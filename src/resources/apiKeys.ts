import type { GetClient } from "../internal.js";
import type { ApiAPIKey, ApiAPIKeySummary, GetAPIKeysResponse } from "../types.js";

export interface ApiKeyGenerateOptions {
  /** "org" (server-side REST access) or "client" (WebSocket/voice only). Defaults to "org". */
  type?: "org" | "client";
  /** Required only for client-type keys. */
  clientId?: string;
  orgId?: string;
}

/** A freshly generated API key. The raw `token` is only returned here, once. */
export interface GeneratedApiKey {
  id: string;
  orgId: string;
  token: string;
  valid: boolean;
  type: "org" | "client";
  userId: string;
  clientId: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
}

/** API key metadata as returned by list (no raw token). */
export interface ApiKeyInfo {
  id: string;
  orgId: string;
  tokenHint: string;
  valid: boolean;
  createdAt: number;
}

function mapGenerated(data: ApiAPIKey): GeneratedApiKey {
  return {
    id: data.api_key_id,
    orgId: data.org_id,
    token: data.token,
    valid: data.valid,
    type: data.type,
    userId: data.user_id,
    clientId: data.client_id ?? null,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    expiresAt: data.expires_at ?? null,
  };
}

function mapSummary(data: ApiAPIKeySummary): ApiKeyInfo {
  return {
    id: data.api_key_id,
    orgId: data.org_id,
    tokenHint: data.token_hint,
    valid: data.valid,
    createdAt: data.created_at,
  };
}

export interface ApiKeyApi {
  /** Generate a new API key (returns the raw token exactly once). */
  generate(options?: ApiKeyGenerateOptions): Promise<GeneratedApiKey>;
  /** List the org's API keys (metadata only). */
  list(orgId?: string): Promise<ApiKeyInfo[]>;
  /** Revoke an API key by id. */
  revoke(apiKeyId: string): Promise<ApiKeyInfo>;
}

export function createApiKeyApi(getClient: GetClient): ApiKeyApi {
  return {
    async generate(options = {}) {
      const client = getClient();
      const body: Record<string, unknown> = { type: options.type ?? "org" };
      if (options.clientId !== undefined) body.client_id = options.clientId;
      if (options.orgId !== undefined) body.org_id = options.orgId;
      const created = await client.post<ApiAPIKey>("/generate-api-key", body);
      return mapGenerated(created);
    },

    async list(orgId) {
      const client = getClient();
      const res = await client.get<GetAPIKeysResponse>("/api-keys", {
        query: orgId ? { org_id: orgId } : undefined,
      });
      return res.api_keys.map(mapSummary);
    },

    async revoke(apiKeyId) {
      const client = getClient();
      const summary = await client.post<ApiAPIKeySummary>("/revoke-api-key", {
        api_key_id: apiKeyId,
      });
      return mapSummary(summary);
    },
  };
}
