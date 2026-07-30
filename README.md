# @ajentify/sdk

The official TypeScript SDK for the [Ajentify](https://ajentify.com) API. A clean, uniform wrapper over every Ajentify primitive — agents, contexts, tools, structured responses, data windows, API keys, JSON documents, and models — with Zod-first schemas and no `ParameterDefinition` / stage plumbing in sight.

```ts
import { Agent, Context } from "@ajentify/sdk";

// A message arrives (email, webhook, ...). Identify the sender, get or create
// their context for a specific agent, then add their message and invoke.
const agent = await Agent.get(AGENT_ID);
const context =
  (await lookupContextForUser(user)) ??
  (await Context.create(agent.id, { userDefined: { accessToken } }));

const response = await context.addMessageAndInvoke(userMessage, {
  clientSideTools: {
    // client-side tool code resolves here, at invoke time
    lookupPatient: async ({ mrn }) => db.find(mrn),
  },
});

console.log(response.text);
```

## Install

```bash
npm install @ajentify/sdk
# Zod is an optional peer dependency — install it to author schemas:
npm install zod
```

Requires Node 18+ (uses the global `fetch`).

## Authentication

The SDK reads your org API key from `AJENTIFY_API_KEY` by default (OpenAI-style). You can also configure it explicitly:

```ts
import { configure, createClient } from "@ajentify/sdk";

// Set global defaults used by the top-level namespaces.
configure({ apiKey: "aj_...", baseUrl: "https://api.ajentify.com" });

// Or create an isolated, per-key client (multi-tenant) exposing the same namespaces.
const aj = createClient({ apiKey: "aj_..." });
const agent = await aj.Agent.get(AGENT_ID);
```

> Client-type keys are for WebSocket/voice only and are rejected on the REST API — use an **org** key.

## Design principles

- **Uniform.** Every primitive follows `Primitive.create(...) -> instance`, with `get` / `list` / `update` / `delete`.
- **ID-pointer rule.** References between resources are always IDs: `Agent.create(name, prompt, toolIds)`, `Context.create(agentId, ...)`, `terminating.toolIds`. Every returned instance has an `.id`.
- **Zod-first schemas.** Anywhere a schema is needed, pass a Zod schema (types are inferred) or a raw JSON Schema object. `ParameterDefinition`s are managed for you.
- **CRUD is secondary.** You *can* create resources from the SDK, but most are authored in the dashboard or deployed via stages.

## Tools

```ts
import { Tools } from "@ajentify/sdk";
import { z } from "zod";

// Client-side tool: no code stored — its handler is supplied at invoke time.
const lookupPatient = await Tools.create("lookupPatient", z.object({ mrn: z.string() }), {
  isClientSide: true,
  passContext: true,
});

// Server-side tool: Python code runs in Ajentify's sandbox.
const addNumbers = await Tools.create("addNumbers", z.object({ a: z.number(), b: z.number() }), {
  code: "def add_numbers(a, b):\n    return a + b",
});

await Tools.list();
await Tools.defaults(); // built-in platform tools
```

## Agents

```ts
import { Agent } from "@ajentify/sdk";

const assistant = await Agent.create("Clinical Assistant", systemPrompt, [lookupPatient.id], {
  description: "Helps clinicians look up patients",
  modelId: "gpt-4o",
});
```

## Contexts & chat

The context is where most of the action lives.

```ts
const context = await Context.create(assistant.id, { userDefined: { accessToken } });

// Add a human message and invoke (save defaults to true).
const res = await context.addMessageAndInvoke("Look up patient 12345", {
  clientSideTools: { lookupPatient: async ({ mrn }, ctx) => db.find(mrn, ctx.userDefined) },
});

// Other message-stack controls:
await context.invoke();                 // invoke on the current stack
await context.addAiMessage("Noted.");   // insert an AI message
await context.setMessages([...]);       // replace the whole stack
await context.refresh();                // re-fetch messages
```

### Client-side tool loop

When you pass `clientSideTools`, the SDK runs the matching handlers and continues the conversation automatically until a final answer. Use `exitOn` to make specific tools break out of the loop and hand control back to you:

```ts
const res = await context.addMessageAndInvoke(text, {
  clientSideTools: { needsApproval: async () => "" },
  exitOn: ["needsApproval"], // stops the loop; res.clientSideToolCalls is populated
});

if (res.needsClientSideTools) {
  for (const call of res.clientSideToolCalls) {
    // handle call.toolName / call.toolInput yourself, then:
  }
  await context.submitToolResponses([{ toolCallId: "…", response: "…" }]);
}
```

### Approval workflow (generate now, save later)

`InvokeResponse` is a pure data object. Persist `generatedMessages` wherever you like; on approval, reload the context and add them.

```ts
// 1. Generate WITHOUT saving to the context.
const draft = await context.addMessageAndInvoke(userMessage, { save: false });

// 2. Persist the draft (in memory or your DB) and run human-in-the-loop review.
await db.saveDraft(contextId, draft.generatedMessages);

// 3. On approval, reload the context and commit exactly those messages.
const ctx = await Context.get(contextId);
await ctx.addMessages(await db.loadDraft(contextId));
```

### Async responses (callback URL)

Agent invocations can exceed API Gateway's 30s timeout. Pass a `callbackUrl` to dispatch asynchronously — the call returns an `AsyncAck` immediately, and the result is POSTed to your URL when finished.

The callback boundary is deliberately **stateless**: once the callback fires, no in-memory SDK state carries over. Encode whatever you need to resume — most importantly the context id — into the callback URL, then reload it in your handler and continue.

```ts
// Encode the context id (and anything else) into the callback URL.
const ack = await context.addMessageAndInvoke(userMessage, {
  callbackUrl: `https://myapp.com/ajentify/callback?contextId=${context.id}`,
  callbackToken: process.env.MY_WEBHOOK_SECRET, // sent as Authorization on the callback
});
// -> { status: "processing", requestId }
```

```ts
// Later, in your webhook handler:
import { parseCallback, Context } from "@ajentify/sdk";

const { ok, response, error } = parseCallback(req.body);
if (ok) {
  // Reload state from the URL params you encoded — nothing is retained locally.
  const contextId = new URL(req.url, "https://myapp.com").searchParams.get("contextId")!;
  const ctx = await Context.get(contextId);

  // `response` is the raw endpoint payload. Type it if you like:
  //   const { response: text } = parseCallback<{ response: string }>(req.body);
  await sendReply((response as { response: string }).response);
}
```

Because the callback resolves in a separate process, the auto client-side tool loop does not run for it — the raw payload may include `client_side_tool_calls` for you to handle after reloading the context (run them, then `ctx.submitToolResponses(...)`).

## Structured responses

```ts
import { StructuredResponse } from "@ajentify/sdk";
import { z } from "zod";

// Saved endpoint (reusable):
const sentiment = await StructuredResponse.create("sentiment", {
  schema: z.object({ sentiment: z.enum(["positive", "negative", "neutral"]) }),
  promptTemplate: "Classify the sentiment of: ${TEXT}",
  variableNames: ["TEXT"],
});
const result = await sentiment.run({ TEXT: "I love it!" });
result.sentiment; // typed

// One-shot inline:
const { answer } = await StructuredResponse.run({
  prompt: "What is 6 x 7?",
  schema: z.object({ answer: z.number() }),
});
```

## Other resources

```ts
import { DataWindow, ApiKey, JsonDocument, Models } from "@ajentify/sdk";

await DataWindow.create("kb", "knowledge base text");

const key = await ApiKey.generate();      // key.token is returned once
await ApiKey.list();

const doc = await JsonDocument.create("config", { featureFlags: {} });
await doc.setValue("featureFlags.beta", true);
await doc.getValue("featureFlags.beta");

const models = await Models.list();       // available LLMs + pricing
```

## Errors

Every failure surfaces as an `AjentifyError` with `status`, `code`, and `body` when the error came from the API.

```ts
import { AjentifyError } from "@ajentify/sdk";

try {
  await Agent.get("nope");
} catch (err) {
  if (err instanceof AjentifyError) console.error(err.status, err.message);
}
```

## License

MIT
