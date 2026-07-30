import type { AjentifyClient } from "../client.js";
import type { GetClient } from "../internal.js";
import type { ApiDataWindow, GetDataWindowsResponse, SuccessResponse } from "../types.js";

export interface DataWindowCreateOptions {
  description?: string;
  orgId?: string;
}

export interface DataWindowUpdateOptions {
  name?: string;
  description?: string;
  data?: string;
}

/** A data window: a named blob of text made available to agents/tools. */
export interface DataWindow {
  readonly id: string;
  readonly orgId: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly data: string;
  readonly stageId: string | null;
  readonly logicalName: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  update(options: DataWindowUpdateOptions): Promise<DataWindow>;
  delete(): Promise<void>;
}

class DataWindowImpl implements DataWindow {
  readonly id: string;
  readonly orgId: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly data: string;
  readonly stageId: string | null;
  readonly logicalName: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;

  constructor(
    private readonly client: AjentifyClient,
    data: ApiDataWindow,
  ) {
    this.id = data.data_window_id;
    this.orgId = data.org_id;
    this.name = data.name ?? null;
    this.description = data.description ?? null;
    this.data = data.data;
    this.stageId = data.stage_id ?? null;
    this.logicalName = data.logical_name ?? null;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  async update(options: DataWindowUpdateOptions): Promise<DataWindow> {
    const body: Record<string, unknown> = {};
    if (options.name !== undefined) body.name = options.name;
    if (options.description !== undefined) body.description = options.description;
    if (options.data !== undefined) body.data = options.data;
    const updated = await this.client.post<ApiDataWindow>(`/data-window/${this.id}`, body);
    return new DataWindowImpl(this.client, updated);
  }

  async delete(): Promise<void> {
    await this.client.delete<SuccessResponse>(`/data-window/${this.id}`);
  }
}

export interface DataWindowApi {
  create(name: string, data: string, options?: DataWindowCreateOptions): Promise<DataWindow>;
  get(dataWindowId: string): Promise<DataWindow>;
  list(orgId?: string): Promise<DataWindow[]>;
}

export function createDataWindowApi(getClient: GetClient): DataWindowApi {
  return {
    async create(name, data, options = {}) {
      const client = getClient();
      const body: Record<string, unknown> = { name, data };
      if (options.description !== undefined) body.description = options.description;
      if (options.orgId !== undefined) body.org_id = options.orgId;
      const created = await client.post<ApiDataWindow>("/data-window", body);
      return new DataWindowImpl(client, created);
    },

    async get(dataWindowId) {
      const client = getClient();
      const dw = await client.get<ApiDataWindow>(`/data-window/${dataWindowId}`);
      return new DataWindowImpl(client, dw);
    },

    async list(orgId) {
      const client = getClient();
      const res = await client.get<GetDataWindowsResponse>("/data-windows", {
        query: orgId ? { org_id: orgId } : undefined,
      });
      return res.data_windows.map((dw) => new DataWindowImpl(client, dw));
    },
  };
}
