# Feature: Footer with Copyright

## ID
`006`

## Status
`draft`

## Description
Add a footer to the bottom of every page displaying the copyright text "© Bygglovsassistenten" and the current year.

## User Stories

### As a site visitor
**I want** to see a copyright notice at the bottom of every page
**So that** I know who owns the application and when it was published

### As a site visitor
**I want** the footer to include the current year
**So that** I can see the copyright is up-to-date

## Acceptance Criteria

All criteria must be browser-observable (testable via Playwright).

### Scenario 1: Footer appears on homepage

**Given** the user visits the homepage
**When** the page loads
**Then** a footer element is visible at the bottom of the viewport
**And** the footer contains the text "© Bygglovsassistenten [current year]" where [current year] is the actual current year

### Scenario 2: Footer appears on design page

**Given** the user visits the design page at "/design"
**When** the page loads
**Then** a footer element is visible at the bottom of the viewport
**And** the footer contains the text "© Bygglovsassistenten [current year]" where [current year] is the actual current year

### Scenario 3: Footer stays at bottom on short pages

**Given** the user visits the homepage
**When** the page content is shorter than the viewport height
**Then** the footer is positioned at the bottom of the viewport

### Scenario 4: Footer stays at bottom on long pages

**Given** the user visits a page with content taller than the viewport
**When** the user scrolls to the bottom of the page
**Then** the footer is visible after all page content

### Scenario 5: Footer has correct year

**Given** the current year is 2026
**When** any page loads
**Then** the footer displays "© Bygglovsassistenten 2026"

## Out of Scope

- Footer links (e.g., privacy policy, terms of service)
- Social media links in footer
- Multiple footer sections
- Footer content other than the copyright notice
- Localization of footer text

## Dependencies

None

## Notes

- The footer should use the RootLayout to ensure it appears on all pages
- Use flexbox layout (`flex-col`, `flex-grow`, etc.) to position the footer at the bottom
- The year should be dynamically generated (not hardcoded)
