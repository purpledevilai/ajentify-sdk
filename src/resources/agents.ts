import type { AjentifyClient } from "../client.js";
import { toCodeName, type GetClient } from "../internal.js";
import type { ApiAgent, GetAgentsResponse, SuccessResponse } from "../types.js";
import { createContextApi, type Context, type ContextCreateOptions } from "./contexts.js";

export type RealtimeVoice =
  | "alloy"
  | "ash"
  | "ballad"
  | "coral"
  | "echo"
  | "sage"
  | "shimmer"
  | "verse"
  | "marin"
  | "cedar";

export interface AgentCreateOptions {
  description?: string;
  isPublic?: boolean;
  modelId?: string;
  agentSpeaksFirst?: boolean;
  promptArgNames?: string[];
  voiceId?: string | null;
  realtimeVoice?: RealtimeVoice | null;
  initializeToolId?: string | null;
  orgId?: string;
}

export interface AgentUpdateOptions {
  name?: string;
  description?: string;
  prompt?: string;
  toolIds?: string[];
  isPublic?: boolean;
  modelId?: string;
  agentSpeaksFirst?: boolean;
  promptArgNames?: string[];
  voiceId?: string | null;
  realtimeVoice?: RealtimeVoice | null;
  initializeToolId?: string | null;
}

/** An agent, with camelCase fields and instance helpers. */
export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
  readonly orgId: string;
  readonly isPublic: boolean;
  readonly isDefaultAgent: boolean;
  readonly agentSpeaksFirst: boolean;
  /** IDs of the tools attached to this agent (ID-pointer rule). */
  readonly toolIds: string[];
  readonly usesPromptArgs: boolean;
  readonly promptArgNames: string[];
  readonly voiceId: string | null;
  readonly realtimeVoice: string | null;
  readonly initializeToolId: string | null;
  readonly modelId: string | null;
  readonly stageId: string | null;
  readonly logicalName: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  update(options: AgentUpdateOptions): Promise<Agent>;
  delete(): Promise<void>;
  /** Convenience: create a new context bound to this agent. */
  createContext(options?: ContextCreateOptions): Promise<Context>;
}

class AgentImpl implements Agent {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
  readonly orgId: string;
  readonly isPublic: boolean;
  readonly isDefaultAgent: boolean;
  readonly agentSpeaksFirst: boolean;
  readonly toolIds: string[];
  readonly usesPromptArgs: boolean;
  readonly promptArgNames: string[];
  readonly voiceId: string | null;
  readonly realtimeVoice: string | null;
  readonly initializeToolId: string | null;
  readonly modelId: string | null;
  readonly stageId: string | null;
  readonly logicalName: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;

  constructor(
    private readonly client: AjentifyClient,
    data: ApiAgent,
  ) {
    this.id = data.agent_id;
    this.name = data.agent_name;
    this.description = data.agent_description;
    this.prompt = data.prompt;
    this.orgId = data.org_id;
    this.isPublic = data.is_public;
    this.isDefaultAgent = data.is_default_agent;
    this.agentSpeaksFirst = data.agent_speaks_first ?? false;
    this.toolIds = data.tools ?? [];
    this.usesPromptArgs = data.uses_prompt_args ?? false;
    this.promptArgNames = data.prompt_arg_names ?? [];
    this.voiceId = data.voice_id ?? null;
    this.realtimeVoice = data.realtime_voice ?? null;
    this.initializeToolId = data.initialize_tool_id ?? null;
    this.modelId = data.model_id ?? null;
    this.stageId = data.stage_id ?? null;
    this.logicalName = data.logical_name ?? null;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  async update(options: AgentUpdateOptions): Promise<Agent> {
    const body: Record<string, unknown> = {};
    if (options.name !== undefined) body.agent_name = options.name;
    if (options.description !== undefined) body.agent_description = options.description;
    if (options.prompt !== undefined) body.prompt = options.prompt;
    if (options.toolIds !== undefined) body.tools = options.toolIds;
    if (options.isPublic !== undefined) body.is_public = options.isPublic;
    if (options.modelId !== undefined) body.model_id = options.modelId;
    if (options.agentSpeaksFirst !== undefined) body.agent_speaks_first = options.agentSpeaksFirst;
    if (options.promptArgNames !== undefined) {
      body.uses_prompt_args = options.promptArgNames.length > 0;
      body.prompt_arg_names = options.promptArgNames;
    }
    if (options.voiceId !== undefined) body.voice_id = options.voiceId;
    if (options.realtimeVoice !== undefined) body.realtime_voice = options.realtimeVoice;
    if (options.initializeToolId !== undefined) body.initialize_tool_id = options.initializeToolId;
    const updated = await this.client.post<ApiAgent>(`/agent/${this.id}`, body);
    return new AgentImpl(this.client, updated);
  }

  async delete(): Promise<void> {
    await this.client.delete<SuccessResponse>(`/agent/${this.id}`);
  }

  createContext(options?: ContextCreateOptions): Promise<Context> {
    return createContextApi(() => this.client).create(this.id, options);
  }
}

export interface AgentApi {
  /** Create an agent. `toolIds` references tools by id (ID-pointer rule). */
  create(
    name: string,
    prompt: string,
    toolIds?: string[],
    options?: AgentCreateOptions,
  ): Promise<Agent>;
  /** Create the agent, or return the existing one with a matching name. */
  getOrCreate(
    name: string,
    prompt: string,
    toolIds?: string[],
    options?: AgentCreateOptions,
  ): Promise<Agent>;
  /** Fetch an agent by id. */
  get(agentId: string): Promise<Agent>;
  /** List the org's agents. */
  list(orgId?: string): Promise<Agent[]>;
}

export function createAgentApi(getClient: GetClient): AgentApi {
  async function create(
    name: string,
    prompt: string,
    toolIds: string[] = [],
    options: AgentCreateOptions = {},
  ): Promise<Agent> {
    const client = getClient();
    const body: Record<string, unknown> = {
      agent_name: name,
      agent_description: options.description ?? "",
      prompt,
      is_public: options.isPublic ?? false,
      tools: toolIds,
    };
    if (options.orgId !== undefined) body.org_id = options.orgId;
    if (options.modelId !== undefined) body.model_id = options.modelId;
    if (options.agentSpeaksFirst !== undefined) body.agent_speaks_first = options.agentSpeaksFirst;
    if (options.promptArgNames !== undefined) {
      body.uses_prompt_args = options.promptArgNames.length > 0;
      body.prompt_arg_names = options.promptArgNames;
    }
    if (options.voiceId !== undefined) body.voice_id = options.voiceId;
    if (options.realtimeVoice !== undefined) body.realtime_voice = options.realtimeVoice;
    if (options.initializeToolId !== undefined) body.initialize_tool_id = options.initializeToolId;
    const created = await client.post<ApiAgent>("/agent", body);
    return new AgentImpl(client, created);
  }

  return {
    create,

    async getOrCreate(name, prompt, toolIds, options) {
      const client = getClient();
      const existing = await client.get<GetAgentsResponse>("/agents", {
        query: options?.orgId ? { org_id: options.orgId } : undefined,
      });
      const match = existing.agents.find(
        (a) => a.agent_name === name || toCodeName(a.agent_name) === toCodeName(name),
      );
      if (match) return new AgentImpl(client, match);
      return create(name, prompt, toolIds, options);
    },

    async get(agentId) {
      const client = getClient();
      const agent = await client.get<ApiAgent>(`/agent/${agentId}`);
      return new AgentImpl(client, agent);
    },

    async list(orgId) {
      const client = getClient();
      const res = await client.get<GetAgentsResponse>("/agents", {
        query: orgId ? { org_id: orgId } : undefined,
      });
      return res.agents.map((a) => new AgentImpl(client, a));
    },
  };
}
