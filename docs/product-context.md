# Product Context

> This is the **single source of product truth**. The loop machinery (agent
> prompts, workflows) is intentionally product-agnostic and points here.
> Change the product by editing this file and the specs — never by editing
> the agent prompts or workflows.

## What the app is

A **Claude MCP tool server** that helps Swedish users plan and permit small
structures (komplementbyggnad, komplementbostadshus, tillbyggnad, eldstad).

The product is a set of Claude tools that work together in conversation:

```
Claude conversation
  ├─ generate_building_link(params)    → shareable 3D viewer URL  ✓ built
  ├─ assess_permit_requirement(...)    → LOVFRI / ANMÄLAN / BYGGLOV verdict
  └─ generate_permit_packet(...)       → situationsplan, planritning, PDFs  (planned)
```

The web app at `/view` is the 3D model viewer only — it is not a standalone
product. All user interaction happens in Claude.

MCP server endpoint: `/api/mcp` (Streamable HTTP, JSON-RPC 2.0 over POST)
Viewer URL format: `/view#<base64url-deflated-BuildingModelV2-json>`

## Principles

- Focus on simple flows. Not architect-grade commercial submissions.
- The app never makes binding legal judgments itself.
- Regulatory version: PBL post-2025-12-01 (Prop 2024/25:181)

## Planned / not built yet

- `generate_permit_packet` — PDF documents: situationsplan, planritning, kontrollplan
- A "tjänsteman" review layer that checks packets against PBL/BBR

The tjänsteman/legal-review layer (`agents/tjansteman/`, golden cases) is
**parked** — there is no app code for it yet. Do not wire loop logic to it
until a spec brings it into `active`.

## Glossary

- **bygglov** — building permit
- **anmälan** — notification (lighter than full permit)
- **LOVFRI** — no submission required, only byggherre-dokumentation
- **komplementbyggnad** — outbuilding (replaces "friggebod"/"attefallshus" post-2025-12-01)
- **komplementbostadshus** — outbuilding intended for habitation
- **PBL / BBR** — the Swedish planning & building regulations
- **pott** — shared quota of lovfri building area per fastighet
