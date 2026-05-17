# Feature: Deterministic Chat Seam

## ID
`deterministic-chat-seam`

## Status
`planned`

## Regression Test
`e2e/deterministic-chat-seam.spec.ts`

## Description
The `/design` chat interface supports a deterministic testing mode that replaces the live LLM with a scripted fake in preview/local environments. This enables the autonomous loop to verify the chat wiring without requiring an LLM API key. The seam selects the model based on the `VERCEL_ENV` environment variable: production uses the real `anthropic('claude-sonnet-4-5')` model, while preview/local uses a scripted fake that streams fixed assistant text and `set_building` tool-calls matched from incoming user messages.

The scripted fake flows through the SAME AI-SDK streaming and tool-call path as the real model — only the model source is faked, never the wiring. The client maintains a building model from tool-call results, which is rendered as raw JSON in a `<pre data-testid="model-state">` element for verification.

The fake model is controlled by a fixtures map that matches exact prompts to scripted tool-call arguments:
- "Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred" → `set_building({ flowType:"komplementbyggnad", footprint:{length:4.5,width:4.5} })`
- "Ändra längden till 5 meter" → `set_building({ footprint:{length:5} })`

## User Stories

### As the autonomous verification loop
**I want** a deterministic chat seam that replaces the LLM with scripted responses in preview
**So that** I can verify the chat wiring and tool-call path without requiring an LLM API key

## Acceptance Criteria

### Scenario 1: Empty model state before any messages

**Given** the user is on the `/design` page with the chat interface
**When** no messages have been sent
**Then** `[data-testid="model-state"]` is visible
**And** `[data-testid="model-state"]` shows an empty/`null` model
**And** no fabricated values are present in the model state

### Scenario 2: Full model extraction from first fixture prompt

**Given** the user is on the `/design` page with the chat interface
**When** the user sends the message "Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred"
**Then** within approximately 15 seconds, `[data-testid="model-state"]` shows `komplementbyggnad` for flowType, `4.5` for length, and `4.5` for width
**And** an assistant text bubble appears (proving the stream path end-to-end)
**And** `[data-testid="model-state"]` must NOT still show empty/`null` values for those fields

### Scenario 3: Partial model update from second fixture prompt

**Given** a building model has been extracted with length `4.5`, width `4.5`, and flowType `komplementbyggnad`
**When** the user sends the message "Ändra längden till 5 meter"
**Then** within approximately 10 seconds, `[data-testid="model-state"]` updates to show length `5`
**And** width remains `4.5` and flowType remains `komplementbyggnad` (partial update)
**And** the page does NOT reload
**And** the chat history remains visible (both previous messages and responses)

## Verifier Hints
- Use `[data-testid="model-state"]` to locate the raw model JSON; it must contain the extracted values (e.g., `4.5`, `komplementbyggnad`)
- Before any message, `[data-testid="model-state"]` must show `null` or `{}` (empty) — it must NOT contain any fabricated values
- The page must NOT contain "fel uppstod", "error", or "undefined" in `[data-testid="model-state"]` or chat bubbles
- After sending the first message, wait up to 15s for `[data-testid="model-state"]` and an assistant bubble to appear; model state must contain all three fields (flowType, length, width) with correct values
- To verify partial update: after the correction message, wait up to 10s; the changed field (length) must have the new value while other fields remain unchanged WITHOUT a page reload
- Verify both chat messages and both assistant responses are visible simultaneously after the second message (history persists)
- These tests must pass on the Vercel preview with NO `ANTHROPIC_API_KEY` set (validates the fake path)

## Out of Scope

- Real-LLM extraction quality evaluation → this is a separate non-blocking evaluation
- Formatted/labelled summary panel with user-friendly display → this is covered by `building-model-panel`
- Computed BYA (byggnadsarea) or nockhöjd (ridge height) → this is covered by `building-model-computed`
- Roof type, installations, or triage-context tools → these are part of a later expansion
- Any change to production chat behaviour (production still uses real model)

## Dependencies

- `[[design-screen]]` — provides the chat interface on `/design`
- `POST /api/design/chat` endpoint — existing chat endpoint that will be enhanced with model selection logic
- AI SDK streaming and tool-call infrastructure (useChat, onToolCall)

## Notes

- Implementation location: `app/api/design/chat/route.ts` — modify to select model based on `VERCEL_ENV`
- Hard guard: production must NEVER use the fake. Use `process.env.VERCEL_ENV === 'production'` to select real model
- The fake must implement the same streaming and tool-call interface as the real model to ensure the wiring is identical
- The model state is displayed as raw JSON (not styled) to keep this verification mechanism minimal
- The fixtures map should be extensible for future test scenarios but is intentionally minimal for this capability