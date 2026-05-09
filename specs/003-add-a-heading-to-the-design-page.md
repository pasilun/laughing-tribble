# Feature: Design Page Heading

## ID
`003-add-a-heading-to-the-design-page`

## Status
`draft`

## Description
A visible page heading on the /design route that provides context to users after they navigate from the homepage. Currently the /design page is a blank placeholder with no indication of where users have arrived.

## User Stories

### As a user
**I want** to see a clear heading on the design page
**So that** I know I've arrived at the correct location after clicking "Kom igång"

### As a user
**I want** the design page heading to provide context about the page's purpose
**So that** I understand what I can do on this page

## Acceptance Criteria

### Scenario 1: Display heading on design page

**Given** the user visits the /design page
**When** the page loads
**Then** the page displays an h1 heading element
**And** the heading is visible on the page

### Scenario 2: Heading provides context

**Given** the user visits the /design page
**When** the page loads
**Then** the page displays an h1 heading element with text content
**And** the heading text is not empty

### Scenario 3: Navigation from homepage shows heading

**Given** the user is on the homepage
**When** the user clicks the "Kom igång" button
**Then** the browser URL changes to "/design"
**And** the page displays an h1 heading element

## Out of Scope

- Any functionality on the design page beyond displaying a heading
- Styling or design specifics for the heading (beyond visibility)
- Navigation or routing logic
- Form inputs or interactive elements
- Content beyond the heading

## Dependencies

- Feature 002 (Start Button) — The "Kom igång" button must exist on the homepage to navigate to the design page

## Notes

This is a simple Phase 0 feature to verify the loop handles page-level UI components. The heading should be basic text using Tailwind CSS for visibility. No complex styling, animations, or interactive elements are required.
