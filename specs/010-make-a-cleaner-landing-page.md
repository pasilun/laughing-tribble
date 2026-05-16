# Feature: Cleaner Landing Page

## ID
`010`

## Status
`draft`

## Description
Redesign the homepage/landing page to provide a cleaner, more polished first impression with strong visual hierarchy, clear messaging, and a focused call-to-action. The current page mixes a greeting feature with the main CTA, creating confusion. The new design should clearly communicate the app's purpose (Swedish bygglov assistant for small structures) and provide a single, primary action to get started.

## User Stories

### As a first-time visitor
**I want** to immediately understand what the app does
**So that** I can decide if it's relevant to my needs

### As a first-time visitor
**I want** to see a clear primary call-to-action
**So that** I know what to do next without confusion

### As a first-time visitor
**I want** the page to look professional and polished
**So that** I trust the app with my bygglov needs

### As a user
**I want** the existing navigation links to continue working
**So that** I can still access other parts of the app

## Acceptance Criteria

All criteria must be browser-observable (testable via Playwright).

### Scenario 1: Page loads with clear messaging

**Given** the user navigates to the homepage
**When** the page loads
**Then** a headline element is visible with text containing "bygglov" OR "Bygglovsassistenten"
**And** a subheading element is visible with text at least 20 characters long
**And** the subheading explains the app's purpose (mentions "friggebod" OR "attefall" OR "små byggnader" OR similar)
**And** there is exactly one primary CTA button visible with text "Kom igång" or similar
**And** the primary CTA links to "/design"

### Scenario 2: Visual hierarchy and spacing

**Given** the user navigates to the homepage
**When** the page loads
**Then** the headline is larger than the subheading (headline font-size ≥ 1.5× subheading font-size)
**And** the primary CTA is positioned below the headline and subheading
**And** there is at least 20px of vertical space between the subheading and the CTA
**And** the primary CTA has a distinct background color different from the page background
**And** the page has a light background color (hex color brightness ≥ 200 or is white)

### Scenario 3: Responsive layout

**Given** the user navigates to the homepage
**When** the viewport is set to 375px wide (mobile)
**Then** all text elements are fully visible without horizontal scrolling
**And** the primary CTA button is fully visible and tappable
**And** there are no overlapping elements

**Given** the user navigates to the homepage
**When** the viewport is set to 1920px wide (desktop)
**Then** content is centered horizontally with equal left/right margins ≥ 100px
**And** maximum content width is ≤ 1200px

### Scenario 4: Typography consistency

**Given** the user navigates to the homepage
**When** the page loads
**Then** all visible text uses a sans-serif font family
**And** the headline uses a bold or semibold font weight
**And** the subheading and button use the same font weight as each other

### Scenario 5: No confusing test features

**Given** the user navigates to the homepage
**When** the page loads
**Then** there is NO visible text input field for entering a name
**And** there is NO button labeled "Byt färg" or similar
**And** there is NO greeting text that changes based on user input

### Scenario 6: Existing navigation preserved

**Given** the user navigates to the homepage
**When** the user clicks the primary CTA button
**Then** the URL changes to "/design"
**And** the new page loads successfully (status code 200)

**Given** the user is on the homepage
**When** the user navigates directly to "/design"
**Then** the page loads successfully (status code 200)

## Out of Scope

- Adding new features beyond the landing page redesign
- Changing the "/design" page functionality
- Adding animations or 3D elements (deferred to future phases)
- Implementing authentication or user accounts
- Integrating with the tjänsteman agent on the landing page
- Adding multi-language support (beyond the existing Swedish)
- Creating additional pages or routes

## Dependencies

- None (this is a UI-only change to the existing homepage)

## Notes

- The current greeting feature (name input + color toggle button) was a test feature from Phase 0 and should be removed
- The new design should be simple and focused — resist the urge to add features
- Use Tailwind CSS utility classes for all styling
- Maintain the existing color scheme (zinc palette for dark mode support)
- The page should load quickly — avoid adding heavy assets
- Consider accessibility: ensure adequate color contrast, proper heading hierarchy, and keyboard navigability
