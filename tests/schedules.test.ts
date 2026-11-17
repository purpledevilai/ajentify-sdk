import { describe, expect, it } from "vitest";
import { AjentifyError, createClient } from "../src/index.js";
import { mockFetch } from "./helpers.js";

const schedule = {
  schedule_id: "s1",
  org_id: "o1",
  agent_id: "a1",
  name: "Morning digest",
  schedule_expression: "cron(0 9 ? * MON-FRI *)",
  timezone: "Australia/Melbourne",
  enabled: true,
  prompt_args: { ARG_TOPIC: "AI news" },
  message: "Good morning",
  created_by: "u1",
  client_id: "c1",
  created_at: 1,
  updated_at: 1,
  run_count: 0,
};

describe("Schedule", () => {
  it("creates a schedule with snake_case body and camelCase instance", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: schedule }));
    const { Schedule } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    const s = await Schedule.create({
      agentId: "a1",
      scheduleExpression: "cron(0 9 ? * MON-FRI *)",
      timezone: "Australia/Melbourne",
      promptArgs: { ARG_TOPIC: "AI news" },
      message: "Good morning",
      name: "Morning digest",
      enabled: true,
    });
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.path).toBe("/schedule");
    expect(calls[0]!.body).toEqual({
      agent_id: "a1",
      schedule_expression: "cron(0 9 ? * MON-FRI *)",
      timezone: "Australia/Melbourne",
      prompt_args: { ARG_TOPIC: "AI news" },
      message: "Good morning",
      name: "Morning digest",
      enabled: true,
    });
    expect(s).toMatchObject({
      id: "s1",
      orgId: "o1",
      agentId: "a1",
      name: "Morning digest",
      scheduleExpression: "cron(0 9 ? * MON-FRI *)",
      timezone: "Australia/Melbourne",
      enabled: true,
      promptArgs: { ARG_TOPIC: "AI news" },
      message: "Good morning",
      createdBy: "u1",
      clientId: "c1",
      runCount: 0,
      lastRunAt: null,
      lastContextId: null,
      lastStatus: null,
      lastError: null,
    });
  });

  it("omits optional create fields that were not given", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: schedule }));
    const { Schedule } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    await Schedule.create({ agentId: "a1", scheduleExpression: "rate(2 hours)" });
    expect(calls[0]!.body).toEqual({ agent_id: "a1", schedule_expression: "rate(2 hours)" });
  });

  it("gets a schedule by id and maps run bookkeeping", async () => {
    const { fetch, calls } = mockFetch(() => ({
      body: { ...schedule, run_count: 3, last_run_at: 99, last_context_id: "ctx9", last_status: "error", last_error: "boom" },
    }));
    const { Schedule } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    const s = await Schedule.get("s1");
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.path).toBe("/schedule/s1");
    expect(s).toMatchObject({ runCount: 3, lastRunAt: 99, lastContextId: "ctx9", lastStatus: "error", lastError: "boom" });
  });

  it("lists by agent or by org", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: { schedules: [schedule] } }));
    const { Schedule } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    const byAgent = await Schedule.list({ agentId: "a1" });
    expect(calls[0]!.path).toBe("/schedules");
    expect(calls[0]!.query.get("agent_id")).toBe("a1");
    expect(calls[0]!.query.has("org_id")).toBe(false);
    expect(byAgent).toHaveLength(1);
    expect(byAgent[0]!.id).toBe("s1");

    await Schedule.list({ orgId: "o1" });
    expect(calls[1]!.query.get("org_id")).toBe("o1");
    expect(calls[1]!.query.has("agent_id")).toBe(false);
  });

  it("updates partially (nulls clear, undefined omitted) from instance and namespace", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: { ...schedule, enabled: false, message: null } }));
    const { Schedule } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    const s = await Schedule.get("s1");
    const updated = await s.update({ enabled: false, message: null, promptArgs: null });
    expect(calls[1]!.method).toBe("POST");
    expect(calls[1]!.path).toBe("/schedule/s1");
    expect(calls[1]!.body).toEqual({ enabled: false, message: null, prompt_args: null });
    expect(updated.enabled).toBe(false);
    expect(updated.message).toBeNull();

    await Schedule.update("s1", { scheduleExpression: "rate(1 day)", timezone: "UTC", name: "x" });
    expect(calls[2]!.body).toEqual({ schedule_expression: "rate(1 day)", timezone: "UTC", name: "x" });
  });

  it("deletes from instance and namespace", async () => {
    const { fetch, calls } = mockFetch((call) => (call.method === "DELETE" ? { body: { success: true } } : { body: schedule }));
    const { Schedule } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    const s = await Schedule.get("s1");
    await s.delete();
    expect(calls[1]!.method).toBe("DELETE");
    expect(calls[1]!.path).toBe("/schedule/s1");
    await Schedule.delete("s2");
    expect(calls[2]!.path).toBe("/schedule/s2");
  });

  it("runNow polls the job and resolves with the schedule + context id", async () => {
    const ran = { ...schedule, run_count: 1, last_status: "ok", last_context_id: "ctx1", last_run_at: 50 };
    let polls = 0;
    const { fetch, calls } = mockFetch((call) => {
      if (call.path === "/schedule/s1") return { body: schedule };
      if (call.path === "/schedule/s1/run") {
        return { status: 202, body: { job_id: "j1", request_id: "r1", status: "queued", poll_url: "/job/j1" } };
      }
      if (call.path === "/job/j1") {
        polls += 1;
        return polls < 2
          ? { body: { job_id: "j1", status: "in_progress" } }
          : { body: { job_id: "j1", status: "completed", result: { schedule: ran, context_id: "ctx1" } } };
      }
      throw new Error(`unexpected ${call.path}`);
    });
    const { Schedule } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    const s = await Schedule.get("s1");
    const result = await s.runNow({ intervalMs: 1 });
    expect(calls[1]!.method).toBe("POST");
    expect(calls[1]!.path).toBe("/schedule/s1/run");
    expect(polls).toBe(2);
    expect(result.contextId).toBe("ctx1");
    expect(result.schedule.runCount).toBe(1);
    expect(result.schedule.lastStatus).toBe("ok");
    expect(result.schedule.lastContextId).toBe("ctx1");
  });

  it("runNow({ wait: false }) returns the queued job without polling", async () => {
    const { fetch, calls } = mockFetch((call) => {
      if (call.path === "/schedule/s1/run") return { status: 202, body: { job_id: "j1", request_id: "r1", status: "queued" } };
      throw new Error(`unexpected ${call.path}`);
    });
    const { Schedule } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    const job = await Schedule.runNow("s1", { wait: false });
    expect(calls).toHaveLength(1);
    expect(job.id).toBe("j1");
    expect(job.status).toBe("queued");
    expect(job.result).toBeNull();
  });

  it("runNow rejects with the job's error when the run fails", async () => {
    const { fetch } = mockFetch((call) => {
      if (call.path === "/schedule/s1/run") return { status: 202, body: { job_id: "j1", request_id: "r1", status: "queued" } };
      return {
        body: { job_id: "j1", status: "error", error: { status_code: 402, message: "Insufficient balance", code: "insufficient_balance" } },
      };
    });
    const { Schedule } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    const err = await Schedule.runNow("s1", { intervalMs: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AjentifyError);
    expect((err as AjentifyError).status).toBe(402);
    expect((err as AjentifyError).code).toBe("insufficient_balance");
  });

  it("runNow throws when the route did not return a job", async () => {
    const { fetch } = mockFetch(() => ({ status: 202, body: { request_id: "r1" } }));
    const { Schedule } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    await expect(Schedule.runNow("s1")).rejects.toBeInstanceOf(AjentifyError);
  });
});
