# Feature: Design Chat UI

## ID
`009a-design-chat-ui`

## Status
`complete`

## Description

A streaming chat interface on `/design` that lets the user converse with Claude in Swedish. This is the UI shell for the design screen — no model extraction or floor plan yet, just a working, streaming conversation.

## User Stories

### As a homeowner
**I want** to open a design screen and type a description of my project
**So that** I can start a conversation about what I want to build

## Acceptance Criteria

### Scenario 1: Page loads with empty state

**Given** the user navigates to `/design`
**Then** the page title or heading contains "Design" or "Designa"
**And** a text input or textarea is visible
**And** a send button is visible

### Scenario 2: Message is sent and a response streams in

**Given** the user is on `/design`
**When** the user types any message and submits
**Then** the user's message appears in the conversation area
**And** an assistant response begins appearing within 10 seconds
**And** the response text grows progressively (streaming — not all at once)

### Scenario 3: Conversation history persists within the session

**Given** the user has sent one message and received a response
**When** the user sends a second message
**Then** both previous messages and both responses are visible in the conversation area
**And** a new response appears for the second message

### Scenario 4: Input clears after send

**Given** the user types a message and submits
**Then** the text input is empty after submission

## Verifier Hints

- Navigate to `/design` — confirm heading contains "Design" or "Designa", `[data-testid="chat-input"]` is visible, and `[data-testid="send-button"]` is visible
- Fill `[data-testid="chat-input"]` with "Hej, vad kan du hjälpa mig med?", click `[data-testid="send-button"]`, wait up to 15s for `[data-testid="assistant-message"]` to appear — it must contain **at least 20 characters** and must **NOT** contain "fel uppstod", "error", or "undefined"
- To verify streaming: record text length of `[data-testid="assistant-message"]` immediately when it first appears, wait 800ms, record again — second reading must be ≥ first (text is growing or already complete)
- After submit, `[data-testid="chat-input"]` must have value `""` (empty) — if the value is unchanged the send handler is broken
- Send a second message after receiving a first response — **both** user messages and **both** assistant responses must be simultaneously visible in the page (history must not disappear between sends)

## Out of Scope

- Tool calls or model extraction (spec 009b)
- Floor plan rendering (spec 009c)
- Triage panel (spec 009d)
- Saving conversation across page reloads

## Dependencies

- `ANTHROPIC_API_KEY` set in `.env.local` and Vercel (both Production and Preview environments)
- `ai` and `@ai-sdk/anthropic` packages — install with `npm install ai @ai-sdk/anthropic` if not present
- Route: `POST /api/design/chat` using `streamText` from `ai`, returning `result.toDataStreamResponse()`
- Client: `useChat` hook from `@ai-sdk/react` (not `ai/react`)
- The `/design` page already exists with a placeholder heading (from spec 003)

## Notes

- System prompt for this delivery: "Du är en hjälpsam assistent för bygglovsfrågor. Svara på svenska."
- No tools wired yet — pure text conversation
- Mobile: single column, input pinned to bottom
- For Playwright streaming test: record text content at t=0 after first chunk appears, wait 500ms, record again — assert second snapshot is longer than first
