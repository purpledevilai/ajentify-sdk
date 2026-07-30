import type { AjentifyClient } from "../client.js";
import { createParameterDefinition, toCodeName, type GetClient } from "../internal.js";
import { toJsonSchema, type SchemaInput } from "../schema.js";
import type {
  ApiDefaultTool,
  ApiTool,
  GetDefaultToolsResponse,
  GetToolsResponse,
  SuccessResponse,
  TestToolResponse,
} from "../types.js";

export interface ToolCreateOptions {
  /** Human-readable description shown to the agent. */
  description?: string;
  /** Marks the tool as client-side; its code runs in your process at invoke time. */
  isClientSide?: boolean;
  /** When true, the tool receives the full context as an extra parameter (server-side). */
  passContext?: boolean;
  /** When true, the tool runs asynchronously (server-side). */
  isAsync?: boolean;
  /** Python source for a server-side tool. Ignored for client-side tools. */
  code?: string;
  /** Pin to a specific organization (defaults to the API key's first org). */
  orgId?: string;
}

export type ToolUpdateOptions = Partial<ToolCreateOptions> & {
  name?: string;
  schema?: SchemaInput;
};

/** A tool as returned by the API, with ergonomic camelCase fields + methods. */
export class Tool {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly description: string | null;
  readonly pdId: string | null;
  readonly code: string | null;
  readonly passContext: boolean;
  readonly isAsync: boolean;
  readonly isClientSide: boolean;
  readonly stageId: string | null;
  readonly logicalName: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;

  /** @internal */
  constructor(
    private readonly client: AjentifyClient,
    data: ApiTool,
  ) {
    this.id = data.tool_id;
    this.orgId = data.org_id;
    this.name = data.name;
    this.description = data.description ?? null;
    this.pdId = data.pd_id ?? null;
    this.code = data.code ?? null;
    this.passContext = data.pass_context;
    this.isAsync = data.is_async;
    this.isClientSide = data.is_client_side_tool;
    this.stageId = data.stage_id ?? null;
    this.logicalName = data.logical_name ?? null;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  /** Update this tool. Passing `schema` creates a new parameter definition. */
  async update(options: ToolUpdateOptions): Promise<Tool> {
    const body: Record<string, unknown> = {};
    if (options.name !== undefined) body.name = options.name;
    if (options.description !== undefined) body.description = options.description;
    if (options.code !== undefined) body.code = options.code;
    if (options.passContext !== undefined) body.pass_context = options.passContext;
    if (options.isAsync !== undefined) body.is_async = options.isAsync;
    if (options.isClientSide !== undefined) body.is_client_side_tool = options.isClientSide;
    if (options.schema !== undefined) {
      body.pd_id = await createParameterDefinition(this.client, await toJsonSchema(options.schema));
    }
    const updated = await this.client.post<ApiTool>(`/tool/${this.id}`, body);
    return new Tool(this.client, updated);
  }

  /** Delete this tool. */
  async delete(): Promise<void> {
    await this.client.delete<SuccessResponse>(`/tool/${this.id}`);
  }

  /** Test a server-side tool's code with the given params, without an agent. */
  async test(params: Record<string, unknown> = {}): Promise<string> {
    const res = await this.client.post<TestToolResponse>("/test-tool", {
      function_name: this.name,
      code: this.code,
      params,
    });
    return res.result;
  }
}

export interface ToolsApi {
  /**
   * Create a tool. Pass a Zod schema (or raw JSON Schema) to define its input;
   * the SDK stores it as a parameter definition automatically.
   */
  create(name: string, schema?: SchemaInput, options?: ToolCreateOptions): Promise<Tool>;
  /** Create the tool, or return the existing one with a matching (normalized) name. */
  getOrCreate(name: string, schema?: SchemaInput, options?: ToolCreateOptions): Promise<Tool>;
  /** Fetch a tool by id. */
  get(toolId: string): Promise<Tool>;
  /** List the org's tools. */
  list(orgId?: string): Promise<Tool[]>;
  /** List the platform's built-in tools (id, name, description, JSON schema, category). */
  defaults(): Promise<ApiDefaultTool[]>;
}

export function createToolsApi(getClient: GetClient): ToolsApi {
  async function create(
    name: string,
    schema?: SchemaInput,
    options: ToolCreateOptions = {},
  ): Promise<Tool> {
    const client = getClient();
    const body: Record<string, unknown> = {
      name,
      description: options.description ?? "",
      pass_context: options.passContext ?? false,
      is_async: options.isAsync ?? false,
      is_client_side_tool: options.isClientSide ?? false,
    };
    if (options.orgId !== undefined) body.org_id = options.orgId;
    if (options.code !== undefined) body.code = options.code;
    if (schema !== undefined) {
      body.pd_id = await createParameterDefinition(client, await toJsonSchema(schema));
    }
    const created = await client.post<ApiTool>("/tool", body);
    return new Tool(client, created);
  }

  return {
    create,

    async getOrCreate(name, schema, options) {
      const client = getClient();
      const target = toCodeName(name);
      const existing = await client.get<GetToolsResponse>("/tools", {
        query: options?.orgId ? { org_id: options.orgId } : undefined,
      });
      const match = existing.tools.find((t) => t.name === target);
      if (match) return new Tool(client, match);
      return create(name, schema, options);
    },

    async get(toolId) {
      const client = getClient();
      const tool = await client.get<ApiTool>(`/tool/${toolId}`);
      return new Tool(client, tool);
    },

    async list(orgId) {
      const client = getClient();
      const res = await client.get<GetToolsResponse>("/tools", {
        query: orgId ? { org_id: orgId } : undefined,
      });
      return res.tools.map((t) => new Tool(client, t));
    },

    async defaults() {
      const client = getClient();
      const res = await client.get<GetDefaultToolsResponse>("/default-tools");
      return res.tools;
    },
  };
}
