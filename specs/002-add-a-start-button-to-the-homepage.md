# Feature: Start Button on Homepage

## ID
`002-add-a-start-button-to-the-homepage`

## Status
`draft`

## Description
Add a "Kom igång" button below the greeting on the homepage. Clicking it navigates the user to `/design`. This is a Phase 0 loop test — intentionally minimal.

## User Stories

### As a user
**I want** to see a "Kom igång" button on the homepage
**So that** I can navigate to the design flow

## Acceptance Criteria

All criteria must be browser-observable (testable via Playwright).

### Scenario 1: Button is visible on homepage

**Given** the user visits the homepage
**When** the page loads
**Then** there is a button with the visible text "Kom igång"

### Scenario 2: Button navigates to /design

**Given** the user is on the homepage
**When** the user clicks the "Kom igång" button
**Then** the URL changes to `/design`

## Out of Scope

- Styling beyond a recognisable button (no design system required)
- Any content on the `/design` page beyond it loading without error
- Authentication or guards on the `/design` route

## Dependencies

- `001-greeting` — homepage must render before the button can be added

## Notes

The `/design` page does not need to exist yet; a 404 is acceptable as long as the navigation occurs. If the page is missing, a simple placeholder is fine.
