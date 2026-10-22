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

/** Serialize a tool handler's return value to the string the API expects. */
export function serializeToolResult(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? null);
}
