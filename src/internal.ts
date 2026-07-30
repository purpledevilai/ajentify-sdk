import type { AjentifyClient } from "./client.js";
import type { ApiParameterDefinition } from "./types.js";
import type { JsonSchema } from "./schema.js";

/** A resolver for the client a namespace is bound to (default or per-createClient). */
export type GetClient = () => AjentifyClient;

/**
 * Create a private ParameterDefinition holding a JSON Schema and return its id.
 * Tools and SREs reference schemas by `pd_id`; the SDK manages this indirection
 * so callers only ever pass a schema.
 */
export async function createParameterDefinition(
  client: AjentifyClient,
  schema: JsonSchema,
): Promise<string> {
  const pd = await client.post<ApiParameterDefinition>("/parameter-definition", { schema });
  return pd.pd_id;
}

/** Normalize a tool name the way the server does (spaces -> underscores, lowercase). */
export function toCodeName(name: string): string {
  return name.replaceAll(" ", "_").toLowerCase();
}
