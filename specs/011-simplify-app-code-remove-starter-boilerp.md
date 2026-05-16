# Feature: Simplify app code - remove starter boilerplate, fix footer year

## ID
`011-simplify-app-code-remove-starter-boilerp`

## Status
`chore`

## Description
Internal cleanup of the app code to remove create-next-app residue and unused assets. This includes removing the unnecessary `'use client'` directive from `app/page.tsx`, removing unused CSS variables and the `@theme inline` block from `app/globals.css`, removing the unused `Geist_Mono` font from `app/layout.tsx`, and fixing the footer year to be dynamic rather than hardcoded. The primary user-observable outcome is **no regression** plus the footer correctly displaying the current year.

## User Stories

### As a user
**I want** the app to work correctly without regressions
**So that** I can continue using the Swedish building permit assistant reliably

### As a user
**I want** the footer to show the correct current year
**So that** the legal information is always accurate

## Acceptance Criteria

All criteria must be browser-observable (testable via Playwright).

### Scenario 1: Landing page renders correctly

**Given** the user is on the homepage
**When** the page loads
**Then** the heading "Din svenska bygglovsassistent" is visible, a subheading is visible, and exactly one "Kom igång" CTA button linking to /design is present

### Scenario 2: Design screen renders correctly

**Given** the user navigates to /design
**When** the page loads
**Then** a "Design" heading is visible and a chat composer is present

### Scenario 3: Footer shows dynamic current year

**Given** the user is on either the homepage or /design
**When** the footer is visible
**Then** the footer contains text "© Bygglovsassistenten " followed by the current 4-digit year (e.g., 2026, 2027), not a hardcoded value

### Scenario 4: No visual regression

**Given** the changes are deployed
**When** the user visits any page in the app
**Then** all active capability specs (landing-page, design-screen, footer) continue to pass without regressions

## Verifier Hints
- Check landing page: use `page.getByText('Din svenska bygglovsassistent')` to verify the main heading is visible; use `page.getByRole('link', { name: 'Kom igång' })` to verify the CTA exists and has `href="/design"`
- Check design screen: navigate to `/design` and use `page.getByText('Design')` to verify the heading is visible; verify a chat input is present using `page.getByRole('textbox')`
- Check footer year: use `page.getByText(/© Bygglovsassistenten \d{4}/)` on both / and /design; extract the year and verify it equals `new Date().getFullYear()` in JavaScript
- Negative assertion: the page must NOT contain any browser console errors; the footer must NOT show a hardcoded 2026 when the current year is different
- Font verification: the page must render without missing font errors (no "Geist_Mono" errors in console)
- CSS verification: verify the page loads without style errors; no broken visual layout (use screenshot comparison or verify element positions)

## Out of Scope
- Adding new features or changing user-facing behavior beyond the footer year fix
- Modifying the active capability specs (landing-page, design-screen, footer) unless behavior actually changes

## Dependencies
- None (this is a refactor of existing code)

## Notes
- Implementation files: `app/page.tsx`, `app/globals.css`, `app/layout.tsx`, `components/Footer.tsx`
- This is a transient chore spec — it will be auto-pruned from `main` after the feature PR merges
- The footer year fix aligns with the requirement in `specs/footer.md` and `e2e/footer.spec.ts`