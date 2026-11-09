import type { AjentifyClient } from "../client.js";
import { abortedError } from "../client.js";
import { AjentifyError } from "../errors.js";
import type { GetClient } from "../internal.js";
import { waitForJob } from "./jobs.js";
import {
  serializeToolResult,
  type AsyncAck,
  type AsyncToolResponse,
  type AsyncToolResponseAck,
  type ClientSideToolCall,
  type ClientSideToolMap,
  type ClientSideToolResponse,
  type Message,
  type QueuedResponse,
} from "../messages.js";
import type {
  ApiContext,
  ApiCreateContextResponse,
  ApiOrgContextSummary,
  GetOrgContextsResponse,
  SuccessResponse,
  WireAsyncAck,
  WireAsyncToolResponseAck,
  WireChatResponse,
  WireClientSideToolCall,
  WireQueuedResponse,
  WireTerminatingConfig,
} from "../types.js";

export interface ContextCreateOptions {
  /** Values filling the agent prompt's argument placeholders. */
  promptArgs?: Record<string, unknown>;
  /** Arbitrary data made available to tools with `passContext` enabled. */
  userDefined?: Record<string, unknown>;
  /** Extra tool ids to make available on top of the agent's tools (ID-pointer rule). */
  additionalTools?: string[];
  /** Extra MCP connection ids whose selected tools to make available on top of the agent's (ID-pointer rule). */
  additionalMcpConnections?: string[];
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

/**
 * How an invocation waits for the agent.
 *
 * - `"sync"` (default) — one HTTP request stays open per model turn. Simple, but
 *   each turn is capped by the API's synchronous limit (~29 s).
 * - `"poll"` — each turn is dispatched as a job (`Prefer: respond-async`) and the
 *   SDK polls `GET /job/{id}` until it finishes. Use for long-running / autonomous
 *   runs; combine with `signal` to bound the whole run.
 * - `"webhook"` — dispatched as a job and the result is POSTed to `callbackUrl`;
 *   the call returns an `AsyncAck` immediately. The client-side tool loop does
 *   not run in this mode (see `parseCallback`).
 */
export type InvokeStrategy = "sync" | "poll" | "webhook";

export interface InvokeOptions {
  /** Map of client-side tool name -> handler, run during the auto loop. */
  clientSideTools?: ClientSideToolMap;
  /** Client-side tool names that break the auto loop and return their call. */
  exitOn?: string[];
  /** Persist the generated AI messages to the context. Defaults to true. */
  save?: boolean;
  /** Autonomous-run terminating configuration. */
  terminating?: TerminatingConfig;
  /**
   * How to wait for the agent. Defaults to `"sync"`, or `"webhook"` when a
   * `callbackUrl` is given.
   */
  strategy?: InvokeStrategy;
  /** `poll` strategy: milliseconds between job polls. Defaults to 2000. */
  pollIntervalMs?: number;
  /**
   * Abort the whole invocation — the current request, the client-side tool loop
   * and any job polling. Typically `AbortSignal.timeout(ms)`. Rejects with an
   * `AjentifyError` whose `code` is `"timeout"` or `"aborted"`. Note the agent's
   * current turn keeps running server-side; messages generated so far are saved.
   */
  signal?: AbortSignal;
  /** `webhook` strategy: results are POSTed to this URL. Returns an AsyncAck. */
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

/**
 * What a `sync` / `poll` invoke resolves to: the agent's turn, or a
 * `QueuedResponse` when the context was being run by someone else (your input
 * was queued and will be applied by that run). Narrow with `isQueued()`.
 */
export type InvokeResult = InvokeResponse | QueuedResponse;

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

  /**
   * Add a human message and run the agent. Resolves to an `InvokeResponse`, or
   * a `QueuedResponse` if the context was being run by someone else (see
   * `isQueued`); with `callbackUrl` / the `webhook` strategy, an `AsyncAck`.
   */
  addMessageAndInvoke(
    text: string,
    options: InvokeOptions & { callbackUrl: string },
  ): Promise<AsyncAck>;
  addMessageAndInvoke(text: string, options?: InvokeOptions): Promise<InvokeResult>;

  /** Run the agent on the current message stack. Same result contract as `addMessageAndInvoke`. */
  invoke(options: InvokeOptions & { callbackUrl: string }): Promise<AsyncAck>;
  invoke(options?: InvokeOptions): Promise<InvokeResult>;

  /** Insert / generate an AI message. Same result contract as `addMessageAndInvoke`. */
  addAiMessage(
    input: string | { prompt: string } | { message: string },
    options: InvokeOptions & { callbackUrl: string },
  ): Promise<AsyncAck>;
  addAiMessage(
    input: string | { prompt: string } | { message: string },
    options?: InvokeOptions,
  ): Promise<InvokeResult>;

  /**
   * Submit client-side tool results and continue the agent. With `options`
   * (e.g. `clientSideTools`, `strategy`) the auto loop resumes from here;
   * without them it is a single round-trip and the result may again
   * `needsClientSideTools`. May resolve to a `QueuedResponse` (see `isQueued`).
   */
  submitToolResponses(
    responses: ClientSideToolResponse[],
    options?: Omit<InvokeOptions, "save" | "callbackUrl" | "callbackToken" | "requestId">,
  ): Promise<InvokeResult>;

  /**
   * Deliver the result of an **async tool** call (`isAsync` tools return an
   * acknowledgement immediately; the real result arrives later via this call).
   * The response is queued on the context's inbox and the context is run
   * automatically to process it — no re-invoke needed.
   */
  asyncToolResponse(response: AsyncToolResponse): Promise<AsyncToolResponseAck>;

  /** Append messages to the context (e.g. commit an approved draft). */
  addMessages(messages: Message[]): Promise<Context>;
  /** Replace the entire message stack. */
  setMessages(messages: Message[]): Promise<Context>;
  /** Re-fetch the context (including tool calls) and update cached state. */
  refresh(options?: ContextGetOptions): Promise<Context>;
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
  addMessageAndInvoke(text: string, options?: InvokeOptions): Promise<InvokeResult>;
  addMessageAndInvoke(
    text: string,
    options?: InvokeOptions,
  ): Promise<InvokeResult | AsyncAck> {
    const body: Record<string, unknown> = {
      context_id: this.id,
      message: text,
      save_ai_messages: options?.save ?? true,
    };
    return this.dispatch("/chat", body, options ?? {});
  }

  invoke(options: InvokeOptions & { callbackUrl: string }): Promise<AsyncAck>;
  invoke(options?: InvokeOptions): Promise<InvokeResult>;
  invoke(options?: InvokeOptions): Promise<InvokeResult | AsyncAck> {
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
  ): Promise<InvokeResult>;
  addAiMessage(
    input: string | { prompt: string } | { message: string },
    options?: InvokeOptions,
  ): Promise<InvokeResult | AsyncAck> {
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

  async submitToolResponses(
    responses: ClientSideToolResponse[],
    options: Omit<InvokeOptions, "save" | "callbackUrl" | "callbackToken" | "requestId"> = {},
  ): Promise<InvokeResult> {
    const wire = responses.map((r) => ({
      tool_call_id: r.toolCallId,
      response: serializeToolResult(r.response),
    }));
    const resp = await this.turn(
      "/chat/client-side-tool-responses",
      { context_id: this.id, tool_responses: wire },
      options,
    );
    return this.runClientLoop(resp, options);
  }

  asyncToolResponse(response: AsyncToolResponse): Promise<AsyncToolResponseAck> {
    return postAsyncToolResponse(this.client, this.id, response);
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

  async refresh(options?: ContextGetOptions): Promise<Context> {
    const updated = await this.client.get<ApiContext>(`/context/${this.id}`, {
      query: contextGetQuery(options),
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
  ): Promise<InvokeResult | AsyncAck> {
    const payload = { ...body };
    if (options.terminating) payload.terminating_config = toWireTerminating(options.terminating);

    const strategy = resolveStrategy(options);
    if (strategy === "webhook") {
      if (!options.callbackUrl) {
        throw new AjentifyError('The "webhook" strategy requires a callbackUrl.');
      }
      const ack = await this.client.post<WireAsyncAck>(path, payload, {
        callback: {
          url: options.callbackUrl,
          token: options.callbackToken,
          requestId: options.requestId,
        },
        signal: options.signal,
      });
      return { status: "processing", requestId: ack.request_id, jobId: ack.job_id ?? null };
    }

    const first = await this.turn(path, payload, options);
    return this.runClientLoop(first, options);
  }

  /**
   * Run one model turn and return its ChatResponse, honouring the strategy:
   * `sync` keeps the request open; `poll` asks for a job and waits on it (and
   * transparently accepts a 200 if the route answered synchronously anyway).
   *
   * Either way the turn may come back *queued* (`WireQueuedResponse`): the
   * context was being run by someone else, so the input was placed on its inbox
   * for that run to apply. `sync` signals this with HTTP 202; `poll` with a job
   * whose `result` is the queued object.
   */
  private async turn(
    path: string,
    payload: Record<string, unknown>,
    options: Pick<InvokeOptions, "strategy" | "pollIntervalMs" | "signal" | "callbackUrl">,
  ): Promise<WireChatResponse | WireQueuedResponse> {
    const signal = options.signal;
    if (resolveStrategy(options) !== "poll") {
      const { status, data } = await this.client.requestWithStatus<WireChatResponse | WireQueuedResponse>(
        "POST",
        path,
        { body: payload, signal },
      );
      if (status === 202 && !isWireQueued(data)) {
        throw new AjentifyError(`Unexpected 202 from ${path}`, { status, body: data });
      }
      return data;
    }
    const { status, data } = await this.client.requestWithStatus<
      WireChatResponse | WireAsyncAck | WireQueuedResponse
    >("POST", path, { body: payload, preferAsync: true, signal });
    if (status !== 202) return data as WireChatResponse;
    // A 202 is normally the job ack; if the route short-circuited to "queued" it is that instead.
    if (isWireQueued(data)) return data;
    const ack = data as WireAsyncAck;
    if (!ack.job_id) {
      throw new AjentifyError(`Async dispatch of ${path} returned no job_id`, { status, body: data });
    }
    const job = await waitForJob<WireChatResponse | WireQueuedResponse>(this.client, ack.job_id, {
      intervalMs: options.pollIntervalMs,
      signal,
    });
    if (!job.result) {
      // A completed job with no result carries the reason in job.error (e.g. result_too_large:
      // the response exceeded the job row cap). Surface that instead of a generic failure.
      const reason = job.error;
      throw new AjentifyError(
        reason?.message ? `Job ${job.id} completed without a result: ${reason.message}` : `Job ${job.id} completed without a result`,
        { status: reason?.statusCode, code: reason?.code ?? "job_no_result", body: job },
      );
    }
    return job.result;
  }

  private async runClientLoop(
    first: WireChatResponse | WireQueuedResponse,
    options: Omit<InvokeOptions, "save" | "callbackUrl" | "callbackToken" | "requestId">,
  ): Promise<InvokeResult> {
    if (isWireQueued(first)) return mapQueued(first);
    const handlers = options.clientSideTools ?? {};
    const exitOn = new Set(options.exitOn ?? []);
    let current: WireChatResponse = first;
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
        if (options.signal?.aborted) throw abortedError("POST", "/chat/client-side-tool-responses", options.signal);
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

      const next = await this.turn(
        "/chat/client-side-tool-responses",
        { context_id: this.id, tool_responses: toolResponses },
        options,
      );
      // Mid-loop the context can be taken over by another run; our tool responses were
      // queued for it, so hand back the QueuedResponse (messages so far are on the context).
      if (isWireQueued(next)) return mapQueued(next);
      current = next;
      generated.push(...(current.generated_messages ?? []));
      cost += current.invocation_cost ?? 0;
    }

    return buildInvokeResponse(current, generated, cost);
  }
}

function isWireQueued(data: unknown): data is WireQueuedResponse {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { status?: unknown }).status === "queued" &&
    typeof (data as { context_id?: unknown }).context_id === "string"
  );
}

function mapQueued(wire: WireQueuedResponse): QueuedResponse {
  return { status: "queued", itemId: wire.item_id ?? null, contextId: wire.context_id };
}

async function postAsyncToolResponse(
  client: AjentifyClient,
  contextId: string,
  response: AsyncToolResponse,
): Promise<AsyncToolResponseAck> {
  const ack = await client.post<WireAsyncToolResponseAck>("/async-tool-response", {
    context_id: contextId,
    tool_call_id: response.toolCallId,
    response: serializeToolResult(response.response),
  });
  return { status: "triggered", itemId: ack.item_id };
}

function resolveStrategy(options: Pick<InvokeOptions, "strategy" | "callbackUrl">): InvokeStrategy {
  if (options.strategy) return options.strategy;
  return options.callbackUrl ? "webhook" : "sync";
}

export interface ContextGetOptions {
  /** Org-API-key proxies: assert the context belongs to this client (404 otherwise). */
  clientId?: string;
  /**
   * Per-message cap on `tool_output` in the returned messages. The API returns 8 000-character
   * previews by default (ending in a `[TOOL OUTPUT TRIMMED: …]` marker); pass `0` for the full
   * stored outputs.
   */
  toolOutputMaxChars?: number;
}

function contextGetQuery(options?: ContextGetOptions): Record<string, string | number | boolean> {
  const query: Record<string, string | number | boolean> = { with_tool_calls: true };
  if (options?.clientId) query.client_id = options.clientId;
  if (options?.toolOutputMaxChars !== undefined) query.tool_output_max_chars = options.toolOutputMaxChars;
  return query;
}

export interface ContextApi {
  create(agentId: string, options?: ContextCreateOptions): Promise<Context>;
  get(contextId: string, options?: ContextGetOptions): Promise<Context>;
  list(
    options?: ContextListOptions,
  ): Promise<{ contexts: ApiOrgContextSummary[]; nextCursor: string | null }>;
  /**
   * Deliver the result of an async tool call without loading the context first
   * (`POST /async-tool-response`). The context is run automatically to process it.
   */
  asyncToolResponse(contextId: string, response: AsyncToolResponse): Promise<AsyncToolResponseAck>;
}

export function createContextApi(getClient: GetClient): ContextApi {
  return {
    async create(agentId, options = {}) {
      const client = getClient();
      const body: Record<string, unknown> = { agent_id: agentId };
      if (options.promptArgs !== undefined) body.prompt_args = options.promptArgs;
      if (options.userDefined !== undefined) body.user_defined = options.userDefined;
      if (options.additionalTools !== undefined) body.additional_agent_tools = options.additionalTools;
      if (options.additionalMcpConnections !== undefined)
        body.additional_mcp_connections = options.additionalMcpConnections;
      if (options.clientId !== undefined) body.client_id = options.clientId;
      if (options.ttlDays !== undefined) body.ttl_days = options.ttlDays;
      if (options.invokeFirst !== undefined) body.invoke_agent_message = options.invokeFirst;
      const created = await client.post<ApiCreateContextResponse>("/context", body);
      return new ContextImpl(client, created);
    },

    async get(contextId, options) {
      const client = getClient();
      const context = await client.get<ApiContext>(`/context/${contextId}`, { query: contextGetQuery(options) });
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

    asyncToolResponse(contextId, response) {
      return postAsyncToolResponse(getClient(), contextId, response);
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
