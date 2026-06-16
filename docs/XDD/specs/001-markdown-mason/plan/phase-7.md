---
title: "Phase 7: Integration, E2E & Release Readiness"
status: pending
version: "1.0"
phase: 7
---

# Phase 7: Integration, E2E & Release Readiness

## Phase Context

**GATE**: Read before starting.

**Specification References**:
- `[ref: SDD/Runtime View]` `[ref: SDD/Deployment View]` `[ref: SDD/Acceptance Criteria (EARS)]`
- `[ref: PRD/Success Metrics]` `[ref: PRD/Open Questions — Sync spike]`

**Key Decisions**:
- No telemetry; single-undo guarantee; release-asset attestation; Sync assumption verified manually.

**Dependencies**: Phases 1–6.

---

## Tasks

Proves the whole flow end-to-end and prepares a submittable release.

- [ ] **T7.1 End-to-end happy path** `[activity: testing]`
  1. Prime: `[ref: SDD/Runtime View — primary flow]`
  2. Test: paste each of the three fixtures, invoke the matching script (and `perplexity-auto`), assert the resulting note matches the golden structured output; assert exactly one undo reverts everything; assert count Notices fire.
  3. Implement: E2E harness over a CM6 editor + mock App wiring all layers.
  4. Validate: all three round-trip; single-undo holds.
  - Success: `[ref: PRD/AC F5, F9; PRD/Success Metrics — fixtures]`

- [ ] **T7.2 Invariant & failure-mode suite** `[activity: testing]`
  1. Prime: `[ref: SDD/Error Handling]` `[ref: PRD/Edge Cases]`
  2. Test: alpha footnotes + orphaned resources survive a full run; empty clipboard/selection → Notice no-op; `disabled` script never runs; drift hard-blocks; throwing script → raw fallback.
  3. Implement: consolidated invariant/failure test module.
  4. Validate: all pass.
  - Success: `[ref: PRD/AC F7, F8, F10; SDD/Quality]`

- [ ] **T7.3 EARS acceptance trace** `[activity: validate]`
  1. Prime: `[ref: SDD/Acceptance Criteria (EARS)]`
  2. Test: a checklist mapping each EARS criterion → a passing test id (traceability matrix).
  3. Implement: `docs/XDD/specs/001-markdown-mason/trace.md` (or test annotations) linking EARS ↔ tests.
  4. Validate: every EARS line has a green test.
  - Success: full PRD↔test traceability `[ref: SDD/Acceptance Criteria]`

- [ ] **T7.4 Release readiness** `[activity: build-tooling]`
  1. Prime: `[ref: SDD/Deployment View]` skill `tcs-patterns:obsidian-plugin` (release/attestation)
  2. Test: `npm run build` produces a clean `main.js`; `versions.json` correct; a release workflow attests `main.js` (`actions/attest-build-provenance`); manifest submission-lint passes.
  3. Implement: `.github/workflows/release.yml` with attestation; finalize `manifest.json`/`versions.json`.
  4. Validate: dry-run the workflow; manifest lint green.
  - Success: submittable artifact `[ref: PRD/AC F10; Success Metrics — review gate]`

- [ ] **T7.5 Sync verification spike (manual)** `[activity: research]`
  1. Prime: `[ref: PRD/Open Questions — Sync]` `[ref: SDD/Implementation Gotchas]`
  2. Test: on two Sync-paired desktops, drop a file in `.obsidian/plugins/<id>/scripts/` and observe whether it replicates; record the result.
  3. Implement: document the outcome in the spec; confirm the per-device-sidecar design holds (gates v0.2).
  4. Validate: result recorded; design confirmed or adjusted via deviation protocol.
  - Success: Sync assumption settled `[ref: SDD/ADR-6; PRD/Open Questions]`

- [ ] **T7.6 Phase Validation** `[activity: validate]`
  - Full suite green; build + lint + typecheck clean; release dry-run succeeds; traceability complete.
