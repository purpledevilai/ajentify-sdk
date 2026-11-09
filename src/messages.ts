import type { ApiContextMessage } from "./types.js";

/**
 * A single message on a context. Uses the same shape the API emits so that
 * `response.generatedMessages` can be passed straight back into
 * `context.addMessages(...)` / `context.setMessages(...)` losslessly.
 *
 * It is a discriminated union:
 *  - `{ sender, message }`                       plain human/ai/system text
 *  - `{ type: "tool_call", ... }`                a tool invocation
 *  - `{ type: "tool_response", ... }`            a tool result
 */
export type Message = ApiContextMessage;

/** A client-side tool call returned from an invocation, in camelCase. */
export interface ClientSideToolCall {
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

/** A response to a client-side tool call, submitted back to the context. */
export interface ClientSideToolResponse {
  toolCallId: string;
  /** String or any JSON-serializable value (objects are JSON-stringified). */
  response: unknown;
}

/** Context passed to a client-side tool handler at invoke time. */
export interface ClientToolContext {
  contextId: string;
  userDefined: Record<string, unknown>;
  toolCallId: string;
  toolName: string;
}

/**
 * A client-side tool handler. Receives the tool input (typed by the agent's
 * tool schema on the server) and a small context, and returns the tool result.
 */
export type ClientSideToolHandler = (
  input: Record<string, unknown>,
  ctx: ClientToolContext,
) => unknown | Promise<unknown>;

/** Map of client-side tool name -> handler, supplied to invoke methods. */
export type ClientSideToolMap = Record<string, ClientSideToolHandler>;

/**
 * Acknowledgement returned when an invoke is dispatched with the `webhook`
 * strategy (`callbackUrl`). The result is POSTed to your URL; `jobId` lets you
 * also inspect it with `Job.get(jobId)` / `Job.wait(jobId)` in the meantime.
 */
export interface AsyncAck {
  status: "processing";
  requestId: string;
  jobId: string | null;
}

/**
 * Returned (instead of an `InvokeResponse`) when the context was being run by
 * someone else at the moment of the call — a concurrent `/chat`, a live chat
 * session, a schedule or a sub-agent reply. Your input is NOT lost: it was queued
 * on the context's inbox and the current run applies it (and generates the
 * agent's reply) before it finishes. Check back with `Context.get(contextId)`.
 *
 * Surfaced by every invoke method for the `sync` strategy (HTTP 202) and the
 * `poll` strategy (job result `{ status: "queued" }`). Narrow with `isQueued()`.
 */
export interface QueuedResponse {
  status: "queued";
  /** The inbox item holding your input. `null` for `invoke()`, which queues nothing. */
  itemId: string | null;
  contextId: string;
}

/** Type guard: true when an invoke result is a `QueuedResponse` rather than an `InvokeResponse`. */
export function isQueued(result: unknown): result is QueuedResponse {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { status?: unknown }).status === "queued" &&
    typeof (result as { contextId?: unknown }).contextId === "string"
  );
}

/** A response to an async tool call, delivered via `/async-tool-response`. */
export interface AsyncToolResponse {
  toolCallId: string;
  /** String or any JSON-serializable value (objects are JSON-stringified). */
  response: unknown;
}

/**
 * Acknowledgement of `asyncToolResponse()`: the response is queued on the
 * context's inbox and a run of the context has been started to process it (or,
 * if the context is already running, that run picks it up before finishing).
 */
export interface AsyncToolResponseAck {
  status: "triggered";
  /** Inbox item id of the queued response. */
  itemId: string;
}

/** Serialize a tool handler's return value to the string the API expects. */
export function serializeToolResult(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? null);
}
