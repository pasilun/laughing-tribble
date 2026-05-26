# Wiki Index

A catalog of all wiki entries for the bygglov assistant project.

## Core Architecture

- [[triage-rules]] - Triage decision logic: bucket assignment (T-001 to T-016) and always-applies obligations (O-001 to O-007) ✓
- [[findings-contract]] - Closed enum of finding IDs the tjänsteman agent can return (severity, category, message template, källa, suggested_fix) ✓
- [[domain-model]] - Core entities: User, Property, Project, Packet, Document, Finding, Grannmedgivande, Submission ✓

## Regulatory Foundation

- [[regulatory-version]] - Single source of truth for which PBL version the codebase assumes (currently PBL post-2025-12-01) ✓

## Product Definitions

- [[product-focus]] - First-class supported flows: komplementbyggnad, komplementbostadshus, tillbyggnad, eldstad, plank, mur
- [[real-project]] - Canonical dogfood case: 20m² sauna + yoga studio (komplementbyggnad), Patrik's property utanför detaljplan outside Strängnäs. Bucket: ANMALAN (vatten/avlopp). Strandskydd TBD.

## Flow-Specific Rules

(TODO - to be created)
- [[komplementbyggnad-rules]] - Detailed rules for komplementbyggnad flows
- [[komplementbostadshus-rules]] - Detailed rules for komplementbostadshus flows
- [[tillbyggnad-rules]] - Detailed rules for tillbyggnad flows
- [[eldstad-rules]] - Detailed rules for eldstad/rökkanal flows
- [[plank-mur-rules]] - Detailed rules for plank and mur flows

## Data & Integration

(TODO - to be created)
- [[packet-contract]] - Required documents per bucket: LOVFRI (byggherre-dokumentation), ANMALAN, BYGGLOV
- [[detaljplan-ingestion]] - How to ingest and parse detaljplaner from kommuner
- [[boverket-apis]] - Integration with Boverket open APIs: Planbestämmelsekatalogen, Ändamålskatalogen, ÖP-katalogen, Författnings-API
- [[lantmateriet-wms]] - Lantmäteriet WMS/API integration: Topowebb WMTS (background tiles, free API key), Fastighetsindelning Direkt (property boundary GeoJSON, OAuth2, free as EU HVD since 2025-02). Auth setup: register at opendata.lantmateriet.se → Geotorget consumer → apimanager.lantmateriet.se for client credentials.

## IFC Pipeline

- [[ifc-pipeline]] — IFC4 STEP generator + web-ifc viewer: double-placement trap, void geometry, wall topology, roof-wall junction, WASM loading, SVG Y-flip, door symbol, screenshot verification discipline ✓

## MCP Tools

The product is a **Claude MCP tool server**. All user interaction happens in Claude conversations. The web app at `/view` is a 3D/2D model viewer only — not the product.

**MCP endpoint:** `https://laughing-tribble-psi.vercel.app/api/mcp` (Streamable HTTP, JSON-RPC 2.0)

Architecture:
```
Claude conversation
  ├─ generate_building_link(params)       → shareable 3D/2D viewer URL  ✓ live
  ├─ assess_permit_requirement(...)       → LOVFRI / ANMÄLAN / BYGGLOV verdict  ✓ live
  └─ generate_permit_packet(...)          → PDFs (planned)
```

**Live tools:**

- `generate_building_link` — takes building parameters, returns a shareable `/view` URL with the model encoded in the hash. ✓
- `assess_permit_requirement` — triage engine (`lib/triage-engine.ts`). Input: flow_type, dimensions, distances, installations, strandskydd, k-marking, etc. Output: `{ bucket: LOVFRI|ANMALAN|BYGGLOV|null, bucket_reasons, obligations, out_of_scope }`. Implements T-001 to T-016 bucket rules + O-001/002/003/004/006 obligations. Regulatory version: PBL post-2025-12-01. ✓

**Planned tools:**

- `generate_permit_packet` — assembles PDFs for the determined bucket (LOVFRI documentation, ANMALAN packet, BYGGLOV application).

## Viewer

The `/view` page renders 3D and 2D floor plans for buildings described in MCP tool results. Two loading modes coexist in the same component:

- **`?file=<name>` mode** — reads `public/models/<name>.json` (BuildingModelV2 JSON). Intended for design iteration where Claude edits JSON files directly; git tracks version history. Example: `/view?file=sample-house`.
- **`#hash` mode** — decodes the model from the URL hash. Used by `generate_building_link` for shareable links. Stateless and elegant; no server round-trip.

Both modes feed the same pipeline: `BuildingModelV2 → generateIFC → web-ifc → Three.js renderer`.

`public/models/sample-house.json` — 10×6m sadel roof example, live at `/view?file=sample-house`.

## Dev Loop Infrastructure (archived — removed 2026-05-26)

The CI/CD loop (spec → dev → verify → auto-merge) and its 8 GitHub Actions workflows were removed on 2026-05-26. Only `deploy.yml` remains (for Vercel deployment). The loop architecture is documented in the [[log]] entries up to 2026-05-18 for historical reference.

## Agent Configuration (archived — removed 2026-05-26)

The spec/dev/verifier agent system prompts (`agents/spec/`, `agents/dev/`, `agents/verifier/`) were part of the CI/CD loop and are no longer in use. See [[log]] entries up to 2026-05-18 for historical context.

## Capability Specs (archived — removed 2026-05-26)

The living spec system (`specs/`) drove the CI/CD loop. With the loop removed, the active specs at time of removal were: [[landing-page]], [[footer]]. The web chat screens ([[design-screen]], [[deterministic-chat-seam]]) were superseded by the MCP product pivot. Planned specs (009b–009e, 007) were abandoned in favour of the MCP tool architecture.

## UI & UX

(TODO - to be created)
- [[ui-conventions]] - Swedish language standards, form patterns, error messages, empty states
- [[disclaimer-policy]] - What the app tells users about advisory-only nature, user responsibility, GDPR posture

## Test Fixtures

(TODO - to be created)
- [[fixture-schema]] - Structure of golden cases for tjänsteman validation
- [[golden-cases-index]] - Catalog of all golden case fixtures

## Meta

- [[wiki-index]] - This page
- [[log]] - Chronological record of wiki updates and changes

---

**Last updated:** 2026-05-26 — Product pivot to MCP tools: `assess_permit_requirement` triage engine shipped, file-based model viewer added, CI/CD loop workflows removed. See [[log]] 2026-05-26.

**Previously:** 2026-05-25 — [[ifc-pipeline]] added: 9 lessons from the IFC STEP generator + web-ifc viewer spike (double-placement trap, void geometry, wall topology, roof soffit, WASM loading, SVG Y-inversion, door symbol, screenshot-first discipline). See [[log]] 2026-05-25.
