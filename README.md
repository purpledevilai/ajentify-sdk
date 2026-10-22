# @ajentify/sdk

The official TypeScript SDK for the [Ajentify](https://ajentify.com) API. A clean, uniform wrapper over every Ajentify primitive — agents, contexts, tools, filesystems, structured responses, data windows, API keys, JSON documents, jobs and models — with Zod-first schemas and no `ParameterDefinition` / stage plumbing in sight.

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
- **One error type.** Everything fails as an `AjentifyError` (`status`, `code`, `body`); aborts and timeouts have `code: "aborted" | "timeout"`.

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

## MCP connections

Connect to a remote MCP server and expose a chosen subset of its tools to agents.
Connections are normally authored in the dashboard (which handles the OAuth flow),
but you can also manage them from the SDK:

```ts
import { MCPConnection } from "@ajentify/sdk";

const connection = await MCPConnection.create("Linear", "https://mcp.linear.app/mcp", {
  requiresAuth: true,
  accessToken,
  refreshToken,
  tokenEndpoint,
  selectedTools: [
    { name: "create_issue", description: "Create a Linear issue", inputSchema: {}, outputSchema: null },
  ],
});

await MCPConnection.list();
await connection.update({ selectedTools: [/* new subset */] });
```

## Agents

```ts
import { Agent } from "@ajentify/sdk";

const assistant = await Agent.create("Clinical Assistant", systemPrompt, [lookupPatient.id], {
  description: "Helps clinicians look up patients",
  modelId: "gpt-4o",
  // MCP connections whose selected tools are exposed to the agent (ID-pointer rule).
  mcpConnections: [connection.id],
});
```

## Contexts & chat

The context is where most of the action lives.

```ts
const context = await Context.create(assistant.id, {
  userDefined: { accessToken },
  // Extra MCP connections on top of the agent's defaults (ID-pointer rule).
  additionalMcpConnections: [connection.id],
});

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

### Long-running runs: strategies

A single model turn can outlive the API's synchronous limit (~29 s) — an autonomous agent that researches the web for minutes, for example. Every invoke method takes a `strategy`:

| `strategy` | What happens | Returns |
|---|---|---|
| `"sync"` (default) | One HTTP request stays open per turn. | `InvokeResponse` |
| `"poll"` | Each turn is dispatched as a job (`Prefer: respond-async`) and the SDK polls `GET /job/{id}` until it finishes. The client-side tool loop runs as normal, through jobs. | `InvokeResponse` |
| `"webhook"` | Dispatched as a job; the result is POSTed to `callbackUrl`. | `AsyncAck` |

`poll` is the one to reach for from a server-side job runner. Bound the whole run with `signal`:

```ts
const context = await Context.create(TRACKER_AGENT_ID, { promptArgs: { ARG_COMPANY: "Acme" } });

const result = await context.invoke({
  strategy: "poll",
  signal: AbortSignal.timeout(14 * 60_000), // the whole run: every turn, tool handler and poll
  clientSideTools: {
    add_alert: async ({ title, content }) => db.alerts.insert({ title, content }),
    set_output: async ({ output }) => db.runs.update({ output }),
  },
});

result.text;              // the agent's final message
result.generatedMessages; // everything it said and every tool it called
```

When the signal fires the promise rejects with an `AjentifyError` whose `code` is `"timeout"` (or `"aborted"` for a manual abort). The agent's current turn keeps running server-side and whatever it generated is saved on the context, so you can always `Context.get(id)` afterwards to see how far it got.

Jobs are also addressable directly — `Job.get(jobId)` / `Job.wait(jobId)` — and `createClient({ timeoutMs })` bounds each individual HTTP call.

### Async responses (callback URL)

The `webhook` strategy (implied by passing a `callbackUrl`) returns an `AsyncAck` immediately — `{ status, requestId, jobId }` — and the result is POSTed to your URL when finished.

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

Because the callback resolves in a separate process, the auto client-side tool loop does not run for it — the raw payload may include `client_side_tool_calls` for you to handle after reloading the context. `ctx.submitToolResponses(responses, { clientSideTools, strategy })` resumes the loop from there (or is a single round-trip without options).

## Filesystems

A filesystem is an org-scoped tree of folders and files that agents read and write through the built-in filesystem tools (`list_folder`, `open_file`, `create_file`, `edit_file`, …). Give an agent those tools and tell it where to work: agents address nodes by *tool paths* whose first segment is the filesystem id — `/<filesystem_id>/companies/acme` — which `fs.toolPath()` builds for you. The SDK methods accept either form.

```ts
import { Filesystem } from "@ajentify/sdk";

const fs = await Filesystem.getOrCreate("Thunderhead", { description: "Competitor monitoring memory" });

await fs.createFolder("/companies/acme", { description: "Acme Corp — monitoring notes" }); // parents created by default
await fs.createFile("/companies/acme/README.md", "# Acme");
await fs.writeFile("/companies/acme/README.md", "# Acme\nUpdated.");   // replace (creates if missing)
await fs.readFile("/companies/acme/README.md");
await fs.get("/companies");                                            // folder with children, or file with content
await fs.move("/companies/acme", "/companies/acme-corp");
await fs.remove("/companies/acme-corp", { recursive: true });
await fs.search("pricing", { scope: "content" });
await fs.tree();

// Hand the agent its working folder as a prompt argument:
await Context.create(agent.id, { promptArgs: { ARG_FOLDER: fs.toolPath("/companies/acme") } });
```

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
import { DataWindow, ApiKey, Client, JsonDocument, Models } from "@ajentify/sdk";

await DataWindow.create("kb", "knowledge base text");

const key = await ApiKey.generate();      // key.token is returned once
await ApiKey.list();

const endUser = await Client.create();    // server-minted client_id, no context
await Context.create(agent.id, { clientId: endUser.id });
await ApiKey.generate({ type: "client", clientId: endUser.id });

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
