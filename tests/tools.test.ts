import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createClient } from "../src/index.js";
import { mockFetch } from "./helpers.js";

const toolResponse = {
  tool_id: "t1",
  org_id: "o1",
  name: "lookup_patient",
  description: "Look up a patient",
  pd_id: "pd1",
  code: null,
  pass_context: true,
  is_async: false,
  is_client_side_tool: true,
  created_at: 1,
  updated_at: 1,
};

describe("Tools", () => {
  it("creates a client-side tool, minting a parameter definition from a Zod schema", async () => {
    const { fetch, calls } = mockFetch((call) =>
      call.path === "/parameter-definition"
        ? { body: { pd_id: "pd1" } }
        : { body: toolResponse },
    );
    const { Tools } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });

    const tool = await Tools.create("lookupPatient", z.object({ mrn: z.string() }), {
      isClientSide: true,
      passContext: true,
      description: "Look up a patient",
    });

    // First call registers the schema as a parameter definition.
    expect(calls[0]!.path).toBe("/parameter-definition");
    const pdBody = calls[0]!.body as Record<string, unknown>;
    expect(pdBody.schema).toMatchObject({ type: "object" });
    expect((pdBody.schema as Record<string, unknown>).properties).toHaveProperty("mrn");

    // Second call creates the tool, referencing the PD by id.
    expect(calls[1]!.path).toBe("/tool");
    const body = calls[1]!.body as Record<string, unknown>;
    expect(body.name).toBe("lookupPatient");
    expect(body.is_client_side_tool).toBe(true);
    expect(body.pass_context).toBe(true);
    expect(body.pd_id).toBe("pd1");

    expect(tool.id).toBe("t1");
    expect(tool.isClientSide).toBe(true);
  });

  it("accepts a raw JSON Schema object unchanged", async () => {
    const { fetch, calls } = mockFetch((call) =>
      call.path === "/parameter-definition"
        ? { body: { pd_id: "pd1" } }
        : { body: toolResponse },
    );
    const { Tools } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    const raw = { type: "object", properties: { q: { type: "string" } } };
    await Tools.create("search", raw, { code: "def search(q):\n  return q" });
    expect(calls[0]!.path).toBe("/parameter-definition");
    expect((calls[0]!.body as Record<string, unknown>).schema).toEqual(raw);
    expect((calls[1]!.body as Record<string, unknown>).pd_id).toBe("pd1");
  });

  it("lists default tools", async () => {
    const { fetch, calls } = mockFetch(() => ({
      body: { tools: [{ tool_id: "d1", name: "web_search", parameters: {}, category: "web" }] },
    }));
    const { Tools } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    const defaults = await Tools.defaults();
    expect(calls[0]!.path).toBe("/default-tools");
    expect(defaults[0]!.name).toBe("web_search");
  });
});
