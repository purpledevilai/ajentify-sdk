import type { AjentifyClient } from "../client.js";
import { createParameterDefinition, type GetClient } from "../internal.js";
import { toJsonSchema, type InferOutput, type SchemaInput } from "../schema.js";
import type {
  ApiStructuredResponseEndpoint,
  GetSREsResponse,
  SuccessResponse,
} from "../types.js";

export interface SRECreateParams<S extends SchemaInput> {
  /** Output schema (Zod or raw JSON Schema) the response is coerced to. */
  schema: S;
  /** Prompt template with ${VARIABLE} placeholders matching `variableNames`. */
  promptTemplate: string;
  variableNames?: string[];
  modelId?: string;
  description?: string;
  isPublic?: boolean;
  orgId?: string;
}

export interface SREInlineParams<S extends SchemaInput> {
  prompt: string;
  schema: S;
  model?: string;
}

export interface SREUpdateParams {
  name?: string;
  description?: string;
  schema?: SchemaInput;
  promptTemplate?: string;
  variableNames?: string[];
  modelId?: string;
  isPublic?: boolean;
}

/** A saved structured-response endpoint. `run` returns the typed output. */
export interface StructuredResponse<Output = unknown> {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly description: string | null;
  readonly pdId: string;
  readonly isPublic: boolean;
  readonly promptTemplate: string | null;
  readonly variableNames: string[];
  readonly modelId: string | null;
  readonly stageId: string | null;
  readonly logicalName: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Run the endpoint, substituting `variables` into the prompt template. */
  run(variables?: Record<string, unknown>): Promise<Output>;
  update(params: SREUpdateParams): Promise<StructuredResponse<Output>>;
  delete(): Promise<void>;
}

class SREImpl<Output> implements StructuredResponse<Output> {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly description: string | null;
  readonly pdId: string;
  readonly isPublic: boolean;
  readonly promptTemplate: string | null;
  readonly variableNames: string[];
  readonly modelId: string | null;
  readonly stageId: string | null;
  readonly logicalName: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;

  constructor(
    private readonly client: AjentifyClient,
    data: ApiStructuredResponseEndpoint,
  ) {
    this.id = data.sre_id;
    this.orgId = data.org_id;
    this.name = data.name;
    this.description = data.description ?? null;
    this.pdId = data.pd_id;
    this.isPublic = data.is_public;
    this.promptTemplate = data.prompt_template ?? null;
    this.variableNames = data.variable_names ?? [];
    this.modelId = data.model_id ?? null;
    this.stageId = data.stage_id ?? null;
    this.logicalName = data.logical_name ?? null;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  async run(variables: Record<string, unknown> = {}): Promise<Output> {
    return this.client.post<Output>(`/run-sre/${this.id}`, variables);
  }

  async update(params: SREUpdateParams): Promise<StructuredResponse<Output>> {
    const body: Record<string, unknown> = {};
    if (params.name !== undefined) body.name = params.name;
    if (params.description !== undefined) body.description = params.description;
    if (params.promptTemplate !== undefined) body.prompt_template = params.promptTemplate;
    if (params.variableNames !== undefined) body.variable_names = params.variableNames;
    if (params.modelId !== undefined) body.model_id = params.modelId;
    if (params.isPublic !== undefined) body.is_public = params.isPublic;
    if (params.schema !== undefined) {
      body.pd_id = await createParameterDefinition(this.client, await toJsonSchema(params.schema));
    }
    const updated = await this.client.post<ApiStructuredResponseEndpoint>(`/sre/${this.id}`, body);
    return new SREImpl<Output>(this.client, updated);
  }

  async delete(): Promise<void> {
    await this.client.delete<SuccessResponse>(`/sre/${this.id}`);
  }
}

export interface StructuredResponseApi {
  /** Create a saved structured-response endpoint. */
  create<S extends SchemaInput>(
    name: string,
    params: SRECreateParams<S>,
  ): Promise<StructuredResponse<InferOutput<S>>>;
  /** Create, or return the existing endpoint with a matching name. */
  getOrCreate<S extends SchemaInput>(
    name: string,
    params: SRECreateParams<S>,
  ): Promise<StructuredResponse<InferOutput<S>>>;
  /** One-shot structured extraction without saving an endpoint. */
  run<S extends SchemaInput>(params: SREInlineParams<S>): Promise<InferOutput<S>>;
  get(sreId: string): Promise<StructuredResponse>;
  list(orgId?: string): Promise<StructuredResponse[]>;
}

export function createStructuredResponseApi(getClient: GetClient): StructuredResponseApi {
  async function create<S extends SchemaInput>(
    name: string,
    params: SRECreateParams<S>,
  ): Promise<StructuredResponse<InferOutput<S>>> {
    const client = getClient();
    const body: Record<string, unknown> = {
      name,
      pd_id: await createParameterDefinition(client, await toJsonSchema(params.schema)),
      prompt_template: params.promptTemplate,
    };
    if (params.variableNames !== undefined) body.variable_names = params.variableNames;
    if (params.modelId !== undefined) body.model_id = params.modelId;
    if (params.description !== undefined) body.description = params.description;
    if (params.isPublic !== undefined) body.is_public = params.isPublic;
    if (params.orgId !== undefined) body.org_id = params.orgId;
    const created = await client.post<ApiStructuredResponseEndpoint>("/sre", body);
    return new SREImpl<InferOutput<S>>(client, created);
  }

  return {
    create,

    async getOrCreate(name, params) {
      const client = getClient();
      const existing = await client.get<GetSREsResponse>("/sres", {
        query: params.orgId ? { org_id: params.orgId } : undefined,
      });
      const match = existing.sres.find((s) => s.name === name);
      if (match) return new SREImpl(client, match);
      return create(name, params);
    },

    async run(params) {
      const client = getClient();
      const schema = await toJsonSchema(params.schema);
      const body: Record<string, unknown> = { prompt: params.prompt, schema };
      if (params.model !== undefined) body.model = params.model;
      return client.post("/run-sre", body);
    },

    async get(sreId) {
      const client = getClient();
      const sre = await client.get<ApiStructuredResponseEndpoint>(`/sre/${sreId}`);
      return new SREImpl(client, sre);
    },

    async list(orgId) {
      const client = getClient();
      const res = await client.get<GetSREsResponse>("/sres", {
        query: orgId ? { org_id: orgId } : undefined,
      });
      return res.sres.map((s) => new SREImpl(client, s));
    },
  };
}
