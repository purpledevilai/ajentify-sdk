import type { GetClient } from "../internal.js";
import type { ApiLLMModel, GetModelsResponse } from "../types.js";

/** An available LLM model and its pricing/metadata. */
export interface Model {
  /** The model identifier (pass as `modelId` to agents / contexts). */
  id: string;
  provider: string;
  inputTokenCost: number;
  outputTokenCost: number;
  contextWindowSize: number;
  order: number | null;
  usesResponsesApi: boolean;
  isRealtime: boolean;
}

function mapModel(data: ApiLLMModel): Model {
  return {
    id: data.model,
    provider: data.model_provider,
    inputTokenCost: data.input_token_cost,
    outputTokenCost: data.output_token_cost,
    contextWindowSize: data.context_window_size,
    order: data.order ?? null,
    usesResponsesApi: data.use_responses_api ?? false,
    isRealtime: data.is_realtime ?? false,
  };
}

export interface ModelsApi {
  /** List the available LLM models. */
  list(): Promise<Model[]>;
}

export function createModelsApi(getClient: GetClient): ModelsApi {
  return {
    async list() {
      const client = getClient();
      const res = await client.get<GetModelsResponse>("/models");
      return res.models.map(mapModel);
    },
  };
}
