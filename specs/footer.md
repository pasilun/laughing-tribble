# Feature: Site Footer

## ID
`footer`

## Status
`active`

## Regression Test
`e2e/footer.spec.ts`

## Description
A global footer rendered at the bottom of every page via the root layout. It
shows a copyright line identifying the app and the current year.

History: this capability supersedes delta spec 006 (footer with copyright).

## User Stories

### As a site visitor
**I want** to see a copyright notice on every page
**So that** I know who owns the app and that I'm on the real site

## Acceptance Criteria

All criteria are browser-observable (Playwright).

### Scenario 1: Footer on the landing page

**Given** a visitor opens `/`
**Then** a `contentinfo` landmark (footer) is visible
**And** it contains the text `© Bygglovsassistenten` followed by the current year

### Scenario 2: Footer on the design screen

**Given** a visitor opens `/design`
**Then** the same `contentinfo` footer is visible

## Out of Scope

- Footer navigation links, social links, legal pages

## Dependencies

- Rendered by `app/layout.tsx`; component in `components/Footer.tsx`
- Appears on [[landing-page]] and [[design-screen]]

## Notes

Known deviation (must be fixed, not enshrined): `components/Footer.tsx`
hardcodes the year as `2026`. The contract is "the current year"; the
regression test should assert the current year dynamically so the hardcode
surfaces as a failure when the year rolls over.
