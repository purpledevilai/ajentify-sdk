import { describe, expect, it, vi } from "vitest";
import { AjentifyError, createClient } from "../src/index.js";
import { mockFetch, type MockCall } from "./helpers.js";

const context = {
  context_id: "ctx1",
  agent_id: "a1",
  org_id: "o1",
  user_id: "u1",
  client_id: null,
  messages: [],
  user_defined: {},
  model_id: "gpt",
  context_percentage: 1,
  created_at: 1,
  updated_at: 1,
};

function sdk(handler: (call: MockCall) => { status?: number; body?: unknown }) {
  const { fetch, calls } = mockFetch(handler);
  return { ...createClient({ apiKey: "k", baseUrl: "https://api.test", fetch }), calls };
}

const chat = (over: Record<string, unknown>) => ({
  response: "",
  saved_ai_messages: true,
  generated_messages: [],
  invocation_cost: 0.1,
  client_side_tool_calls: null,
  ...over,
});

describe("poll strategy", () => {
  it("dispatches with Prefer: respond-async, polls the job, and runs the tool loop through jobs", async () => {
    let invokePolls = 0;
    const addAlert = vi.fn(async (input: Record<string, unknown>) => ({ alert_id: `al-${input.title}` }));
    const { Context, calls } = sdk((call) => {
      if (call.path === "/context") return { body: context };
      if (call.path === "/chat/invoke") {
        return { status: 202, body: { job_id: "job-1", status: "queued", request_id: "r1", poll_url: "/job/job-1" } };
      }
      if (call.path === "/job/job-1") {
        invokePolls += 1;
        if (invokePolls < 3) return { body: { job_id: "job-1", status: "in_progress" } };
        return {
          body: {
            job_id: "job-1",
            status: "completed",
            result: chat({
              generated_messages: [{ type: "tool_call", tool_call_id: "c1", tool_name: "add_alert", tool_input: { title: "x" } }],
              client_side_tool_calls: [{ tool_call_id: "c1", tool_name: "add_alert", tool_input: { title: "x" } }],
            }),
          },
        };
      }
      if (call.path === "/chat/client-side-tool-responses") {
        return { status: 202, body: { job_id: "job-2", status: "queued", request_id: "r2" } };
      }
      if (call.path === "/job/job-2") {
        return {
          body: {
            job_id: "job-2",
            status: "completed",
            result: chat({ response: "done", generated_messages: [{ sender: "ai", message: "done" }], invocation_cost: 0.2 }),
          },
        };
      }
      throw new Error(`unexpected ${call.path}`);
    });

    const ctx = await Context.create("a1");
    const res = await ctx.invoke({
      strategy: "poll",
      pollIntervalMs: 1,
      clientSideTools: { add_alert: addAlert },
    });

    expect(res.text).toBe("done");
    expect(res.cost).toBeCloseTo(0.3);
    expect(res.generatedMessages).toHaveLength(2);
    expect(res.needsClientSideTools).toBe(false);
    expect(addAlert).toHaveBeenCalledWith({ title: "x" }, expect.objectContaining({ toolCallId: "c1", toolName: "add_alert" }));

    const invoke = calls.find((c) => c.path === "/chat/invoke")!;
    expect(invoke.headers["Prefer"]).toBe("respond-async");
    const cont = calls.find((c) => c.path === "/chat/client-side-tool-responses")!;
    expect(cont.headers["Prefer"]).toBe("respond-async");
    expect(cont.body).toEqual({
      context_id: "ctx1",
      tool_responses: [{ tool_call_id: "c1", response: JSON.stringify({ alert_id: "al-x" }) }],
    });
    expect(invokePolls).toBe(3);
  });

  it("accepts a synchronous 200 from a route that ignored Prefer", async () => {
    const { Context, calls } = sdk((call) => {
      if (call.path === "/context") return { body: context };
      return { body: chat({ response: "sync answer" }) };
    });
    const ctx = await Context.create("a1");
    const res = await ctx.addMessageAndInvoke("hi", { strategy: "poll" });
    expect(res.text).toBe("sync answer");
    expect(calls.some((c) => c.path.startsWith("/job/"))).toBe(false);
  });

  it("surfaces a failed job as an AjentifyError carrying the job's status and code", async () => {
    const { Context } = sdk((call) => {
      if (call.path === "/context") return { body: context };
      if (call.path === "/chat/invoke") return { status: 202, body: { job_id: "j", status: "queued", request_id: "r" } };
      return {
        body: { job_id: "j", status: "error", error: { status_code: 402, message: "insufficient balance", code: "insufficient_balance" } },
      };
    });
    const ctx = await Context.create("a1");
    const err = await ctx.invoke({ strategy: "poll", pollIntervalMs: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(AjentifyError);
    expect(err.status).toBe(402);
    expect(err.code).toBe("insufficient_balance");
    expect(err.message).toBe("insufficient balance");
  });

  it("surfaces a completed job with no result using the job's error (result_too_large)", async () => {
    const { Context } = sdk((call) => {
      if (call.path === "/context") return { body: context };
      if (call.path === "/chat/invoke") return { status: 202, body: { job_id: "j", status: "queued", request_id: "r" } };
      return {
        body: {
          job_id: "j", status: "completed", result: null,
          error: { status_code: 200, message: "Result exceeds 350 KB; call the synchronous route to fetch it", code: "result_too_large" },
        },
      };
    });
    const ctx = await Context.create("a1");
    const err = await ctx.invoke({ strategy: "poll", pollIntervalMs: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(AjentifyError);
    expect(err.code).toBe("result_too_large");
    expect(err.message).toContain("Result exceeds 350 KB");

    const { Context: C2 } = sdk((call) => {
      if (call.path === "/context") return { body: context };
      if (call.path === "/chat/invoke") return { status: 202, body: { job_id: "j", status: "queued", request_id: "r" } };
      return { body: { job_id: "j", status: "completed", result: null } };
    });
    const ctx2 = await C2.create("a1");
    const err2 = await ctx2.invoke({ strategy: "poll", pollIntervalMs: 1 }).catch((e) => e);
    expect(err2.code).toBe("job_no_result");
  });

  it("stops polling when the signal fires and rejects with code timeout", async () => {
    let polls = 0;
    const { Context } = sdk((call) => {
      if (call.path === "/context") return { body: context };
      if (call.path === "/chat/invoke") return { status: 202, body: { job_id: "j", status: "queued", request_id: "r" } };
      polls += 1;
      return { body: { job_id: "j", status: "in_progress" } };
    });
    const ctx = await Context.create("a1");
    const err = await ctx
      .invoke({ strategy: "poll", pollIntervalMs: 5, signal: AbortSignal.timeout(40) })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AjentifyError);
    expect(err.code).toBe("timeout");
    expect(polls).toBeGreaterThan(0);
    expect(polls).toBeLessThan(20);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const { Context, calls } = sdk((call) => {
      if (call.path === "/context") return { body: context };
      return { body: chat({}) };
    });
    const ctx = await Context.create("a1");
    const controller = new AbortController();
    controller.abort();
    const err = await ctx.invoke({ signal: controller.signal }).catch((e) => e);
    expect(err).toBeInstanceOf(AjentifyError);
    expect(err.code).toBe("aborted");
    expect(calls.filter((c) => c.path === "/chat/invoke")).toHaveLength(0);
  });

  it("Job.get / Job.wait map the job row", async () => {
    let n = 0;
    const { Job } = sdk(() => {
      n += 1;
      return n < 2
        ? { body: { job_id: "j", status: "queued", route: "/chat/invoke", method: "POST" } }
        : { body: { job_id: "j", status: "completed", route: "/chat/invoke", method: "POST", result: { response: "x" }, finished_at: 9 } };
    });
    const first = await Job.get("j");
    expect(first).toMatchObject({ id: "j", status: "queued", route: "/chat/invoke", result: null, error: null });
    const done = await Job.wait<{ response: string }>("j", { intervalMs: 1 });
    expect(done.status).toBe("completed");
    expect(done.result?.response).toBe("x");
    expect(done.finishedAt).toBe(9);
  });
});

describe("submitToolResponses", () => {
  it("resumes the auto loop when handlers are given", async () => {
    const { Context, calls } = sdk((call) => {
      if (call.path === "/context") return { body: context };
      const n = calls.filter((c) => c.path === "/chat/client-side-tool-responses").length;
      if (n === 1) {
        return { body: chat({ client_side_tool_calls: [{ tool_call_id: "c2", tool_name: "set_output", tool_input: { output: "o" } }] }) };
      }
      return { body: chat({ response: "final" }) };
    });
    const ctx = await Context.create("a1");
    const res = await ctx.submitToolResponses([{ toolCallId: "c1", response: "ok" }], {
      clientSideTools: { set_output: async () => "saved" },
    });
    expect(res.text).toBe("final");
    expect(calls.filter((c) => c.path === "/chat/client-side-tool-responses")).toHaveLength(2);
  });

  it("is a single round-trip without handlers", async () => {
    const { Context, calls } = sdk((call) => {
      if (call.path === "/context") return { body: context };
      return { body: chat({ client_side_tool_calls: [{ tool_call_id: "c2", tool_name: "set_output", tool_input: {} }] }) };
    });
    const ctx = await Context.create("a1");
    const res = await ctx.submitToolResponses([{ toolCallId: "c1", response: "ok" }]);
    expect(res.needsClientSideTools).toBe(true);
    expect(calls.filter((c) => c.path === "/chat/client-side-tool-responses")).toHaveLength(1);
  });
});

describe("webhook strategy", () => {
  it("requires a callbackUrl", async () => {
    const { Context } = sdk(() => ({ body: context }));
    const ctx = await Context.create("a1");
    await expect(ctx.invoke({ strategy: "webhook" })).rejects.toThrow(/callbackUrl/);
  });
});
