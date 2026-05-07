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

## Agent Configuration

(TODO - to be created)
- [[spec-agent-prompt]] - System prompt for the spec agent
- [[dev-agent-prompt]] - System prompt for the dev agent
- [[verifier-agent-prompt]] - System prompt for the verifier agent
- [[tjansteman-agent-prompt]] - System prompt for the tjänsteman agent (product-embedded)

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

**Total entries:** 4 complete, 19 TODO
**Last updated:** 2026-05-03
