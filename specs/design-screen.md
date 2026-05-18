# Feature: Design Screen

## ID
`design-screen`

## Status
`active`

## Regression Test
`e2e/design-screen.spec.ts`

## Description
The design screen (`/design`) is a streaming chat interface where the user
describes their building project in Swedish and converses with an assistant.
It is the working UI shell for the design phase: a labelled screen, an
empty-state prompt, a scrolling message list that streams the assistant's
reply, and a message composer.

History: this capability supersedes the delta specs 003 (design page heading)
and 009a (design chat UI). It describes the design screen as it must be now.

## User Stories

### As a user who clicked "Kom igång"
**I want** to know I have arrived at the design screen
**So that** I understand where I am and what to do

### As a user describing a project
**I want** to send a message and see the assistant reply stream back
**So that** the conversation feels responsive

## Acceptance Criteria

All criteria are browser-observable (Playwright).

### Scenario 1: The screen is identifiable

**Given** the user opens `/design`
**Then** a heading with the accessible name `Design` is visible
**And** an empty-state message is visible inviting the user to describe their project

### Scenario 2: Message composer

**Given** the user is on `/design`
**Then** a text input with placeholder `Beskriv vad du vill bygga...` is visible
**And** a send button labelled `Skicka` is visible
**And** the send button is disabled while the input is empty

### Scenario 3 (DEFERRED — not currently a binding criterion)

> **Honesty note:** the chat round-trip below was never genuinely verified.
> The loop's preview has no working chat backend (no key in Preview /
> non-deterministic LLM), so this scenario only ever "passed" UI-only or
> failed for infra reasons. It is **not binding** until
> [[deterministic-chat-seam]] lands (deterministic, key-free preview chat).
> At that point this is restored as a binding criterion and genuinely
> re-verified.
>
> **Given** the user has typed a non-empty message
> **When** they submit the form (click `Skicka` or press Enter)
> **Then** their message appears as a user message, the input clears, an
> assistant message appears and streams in, and a loading indicator shows
> while responding.

### Scenario 4: Reachable from the landing page

**Given** a visitor on `/`
**When** they activate `Kom igång`
**Then** they arrive on `/design` with the chat interface ready

## Out of Scope

- Structured model extraction, floor-plan rendering, triage, validation loop
  (these are planned: see [[007-situationsplan]], `009b`–`009e`)
- Persistence of conversations across reloads
- The temporary on-screen debug bar (see Notes — slated for removal, NOT part
  of the contract)

## Dependencies

- `app/api/design/chat/route.ts` provides the streaming chat endpoint
- Reachable from [[landing-page]]

## Notes

Implemented by `app/design/page.tsx` using `@ai-sdk/react` `useChat` against
`/api/design/chat`. Test hooks exist: `data-testid` `chat-input`,
`send-button`, `assistant-message`.

Known deviation (do not enshrine as contract): the page currently renders a
`status / msgs / error` debug bar marked "remove before launch". It is tech
debt to be removed and must not be asserted by the regression test.

Verification honesty: Scenarios 1, 2, 4 (identity, composer, navigation)
are genuinely browser-verified. Scenario 3 (chat streaming) is **deferred**
— it depends on a working chat backend the loop's preview never had, so it
was never truly verified. `e2e/design-screen.spec.ts`'s streaming
assertion is therefore not trustworthy until [[deterministic-chat-seam]]
makes preview chat deterministic; the test will be reworked to drive the
seam and Scenario 3 restored as binding then.
