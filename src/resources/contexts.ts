import type { AjentifyClient } from "../client.js";
import type { GetClient } from "../internal.js";
import {
  serializeToolResult,
  type AsyncAck,
  type ClientSideToolCall,
  type ClientSideToolMap,
  type ClientSideToolResponse,
  type Message,
} from "../messages.js";
import type {
  ApiContext,
  ApiCreateContextResponse,
  ApiOrgContextSummary,
  GetOrgContextsResponse,
  SuccessResponse,
  WireAsyncAck,
  WireChatResponse,
  WireClientSideToolCall,
  WireTerminatingConfig,
} from "../types.js";

export interface ContextCreateOptions {
  /** Values filling the agent prompt's argument placeholders. */
  promptArgs?: Record<string, unknown>;
  /** Arbitrary data made available to tools with `passContext` enabled. */
  userDefined?: Record<string, unknown>;
  /** Extra tool ids to make available on top of the agent's tools (ID-pointer rule). */
  additionalTools?: string[];
  /** Client scoping id. */
  clientId?: string;
  /** Time-to-live in days. */
  ttlDays?: number;
  /** Invoke the agent immediately on creation (agent speaks first). */
  invokeFirst?: boolean;
}

export interface ContextListOptions {
  agentId?: string;
  clientId?: string;
  orgId?: string;
  limit?: number;
  cursor?: string;
}

export interface TerminatingConfig {
  /** Tool ids whose call ends the autonomous run (ID-pointer rule). */
  toolIds?: string[];
  consecutiveNudges?: number;
  nudgeMessage?: string;
  maxInvocations?: number;
}

export interface InvokeOptions {
  /** Map of client-side tool name -> handler, run during the auto loop. */
  clientSideTools?: ClientSideToolMap;
  /** Client-side tool names that break the auto loop and return their call. */
  exitOn?: string[];
  /** Persist the generated AI messages to the context. Defaults to true. */
  save?: boolean;
  /** Autonomous-run terminating configuration. */
  terminating?: TerminatingConfig;
  /** Dispatch asynchronously; results are POSTed to this URL. Returns an AsyncAck. */
  callbackUrl?: string;
  /** Forwarded as the Authorization header on the callback POST. */
  callbackToken?: string;
  /** Sets the request_id echoed back in the callback body. */
  requestId?: string;
}

/** Normalized data behind an InvokeResponse. */
interface InvokeResponseData {
  text: string;
  generatedMessages: Message[];
  clientSideToolCalls: ClientSideToolCall[];
  saved: boolean;
  cost: number | null;
  contextPercentage: number | null;
  modelId: string | null;
  events: Record<string, unknown>[];
}

/**
 * The result of an invocation — a pure data object. Exposes the final text,
 * every generated message, any client-side tool calls that need handling, and
 * cost. To persist a draft for approval, keep `generatedMessages` in your own
 * store, then later `Context.get(id)` and `context.addMessages(...)`.
 */
export class InvokeResponse {
  readonly text: string;
  readonly generatedMessages: Message[];
  readonly clientSideToolCalls: ClientSideToolCall[];
  readonly saved: boolean;
  readonly cost: number | null;
  readonly contextPercentage: number | null;
  readonly modelId: string | null;
  readonly events: Record<string, unknown>[];

  /** @internal */
  constructor(data: InvokeResponseData) {
    this.text = data.text;
    this.generatedMessages = data.generatedMessages;
    this.clientSideToolCalls = data.clientSideToolCalls;
    this.saved = data.saved;
    this.cost = data.cost;
    this.contextPercentage = data.contextPercentage;
    this.modelId = data.modelId;
    this.events = data.events;
  }

  /** True if the invocation stopped waiting on client-side tool calls. */
  get needsClientSideTools(): boolean {
    return this.clientSideToolCalls.length > 0;
  }
}

export interface CallbackResult<T = unknown> {
  requestId: string;
  statusCode: number;
  ok: boolean;
  /**
   * The raw response body from the original endpoint (present on success). It is
   * intentionally NOT reconstructed into an SDK object — the callback boundary is
   * stateless, so you reload whatever you need (e.g. `Context.get(contextId)`,
   * using params you encoded in the callback URL) and continue from there.
   */
  response?: T;
  error?: string;
}

/** A context, with camelCase fields, message-stack control, and invoke methods. */
export interface Context {
  readonly id: string;
  readonly agentId: string;
  readonly orgId: string | null;
  readonly userId: string;
  readonly clientId: string | null;
  readonly modelId: string | null;
  readonly userDefined: Record<string, unknown>;
  readonly contextPercentage: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly expiresAt: number | null;
  /** Present only when a context is created anonymously for a public agent. */
  readonly clientApiKey: string | null;
  /** The cached message stack (as of the last create/get/refresh/mutation). */
  readonly messages: Message[];

  addMessageAndInvoke(
    text: string,
    options: InvokeOptions & { callbackUrl: string },
  ): Promise<AsyncAck>;
  addMessageAndInvoke(text: string, options?: InvokeOptions): Promise<InvokeResponse>;

  invoke(options: InvokeOptions & { callbackUrl: string }): Promise<AsyncAck>;
  invoke(options?: InvokeOptions): Promise<InvokeResponse>;

  addAiMessage(
    input: string | { prompt: string } | { message: string },
    options: InvokeOptions & { callbackUrl: string },
  ): Promise<AsyncAck>;
  addAiMessage(
    input: string | { prompt: string } | { message: string },
    options?: InvokeOptions,
  ): Promise<InvokeResponse>;

  /** Manually submit client-side tool results (single round-trip). */
  submitToolResponses(responses: ClientSideToolResponse[]): Promise<InvokeResponse>;

  /** Append messages to the context (e.g. commit an approved draft). */
  addMessages(messages: Message[]): Promise<Context>;
  /** Replace the entire message stack. */
  setMessages(messages: Message[]): Promise<Context>;
  /** Re-fetch the context (including tool calls) and update cached state. */
  refresh(): Promise<Context>;
  /** Delete the context. */
  delete(): Promise<void>;
}

class ContextImpl implements Context {
  id!: string;
  agentId!: string;
  orgId: string | null = null;
  userId!: string;
  clientId: string | null = null;
  modelId: string | null = null;
  userDefined: Record<string, unknown> = {};
  contextPercentage: number | null = null;
  createdAt = 0;
  updatedAt = 0;
  expiresAt: number | null = null;
  clientApiKey: string | null = null;
  private _messages: Message[] = [];

  constructor(
    private readonly client: AjentifyClient,
    data: ApiContext | ApiCreateContextResponse,
  ) {
    this.hydrate(data);
  }

  get messages(): Message[] {
    return this._messages;
  }

  private hydrate(data: ApiContext | ApiCreateContextResponse): void {
    this.id = data.context_id;
    this.agentId = data.agent_id;
    this.orgId = data.org_id ?? null;
    this.userId = data.user_id;
    this.clientId = data.client_id ?? null;
    this.modelId = data.model_id ?? null;
    this.userDefined = data.user_defined ?? {};
    this.contextPercentage = data.context_percentage ?? null;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
    this.expiresAt = data.expires_at ?? null;
    this._messages = data.messages ?? [];
    if ("client_api_key" in data && data.client_api_key) {
      this.clientApiKey = data.client_api_key;
    }
  }

  addMessageAndInvoke(
    text: string,
    options: InvokeOptions & { callbackUrl: string },
  ): Promise<AsyncAck>;
  addMessageAndInvoke(text: string, options?: InvokeOptions): Promise<InvokeResponse>;
  addMessageAndInvoke(
    text: string,
    options?: InvokeOptions,
  ): Promise<InvokeResponse | AsyncAck> {
    const body: Record<string, unknown> = {
      context_id: this.id,
      message: text,
      save_ai_messages: options?.save ?? true,
    };
    return this.dispatch("/chat", body, options ?? {});
  }

  invoke(options: InvokeOptions & { callbackUrl: string }): Promise<AsyncAck>;
  invoke(options?: InvokeOptions): Promise<InvokeResponse>;
  invoke(options?: InvokeOptions): Promise<InvokeResponse | AsyncAck> {
    const body: Record<string, unknown> = {
      context_id: this.id,
      save_ai_messages: options?.save ?? true,
    };
    return this.dispatch("/chat/invoke", body, options ?? {});
  }

  addAiMessage(
    input: string | { prompt: string } | { message: string },
    options: InvokeOptions & { callbackUrl: string },
  ): Promise<AsyncAck>;
  addAiMessage(
    input: string | { prompt: string } | { message: string },
    options?: InvokeOptions,
  ): Promise<InvokeResponse>;
  addAiMessage(
    input: string | { prompt: string } | { message: string },
    options?: InvokeOptions,
  ): Promise<InvokeResponse | AsyncAck> {
    const body: Record<string, unknown> = {
      context_id: this.id,
      save_ai_messages: options?.save ?? true,
    };
    if (typeof input === "string") {
      body.message = input;
    } else if ("prompt" in input) {
      body.prompt = input.prompt;
    } else {
      body.message = input.message;
    }
    return this.dispatch("/chat/add-ai-message", body, options ?? {});
  }

  async submitToolResponses(responses: ClientSideToolResponse[]): Promise<InvokeResponse> {
    const wire = responses.map((r) => ({
      tool_call_id: r.toolCallId,
      response: serializeToolResult(r.response),
    }));
    const resp = await this.client.post<WireChatResponse>("/chat/client-side-tool-responses", {
      context_id: this.id,
      tool_responses: wire,
    });
    return buildInvokeResponse(resp, resp.generated_messages, resp.invocation_cost ?? 0);
  }

  async addMessages(messages: Message[]): Promise<Context> {
    const updated = await this.client.post<ApiContext>("/context/add-messages", {
      context_id: this.id,
      messages,
    });
    this.hydrate(updated);
    return this;
  }

  async setMessages(messages: Message[]): Promise<Context> {
    const updated = await this.client.post<ApiContext>("/context/set-messages", {
      context_id: this.id,
      messages,
    });
    this.hydrate(updated);
    return this;
  }

  async refresh(): Promise<Context> {
    const updated = await this.client.get<ApiContext>(`/context/${this.id}`, {
      query: { with_tool_calls: true },
    });
    this.hydrate(updated);
    return this;
  }

  async delete(): Promise<void> {
    await this.client.delete<SuccessResponse>(`/context/${this.id}`);
  }

  // --- internals ---------------------------------------------------------

  private async dispatch(
    path: string,
    body: Record<string, unknown>,
    options: InvokeOptions,
  ): Promise<InvokeResponse | AsyncAck> {
    const payload = { ...body };
    if (options.terminating) payload.terminating_config = toWireTerminating(options.terminating);

    if (options.callbackUrl) {
      const ack = await this.client.post<WireAsyncAck>(path, payload, {
        callback: {
          url: options.callbackUrl,
          token: options.callbackToken,
          requestId: options.requestId,
        },
      });
      return { status: "processing", requestId: ack.request_id };
    }

    const first = await this.client.post<WireChatResponse>(path, payload);
    return this.runClientLoop(first, options);
  }

  private async runClientLoop(
    first: WireChatResponse,
    options: InvokeOptions,
  ): Promise<InvokeResponse> {
    const handlers = options.clientSideTools ?? {};
    const exitOn = new Set(options.exitOn ?? []);
    let current = first;
    const generated: Message[] = [...(first.generated_messages ?? [])];
    let cost = first.invocation_cost ?? 0;

    while (current.client_side_tool_calls && current.client_side_tool_calls.length > 0) {
      const calls = current.client_side_tool_calls;
      const anyExit = calls.some((c) => exitOn.has(c.tool_name));
      const allHandled = calls.every((c) => typeof handlers[c.tool_name] === "function");
      // The API requires responses for ALL client-side calls in a turn, so we
      // only continue when every call is handled and none is an explicit exit.
      if (anyExit || !allHandled) break;

      const toolResponses: { tool_call_id: string; response: string }[] = [];
      for (const call of calls) {
        const handler = handlers[call.tool_name]!;
        const out = await handler(call.tool_input, {
          contextId: this.id,
          userDefined: this.userDefined,
          toolCallId: call.tool_call_id,
          toolName: call.tool_name,
        });
        toolResponses.push({
          tool_call_id: call.tool_call_id,
          response: serializeToolResult(out),
        });
      }

      current = await this.client.post<WireChatResponse>("/chat/client-side-tool-responses", {
        context_id: this.id,
        tool_responses: toolResponses,
      });
      generated.push(...(current.generated_messages ?? []));
      cost += current.invocation_cost ?? 0;
    }

    return buildInvokeResponse(current, generated, cost);
  }
}

export interface ContextApi {
  create(agentId: string, options?: ContextCreateOptions): Promise<Context>;
  get(contextId: string, options?: { clientId?: string }): Promise<Context>;
  list(
    options?: ContextListOptions,
  ): Promise<{ contexts: ApiOrgContextSummary[]; nextCursor: string | null }>;
}

export function createContextApi(getClient: GetClient): ContextApi {
  return {
    async create(agentId, options = {}) {
      const client = getClient();
      const body: Record<string, unknown> = { agent_id: agentId };
      if (options.promptArgs !== undefined) body.prompt_args = options.promptArgs;
      if (options.userDefined !== undefined) body.user_defined = options.userDefined;
      if (options.additionalTools !== undefined) body.additional_agent_tools = options.additionalTools;
      if (options.clientId !== undefined) body.client_id = options.clientId;
      if (options.ttlDays !== undefined) body.ttl_days = options.ttlDays;
      if (options.invokeFirst !== undefined) body.invoke_agent_message = options.invokeFirst;
      const created = await client.post<ApiCreateContextResponse>("/context", body);
      return new ContextImpl(client, created);
    },

    async get(contextId, options) {
      const client = getClient();
      const query: Record<string, string | boolean> = { with_tool_calls: true };
      if (options?.clientId) query.client_id = options.clientId;
      const context = await client.get<ApiContext>(`/context/${contextId}`, { query });
      return new ContextImpl(client, context);
    },

    async list(options = {}) {
      const client = getClient();
      const query: Record<string, string | number | undefined> = {};
      if (options.orgId) query.org_id = options.orgId;
      if (options.agentId) query.agent_id = options.agentId;
      if (options.clientId) query.client_id = options.clientId;
      if (options.limit) query.limit = options.limit;
      if (options.cursor) query.cursor = options.cursor;
      const res = await client.get<GetOrgContextsResponse>("/org-contexts", { query });
      return { contexts: res.contexts, nextCursor: res.next_cursor ?? null };
    },
  };
}

/**
 * Decode the envelope an async callback POSTs back. This is a pure, stateless
 * helper — it does NOT reconstruct any SDK object or hold a context. The
 * callback design intentionally hands control back to you: encode whatever you
 * need (e.g. the context id) in the callback URL, then here reload it with
 * `Context.get(contextId)` and continue.
 *
 * `response` is the raw body from the original endpoint. Type it yourself when
 * you know which endpoint the callback is for, e.g. `parseCallback<MyShape>(body)`.
 */
export function parseCallback<T = unknown>(body: unknown): CallbackResult<T> {
  const b = (body ?? {}) as {
    request_id?: string;
    status_code?: number;
    response?: unknown;
    error?: string;
  };
  const statusCode = b.status_code ?? (b.error ? 500 : 200);
  const result: CallbackResult<T> = {
    requestId: b.request_id ?? "",
    statusCode,
    ok: !b.error && statusCode >= 200 && statusCode < 300,
  };
  if (b.error) result.error = b.error;
  if (b.response !== undefined) result.response = b.response as T;
  return result;
}

function mapClientSideToolCalls(
  calls: WireClientSideToolCall[] | null | undefined,
): ClientSideToolCall[] {
  return (calls ?? []).map((c) => ({
    toolCallId: c.tool_call_id,
    toolName: c.tool_name,
    toolInput: c.tool_input,
  }));
}

function buildInvokeResponse(
  wire: WireChatResponse,
  generatedMessages: Message[],
  cost: number,
): InvokeResponse {
  return new InvokeResponse({
    text: wire.response,
    generatedMessages,
    clientSideToolCalls: mapClientSideToolCalls(wire.client_side_tool_calls),
    saved: wire.saved_ai_messages,
    cost,
    contextPercentage: wire.context_percentage ?? null,
    modelId: wire.model_id ?? null,
    events: wire.events ?? [],
  });
}

function toWireTerminating(config: TerminatingConfig): WireTerminatingConfig {
  const wire: WireTerminatingConfig = {};
  if (config.toolIds !== undefined) wire.tool_ids = config.toolIds;
  if (config.consecutiveNudges !== undefined) wire.consecutive_nudges = config.consecutiveNudges;
  if (config.nudgeMessage !== undefined) wire.nudge_message = config.nudgeMessage;
  if (config.maxInvocations !== undefined) wire.max_invocations = config.maxInvocations;
  return wire;
}
