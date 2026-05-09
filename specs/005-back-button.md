# Feature: Back Button

## ID
`005-back-button`

## Status
`draft`

## Description
A back button on the design page that allows users to navigate back to the homepage. Currently, users who navigate from the homepage to the design page have no way to return, creating a dead-end navigation experience.

## User Stories

### As a user
**I want** to see a back button on the design page
**So that** I can easily return to the homepage

### As a user
**I want** clicking the back button to navigate me back to the homepage
**So that** I can start over or go back to the beginning

## Acceptance Criteria

### Scenario 1: Display back button on design page

**Given** the user visits the /design page
**When** the page loads
**Then** the page displays a button with back navigation functionality
**And** the button is visible on the page

### Scenario 2: Navigate to homepage on back button click

**Given** the user is on the /design page
**When** the user clicks the back button
**Then** the browser URL changes to "/"
**And** the homepage is displayed

### Scenario 3: Back button works after navigation from homepage

**Given** the user is on the homepage
**When** the user clicks the "Kom igång" button to navigate to /design
**And** the user clicks the back button
**Then** the browser URL changes to "/"
**And** the homepage greeting is displayed

### Scenario 4: Back button is accessible

**Given** the user is on the /design page
**When** the page loads
**Then** the back button can be activated via keyboard navigation
**And** the back button has a descriptive label or text indicating its purpose

## Out of Scope

- Browser back button functionality (native browser behavior)
- Forward navigation history
- Confirmation dialogs before navigating back
- Styling the button beyond basic visibility and positioning
- Persisting any design page state when navigating back

## Dependencies

- Feature 002 (Start Button) — The "Kom igång" button must exist on the homepage to provide the initial navigation to the design page
- Feature 003 (Design Page Heading) — The design page must exist with a heading as the navigation target

## Notes

This is a Phase 0 loop test feature to verify the loop handles bidirectional navigation. The back button should be a basic navigation mechanism (e.g., Next.js Link or router.push) that returns users to the homepage. Follow the existing styling patterns from the homepage button for consistency.
