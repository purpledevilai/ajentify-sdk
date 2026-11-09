# Changelog

All notable changes to `@ajentify/sdk` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semver (pre-1.0: minor bumps may break).

## [0.3.0] — 2026-11-09

Tracks the API's single-runner-per-context model (context inbox + run lease).

### Added
- **`QueuedResponse`** `{ status: "queued", itemId: string | null, contextId: string }` and the type guard **`isQueued(result)`**.
  The four chat routes (`/chat`, `/chat/invoke`, `/chat/add-ai-message`, `/chat/client-side-tool-responses`) now answer
  **HTTP 202** with this body when the context is being run by someone else; the SDK returns it instead of throwing.
  - `sync` strategy: 202 → `QueuedResponse`.
  - `poll` strategy: a job whose `result` is `{ status: "queued", … }` → `QueuedResponse` (a 202 that is already the
    queued body, with no job, is returned directly too).
  - `webhook` strategy: unchanged (`AsyncAck`); the callback's `response` may be the raw `{ status: "queued", … }` object.
  - The client-side tool loop stops and returns the `QueuedResponse` if a mid-loop turn is queued.
- **`Context.asyncToolResponse(contextId, { toolCallId, response })`** and **`context.asyncToolResponse({ toolCallId, response })`**
  → `POST /async-tool-response`, typed `AsyncToolResponseAck` `{ status: "triggered", itemId }`. Delivers the result of an
  async tool call; the API runs the context automatically, so no re-invoke is needed. Non-string `response` values are
  JSON-stringified (same rule as client-side tool results).
- Types: `InvokeResult = InvokeResponse | QueuedResponse`, `QueuedResponse`, `AsyncToolResponse`, `AsyncToolResponseAck`.

### Changed (breaking)
- `addMessageAndInvoke` / `invoke` / `addAiMessage` / `submitToolResponses` now resolve to `InvokeResult`
  (`InvokeResponse | QueuedResponse`) for the `sync` and `poll` strategies. Narrow with `isQueued(res)` (or
  `res instanceof InvokeResponse`) before reading `res.text` etc.

### Removed
- The API route `POST /on-tool-call-response` no longer exists; use `asyncToolResponse` (`POST /async-tool-response`).
  The SDK never wrapped the old route.

## [0.2.0] — 2026-10-24

### Added
- Invoke strategies `sync` / `poll` / `webhook` (`InvokeOptions.strategy`, `pollIntervalMs`, `signal`), `AsyncAck`.
- `Job` resource (`Job.get`, `Job.wait`) and `createClient({ timeoutMs })`.
- `Filesystem` resource.
- `Context.get` / `context.refresh` accept `toolOutputMaxChars`.

### Fixed
- `poll`: a completed job with no `result` surfaces `job.error` (e.g. `result_too_large`) instead of a generic failure.

## [0.1.0] — 2026-07-30

Initial release: agents, contexts, tools, structured responses, data windows, API keys, clients, JSON documents,
MCP connections, models; Zod-first schemas; async callback (`parseCallback`).
