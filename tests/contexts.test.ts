import { describe, expect, it, vi } from "vitest";
import { createClient, InvokeResponse, parseCallback } from "../src/index.js";
import { mockFetch, type MockCall } from "./helpers.js";

const context = {
  context_id: "ctx1",
  agent_id: "a1",
  org_id: "o1",
  user_id: "u1",
  client_id: null,
  messages: [],
  user_defined: { accessToken: "tok" },
  model_id: "gpt",
  context_percentage: 1,
  created_at: 1,
  updated_at: 1,
};

function sdk(handler: (call: MockCall) => { status?: number; body?: unknown }) {
  const { fetch, calls } = mockFetch(handler);
  return { ...createClient({ apiKey: "k", baseUrl: "https://api.test", fetch }), calls };
}

describe("Context", () => {
  it("creates a context and sends camel->snake options", async () => {
    const { Context, calls } = sdk(() => ({ body: context }));
    const ctx = await Context.create("a1", { userDefined: { accessToken: "tok" }, ttlDays: 7 });
    expect(calls[0]!.path).toBe("/context");
    expect(calls[0]!.body).toMatchObject({
      agent_id: "a1",
      user_defined: { accessToken: "tok" },
      ttl_days: 7,
    });
    expect(ctx.id).toBe("ctx1");
    expect(ctx.userDefined).toEqual({ accessToken: "tok" });
  });

  it("addMessageAndInvoke returns an InvokeResponse", async () => {
    const { Context } = sdk((call) => {
      if (call.path === "/context") return { body: context };
      return {
        body: {
          response: "hi there",
          saved_ai_messages: true,
          generated_messages: [{ sender: "ai", message: "hi there" }],
          invocation_cost: 0.01,
          client_side_tool_calls: null,
        },
      };
    });
    const ctx = await Context.create("a1");
    const res = await ctx.addMessageAndInvoke("hello");
    expect(res).toBeInstanceOf(InvokeResponse);
    expect(res.text).toBe("hi there");
    expect(res.saved).toBe(true);
    expect(res.cost).toBe(0.01);
    expect(res.generatedMessages).toHaveLength(1);
  });

  it("runs the client-side tool loop to completion via clientSideTools handlers", async () => {
    const handler = vi.fn(async (input: Record<string, unknown>) => ({ found: input.mrn }));
    const { Context, calls } = sdk((call) => {
      if (call.path === "/context") return { body: context };
      if (call.path === "/chat") {
        return {
          body: {
            response: "",
            saved_ai_messages: true,
            generated_messages: [],
            invocation_cost: 0.1,
            client_side_tool_calls: [
              { tool_call_id: "c1", tool_name: "lookupPatient", tool_input: { mrn: "42" } },
            ],
          },
        };
      }
      // /chat/client-side-tool-responses
      return {
        body: {
          response: "The patient is fine.",
          saved_ai_messages: true,
          generated_messages: [{ sender: "ai", message: "The patient is fine." }],
          invocation_cost: 0.2,
          client_side_tool_calls: null,
        },
      };
    });

    const ctx = await Context.create("a1");
    const res = await ctx.addMessageAndInvoke("check patient 42", {
      clientSideTools: { lookupPatient: handler },
    });

    expect(handler).toHaveBeenCalledWith(
      { mrn: "42" },
      expect.objectContaining({ contextId: "ctx1", toolName: "lookupPatient" }),
    );
    expect(res.text).toBe("The patient is fine.");
    expect(res.cost).toBeCloseTo(0.3);
    expect(res.clientSideToolCalls).toHaveLength(0);

    const submit = calls.find((c) => c.path === "/chat/client-side-tool-responses");
    expect(submit).toBeTruthy();
    const body = submit!.body as { tool_responses: { tool_call_id: string; response: string }[] };
    expect(body.tool_responses[0]!.tool_call_id).toBe("c1");
    expect(body.tool_responses[0]!.response).toBe(JSON.stringify({ found: "42" }));
  });

  it("exitOn breaks the loop and returns the tool call without running the handler", async () => {
    const handler = vi.fn();
    const { Context, calls } = sdk((call) => {
      if (call.path === "/context") return { body: context };
      return {
        body: {
          response: "",
          saved_ai_messages: true,
          generated_messages: [],
          client_side_tool_calls: [
            { tool_call_id: "c1", tool_name: "needsApproval", tool_input: { amount: 100 } },
          ],
        },
      };
    });

    const ctx = await Context.create("a1");
    const res = await ctx.addMessageAndInvoke("pay", {
      clientSideTools: { needsApproval: handler },
      exitOn: ["needsApproval"],
    });

    expect(handler).not.toHaveBeenCalled();
    expect(res.clientSideToolCalls).toHaveLength(1);
    expect(res.clientSideToolCalls[0]!.toolName).toBe("needsApproval");
    expect(calls.some((c) => c.path === "/chat/client-side-tool-responses")).toBe(false);
  });

  it("returns an AsyncAck (and sets callback headers) when callbackUrl is given", async () => {
    const { Context, calls } = sdk((call) => {
      if (call.path === "/context") return { body: context };
      return { status: 202, body: { job_id: "job-1", status: "queued", request_id: "req-1", poll_url: "/job/job-1" } };
    });
    const ctx = await Context.create("a1");
    const ack = await ctx.addMessageAndInvoke("hello", {
      callbackUrl: "https://myapp.com/cb",
      callbackToken: "shh",
    });
    expect(ack).toEqual({ status: "processing", requestId: "req-1", jobId: "job-1" });
    const chat = calls.find((c) => c.path === "/chat")!;
    expect(chat.headers["Callback-URL"]).toBe("https://myapp.com/cb");
    expect(chat.headers["Callback-Token"]).toBe("shh");
  });

  it("supports the approval flow: save:false then addMessages", async () => {
    const generated = [{ sender: "ai", message: "draft reply" }];
    const { Context, calls } = sdk((call) => {
      if (call.path === "/context") return { body: context };
      if (call.path === "/chat") {
        return {
          body: {
            response: "draft reply",
            saved_ai_messages: false,
            generated_messages: generated,
            client_side_tool_calls: null,
          },
        };
      }
      // /context/add-messages
      return { body: { ...context, messages: generated } };
    });

    const ctx = await Context.create("a1");
    const draft = await ctx.addMessageAndInvoke("write reply", { save: false });
    expect((calls.find((c) => c.path === "/chat")!.body as Record<string, unknown>).save_ai_messages).toBe(false);
    expect(draft.saved).toBe(false);

    await ctx.addMessages(draft.generatedMessages);
    const add = calls.find((c) => c.path === "/context/add-messages")!;
    expect((add.body as { messages: unknown[] }).messages).toEqual(generated);
  });
});

describe("parseCallback", () => {
  it("decodes the envelope and returns the raw response body (no reconstruction)", () => {
    const rawBody = {
      response: "done",
      saved_ai_messages: true,
      generated_messages: [{ sender: "ai", message: "done" }],
      client_side_tool_calls: null,
    };
    const result = parseCallback({
      request_id: "req-1",
      status_code: 200,
      response: rawBody,
    });
    expect(result.ok).toBe(true);
    expect(result.requestId).toBe("req-1");
    expect(result.response).toEqual(rawBody);
    expect(result.response).not.toBeInstanceOf(InvokeResponse);
  });

  it("surfaces errors", () => {
    const result = parseCallback({ request_id: "r", status_code: 500, error: "boom" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("boom");
  });
});
