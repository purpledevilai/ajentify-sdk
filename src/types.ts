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

export interface ApiMCPTool {
  name: string;
  description?: string | null;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown> | null;
}

export interface ApiMCPConnection {
  mcp_connection_id: string;
  org_id: string;
  name: string;
  mcp_url: string;
  requires_auth: boolean;
  access_token?: string | null;
  refresh_token?: string | null;
  token_endpoint?: string | null;
  client_id?: string | null;
  issuer?: string | null;
  selected_tools: ApiMCPTool[];
  stage_id?: string | null;
  logical_name?: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateMCPConnectionParams {
  org_id?: string;
  name: string;
  mcp_url: string;
  requires_auth?: boolean;
  access_token?: string | null;
  refresh_token?: string | null;
  token_endpoint?: string | null;
  client_id?: string | null;
  issuer?: string | null;
  selected_tools?: ApiMCPTool[];
}

export interface GetMCPConnectionsResponse {
  mcp_connections: ApiMCPConnection[];
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
  mcp_connections?: string[];
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
  mcp_connections?: string[];
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

export interface ApiClient {
  client_id: string;
  org_id: string;
  created_at: number;
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

/** The 202 body of an async-dispatched request: the job row + request_id (+ poll_url when authenticated). */
export interface WireAsyncAck extends Partial<ApiJob> {
  request_id: string;
  poll_url?: string;
}

/**
 * The 202 body of a chat route whose context is being run by someone else: the input was
 * queued on the context's inbox and the current run holder will apply it. Also the job
 * `result` when such a route ran as an async job.
 */
export interface WireQueuedResponse {
  status: "queued";
  /** `null` for `/chat/invoke`, which queues nothing. */
  item_id: string | null;
  context_id: string;
}

/** The 200 body of `POST /async-tool-response`. */
export interface WireAsyncToolResponseAck {
  status: "triggered";
  item_id: string;
}

export interface ApiJobError {
  status_code: number;
  message: string;
  code?: string | null;
}

export interface ApiJob {
  job_id: string;
  owner_id?: string;
  status: "queued" | "in_progress" | "completed" | "error";
  message?: string | null;
  data?: Record<string, unknown> | null;
  route?: string | null;
  method?: string | null;
  request_id?: string | null;
  callback_url?: string | null;
  result?: unknown;
  error?: ApiJobError | null;
  started_at?: number | null;
  finished_at?: number | null;
  expires_at?: number | null;
  created_at?: number;
  updated_at?: number;
}

// --- Filesystems ---------------------------------------------------------------

export interface ApiFilesystem {
  filesystem_id: string;
  org_id: string;
  name: string;
  description?: string | null;
  created_at: number;
  updated_at: number;
}

export interface GetFilesystemsResponse {
  filesystems: ApiFilesystem[];
}

export interface ApiFilesystemTreeNode {
  path: string;
  type: "folder" | "file";
  name: string;
  parent_path: string;
  description?: string | null;
  size_bytes?: number | null;
  updated_at?: number | null;
}

export interface ApiFilesystemTree {
  filesystem_id: string;
  name: string;
  description?: string | null;
  nodes: ApiFilesystemTreeNode[];
}

export interface ApiFolderChild {
  name: string;
  path: string;
  type: "folder" | "file";
  description?: string | null;
  size_bytes?: number | null;
}

export interface ApiFolderNode {
  type: "folder";
  path: string;
  name: string;
  parent_path: string;
  description?: string | null;
  size_bytes?: number | null;
  created_at?: number | null;
  updated_at?: number | null;
  children?: ApiFolderChild[];
  parents_created?: string[] | number | null;
}

export interface ApiFileNode {
  type: "file";
  path: string;
  name: string;
  parent_path: string;
  content?: string;
  size_bytes?: number | null;
  created_at?: number | null;
  updated_at?: number | null;
  parents_created?: string[] | number | null;
}

export type ApiFilesystemNode = ApiFolderNode | ApiFileNode;

export interface ApiFilesystemMoveResult {
  source_path: string;
  destination_path: string;
  type: "folder" | "file";
  parents_created?: string[] | number | null;
}

export interface ApiFilesystemDeleteResult {
  path: string;
  type: "folder" | "file";
  deleted: { folders: number; files: number };
}

export interface ApiFilesystemSearchMatch {
  path: string;
  type: "folder" | "file";
  matched_on: string;
  snippet?: string | null;
}

export interface ApiFilesystemSearchResult {
  query: string;
  path: string;
  matches: ApiFilesystemSearchMatch[];
  truncated: boolean;
}

export interface WireTerminatingConfig {
  tool_ids?: string[];
  consecutive_nudges?: number;
  nudge_message?: string;
  max_invocations?: number;
}
