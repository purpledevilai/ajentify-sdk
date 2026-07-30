import { AjentifyError } from "./errors.js";

/** A plain JSON Schema object (Draft 2020-12 on the server). */
export type JsonSchema = Record<string, unknown>;

/**
 * Anything the SDK accepts where a schema is required: a raw JSON Schema object,
 * or a validation library schema (Zod, or any Standard Schema implementation).
 */
export type SchemaInput = JsonSchema | StandardSchemaLike | ZodLike;

/** Minimal structural match for the Standard Schema spec (Zod v4, and others). */
export interface StandardSchemaLike<Output = unknown> {
  readonly "~standard": {
    readonly version: number;
    readonly vendor: string;
    readonly types?: { readonly output: Output; readonly input: unknown };
  };
}

interface ZodLike {
  parse?: (...args: unknown[]) => unknown;
  safeParse?: (...args: unknown[]) => unknown;
  _def?: unknown;
  _zod?: unknown;
}

/**
 * Infer the output type of a schema so `run()` / structured results are typed.
 * Works with Zod v3, Zod v4 (via Standard Schema `~standard`), or falls back to
 * `unknown` for raw JSON Schema objects.
 */
export type InferOutput<S> = S extends {
  readonly "~standard": { readonly types?: { readonly output: infer O } };
}
  ? O
  : S extends { _output: infer O }
    ? O
    : S extends { _type: infer O }
      ? O
      : unknown;

function isValidationSchema(value: unknown): boolean {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return false;
  }
  const v = value as ZodLike & Partial<StandardSchemaLike>;
  return (
    typeof v.parse === "function" ||
    typeof v.safeParse === "function" ||
    (v as Record<string, unknown>)["~standard"] !== undefined
  );
}

/**
 * Normalize a schema input to a JSON Schema object. Raw JSON Schema objects are
 * returned as-is. Validation-library schemas are converted: Zod v4 via the
 * built-in `z.toJSONSchema`, Zod v3 via the optional `zod-to-json-schema`.
 */
export async function toJsonSchema(input: SchemaInput): Promise<JsonSchema> {
  if (!isValidationSchema(input)) {
    return input as JsonSchema;
  }

  // Zod v4: static z.toJSONSchema (imported from the consumer's zod install so
  // the function instance matches the schema instance).
  try {
    const zodPkg = (await import("zod")) as unknown as {
      z?: { toJSONSchema?: (s: unknown, opts?: unknown) => JsonSchema };
      toJSONSchema?: (s: unknown, opts?: unknown) => JsonSchema;
    };
    const toJson = zodPkg.z?.toJSONSchema ?? zodPkg.toJSONSchema;
    if (typeof toJson === "function") {
      return toJson(input, { target: "draft-2020-12" });
    }
  } catch {
    // fall through to the v3 path
  }

  // Zod v3: optional peer dependency.
  try {
    const mod = (await import("zod-to-json-schema")) as unknown as {
      zodToJsonSchema: (schema: unknown, opts?: unknown) => JsonSchema;
    };
    return mod.zodToJsonSchema(input, { target: "jsonSchema2019-09" });
  } catch (err) {
    throw new AjentifyError(
      "Could not convert the provided schema to JSON Schema. Install zod >=4 (preferred) " +
        `or the 'zod-to-json-schema' package for zod v3. Underlying error: ${(err as Error).message}`,
    );
  }
}
