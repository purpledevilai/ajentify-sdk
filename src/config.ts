import { AjentifyClient, type AjentifyClientOptions } from "./client.js";

let overrides: AjentifyClientOptions = {};
let defaultClient: AjentifyClient | undefined;

/**
 * Set global defaults (apiKey, baseUrl, fetch) used by the top-level namespaces
 * (`Agent`, `Context`, `Tools`, ...). Call before your first API call. This
 * resets the cached default client so subsequent calls pick up the new config.
 */
export function configure(options: AjentifyClientOptions): void {
  overrides = { ...overrides, ...options };
  defaultClient = undefined;
}

/** Lazily construct (and cache) the default client bound to global config + env. */
export function getDefaultClient(): AjentifyClient {
  if (!defaultClient) defaultClient = new AjentifyClient(overrides);
  return defaultClient;
}

/** For tests: clear the cached default client and any overrides. */
export function resetDefaultClient(): void {
  overrides = {};
  defaultClient = undefined;
}
