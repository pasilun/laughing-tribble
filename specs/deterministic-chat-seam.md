# Feature: Deterministic Chat Seam

## ID
`deterministic-chat-seam`

## Status
`planned`

## Regression Test
`e2e/deterministic-chat-seam.spec.ts`

## Description
The design chat endpoint (`/api/design/chat/route.ts`) selects the AI model based on the environment to enable deterministic verification without a live LLM. In production, it uses the real Anthropic Claude Sonnet 4.5 model. In preview and local development environments, it uses a scripted fake model that returns predetermined responses and tool calls based on matching incoming user messages against a fixture map. The fake model flows through the same AI-SDK streaming and tool-call path as the real model, ensuring the code's wiring (not the model output) is tested. The client-side model state derived from tool-call results is displayed as a raw echo in a `<pre data-testid="model-state">` element on `/design`.

## User Stories

### As a developer running the loop
**I want** the preview environment to use a deterministic fake chat model
**So that** verification tests pass reliably without requiring an API key or waiting for non-deterministic LLM responses

### As a QA or verification system
**I want** the chat endpoint to expose the client-side model state on the page
**So that** I can verify tool-call results are correctly processed and rendered

## Acceptance Criteria

All criteria must be browser-observable and deterministic (no API key required).

### Scenario 1: Initial model state is empty/null

**Given** the user is on `/design`
**When** no chat message has been sent
**Then** `[data-testid="model-state"]` is visible and shows an empty or null model representation (no fabricated values)

### Scenario 2: First fixture prompt triggers scripted response

**Given** the user is on `/design`
**When** the user sends the message "Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred"
**Then** within 15 seconds, `[data-testid="model-state"]` displays a model with `flowType:"komplementbyggnad"`, `footprint.length:4.5`, and `footprint.width:4.5`
**And** an assistant text bubble appears in the chat interface
**And** the assistant text is visible (proving the streaming path works end-to-end)

### Scenario 3: Second fixture prompt triggers partial model update

**Given** a chat session where the first fixture prompt has been sent and the model state shows `length:4.5` and `width:4.5`
**When** the user sends the message "Ändra längden till 5 meter"
**Then** `[data-testid="model-state"]` updates to show `length:5` with `width` still `4.5` (partial update)
**And** the chat history remains visible (no page reload occurred)
**And** both previous user/assistant message pairs and the new pair are visible

### Scenario 4: Production environment uses real model

**Given** the application is running in a production environment (`VERCEL_ENV === 'production'`)
**When** any chat message is sent
**Then** the request is handled by the real Anthropic Claude Sonnet 4.5 model
**And** the scripted fake model is never used

### Scenario 5: Preview environment uses fake model without API key

**Given** the application is running in a preview or local development environment
**When** `ANTHROPIC_API_KEY` is not set
**When** a fixture prompt is sent
**Then** the chat still functions correctly with the scripted fake model
**And** all acceptance criteria pass deterministically

## Verifier Hints

- **State selector**: use `[data-testid="model-state"]` to find the raw model state element; it must be visible on `/design` page load and contain JSON-serialized model data (or null/empty string)
- **Negative assertion**: before sending any message, `[data-testid="model-state"]` must NOT contain fabricated values like `"flowType"`, `"footprint"`, or numeric dimensions; it should show only `null`, `{}`, `undefined`, or be empty
- **Async verification after first prompt**: send "Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred", wait up to 15s for `[data-testid="model-state"]` to update; it must contain `"flowType"` with value `"komplementbygagnad"` and numeric `length:4.5` and `width:4.5`; must NOT contain `"error"`, `"undefined"`, or `"fel uppstod"`
- **Partial update verification**: after first prompt succeeds, send "Ändra längden till 5 meter", wait up to 10s for model state update; `length` must be `5` and `width` must remain `4.5`; previous fixture values must persist (state mutation, not replacement)
- **Chat history persistence**: after sending both prompts, count visible message bubbles in the chat interface; must be at least 4 (2 user + 2 assistant); page must NOT have reloaded (check that input field still exists and scroll position is preserved)
- **Streaming evidence**: verify assistant text bubble appears with content (not just a loading spinner); assistant message must be >10 characters and must NOT contain API error messages
- **Production guard check**: in preview environment (no API key), verify all scenarios pass; do NOT attempt to test production behavior from preview (that requires a separate production deployment test)

## Out of Scope

- Real LLM extraction quality assessment → separate non-blocking evaluation (future work)
- Formatted or labeled summary panel → covered by `building-model-panel`
- Computed BYA (byggnadsyta) or nockhöjd values → covered by `building-model-computed`
- Roof, installations, or triage tools → separate capabilities
- Any changes to production chat behavior → production must continue using the real model unchanged

## Dependencies

- AI-SDK streaming and tool-call infrastructure (existing)
- `/design` page with chat interface (existing)
- `useChat` hook with `onToolCall` callback (existing)
- Vercel environment variables (`VERCEL_ENV`) automatically set by Vercel

## Notes

- Implementation file: `app/api/design/chat/route.ts`
- Client model state rendering: `<pre data-testid="model-state">` on `/design`
- Fixture map maps exact user message strings to scripted tool-call arguments
- Hard guard: production detection uses `process.env.VERCEL_ENV === 'production'` — do NOT introduce a manual env var toggle
- The fake model must use the same AI-SDK streaming interface; only the model output is faked, not the wiring path
- This supersedes the in-flight `building-model-extraction` (issue #47, PR #49) once implemented — that spec will be reconciled after this lands
- Known deviations: none (this is a new capability)