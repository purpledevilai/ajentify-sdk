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
}

/**
 * Thin HTTP client over the Ajentify REST API. Adds the Bearer auth header,
 * serializes JSON, maps non-2xx responses to `AjentifyError` (surfacing the
 * server's `error`/`code`), and wires up the async callback headers.
 */
export class AjentifyClient {
  readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AjentifyClientOptions = {}) {
    this.apiKey = options.apiKey ?? readEnv("AJENTIFY_API_KEY");
    this.baseUrl = (
      options.baseUrl ??
      readEnv("AJENTIFY_BASE_URL") ??
      DEFAULT_BASE_URL
    ).replace(/\/+$/, "");
    const impl = options.fetch ?? globalThis.fetch;
    if (typeof impl !== "function") {
      throw new AjentifyError(
        "No global fetch is available. Use Node 18+ or pass a fetch implementation via createClient({ fetch }).",
      );
    }
    this.fetchImpl = impl;
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
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

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch (err) {
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

    return parsed as T;
  }

  get<T>(path: string, options?: Omit<RequestOptions, "body">): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">): Promise<T> {
    return this.request<T>("POST", path, { ...options, body });
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
