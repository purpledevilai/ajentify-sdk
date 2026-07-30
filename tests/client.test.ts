import { describe, expect, it } from "vitest";
import { AjentifyClient, AjentifyError } from "../src/index.js";
import { mockFetch } from "./helpers.js";

describe("AjentifyClient", () => {
  it("adds the Bearer auth header and hits the configured base URL", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: { ok: true } }));
    const client = new AjentifyClient({ apiKey: "secret", baseUrl: "https://api.test", fetch });
    await client.get("/models");
    expect(calls[0]!.url).toBe("https://api.test/models");
    expect(calls[0]!.headers["Authorization"]).toBe("Bearer secret");
  });

  it("serializes query params and JSON bodies", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: {} }));
    const client = new AjentifyClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    await client.request("POST", "/thing", { query: { a: 1, b: true }, body: { x: "y" } });
    expect(calls[0]!.query.get("a")).toBe("1");
    expect(calls[0]!.query.get("b")).toBe("true");
    expect(calls[0]!.body).toEqual({ x: "y" });
    expect(calls[0]!.headers["Content-Type"]).toBe("application/json");
  });

  it("maps non-2xx responses to AjentifyError with status/code/body", async () => {
    const { fetch } = mockFetch(() => ({ status: 403, body: { error: "nope", code: "forbidden" } }));
    const client = new AjentifyClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    await expect(client.get("/x")).rejects.toMatchObject({
      message: "nope",
      status: 403,
      code: "forbidden",
    });
    await expect(client.get("/x")).rejects.toBeInstanceOf(AjentifyError);
  });

  it("throws when no API key is available for a private endpoint", async () => {
    const prev = process.env.AJENTIFY_API_KEY;
    delete process.env.AJENTIFY_API_KEY;
    try {
      const { fetch } = mockFetch(() => ({ body: {} }));
      const client = new AjentifyClient({ baseUrl: "https://api.test", fetch });
      await expect(client.get("/x")).rejects.toBeInstanceOf(AjentifyError);
    } finally {
      if (prev !== undefined) process.env.AJENTIFY_API_KEY = prev;
    }
  });
});
