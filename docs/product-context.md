# Product Context

> This is the **single source of product truth**. The loop machinery (agent
> prompts, workflows) is intentionally product-agnostic and points here.
> Change the product by editing this file and the specs — never by editing
> the agent prompts or workflows.

## What the app is (current direction — still iterating)

A web app that helps Swedish users prepare **bygglov / anmälan** packets for
small structures (friggebod, attefallshus, attefallstillbyggnad,
komplementbyggnad, liten tillbyggnad).

The MVP scope is **not fixed** — it grows spec by spec. Treat the active
specs in `specs/` (Status: `active`) as the authoritative description of what
exists today. This section is orientation, not a contract.

## Principles

- Focus on simple flows. Not architect-grade commercial submissions.
- The app never makes binding legal judgments itself.

## Planned / not built yet

These are aspirational and live as `planned` specs (`specs/007`, `008`,
`009b`–`009e`) and product notes under `docs/product/`:

- Parametric design conversation → structured building model
- Generated documentation (situationsplan, planritning, PDFs)
- A "tjänsteman" review layer that checks packets against PBL/BBR

The tjänsteman/legal-review layer (`agents/tjansteman/`, golden cases) is
**parked** — there is no app code for it yet. Do not wire loop logic to it
until a spec brings it into `active`.

## Glossary

- **bygglov** — building permit
- **anmälan** — notification (lighter than full permit)
- **friggebod** — ≤15 m² outbuilding, permit-free
- **attefallshus** — ≤30 m² outbuilding, requires anmälan
- **PBL / BBR** — the Swedish planning & building regulations
