# Feature: Greeting

## ID
`001-greeting`

## Status
`draft`

## Description
A simple greeting feature that displays a personalized welcome message to users. This is a trivial feature to test the autonomous AI dev loop.

## User Stories

### As a user
**I want** to see a greeting when I visit the homepage
**So that** I feel welcomed to the application

### As a user
**I want** to see my name in the greeting
**So that** the message feels personal

## Acceptance Criteria

### Scenario 1: Display default greeting

**Given** the user visits the homepage
**When** the page loads
**Then** the page displays the text "Välkommen till Bygglovsassistenten"

### Scenario 2: Display personalized greeting with name input

**Given** the user visits the homepage
**When** the user enters "Anna" in the name input field
**Then** the greeting displays "Välkommen, Anna!"

### Scenario 3: Update greeting when name changes

**Given** the user has entered "Anna" in the name field
**When** the user changes the name to "Erik"
**Then** the greeting displays "Välkommen, Erik!"

### Scenario 4: Handle empty name

**Given** the user has entered a name
**When** the user clears the name field
**Then** the greeting displays "Välkommen till Bygglovsassistenten"

## Out of Scope

- Persisting the name across sessions
- Validating the name format
- Multi-language support
- Styling beyond basic Tailwind

## Dependencies

None

## Notes

This is a Phase 0 test feature to verify the loop works end-to-end.
