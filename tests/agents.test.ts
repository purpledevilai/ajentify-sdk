import { describe, expect, it } from "vitest";
import { createClient } from "../src/index.js";
import { mockFetch } from "./helpers.js";

const agentResponse = {
  agent_id: "a1",
  agent_name: "Clinical Assistant",
  agent_description: "helps",
  prompt: "You are helpful",
  org_id: "o1",
  is_public: false,
  is_default_agent: false,
  tools: ["t1", "t2"],
  created_at: 1,
  updated_at: 1,
};

describe("Agent", () => {
  it("creates an agent, passing tools by id (ID-pointer rule)", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: agentResponse }));
    const { Agent } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });

    const agent = await Agent.create("Clinical Assistant", "You are helpful", ["t1", "t2"], {
      description: "helps",
    });

    expect(calls[0]!.path).toBe("/agent");
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.agent_name).toBe("Clinical Assistant");
    expect(body.prompt).toBe("You are helpful");
    expect(body.tools).toEqual(["t1", "t2"]);
    expect(agent.id).toBe("a1");
    expect(agent.toolIds).toEqual(["t1", "t2"]);
  });

  it("fetches an agent by id", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: agentResponse }));
    const { Agent } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    const agent = await Agent.get("a1");
    expect(calls[0]!.path).toBe("/agent/a1");
    expect(agent.name).toBe("Clinical Assistant");
  });
});
