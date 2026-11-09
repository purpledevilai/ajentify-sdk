import { InvokeResponse, isQueued, type InvokeResult } from "../src/index.js";

/** Narrow an invoke result to the InvokeResponse branch (fails loudly if the context was busy). */
export function invoked(result: InvokeResult): InvokeResponse {
  if (isQueued(result)) throw new Error(`expected an InvokeResponse, got queued ${JSON.stringify(result)}`);
  return result;
}

export interface MockCall {
  url: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  query: URLSearchParams;
}

export interface MockResult {
  status?: number;
  body?: unknown;
}

export type MockHandler = (call: MockCall) => MockResult;

/**
 * Build a fetch stand-in that records calls and returns queued/handler-driven
 * responses. Pass to createClient({ fetch }).
 */
export function mockFetch(handler: MockHandler): { fetch: typeof fetch; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const impl = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const call: MockCall = {
      url: url.toString(),
      path: url.pathname,
      method: init?.method ?? "GET",
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body ? JSON.parse(init.body as string) : undefined,
      query: url.searchParams,
    };
    calls.push(call);
    const result = handler(call);
    const status = result.status ?? 200;
    const text = result.body === undefined ? "" : JSON.stringify(result.body);
    return new Response(text, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetch: impl as unknown as typeof fetch, calls };
}

/** A sequential responder: returns queued results in order. */
export function sequence(...results: MockResult[]): MockHandler {
  let i = 0;
  return () => results[Math.min(i++, results.length - 1)]!;
}
