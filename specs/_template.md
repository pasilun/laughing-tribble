# Feature: [Capability Name]

## ID
`[kebab-case-id]`

## Status
<!-- exactly one of: active | planned | superseded | obsolete | chore -->
`active`

<!--
  active     = describes behaviour the app MUST have now (the drift contract).
               Requires a Regression Test that exists.
  planned    = agreed but not built yet. No regression test required.
  superseded = folded into another capability spec. Reduce this file to a
               one-line tombstone with [[pointer]] to the replacement.
  obsolete   = the behaviour was removed. Delete the file and its stale tests.
  chore      = a one-off cleanup/refactor with no new capability. TRANSIENT:
               it only drives one dev+verify cycle and is auto-pruned from
               main after the feature PR merges. Never a permanent spec, never
               a regression-test owner. Acceptance = "no regression in the
               existing active specs" (+ any specific observable fix).
-->

## Regression Test
<!--
  Required when Status is `active`. The Verification Agent AUTHORS this file
  and flips the spec planned→active when it passes — the dev agent must NOT
  write tests. Use the verifier's path convention:
-->
`e2e/_verified-[kebab-id].spec.ts`

## Description
Describe the capability as it must exist NOW — not the change being made.
A reader should be able to rebuild this part of the app from this section
plus the acceptance criteria alone. Note any *known deviations* (current
code that violates the contract and must be fixed, not enshrined).

## User Stories

### As a [user type]
**I want** [capability]
**So that** [benefit]

## Acceptance Criteria

All criteria must be browser-observable (testable via Playwright).

### Scenario 1: [name]

**Given** [precondition]
**When** [action]
**Then** [observable outcome]

## Verifier Hints
- [Selector hint]: use `[data-testid="X"]` to find element Y; it must contain Z
- [Negative assertion]: the page must NOT contain "error text" / element X must NOT be visible before condition Y
- [Async hint]: after submitting, wait up to Ns for `[data-testid="X"]`; content must be >10 chars and must NOT contain "fel uppstod" / "error" / "undefined"
- [Responsive — applies to every UI spec]: at the iPhone viewport (the
  default Playwright project) there is **no horizontal overflow**
  (`document.scrollingElement.scrollWidth <= window.innerWidth + 1`) and
  primary chrome (header/title, primary CTA, key content) is fully within
  the viewport and not clipped, in every scenario state.

## Out of Scope

What this capability explicitly does NOT include (and links to the specs that do).

## Dependencies

- Other capability specs (`[[id]]`), endpoints, or services this relies on

## Notes

Where it is implemented (files), test hooks, and any known deviations.
