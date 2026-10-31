# Situation plan (situationsplan)

`npx tsx scripts/situation.mts "Strängnäs Lövinge 3:2" [--paper A3|A4] [--scale 500] [--address "…"] [--author "…"] [--no-map] [--out dir]`

makes `situationsplan.svg`, `.png` and `.pdf` (and `site.json`) of a property: the boundary, the
buildings with their sizes and the distance from each to the boundary, north arrow, scale bar,
legend and a title block. The whole property is fitted at the largest standard scale
(A3 portrait 1:500 for a plot of 77 × 168 m).

## Where the data comes from

Lantmäteriet's Min karta (minkarta.lantmateriet.se), through the two services the page itself uses:

- `api/searchservice/searchinput` and `…/fastighetsgeometri/v1`: the property's id and its boundary as
  polygons in SWEREF 99 TM (EPSG:3006), metres. This is the register map's boundary: it is
  what Min karta draws, and what an *inmätning* would confirm or correct, not a survey.
- `map/ortofoto` (WMS, EPSG:3006): Min karta's "Flygbild" – the best aerial photo it has, about 0.16 m per pixel, requested as one picture of the whole drawing area (`flygbild.*`: the photo under the boundary and buildings, with a 10 m grid in local coordinates, x east and y north from the south-west corner of the property, so that a place can be named "x 30, y 120"). Older photos ("Flygbild ca 1960", "ca 1975") are further layers in the same page; not used yet.
- `map/topowebbcache`: the topographic web map as WMTS tiles in EPSG:3006, finest level 13 =
  0.5 m per pixel. Used as a pale underlay, and to read the buildings.

The official property WMS (`maps.lantmateriet.se/fastighet/wms`) needs an agreement with
Lantmäteriet (401), and OpenStreetMap's Overpass is blocked in this environment, so the
buildings are read out of the map: a dwelling is painted orange-brown (201,135,84) and other
buildings tan (201,183,141); connected areas are fitted with the smallest rectangle (any angle)
and grown by half a pixel. **Good to about ±1 m, rectangles only** (an L-shaped house becomes
its bounding rectangle, a hip roof's eaves are not seen). The sheet says so in its title block.
When the exact position decides (a building a metre from the boundary), use the
building register's geometry or a survey instead.

These are not documented products: if the page changes, the lookup fails loudly. Keep the request
count small (about a dozen tiles per sheet) and use it for the property at hand.

## Code

`lib/site/lantmateriet.ts` (search, geometry, tiles), `buildings.ts` (footprints from the map),
`geometry.ts` (area, smallest rectangle, shortest line between outlines), `render.ts` (the SVG sheet),
`export.ts` (PNG, PDF). Test: `e2e/site-plan.spec.ts` on a recorded property
(`e2e/fixtures/site/lovinge.json`), no network.

The photo is a reference, not drawing material: it is taken at an angle to the vertical in places, roofs overhang walls, and trees hide the ground. The building rectangles come from the map, not from the photo.

## Marked areas

`sites/<property>/areas.json` (for Lövinge: `sites/strangnas-lovinge-3-2/areas.json`) holds areas to mark on both sheets: a name, a kind, a status (befintlig, idé, planerad, ansökan), colours, and a ring in **local metres** (x east, y north of the property's south-west corner, the same numbers as the photo sheet's grid). On the drawing (`situationsplan.*`) an area is a plan item like a building: grass hatching for a meadow, dots for a lawn, a dash-dot outline, a number (A1, A2), name and area (and how much of it is inside the boundary when it runs over it), and a legend line. Over the aerial photo (`flygbild.*`) it is only a yellow dashed outline, so the photo stays readable. The meadow in the file is read from the photo by brightness and smoothness (open, even ground between the dark spruce) and is an estimate, not a survey.

## Not yet

New buildings and changes (a proposed building in red with its distances), roads and the road
connection, building height and ridge, fastighetsbeteckning of the neighbours, terrain levels,
use from the app and the MCP tools (it is a script so far).
