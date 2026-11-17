import type { AjentifyClient } from "../client.js";
import { AjentifyError } from "../errors.js";
import type { GetClient } from "../internal.js";
import type { ApiRunScheduleResponse, ApiSchedule, GetSchedulesResponse, SuccessResponse, WireAsyncAck } from "../types.js";
import { mapJob, waitForJob, type Job, type JobWaitOptions } from "./jobs.js";

/** Outcome of the schedule's last fire. */
export type ScheduleRunStatus = "ok" | "error";

export interface ScheduleCreateOptions {
  /** Agent to invoke on every fire. */
  agentId: string;
  /** EventBridge Scheduler expression, verbatim: `rate(2 hours)`, `cron(0 9 ? * MON-FRI *)` or `at(2026-11-05T09:00:00)`. */
  scheduleExpression: string;
  /** IANA timezone the expression is evaluated in (e.g. `Australia/Melbourne`). Defaults to UTC. */
  timezone?: string;
  /** Optional kick-off message added as the human turn before the agent is invoked. */
  message?: string;
  /** Prompt arguments passed to every context the schedule creates (keys must be the agent's `promptArgNames`). */
  promptArgs?: Record<string, unknown>;
  /** Start enabled (default true). */
  enabled?: boolean;
  /** Optional display name (≤100 characters). */
  name?: string;
}

/** Partial update: only the fields you pass change. `promptArgs: null` / `message: null` / `name: null` clear them. */
export interface ScheduleUpdateOptions {
  name?: string | null;
  scheduleExpression?: string;
  timezone?: string;
  enabled?: boolean;
  promptArgs?: Record<string, unknown> | null;
  message?: string | null;
}

/** List an agent's schedules or every schedule of an organization. */
export type ScheduleListOptions = { agentId: string; orgId?: never } | { orgId: string; agentId?: never };

export interface ScheduleRunOptions extends JobWaitOptions {
  /**
   * `POST /schedule/{id}/run` is always a job (202). By default the SDK polls it until the run
   * finishes and resolves with `{ schedule, contextId }`. Pass `wait: false` to get the queued
   * `Job` back immediately instead (inspect it with `Job.get` / `Job.wait`).
   */
  wait?: boolean;
}

/** What a finished `runNow` resolves to: the schedule with its bookkeeping updated by the run, and the context it created. */
export interface ScheduleRunResult {
  schedule: Schedule;
  contextId: string;
}

/** The job behind `runNow({ wait: false })`; its `result` is the raw `{ schedule, context_id }` body once completed. */
export type ScheduleRunJob = Job<ApiRunScheduleResponse>;

/** A schedule, with camelCase fields and instance helpers. */
export class Schedule {
  readonly id: string;
  readonly orgId: string;
  readonly agentId: string;
  readonly name: string | null;
  readonly scheduleExpression: string;
  readonly timezone: string;
  readonly enabled: boolean;
  readonly promptArgs: Record<string, unknown> | null;
  readonly message: string | null;
  readonly createdBy: string;
  /** Client minted for this schedule; every run's context is attached to it. */
  readonly clientId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Number of fires so far (ok + error). */
  readonly runCount: number;
  readonly lastRunAt: number | null;
  /** Context created by the last successful fire. */
  readonly lastContextId: string | null;
  readonly lastStatus: ScheduleRunStatus | null;
  readonly lastError: string | null;

  /** @internal */
  constructor(
    private readonly client: AjentifyClient,
    data: ApiSchedule,
  ) {
    this.id = data.schedule_id;
    this.orgId = data.org_id;
    this.agentId = data.agent_id;
    this.name = data.name ?? null;
    this.scheduleExpression = data.schedule_expression;
    this.timezone = data.timezone;
    this.enabled = data.enabled;
    this.promptArgs = data.prompt_args ?? null;
    this.message = data.message ?? null;
    this.createdBy = data.created_by;
    this.clientId = data.client_id;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
    this.runCount = data.run_count ?? 0;
    this.lastRunAt = data.last_run_at ?? null;
    this.lastContextId = data.last_context_id ?? null;
    this.lastStatus = data.last_status ?? null;
    this.lastError = data.last_error ?? null;
  }

  /** Partially update this schedule (expression / timezone / enabled changes re-sync EventBridge). */
  async update(options: ScheduleUpdateOptions): Promise<Schedule> {
    return updateSchedule(this.client, this.id, options);
  }

  /** Delete this schedule (its EventBridge schedule first, then the row). Contexts it created are kept. */
  async delete(): Promise<void> {
    await this.client.delete<SuccessResponse>(`/schedule/${this.id}`);
  }

  /** Run this schedule now, exactly as a fire would. See `ScheduleRunOptions`. */
  runNow(options?: ScheduleRunOptions & { wait?: true }): Promise<ScheduleRunResult>;
  runNow(options: ScheduleRunOptions & { wait: false }): Promise<ScheduleRunJob>;
  runNow(options: ScheduleRunOptions = {}): Promise<ScheduleRunResult | ScheduleRunJob> {
    return runSchedule(this.client, this.id, options);
  }
}

async function updateSchedule(client: AjentifyClient, scheduleId: string, options: ScheduleUpdateOptions): Promise<Schedule> {
  const body: Record<string, unknown> = {};
  if (options.name !== undefined) body.name = options.name;
  if (options.scheduleExpression !== undefined) body.schedule_expression = options.scheduleExpression;
  if (options.timezone !== undefined) body.timezone = options.timezone;
  if (options.enabled !== undefined) body.enabled = options.enabled;
  if (options.promptArgs !== undefined) body.prompt_args = options.promptArgs;
  if (options.message !== undefined) body.message = options.message;
  const updated = await client.post<ApiSchedule>(`/schedule/${scheduleId}`, body);
  return new Schedule(client, updated);
}

async function runSchedule(
  client: AjentifyClient,
  scheduleId: string,
  options: ScheduleRunOptions,
): Promise<ScheduleRunResult | ScheduleRunJob> {
  const path = `/schedule/${scheduleId}/run`;
  const { status, data } = await client.requestWithStatus<WireAsyncAck>("POST", path, { signal: options.signal });
  if (!data?.job_id) {
    throw new AjentifyError(`Run of ${path} returned no job_id`, { status, body: data });
  }
  if (options.wait === false) {
    return mapJob<ApiRunScheduleResponse>({ ...data, job_id: data.job_id, status: data.status ?? "queued" });
  }
  const job = await waitForJob<ApiRunScheduleResponse>(client, data.job_id, {
    intervalMs: options.intervalMs,
    signal: options.signal,
  });
  if (!job.result) {
    const reason = job.error;
    throw new AjentifyError(
      reason?.message ? `Job ${job.id} completed without a result: ${reason.message}` : `Job ${job.id} completed without a result`,
      { status: reason?.statusCode, code: reason?.code ?? "job_no_result", body: job },
    );
  }
  return { schedule: new Schedule(client, job.result.schedule), contextId: job.result.context_id };
}

export interface ScheduleApi {
  /** Create a schedule that invokes an agent on a `rate(...)` / `cron(...)` / `at(...)` expression. */
  create(options: ScheduleCreateOptions): Promise<Schedule>;
  /** Fetch a schedule by id (including its last-run bookkeeping). */
  get(scheduleId: string): Promise<Schedule>;
  /** List the schedules of an agent (`{ agentId }`) or of an organization (`{ orgId }`). */
  list(options: ScheduleListOptions): Promise<Schedule[]>;
  /** Partially update a schedule by id. */
  update(scheduleId: string, options: ScheduleUpdateOptions): Promise<Schedule>;
  /** Delete a schedule by id. */
  delete(scheduleId: string): Promise<void>;
  /** Run a schedule now by id. See `ScheduleRunOptions`. */
  runNow(scheduleId: string, options?: ScheduleRunOptions & { wait?: true }): Promise<ScheduleRunResult>;
  runNow(scheduleId: string, options: ScheduleRunOptions & { wait: false }): Promise<ScheduleRunJob>;
}

export function createScheduleApi(getClient: GetClient): ScheduleApi {
  function runNow(scheduleId: string, options?: ScheduleRunOptions & { wait?: true }): Promise<ScheduleRunResult>;
  function runNow(scheduleId: string, options: ScheduleRunOptions & { wait: false }): Promise<ScheduleRunJob>;
  function runNow(scheduleId: string, options: ScheduleRunOptions = {}): Promise<ScheduleRunResult | ScheduleRunJob> {
    return runSchedule(getClient(), scheduleId, options);
  }

  return {
    runNow,

    async create(options) {
      const client = getClient();
      const body: Record<string, unknown> = {
        agent_id: options.agentId,
        schedule_expression: options.scheduleExpression,
      };
      if (options.timezone !== undefined) body.timezone = options.timezone;
      if (options.message !== undefined) body.message = options.message;
      if (options.promptArgs !== undefined) body.prompt_args = options.promptArgs;
      if (options.enabled !== undefined) body.enabled = options.enabled;
      if (options.name !== undefined) body.name = options.name;
      const created = await client.post<ApiSchedule>("/schedule", body);
      return new Schedule(client, created);
    },

    async get(scheduleId) {
      const client = getClient();
      const schedule = await client.get<ApiSchedule>(`/schedule/${scheduleId}`);
      return new Schedule(client, schedule);
    },

    async list(options) {
      const client = getClient();
      const res = await client.get<GetSchedulesResponse>("/schedules", {
        query: options.agentId ? { agent_id: options.agentId } : { org_id: options.orgId },
      });
      return res.schedules.map((s) => new Schedule(client, s));
    },

    async update(scheduleId, options) {
      return updateSchedule(getClient(), scheduleId, options);
    },

    async delete(scheduleId) {
      await getClient().delete<SuccessResponse>(`/schedule/${scheduleId}`);
    },
  };
}
