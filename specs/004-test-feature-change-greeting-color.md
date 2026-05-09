# Feature: Change Greeting Color

## ID
`004-test-feature-change-greeting-color`

## Status
`draft`

## Description
A toggle button that changes the greeting text color between default and red. This allows users to customize the visual appearance of the greeting.

## User Stories

### As a user
**I want** to be able to change the greeting text color by clicking a button
**So that** I can customize the visual appearance of the greeting

### As a user
**I want** the button to toggle between red and the default color
**So that** I can easily switch between the two states

## Acceptance Criteria

All criteria must be browser-observable (testable via Playwright).

### Scenario 1: Toggle greeting color to red

**Given** the homepage is loaded
**When** the user clicks the color toggle button
**Then** the greeting text color changes to red

**Given** the greeting text color is red
**When** the user clicks the color toggle button
**Then** the greeting text color changes to the default color

### Scenario 2: Initial button state

**Given** the homepage is loaded
**When** the page renders
**Then** the color toggle button is visible on the page
**And** the greeting text has the default color (not red)

### Scenario 3: Multiple toggles

**Given** the homepage is loaded
**When** the user clicks the color toggle button three times
**Then** the greeting text color is red

**Given** the greeting text color is red
**When** the user clicks the color toggle button four more times
**Then** the greeting text color has the default color (not red)

## Out of Scope

- Custom color selection (only toggle between default and red)
- Color changes persisting across page refreshes
- Color changes persisting across browser sessions
- Accessibility settings or high contrast mode integration

## Dependencies

- None (this is a standalone feature)

## Notes

- The default color should match the current greeting text color
- The toggle button should have clear visual feedback when clicked
- This is a test feature to demonstrate the spec → dev → verify → merge loop
