import { AjentifyError } from "./errors.js";

export const DEFAULT_BASE_URL = "https://api.ajentify.com";

export interface AjentifyClientOptions {
  /**
   * Org API key used as a Bearer token. Defaults to `process.env.AJENTIFY_API_KEY`.
   * Client-type keys are rejected by the REST API — use an org key.
   */
  apiKey?: string;
  /** Base URL of the API. Defaults to `AJENTIFY_BASE_URL` env or `https://api.ajentify.com`. */
  baseUrl?: string;
  /** Override the `fetch` implementation (useful for tests or older runtimes). */
  fetch?: typeof fetch;
  /**
   * Per-request timeout in milliseconds. Applies to every HTTP call the SDK makes
   * (a long agent run is many short calls, so this bounds a single hung socket,
   * not the whole run — use `signal` on invoke for that). Unset = no timeout.
   */
  timeoutMs?: number;
}

/** Headers that trigger the API's async callback flow. */
export interface CallbackConfig {
  url: string;
  token?: string;
  requestId?: string;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  headers?: Record<string, string>;
  /** When true, the request is allowed to proceed without an API key. */
  public?: boolean;
  /** When set, adds the Callback-URL/Token/Request-ID headers. */
  callback?: CallbackConfig;
  /**
   * When true, sends `Prefer: respond-async`. Routes that support it return
   * `202` with a job to poll; routes that don't simply run synchronously.
   */
  preferAsync?: boolean;
  /** Abort this request (and surface an `AjentifyError` with code `aborted`). */
  signal?: AbortSignal;
}

/** A response with its HTTP status, for callers that branch on 200 vs 202. */
export interface StatusResponse<T> {
  status: number;
  data: T;
}

/**
 * Thin HTTP client over the Ajentify REST API. Adds the Bearer auth header,
 * serializes JSON, maps non-2xx responses to `AjentifyError` (surfacing the
 * server's `error`/`code`), and wires up the async callback headers.
 */
export class AjentifyClient {
  readonly baseUrl: string;
  readonly timeoutMs: number | undefined;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AjentifyClientOptions = {}) {
    this.apiKey = options.apiKey ?? readEnv("AJENTIFY_API_KEY");
    this.baseUrl = (
      options.baseUrl ??
      readEnv("AJENTIFY_BASE_URL") ??
      DEFAULT_BASE_URL
    ).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs;
    const impl = options.fetch ?? globalThis.fetch;
    if (typeof impl !== "function") {
      throw new AjentifyError(
        "No global fetch is available. Use Node 18+ or pass a fetch implementation via createClient({ fetch }).",
      );
    }
    this.fetchImpl = impl;
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const { data } = await this.requestWithStatus<T>(method, path, options);
    return data;
  }

  /** Like `request`, but also returns the HTTP status (e.g. to tell 200 from 202). */
  async requestWithStatus<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<StatusResponse<T>> {
    const url = new URL(this.baseUrl + path);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    } else if (!options.public) {
      throw new AjentifyError(
        "Missing API key. Set AJENTIFY_API_KEY, call configure({ apiKey }), or use createClient({ apiKey }).",
      );
    }

    if (options.callback) {
      headers["Callback-URL"] = options.callback.url;
      if (options.callback.token) headers["Callback-Token"] = options.callback.token;
      if (options.callback.requestId) headers["Callback-Request-ID"] = options.callback.requestId;
    }
    if (options.preferAsync) headers["Prefer"] = "respond-async";

    const signal = combineSignals(options.signal, this.timeoutMs);
    if (signal?.aborted) throw abortedError(method, path, signal);

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw abortedError(method, path, signal);
      throw new AjentifyError(
        `Network error calling ${method} ${path}: ${(err as Error).message}`,
      );
    }

    const text = await response.text();
    let parsed: unknown;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!response.ok) {
      const body = parsed as { error?: string; code?: string } | string | undefined;
      const message =
        body && typeof body === "object" && typeof body.error === "string"
          ? body.error
          : `HTTP ${response.status} from ${method} ${path}`;
      const code = body && typeof body === "object" ? body.code : undefined;
      throw new AjentifyError(message, { status: response.status, code, body: parsed });
    }

    return { status: response.status, data: parsed as T };
  }

  get<T>(path: string, options?: Omit<RequestOptions, "body">): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">): Promise<T> {
    return this.request<T>("POST", path, { ...options, body });
  }

  put<T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">): Promise<T> {
    return this.request<T>("PUT", path, { ...options, body });
  }

  delete<T>(path: string, options?: Omit<RequestOptions, "body">): Promise<T> {
    return this.request<T>("DELETE", path, options);
  }
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const value = env?.[name];
  return value && value.length > 0 ? value : undefined;
}

/** Merge a caller signal with the client-level timeout into one AbortSignal. */
function combineSignals(signal: AbortSignal | undefined, timeoutMs: number | undefined): AbortSignal | undefined {
  const timeout = timeoutMs && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
  if (signal && timeout) {
    const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
    if (typeof any === "function") return any([signal, timeout]);
    // Node 18: no AbortSignal.any — chain manually.
    const controller = new AbortController();
    const forward = (s: AbortSignal) => controller.abort(s.reason);
    for (const s of [signal, timeout]) {
      if (s.aborted) return s;
      s.addEventListener("abort", () => forward(s), { once: true });
    }
    return controller.signal;
  }
  return signal ?? timeout;
}

/** Build the error raised when a request is aborted (caller signal or client timeout). */
export function abortedError(method: string, path: string, signal: AbortSignal): AjentifyError {
  const reason = signal.reason as { name?: string; message?: string } | undefined;
  const timedOut = reason?.name === "TimeoutError";
  return new AjentifyError(
    timedOut
      ? `Timed out calling ${method} ${path}`
      : `Aborted calling ${method} ${path}${reason?.message ? `: ${reason.message}` : ""}`,
    { code: timedOut ? "timeout" : "aborted" },
  );
}
