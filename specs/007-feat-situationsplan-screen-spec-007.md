# Feature: Situationsplan Screen

## ID
`007-feat-situationsplan-screen-spec-007`

## Status
`draft`

## Description
Build the situationsplan screen at `/situationsplan` where users upload a fastighetskarta image, place a draggable rectangle for the friggebod footprint, see four distance-to-edge labels in metres, and can export the annotated map as a PDF with north arrow and scale bar. This is a Phase 1 feature for the bygglov assistant, focusing on creating visual situationsplan documentation for friggebod applications.

## User Stories

### As a user creating a bygglov packet
**I want** to upload a fastighetskarta image to the situationsplan screen
**So that** I can visualize my building placement on the property map

### As a user creating a bygglov packet
**I want** to place a draggable rectangle representing the friggebod footprint on the map
**So that** I can accurately position the building relative to property boundaries

### As a user creating a bygglov packet
**I want** to see distance labels showing metres from the building to the northern, southern, eastern, and western edges of the map
**So that** I can verify the building meets setback requirements for a bygglovsfri friggebod

### As a user creating a bygglov packet
**I want** to export the annotated map as a PDF with a north arrow and scale bar
**So that** I can include a professional situationsplan in my bygglov packet

## Acceptance Criteria

All criteria must be browser-observable (testable via Playwright).

### Scenario 1: Display situationsplan screen with heading

**Given** the user visits the `/situationsplan` URL
**When** the page loads
**Then** the page displays a heading with the text "Situationsplan"

### Scenario 2: Upload and display fastighetskarta image

**Given** the user is on the `/situationsplan` page
**When** the user selects a valid image file using the file upload element with `data-testid="map-upload"`
**Then** the uploaded image is displayed in the `data-testid="map-canvas"` element
**And** the image is visible and rendered correctly

### Scenario 3: Display file upload before image is loaded

**Given** the user is on the `/situationsplan` page
**When** no image has been uploaded yet
**Then** a file upload element with `data-testid="map-upload"` is visible on the page

### Scenario 4: Place building rectangle via button

**Given** the user has uploaded a fastighetskarta image
**When** the user clicks the "Lägg till byggnad" button with `data-testid="add-building-btn"`
**Then** a rectangle element with `data-testid="building-rect"` appears on the map canvas
**And** the rectangle is visible and overlayed on the map image

### Scenario 5: Building rectangle is draggable

**Given** the user has placed a building rectangle on the map
**When** the user drags the rectangle using mouse interactions
**Then** the rectangle position updates in real-time
**And** the rectangle remains within the map canvas boundaries

### Scenario 6: Display distance labels in metres

**Given** the user has placed a building rectangle on the map
**When** the page renders
**Then** four distance labels are displayed with `data-testid="dist-north"`, `data-testid="dist-south"`, `data-testid="dist-east"`, and `data-testid="dist-west"`
**And** each label shows a numeric value representing metres
**And** the values are greater than or equal to 0

### Scenario 7: Distance labels update on rectangle movement

**Given** the user has placed a building rectangle on the map
**When** the user drags the rectangle to a new position
**Then** the distance labels update to reflect the new distances to each edge
**And** all four labels show values greater than or equal to 0

### Scenario 8: Export annotated map as PDF

**Given** the user has uploaded a map and placed a building rectangle
**When** the user clicks the "Exportera PDF" button with `data-testid="export-pdf-btn"`
**Then** a PDF file download is triggered
**And** the download begins automatically without additional user action

### Scenario 9: PDF includes required elements

**Given** the user exports the situationsplan as PDF
**When** the PDF download completes
**Then** the PDF contains the uploaded fastighetskarta image
**And** the PDF contains the building rectangle overlay
**And** the PDF contains a north arrow indicator
**And** the PDF contains a scale bar

### Scenario 10: Add building button requires uploaded map

**Given** the user is on the `/situationsplan` page
**When** no image has been uploaded
**Then** the "Lägg till byggnad" button with `data-testid="add-building-btn"` either is disabled or shows no effect when clicked

### Scenario 11: Export PDF requires uploaded map and building

**Given** the user is on the `/situationsplan` page
**When** no image has been uploaded
**Or** no building rectangle has been placed
**Then** the "Exportera PDF" button with `data-testid="export-pdf-btn"` either is disabled or shows no effect when clicked

## Out of Scope

- Automatic boundary detection from image content (property boundaries must be manually inferred from the uploaded map)
- Multiple buildings on the same situationsplan (single friggebod only)
- North arrow rotation customization (fixed orientation only)
- Real geodata or GIS integration (image-based approach only)
- Complex polygon shapes for buildings (rectangle footprint only)
- Advanced PDF customization beyond north arrow and scale bar
- Situationsplan review or validation by the tjänsteman agent

## Dependencies

None. This is a standalone feature that can be implemented independently.

## Notes

- This is a Phase 1 feature for the bygglov assistant, focusing on the friggebod flow
- The screen should use Swedish UI text throughout
- Follow the existing styling patterns from the homepage and design pages for consistency
- Distance calculations should be based on pixel measurements converted to metres using a reasonable scale assumption (e.g., 1 pixel = X metres based on typical fastighetskarta scales)
- The map canvas should be responsive and work on different screen sizes
- The building rectangle should have reasonable default dimensions (e.g., representing a 4×4m friggebod)
- PDF export should use a reliable library such as react-pdf or pdf-lib
- Consider adding a "Ta bort byggnad" (Remove building) button for better UX, though this is optional for the MVP
