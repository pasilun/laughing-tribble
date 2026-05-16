# Feature: Landing Page

## ID
`landing-page`

## Status
`active`

## Regression Test
`e2e/landing-page.spec.ts`

## Description
The landing page (`/`) is the app's first impression. It states what the app
is (a Swedish bygglov assistant for small structures) and provides one primary
action that takes the visitor to the design screen. It is intentionally
single-purpose: one headline, one supporting line, one call-to-action. No
greeting, no secondary actions.

History: this capability supersedes the delta specs 001 (greeting), 002 (start
button) and 010 (cleaner landing page). It describes the homepage as it must
be now — not how it changed.

## User Stories

### As a first-time visitor
**I want** to immediately understand what the app does
**So that** I can decide if it is relevant to me

### As a visitor ready to begin
**I want** a single obvious way to start
**So that** I reach the design screen without hunting

## Acceptance Criteria

All criteria are browser-observable (Playwright).

### Scenario 1: The page communicates purpose

**Given** a visitor opens `/`
**Then** a single top-level heading is visible reading `Din svenska bygglovsassistent`
**And** a supporting line is visible mentioning friggebod and attefallshus
**And** the document language is Swedish (`<html lang="sv">`)

### Scenario 2: Single primary call-to-action

**Given** a visitor on `/`
**Then** exactly one primary action link is visible with the accessible name `Kom igång`
**And** there is no greeting message and no secondary call-to-action

### Scenario 3: The call-to-action navigates to the design screen

**Given** a visitor on `/`
**When** they activate the `Kom igång` link
**Then** the URL becomes `/design`

### Scenario 4: Footer is present

**Given** a visitor on `/`
**Then** the site footer (see [[footer]]) is visible at the bottom of the page

## Out of Scope

- The content/behaviour of `/design` (see [[design-screen]])
- Marketing copy beyond the headline + one supporting line
- Authentication, localisation toggles, theming controls

## Notes

Implemented by `app/page.tsx` (+ `app/layout.tsx` for the footer). Copy is in
Swedish. The CTA is a Next.js `Link` to `/design`.
