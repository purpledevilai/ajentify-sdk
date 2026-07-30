import type { AjentifyClient } from "../client.js";
import type { GetClient } from "../internal.js";
import type {
  ApiJSONDocument,
  GetJSONDocumentsResponse,
  JSONShapeResponse,
  JSONValueResponse,
  SuccessResponse,
} from "../types.js";

export type JSONValueType = "string" | "number" | "boolean" | "json";

export interface JsonDocumentCreateOptions {
  isPublic?: boolean;
  orgId?: string;
}

export interface JsonDocumentUpdateOptions {
  name?: string;
  data?: Record<string, unknown>;
  isPublic?: boolean;
}

function inferType(value: unknown): JSONValueType {
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "json";
  }
}

/** A mutable JSON document addressable by dot-paths. */
export interface JsonDocument {
  readonly id: string;
  readonly name: string;
  readonly data: Record<string, unknown>;
  readonly orgId: string;
  readonly stageId: string | null;
  readonly logicalName: string | null;
  readonly isPublic: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  update(options: JsonDocumentUpdateOptions): Promise<JsonDocument>;
  delete(): Promise<void>;
  /** Set a value at a dot-path (type is inferred when omitted). */
  setValue(path: string, value: unknown, type?: JSONValueType): Promise<void>;
  /** Append an item to a list at a dot-path (type is inferred when omitted). */
  addListItem(path: string, value: unknown, type?: JSONValueType): Promise<void>;
  /** Delete the value at a dot-path. */
  deleteValue(path: string): Promise<void>;
  /** Read the value at a dot-path. */
  getValue(path: string): Promise<unknown>;
  /** Get the inferred shape of the document. */
  shape(): Promise<Record<string, unknown>>;
}

class JsonDocumentImpl implements JsonDocument {
  readonly id: string;
  readonly name: string;
  readonly data: Record<string, unknown>;
  readonly orgId: string;
  readonly stageId: string | null;
  readonly logicalName: string | null;
  readonly isPublic: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;

  constructor(
    private readonly client: AjentifyClient,
    data: ApiJSONDocument,
  ) {
    this.id = data.document_id;
    this.name = data.name;
    this.data = data.data;
    this.orgId = data.org_id;
    this.stageId = data.stage_id ?? null;
    this.logicalName = data.logical_name ?? null;
    this.isPublic = data.is_public;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  async update(options: JsonDocumentUpdateOptions): Promise<JsonDocument> {
    const body: Record<string, unknown> = {};
    if (options.name !== undefined) body.name = options.name;
    if (options.data !== undefined) body.data = options.data;
    if (options.isPublic !== undefined) body.is_public = options.isPublic;
    const updated = await this.client.post<ApiJSONDocument>(`/json-document/${this.id}`, body);
    return new JsonDocumentImpl(this.client, updated);
  }

  async delete(): Promise<void> {
    await this.client.delete<SuccessResponse>(`/json-document/${this.id}`);
  }

  async setValue(path: string, value: unknown, type?: JSONValueType): Promise<void> {
    await this.client.post<SuccessResponse>(`/json-document/${this.id}/set`, {
      path,
      value,
      type: type ?? inferType(value),
    });
  }

  async addListItem(path: string, value: unknown, type?: JSONValueType): Promise<void> {
    await this.client.post<SuccessResponse>(`/json-document/${this.id}/add`, {
      path,
      value,
      type: type ?? inferType(value),
    });
  }

  async deleteValue(path: string): Promise<void> {
    await this.client.post<SuccessResponse>(`/json-document/${this.id}/delete`, { path });
  }

  async getValue(path: string): Promise<unknown> {
    const res = await this.client.get<JSONValueResponse>(`/json-document/${this.id}/value`, {
      query: { path },
    });
    return res.value;
  }

  async shape(): Promise<Record<string, unknown>> {
    const res = await this.client.get<JSONShapeResponse>(`/json-document/${this.id}/shape`);
    return res.schema;
  }
}

export interface JsonDocumentApi {
  create(
    name: string,
    data: Record<string, unknown>,
    options?: JsonDocumentCreateOptions,
  ): Promise<JsonDocument>;
  get(documentId: string): Promise<JsonDocument>;
  list(orgId?: string): Promise<JsonDocument[]>;
}

export function createJsonDocumentApi(getClient: GetClient): JsonDocumentApi {
  return {
    async create(name, data, options = {}) {
      const client = getClient();
      const body: Record<string, unknown> = { name, data };
      if (options.isPublic !== undefined) body.is_public = options.isPublic;
      if (options.orgId !== undefined) body.org_id = options.orgId;
      const created = await client.post<ApiJSONDocument>("/json-document", body);
      return new JsonDocumentImpl(client, created);
    },

    async get(documentId) {
      const client = getClient();
      const doc = await client.get<ApiJSONDocument>(`/json-document/${documentId}`);
      return new JsonDocumentImpl(client, doc);
    },

    async list(orgId) {
      const client = getClient();
      const res = await client.get<GetJSONDocumentsResponse>("/json-documents", {
        query: orgId ? { org_id: orgId } : undefined,
      });
      return res.json_documents.map((doc) => new JsonDocumentImpl(client, doc));
    },
  };
}
