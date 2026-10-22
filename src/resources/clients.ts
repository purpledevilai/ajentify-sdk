import type { GetClient } from "../internal.js";
import type { ApiClient } from "../types.js";

/**
 * A client is one of *your* end-users — the person chatting with an agent through
 * your product. Ajentify mints the `id`; store it against your own user record and
 * pass it to `Context.create(..., { clientId })` and `ApiKey.generate({ type: "client", clientId })`.
 */
export interface ClientRecord {
  id: string;
  orgId: string;
  createdAt: number;
}

export interface ClientCreateOptions {
  /** Organization the client belongs to. Defaults to the caller's first org. */
  orgId?: string;
}

function mapClient(data: ApiClient): ClientRecord {
  return {
    id: data.client_id,
    orgId: data.org_id,
    createdAt: data.created_at,
  };
}

export interface ClientApi {
  /** Mint a new client_id (server-generated) without creating a context. */
  create(options?: ClientCreateOptions): Promise<ClientRecord>;
}

export function createClientApi(getClient: GetClient): ClientApi {
  return {
    async create(options = {}) {
      const client = getClient();
      const body: Record<string, unknown> = {};
      if (options.orgId !== undefined) body.org_id = options.orgId;
      const created = await client.post<ApiClient>("/client", body);
      return mapClient(created);
    },
  };
}
