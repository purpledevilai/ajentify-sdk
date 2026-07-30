/**
 * Wire types mirroring the Ajentify REST API request/response shapes
 * (snake_case, as the server emits them). These are internal to the SDK; the
 * resource classes expose camelCase, ergonomic shapes on top of them. Ported
 * from ajentify-web's src/types/api.ts.
 */

export interface SuccessResponse {
  success: boolean;
}

export interface ApiLLMModel {
  model: string;
  model_provider: string;
  input_token_cost: number;
  output_token_cost: number;
  context_window_size: number;
  order?: number | null;
  use_responses_api?: boolean;
  is_realtime?: boolean;
}

export interface GetModelsResponse {
  models: ApiLLMModel[];
}

export interface ApiParameterDefinition {
  pd_id: string;
  org_id: string;
  schema: Record<string, unknown>;
  stage_id?: string | null;
  logical_name?: string | null;
  created_at: number;
  updated_at: number;
}

export interface ApiTool {
  tool_id: string;
  org_id: string;
  name: string;
  description?: string | null;
  pd_id?: string | null;
  code?: string | null;
  pass_context: boolean;
  is_async: boolean;
  is_client_side_tool: boolean;
  stage_id?: string | null;
  logical_name?: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateToolParams {
  org_id?: string;
  name: string;
  description: string;
  pd_id?: string | null;
  code?: string | null;
  pass_context?: boolean;
  is_async?: boolean;
  is_client_side_tool?: boolean;
}

export interface GetToolsResponse {
  tools: ApiTool[];
}

export interface ApiDefaultTool {
  tool_id: string;
  name: string;
  description?: string | null;
  parameters: Record<string, unknown>;
  pass_context?: boolean;
  is_async?: boolean;
  is_client_side_tool?: boolean;
  category: string;
}

export interface GetDefaultToolsResponse {
  tools: ApiDefaultTool[];
}

export interface TestToolResponse {
  result: string;
}

export interface ApiAgent {
  agent_id: string;
  agent_name: string;
  agent_description: string;
  prompt: string;
  org_id: string;
  is_public: boolean;
  is_default_agent: boolean;
  agent_speaks_first?: boolean;
  tools?: string[];
  uses_prompt_args?: boolean;
  prompt_arg_names?: string[];
  voice_id?: string | null;
  realtime_voice?: string | null;
  initialize_tool_id?: string | null;
  model_id?: string | null;
  stage_id?: string | null;
  logical_name?: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateAgentParams {
  agent_name: string;
  agent_description: string;
  prompt: string;
  org_id?: string;
  is_public?: boolean;
  agent_speaks_first?: boolean;
  tools?: string[];
  uses_prompt_args?: boolean;
  prompt_arg_names?: string[];
  voice_id?: string | null;
  realtime_voice?: string | null;
  initialize_tool_id?: string | null;
  model_id?: string | null;
}

export interface GetAgentsResponse {
  agents: ApiAgent[];
}

export interface ApiStructuredResponseEndpoint {
  sre_id: string;
  org_id: string;
  name: string;
  description?: string | null;
  pd_id: string;
  is_public: boolean;
  prompt_template?: string | null;
  variable_names?: string[] | null;
  model_id?: string | null;
  stage_id?: string | null;
  logical_name?: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateSREParams {
  org_id?: string;
  name: string;
  description?: string | null;
  pd_id: string;
  is_public?: boolean;
  prompt_template: string;
  variable_names?: string[] | null;
  model_id?: string | null;
}

export interface GetSREsResponse {
  sres: ApiStructuredResponseEndpoint[];
}

export interface ApiDataWindow {
  data_window_id: string;
  org_id: string;
  name?: string | null;
  description?: string | null;
  data: string;
  stage_id?: string | null;
  logical_name?: string | null;
  created_at: number;
  updated_at: number;
}

export interface GetDataWindowsResponse {
  data_windows: ApiDataWindow[];
}

export interface ApiAPIKeySummary {
  api_key_id: string;
  org_id: string;
  token_hint: string;
  valid: boolean;
  created_at: number;
}

export interface ApiAPIKey {
  api_key_id: string;
  org_id: string;
  token: string;
  valid: boolean;
  type: "org" | "client";
  user_id: string;
  client_id?: string | null;
  created_at: number;
  updated_at: number;
  expires_at?: number | null;
}

export interface GetAPIKeysResponse {
  api_keys: ApiAPIKeySummary[];
}

export interface ApiJSONDocument {
  document_id: string;
  name: string;
  data: Record<string, unknown>;
  org_id: string;
  stage_id?: string | null;
  logical_name?: string | null;
  created_at: number;
  updated_at: number;
  is_public: boolean;
}

export interface GetJSONDocumentsResponse {
  json_documents: ApiJSONDocument[];
}

export interface JSONValueResponse {
  value: unknown;
}

export interface JSONShapeResponse {
  schema: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Contexts + chat                                                            */
/* -------------------------------------------------------------------------- */

export type ApiContextMessage =
  | { sender: "ai" | "human" | "system"; message: string }
  | {
      type: "tool_call";
      tool_call_id: string;
      tool_name: string;
      tool_input?: Record<string, unknown> | null;
    }
  | {
      type: "tool_response";
      tool_call_id: string;
      tool_output: string;
    };

export type ContextOwnerKind = "api_key" | "public";

export interface ApiContext {
  context_id: string;
  agent_id: string;
  org_id?: string | null;
  user_id: string;
  client_id?: string | null;
  messages: ApiContextMessage[];
  user_defined?: Record<string, unknown> | null;
  model_id?: string | null;
  context_percentage?: number | null;
  created_at: number;
  updated_at: number;
  expires_at?: number | null;
}

export interface ApiCreateContextResponse extends ApiContext {
  client_api_key?: string | null;
}

export interface ApiOrgContextSummary {
  context_id: string;
  agent_id: string;
  org_id: string;
  user_id: string;
  client_id?: string | null;
  owner_kind: ContextOwnerKind;
  last_message_preview?: string | null;
  created_at: number;
  updated_at: number;
  expires_at?: number | null;
}

export interface GetOrgContextsResponse {
  contexts: ApiOrgContextSummary[];
  next_cursor?: string | null;
}

export interface WireClientSideToolCall {
  tool_call_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface WireChatResponse {
  response: string;
  saved_ai_messages: boolean;
  generated_messages: ApiContextMessage[];
  model_id?: string | null;
  context_percentage?: number | null;
  invocation_cost?: number | null;
  events?: Record<string, unknown>[] | null;
  client_side_tool_calls?: WireClientSideToolCall[] | null;
}

export interface WireAsyncAck {
  status: "processing";
  request_id: string;
}

export interface WireTerminatingConfig {
  tool_ids?: string[];
  consecutive_nudges?: number;
  nudge_message?: string;
  max_invocations?: number;
}
