import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createClient } from "../src/index.js";
import { mockFetch } from "./helpers.js";

const sreResponse = {
  sre_id: "sre1",
  org_id: "o1",
  name: "sentiment",
  description: null,
  pd_id: "pd1",
  is_public: false,
  prompt_template: "Analyze: ${TEXT}",
  variable_names: ["TEXT"],
  model_id: null,
  created_at: 1,
  updated_at: 1,
};

describe("StructuredResponse", () => {
  it("creates a saved endpoint, minting a parameter definition from the output schema", async () => {
    const { fetch, calls } = mockFetch((call) =>
      call.path === "/parameter-definition" ? { body: { pd_id: "pd1" } } : { body: sreResponse },
    );
    const { StructuredResponse } = createClient({
      apiKey: "k",
      baseUrl: "https://api.test",
      fetch,
    });

    await StructuredResponse.create("sentiment", {
      schema: z.object({ sentiment: z.enum(["positive", "negative"]) }),
      promptTemplate: "Analyze: ${TEXT}",
      variableNames: ["TEXT"],
    });

    // First call registers the output schema as a parameter definition.
    expect(calls[0]!.path).toBe("/parameter-definition");
    expect((calls[0]!.body as Record<string, unknown>).schema).toMatchObject({ type: "object" });

    // Second call creates the SRE, referencing the PD by id.
    expect(calls[1]!.path).toBe("/sre");
    const body = calls[1]!.body as Record<string, unknown>;
    expect(body.pd_id).toBe("pd1");
    expect(body.prompt_template).toBe("Analyze: ${TEXT}");
    expect(body.variable_names).toEqual(["TEXT"]);
  });

  it("runs a saved endpoint with variables and returns the typed object", async () => {
    const { fetch, calls } = mockFetch((call) => {
      if (call.path === "/parameter-definition") return { body: { pd_id: "pd1" } };
      if (call.path === "/sre") return { body: sreResponse };
      return { body: { sentiment: "positive" } };
    });
    const { StructuredResponse } = createClient({
      apiKey: "k",
      baseUrl: "https://api.test",
      fetch,
    });
    const sre = await StructuredResponse.create("sentiment", {
      schema: z.object({ sentiment: z.enum(["positive", "negative"]) }),
      promptTemplate: "Analyze: ${TEXT}",
      variableNames: ["TEXT"],
    });
    const out = await sre.run({ TEXT: "great!" });
    expect(calls[2]!.path).toBe("/run-sre/sre1");
    expect(calls[2]!.body).toEqual({ TEXT: "great!" });
    expect(out.sentiment).toBe("positive");
  });

  it("supports one-shot inline runs", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: { answer: 42 } }));
    const { StructuredResponse } = createClient({
      apiKey: "k",
      baseUrl: "https://api.test",
      fetch,
    });
    const out = await StructuredResponse.run({
      prompt: "What is 6x7?",
      schema: z.object({ answer: z.number() }),
    });
    expect(calls[0]!.path).toBe("/run-sre");
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.prompt).toBe("What is 6x7?");
    expect(body.schema).toMatchObject({ type: "object" });
    expect(out.answer).toBe(42);
  });
});
