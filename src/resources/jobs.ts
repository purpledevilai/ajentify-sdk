import type { AjentifyClient } from "../client.js";
import { abortedError } from "../client.js";
import { AjentifyError } from "../errors.js";
import type { GetClient } from "../internal.js";
import type { ApiJob } from "../types.js";

export type JobStatus = "queued" | "in_progress" | "completed" | "error";

/** The error a failed job carries (mirrors an HTTP error the route would have returned). */
export interface JobError {
  statusCode: number;
  message: string;
  code: string | null;
}

/**
 * An async job: the server-side execution of a request that was dispatched with
 * `Prefer: respond-async` or a `Callback-URL`. `result` is the raw body the route
 * would have returned synchronously.
 */
export interface Job<TResult = unknown> {
  id: string;
  status: JobStatus;
  /** The route that is running, e.g. `/chat/invoke`. */
  route: string | null;
  method: string | null;
  requestId: string | null;
  message: string | null;
  /** Present once `status === "completed"`. */
  result: TResult | null;
  /** Present once `status === "error"`. */
  error: JobError | null;
  startedAt: number | null;
  finishedAt: number | null;
  expiresAt: number | null;
}

export interface JobWaitOptions {
  /** Milliseconds between polls. Defaults to 2000. */
  intervalMs?: number;
  /** Abort waiting (the job itself keeps running server-side). */
  signal?: AbortSignal;
}

export function mapJob<T>(data: ApiJob): Job<T> {
  return {
    id: data.job_id,
    status: data.status,
    route: data.route ?? null,
    method: data.method ?? null,
    requestId: data.request_id ?? null,
    message: data.message ?? null,
    result: (data.result as T | null | undefined) ?? null,
    error: data.error
      ? {
          statusCode: data.error.status_code,
          message: data.error.message,
          code: data.error.code ?? null,
        }
      : null,
    startedAt: data.started_at ?? null,
    finishedAt: data.finished_at ?? null,
    expiresAt: data.expires_at ?? null,
  };
}

/** True once the job will not change again. */
export function isJobDone(job: Job): boolean {
  return job.status === "completed" || job.status === "error";
}

/**
 * Poll `GET /job/{id}` until the job completes or errors. Resolves with the job
 * on completion; rejects with an `AjentifyError` (carrying the job's status
 * code / code) when the job failed, or with code `aborted` / `timeout` when the
 * signal fires.
 */
export async function waitForJob<T>(
  client: AjentifyClient,
  jobId: string,
  options: JobWaitOptions = {},
): Promise<Job<T>> {
  const intervalMs = options.intervalMs ?? 2000;
  const signal = options.signal;
  for (;;) {
    const job = mapJob<T>(await client.get<ApiJob>(`/job/${jobId}`, { signal }));
    if (job.status === "completed") return job;
    if (job.status === "error") {
      const err = job.error;
      throw new AjentifyError(err?.message ?? `Job ${jobId} failed`, {
        status: err?.statusCode,
        code: err?.code ?? "job_failed",
        body: job,
      });
    }
    await sleep(intervalMs, signal);
    if (signal?.aborted) throw abortedError("GET", `/job/${jobId}`, signal);
  }
}

export interface JobApi {
  /** Fetch a job by id (owner-gated: only the principal that dispatched it). */
  get<T = unknown>(jobId: string): Promise<Job<T>>;
  /** Poll a job until it completes; rejects if it errors or the signal fires. */
  wait<T = unknown>(jobId: string, options?: JobWaitOptions): Promise<Job<T>>;
}

export function createJobApi(getClient: GetClient): JobApi {
  return {
    async get(jobId) {
      return mapJob(await getClient().get<ApiJob>(`/job/${jobId}`));
    },
    async wait(jobId, options) {
      return waitForJob(getClient(), jobId, options);
    },
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
