import { describe, expect, it } from "vitest";
import { createClient } from "../src/index.js";
import { mockFetch } from "./helpers.js";

describe("Models", () => {
  it("lists models mapped to camelCase", async () => {
    const { fetch, calls } = mockFetch(() => ({
      body: {
        models: [
          {
            model: "gpt-4o",
            model_provider: "openai",
            input_token_cost: 1,
            output_token_cost: 2,
            context_window_size: 128000,
            is_realtime: false,
          },
        ],
      },
    }));
    const { Models } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    const models = await Models.list();
    expect(calls[0]!.path).toBe("/models");
    expect(models[0]).toMatchObject({ id: "gpt-4o", provider: "openai", contextWindowSize: 128000 });
  });
});

describe("DataWindow", () => {
  it("creates a data window", async () => {
    const { fetch, calls } = mockFetch(() => ({
      body: {
        data_window_id: "dw1",
        org_id: "o1",
        name: "kb",
        description: null,
        data: "hello",
        created_at: 1,
        updated_at: 1,
      },
    }));
    const { DataWindow } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    const dw = await DataWindow.create("kb", "hello", { description: "notes" });
    expect(calls[0]!.path).toBe("/data-window");
    expect(calls[0]!.body).toMatchObject({ name: "kb", data: "hello", description: "notes" });
    expect(dw.id).toBe("dw1");
  });
});

describe("ApiKey", () => {
  it("generates a key and exposes the token once", async () => {
    const { fetch, calls } = mockFetch(() => ({
      body: {
        api_key_id: "key1",
        org_id: "o1",
        token: "jwt-token",
        valid: true,
        type: "org",
        user_id: "u1",
        created_at: 1,
        updated_at: 1,
      },
    }));
    const { ApiKey } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    const key = await ApiKey.generate();
    expect(calls[0]!.path).toBe("/generate-api-key");
    expect(calls[0]!.body).toMatchObject({ type: "org" });
    expect(key.token).toBe("jwt-token");
    expect(key.id).toBe("key1");
  });
});

describe("JsonDocument", () => {
  it("creates a document and sets a value with an inferred type", async () => {
    const doc = {
      document_id: "doc1",
      name: "cfg",
      data: {},
      org_id: "o1",
      is_public: false,
      created_at: 1,
      updated_at: 1,
    };
    const { fetch, calls } = mockFetch((call) => {
      if (call.path === "/json-document") return { body: doc };
      return { body: { success: true } };
    });
    const { JsonDocument } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    const d = await JsonDocument.create("cfg", {});
    await d.setValue("a.b", 5);
    const set = calls.find((c) => c.path === "/json-document/doc1/set")!;
    expect(set.body).toMatchObject({ path: "a.b", value: 5, type: "number" });
  });
});
