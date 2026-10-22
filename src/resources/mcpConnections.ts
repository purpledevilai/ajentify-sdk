import type { AjentifyClient } from "../client.js";
import type { GetClient } from "../internal.js";
import type {
  ApiMCPConnection,
  ApiMCPTool,
  GetMCPConnectionsResponse,
  SuccessResponse,
} from "../types.js";

/** A single tool selected from an MCP server. */
export interface MCPTool {
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
}

export interface MCPConnectionCreateOptions {
  /** Whether the MCP server requires OAuth. */
  requiresAuth?: boolean;
  /** OAuth access token obtained by the caller. */
  accessToken?: string | null;
  /** OAuth refresh token obtained by the caller. */
  refreshToken?: string | null;
  /** Cached OAuth token endpoint of the MCP authorization server. */
  tokenEndpoint?: string | null;
  /** OAuth client_id resolved for this connection's authorization server. */
  clientId?: string | null;
  /** Authorization-server issuer, used to resolve the cached OAuth client (and its secret) at refresh time. */
  issuer?: string | null;
  /** The subset of the server's tools to expose to agents. */
  selectedTools?: MCPTool[];
  /** Pin to a specific organization (defaults to the API key's first org). */
  orgId?: string;
}

export interface MCPConnectionUpdateOptions {
  name?: string;
  mcpUrl?: string;
  requiresAuth?: boolean;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenEndpoint?: string | null;
  clientId?: string | null;
  issuer?: string | null;
  selectedTools?: MCPTool[];
}

function toMCPTool(t: ApiMCPTool): MCPTool {
  return {
    name: t.name,
    description: t.description ?? null,
    inputSchema: t.input_schema ?? {},
    outputSchema: t.output_schema ?? null,
  };
}

function fromMCPTool(t: MCPTool): ApiMCPTool {
  return {
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
    output_schema: t.outputSchema,
  };
}

/** An MCP connection, with camelCase fields and instance helpers. */
export class MCPConnection {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly mcpUrl: string;
  readonly requiresAuth: boolean;
  readonly issuer: string | null;
  readonly selectedTools: MCPTool[];
  readonly stageId: string | null;
  readonly logicalName: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;

  /** @internal */
  constructor(
    private readonly client: AjentifyClient,
    data: ApiMCPConnection,
  ) {
    this.id = data.mcp_connection_id;
    this.orgId = data.org_id;
    this.name = data.name;
    this.mcpUrl = data.mcp_url;
    this.requiresAuth = data.requires_auth;
    this.issuer = data.issuer ?? null;
    this.selectedTools = (data.selected_tools ?? []).map(toMCPTool);
    this.stageId = data.stage_id ?? null;
    this.logicalName = data.logical_name ?? null;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  /** Update this connection (e.g. change the selected tool set). */
  async update(options: MCPConnectionUpdateOptions): Promise<MCPConnection> {
    const body: Record<string, unknown> = {};
    if (options.name !== undefined) body.name = options.name;
    if (options.mcpUrl !== undefined) body.mcp_url = options.mcpUrl;
    if (options.requiresAuth !== undefined) body.requires_auth = options.requiresAuth;
    if (options.accessToken !== undefined) body.access_token = options.accessToken;
    if (options.refreshToken !== undefined) body.refresh_token = options.refreshToken;
    if (options.tokenEndpoint !== undefined) body.token_endpoint = options.tokenEndpoint;
    if (options.clientId !== undefined) body.client_id = options.clientId;
    if (options.issuer !== undefined) body.issuer = options.issuer;
    if (options.selectedTools !== undefined) body.selected_tools = options.selectedTools.map(fromMCPTool);
    const updated = await this.client.post<ApiMCPConnection>(`/mcp-connection/${this.id}`, body);
    return new MCPConnection(this.client, updated);
  }

  /** Delete this connection. */
  async delete(): Promise<void> {
    await this.client.delete<SuccessResponse>(`/mcp-connection/${this.id}`);
  }
}

export interface MCPConnectionApi {
  /** Create an MCP connection with its selected tools. */
  create(name: string, mcpUrl: string, options?: MCPConnectionCreateOptions): Promise<MCPConnection>;
  /** Fetch a connection by id. */
  get(mcpConnectionId: string): Promise<MCPConnection>;
  /** List the org's MCP connections. */
  list(orgId?: string): Promise<MCPConnection[]>;
}

export function createMCPConnectionApi(getClient: GetClient): MCPConnectionApi {
  return {
    async create(name, mcpUrl, options = {}) {
      const client = getClient();
      const body: Record<string, unknown> = {
        name,
        mcp_url: mcpUrl,
        requires_auth: options.requiresAuth ?? false,
        selected_tools: (options.selectedTools ?? []).map(fromMCPTool),
      };
      if (options.orgId !== undefined) body.org_id = options.orgId;
      if (options.accessToken !== undefined) body.access_token = options.accessToken;
      if (options.refreshToken !== undefined) body.refresh_token = options.refreshToken;
      if (options.tokenEndpoint !== undefined) body.token_endpoint = options.tokenEndpoint;
      if (options.clientId !== undefined) body.client_id = options.clientId;
      if (options.issuer !== undefined) body.issuer = options.issuer;
      const created = await client.post<ApiMCPConnection>("/mcp-connection", body);
      return new MCPConnection(client, created);
    },

    async get(mcpConnectionId) {
      const client = getClient();
      const connection = await client.get<ApiMCPConnection>(`/mcp-connection/${mcpConnectionId}`);
      return new MCPConnection(client, connection);
    },

    async list(orgId) {
      const client = getClient();
      const res = await client.get<GetMCPConnectionsResponse>("/mcp-connections", {
        query: orgId ? { org_id: orgId } : undefined,
      });
      return res.mcp_connections.map((c) => new MCPConnection(client, c));
    },
  };
}
