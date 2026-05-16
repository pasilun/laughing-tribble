# Feature: Building Model Extraction from Chat

## ID
`building-model-extraction`

## Status
`active`

## Regression Test
`e2e/building-model-extraction.spec.ts`

## Description
The `/design` page provides a chat interface with an AI assistant that maintains a structured building model based on the Swedish conversation. The assistant uses LLM tool-calls (specifically a `set_building` partial-update tool) to extract and update building parameters from user messages. This structured model is surfaced on the page as a visible raw echo in a `<pre data-testid="model-state">` element.

The model fields supported in this capability are:
- `flowType`: the building type (e.g., "komplementbyggnad")
- `footprint: { length, width }`: building dimensions in metres

The assistant updates only the fields that are explicitly mentioned or corrected in the conversation, maintaining previously extracted values.

## User Stories

### As a user
**I want** to describe my building project in natural Swedish chat
**So that** the system maintains a structured model of my building requirements that I can verify

## Acceptance Criteria

### Scenario 1: Initial building model extraction from Swedish description

**Given** the user is on the `/design` page with the chat interface
**When** the user sends the message "Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred"
**Then** within approximately 15 seconds, `[data-testid="model-state"]` becomes visible and contains `4.5` for length, `4.5` for width, and `komplementbyggnad` for flowType
**And** the model must NOT still show empty/`null` values for those fields

### Scenario 2: Partial update to extracted model

**Given** a building model has been extracted with length `4.5`, width `4.5`, and flowType `komplementbyggnad`
**When** the user sends the message "Ändra längden till 5 meter"
**Then** `[data-testid="model-state"]` updates to show length `5` while width remains `4.5` and flowType remains `komplementbyggnad`
**And** the page does NOT reload
**And** the chat history remains visible

### Scenario 3: Empty model state before any messages

**Given** the user is on the `/design` page with the chat interface
**When** no messages have been sent
**Then** `[data-testid="model-state"]` shows an empty/`null` model
**And** no fabricated values are present in the model state

## Verifier Hints
- Use `[data-testid="model-state"]` to locate the raw model JSON; it must contain the extracted values (e.g., `4.5`, `komplementbyggnad`)
- The page must NOT contain "fel uppstod", "error", or "undefined" in `[data-testid="model-state"]` at any point
- After sending the first message, wait up to 15s for `[data-testid="model-state"]` to appear; the JSON content must be parseable and must NOT be `null` or `{}` (empty object)
- To verify partial update: after the correction message, wait up to 10s for the model to update; the changed field must have the new value while other fields remain unchanged WITHOUT a page reload
- Before any message is sent, `[data-testid="model-state"]` must either show `null`, `{}`, or be absent — it must NOT contain any fabricated building dimensions or types

## Out of Scope

- Formatted/labelled summary panel with "–" placeholders → this is covered by `building-model-panel`
- Computed BYA (byggnadsarea) or nockhöjd (ridge height) → this is covered by `building-model-computed`
- Roof type, installations, or triage-context tools → these are part of a later extraction expansion
- Validation or enforcement of building regulations → user-owned

## Dependencies

- `[[design-screen]]` — provides the chat interface on `/design`
- `POST /api/design/chat` endpoint — existing chat endpoint that will be enhanced with tool-calls
- LLM service with tool-calling capability (e.g., OpenAI with function calling)

## Notes

- The `set_building` tool is a partial-update tool that only updates the fields explicitly provided in the tool call
- Implementation likely involves: enhancing the chat endpoint to support tool-calling, defining the `set_building` tool schema, and adding the model state display to the design page
- The model state is displayed as raw JSON (not styled) to keep this piece minimal and focused on extraction
- Chat messages and history persistence are handled by the existing `design-screen` capability