import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toJsonSchema } from "../src/schema.js";

describe("toJsonSchema", () => {
  it("converts a Zod schema to a JSON Schema object", async () => {
    const schema = await toJsonSchema(z.object({ name: z.string(), age: z.number().optional() }));
    expect(schema).toMatchObject({ type: "object" });
    expect(schema.properties).toHaveProperty("name");
  });

  it("passes a raw JSON Schema object through unchanged", async () => {
    const raw = { type: "object", properties: { q: { type: "string" } }, required: ["q"] };
    expect(await toJsonSchema(raw)).toEqual(raw);
  });
});
