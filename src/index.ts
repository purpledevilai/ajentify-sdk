import { AjentifyClient, type AjentifyClientOptions } from "./client.js";
import { configure, getDefaultClient } from "./config.js";
import type { GetClient } from "./internal.js";
import { isQueued as isQueuedImpl } from "./messages.js";

import {
  createAgentApi,
  type Agent as AgentInstance,
  type AgentApi,
} from "./resources/agents.js";
import {
  createContextApi,
  parseCallback as parseCallbackImpl,
  type Context as ContextInstance,
  type ContextApi,
} from "./resources/contexts.js";
import { createToolsApi, type ToolsApi } from "./resources/tools.js";
import {
  createStructuredResponseApi,
  type StructuredResponse as StructuredResponseInstance,
  type StructuredResponseApi,
} from "./resources/structuredResponses.js";
import {
  createDataWindowApi,
  type DataWindow as DataWindowInstance,
  type DataWindowApi,
} from "./resources/dataWindows.js";
import { createApiKeyApi, type ApiKeyApi } from "./resources/apiKeys.js";
import { createClientApi, type ClientApi } from "./resources/clients.js";
import {
  createJsonDocumentApi,
  type JsonDocument as JsonDocumentInstance,
  type JsonDocumentApi,
} from "./resources/jsonDocuments.js";
import { createModelsApi, type ModelsApi } from "./resources/models.js";
import {
  createMCPConnectionApi,
  type MCPConnection as MCPConnectionInstance,
  type MCPConnectionApi,
} from "./resources/mcpConnections.js";
import { createJobApi, type JobApi } from "./resources/jobs.js";
import {
  createFilesystemApi,
  type Filesystem as FilesystemInstance,
  type FilesystemApi,
} from "./resources/filesystems.js";

/** The full set of resource namespaces bound to a single client. */
export interface AjentifyNamespaces {
  client: AjentifyClient;
  Agent: AgentApi;
  Context: ContextApi;
  Tools: ToolsApi;
  StructuredResponse: StructuredResponseApi;
  DataWindow: DataWindowApi;
  ApiKey: ApiKeyApi;
  Client: ClientApi;
  JsonDocument: JsonDocumentApi;
  Models: ModelsApi;
  MCPConnection: MCPConnectionApi;
  Job: JobApi;
  Filesystem: FilesystemApi;
}

function bindNamespaces(getClient: GetClient, client: AjentifyClient): AjentifyNamespaces {
  return {
    client,
    Agent: createAgentApi(getClient),
    Context: createContextApi(getClient),
    Tools: createToolsApi(getClient),
    StructuredResponse: createStructuredResponseApi(getClient),
    DataWindow: createDataWindowApi(getClient),
    ApiKey: createApiKeyApi(getClient),
    Client: createClientApi(getClient),
    JsonDocument: createJsonDocumentApi(getClient),
    Models: createModelsApi(getClient),
    MCPConnection: createMCPConnectionApi(getClient),
    Job: createJobApi(getClient),
    Filesystem: createFilesystemApi(getClient),
  };
}

/**
 * Create an isolated client with its own API key / base URL, exposing the same
 * namespaces as the top-level exports. Use for multi-tenant / multi-key setups.
 */
export function createClient(options: AjentifyClientOptions = {}): AjentifyNamespaces {
  const client = new AjentifyClient(options);
  return bindNamespaces(() => client, client);
}

// --- Default namespaces (bound to global config + AJENTIFY_API_KEY env) ------

export const Agent = createAgentApi(getDefaultClient);
export const Context = createContextApi(getDefaultClient);
export const Tools = createToolsApi(getDefaultClient);
export const StructuredResponse = createStructuredResponseApi(getDefaultClient);
export const DataWindow = createDataWindowApi(getDefaultClient);
export const ApiKey = createApiKeyApi(getDefaultClient);
export const Client = createClientApi(getDefaultClient);
export const JsonDocument = createJsonDocumentApi(getDefaultClient);
export const Models = createModelsApi(getDefaultClient);
export const MCPConnection = createMCPConnectionApi(getDefaultClient);
export const Job = createJobApi(getDefaultClient);
export const Filesystem = createFilesystemApi(getDefaultClient);

/** Parse an async callback POST body into a structured result. */
export const parseCallback = parseCallbackImpl;

/** Type guard: did an invoke resolve to a `QueuedResponse` (context busy, input queued)? */
export const isQueued = isQueuedImpl;

// Merge the instance type names with the namespace value names above so that
// `Agent.create()` (value) and `const a: Agent` (type) both work.
export type Agent = AgentInstance;
export type Context = ContextInstance;
export type StructuredResponse<Output = unknown> = StructuredResponseInstance<Output>;
export type DataWindow = DataWindowInstance;
export type JsonDocument = JsonDocumentInstance;
export type MCPConnection = MCPConnectionInstance;
export type Filesystem = FilesystemInstance;

/** Aggregate namespace for those who prefer a single import. */
export const AJ = {
  Agent,
  Context,
  Tools,
  StructuredResponse,
  DataWindow,
  ApiKey,
  Client,
  JsonDocument,
  Models,
  MCPConnection,
  Job,
  Filesystem,
  parseCallback,
  isQueued,
  configure,
  createClient,
};

// --- Config / client ---------------------------------------------------------

export { configure };
export { AjentifyClient, DEFAULT_BASE_URL } from "./client.js";
export type { AjentifyClientOptions, RequestOptions, CallbackConfig, StatusResponse } from "./client.js";
export { AjentifyError } from "./errors.js";
export type { AjentifyErrorDetails } from "./errors.js";

// --- Shared types ------------------------------------------------------------

export { InvokeResponse } from "./resources/contexts.js";
export { Tool } from "./resources/tools.js";

export type { GetClient } from "./internal.js";
export type { JsonSchema, SchemaInput, InferOutput, StandardSchemaLike } from "./schema.js";
export type {
  Message,
  ClientSideToolCall,
  ClientSideToolResponse,
  ClientSideToolHandler,
  ClientSideToolMap,
  ClientToolContext,
  AsyncAck,
  QueuedResponse,
  AsyncToolResponse,
  AsyncToolResponseAck,
} from "./messages.js";

export type {
  AgentApi,
  AgentCreateOptions,
  AgentUpdateOptions,
  RealtimeVoice,
} from "./resources/agents.js";
export type {
  ContextApi,
  ContextCreateOptions,
  ContextGetOptions,
  ContextListOptions,
  InvokeOptions,
  InvokeResult,
  InvokeStrategy,
  TerminatingConfig,
  CallbackResult,
} from "./resources/contexts.js";
export type { JobApi, Job as JobRecord, JobStatus, JobError, JobWaitOptions } from "./resources/jobs.js";
export type {
  FilesystemApi,
  FilesystemCreateOptions,
  FilesystemUpdateOptions,
  FilesystemNode,
  FilesystemTreeNode,
  FolderNode,
  FileNode,
  FolderChild,
  CreateFolderOptions,
  CreateFileOptions,
  WriteFileOptions,
  MoveOptions,
  MoveResult,
  RemoveOptions,
  DeleteResult,
  SearchOptions,
  SearchResult,
  SearchMatch,
} from "./resources/filesystems.js";
export type {
  ToolsApi,
  ToolCreateOptions,
  ToolUpdateOptions,
} from "./resources/tools.js";
export type {
  StructuredResponseApi,
  SRECreateParams,
  SREInlineParams,
  SREUpdateParams,
} from "./resources/structuredResponses.js";
export type {
  DataWindowApi,
  DataWindowCreateOptions,
  DataWindowUpdateOptions,
} from "./resources/dataWindows.js";
export type {
  ApiKeyApi,
  ApiKeyGenerateOptions,
  GeneratedApiKey,
  ApiKeyInfo,
} from "./resources/apiKeys.js";
export type { ClientApi, ClientCreateOptions, ClientRecord } from "./resources/clients.js";
export type {
  JsonDocumentApi,
  JsonDocumentCreateOptions,
  JsonDocumentUpdateOptions,
  JSONValueType,
} from "./resources/jsonDocuments.js";
export type { ModelsApi, Model } from "./resources/models.js";
export type {
  MCPConnectionApi,
  MCPConnectionCreateOptions,
  MCPConnectionUpdateOptions,
  MCPTool,
} from "./resources/mcpConnections.js";
