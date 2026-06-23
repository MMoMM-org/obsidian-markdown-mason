---
title: "Scripts distribution & settings redesign (v0.2) — Implementation Plan"
status: draft
version: "1.0"
---

# Implementation Plan

## Validation Checklist

### CRITICAL GATES (Must Pass)

- [x] All `[NEEDS CLARIFICATION: ...]` markers have been addressed
- [x] All specification file paths are correct and exist
- [x] Each phase follows TDD: Prime → Test → Implement → Validate
- [x] Every task has verifiable success criteria
- [x] A developer could follow this plan independently

### QUALITY CHECKS (Should Pass)

- [x] Context priming section is complete
- [x] All implementation phases are defined with linked phase files
- [x] Dependencies between phases are clear (no circular dependencies)
- [x] Parallel work is properly tagged with `[parallel: true]`
- [x] Activity hints provided for specialist selection `[activity: type]`
- [x] Every phase references relevant SDD sections
- [x] Every test references PRD acceptance criteria
- [x] Integration & E2E tests defined in final phase
- [x] Project commands match actual project setup

---

## Output Schema

### PLAN Status Report

| Field | Value |
|-------|-------|
| specId | 002-script-distribution-and-settings |
| title | Scripts distribution & settings redesign (v0.2) |
| status | IN_REVIEW |
| totalTasks | 22 (incl. 5 phase-validation tasks) |
| parallelTasks | 7 |
| clarificationsRemaining | 0 |

---

## Specification Compliance Guidelines

### How to Ensure Specification Adherence

1. **Before Each Phase**: Read the phase's Specification References gate.
2. **During Implementation**: Reference the cited SDD sections / ADRs in each task.
3. **After Each Task**: Run unit tests + `npm run lint`; keep `npm run compliance` green.
4. **Phase Completion**: Run the phase-validation task.

### Deviation Protocol

When implementation requires changes from the specification:
1. Document the deviation with clear rationale (in the phase file).
2. Obtain approval before proceeding.
3. Update the SDD when the deviation improves the design.
4. Record all deviations in the relevant phase file for traceability.

## Metadata Reference

- `[parallel: true]` — Tasks that can run concurrently
- `[ref: document/section]` — Links to specifications
- `[activity: type]` — Activity hint for specialist agent selection

### Success Criteria

**Validate** = Process verification ("did we follow TDD?")
**Success** = Outcome verification ("does it work correctly?")

---

## Context Priming

*GATE: Read all files in this section before starting any implementation.*

**Specification**:
- `docs/XDD/specs/002-script-distribution-and-settings/requirements.md` — Product Requirements (11 features, 47 ACs)
- `docs/XDD/specs/002-script-distribution-and-settings/solution.md` — Solution Design (ADR-11..17)
- `docs/XDD/specs/001-markdown-mason/sync-spike.md` — T7.5 Sync correction (why consent rides data.json)

**Key Design Decisions** (from SDD):
- **ADR-11 — Derived lifecycle state.** Persist only `{enabled, okayed:{version,checksum}, command, provenance, source}`; compute `LifecycleState` via `evaluateState` (superset of `evaluateTrust`).
- **ADR-12 — Fold `device.json` → synced `data.json`.** No migration (no installed base). Supersedes ADR-6.
- **ADR-13 — `CatalogSource` port + `requestUrl` adapter; SHA-pinned `index.json`.**
- **ADR-14 — Byte-exact checksum & verbatim materialization** (binary I/O; fixes `runtime.ts:96`).
- **ADR-15 — Dev-override via build-time DCE** (`__MASON_DEV__` define); never in `data.json`.
- **ADR-16 — Envelope-only `{ run, paste? }`** (no bare-function fallback); `buildPasteChain` chokepoint; retire `perplexity-auto` + `detect.ts`.
- **ADR-17 — Segmented settings nav + Templater-style command management.**

**Implementation Context**:
```bash
# Testing
npm test                 # vitest run (unit + integration + e2e)
npm run test:watch       # vitest watch

# Quality
npm run lint             # eslint src/
npm run compliance       # vitest run test/compliance.test.ts  (community rules: requestUrl-only, no innerHTML, etc.)
npm run check:manifest   # manifest validation

# Build
npm run dev              # esbuild watch → copies to test vault
npm run build            # tsc -noEmit && esbuild production
```

---

## Implementation Phases

Each phase is defined in a separate file. Tasks follow red-green-refactor: **Prime** (understand context), **Test** (red), **Implement** (green), **Validate** (refactor + verify).

> **Tracking Principle**: Track logical units that produce verifiable outcomes. The TDD cycle is the method, not separate tracked items.

- [x] [Phase 1: Storage & Lifecycle Core](phase-1.md)
- [ ] [Phase 2: Distribution & Materialization](phase-2.md)
- [ ] [Phase 3: Module Envelope, Paste Chain & Disclosure](phase-3.md)
- [ ] [Phase 4: Settings UI & Command Management](phase-4.md)
- [ ] [Phase 5: Dev Override, Catalog Migration & E2E](phase-5.md)

---

## Plan Verification

| Criterion | Status |
|-----------|--------|
| A developer can follow this plan without additional clarification | ✅ |
| Every task produces a verifiable deliverable | ✅ |
| All PRD acceptance criteria map to specific tasks | ✅ |
| All SDD components have implementation tasks | ✅ |
| Dependencies are explicit with no circular references | ✅ |
| Parallel opportunities are marked with `[parallel: true]` | ✅ |
| Each task has specification references `[ref: ...]` | ✅ |
| Project commands in Context Priming are accurate | ✅ |
| All phase files exist and are linked from this manifest as `[Phase N: Title](phase-N.md)` | ✅ |

## PRD → Phase coverage map

| PRD feature | Phase(s) |
|---|---|
| F1 Unified lifecycle | P1 (store+state), P4 (remove/reinstall UI) |
| F2 Enable-implies-consent | P1 (okayed record), P3 (disclosure) |
| F3 Nothing auto-enables / offline | P1 (state), P2 (materialize→Blocked offline) |
| F4 Distribution & updates | P2 (catalog+materializer), P4 (UpdateAvailable badge) |
| F5 Cross-device materialization | P1 (evaluateState), P2 (materializer) |
| F6 Fail-closed Blocked + recovery | P1 (reasons), P2 (materialize reasons), P4 (inline UI) |
| F7 Segmented nav | P4 |
| F8 Scripts card rows | P4 |
| F9 Commands tab + launcher | P4 |
| F10 Paste autodetect chain | P3 |
| F11 Migrate Perplexity / retire auto | P3 (retire), P5 (catalog entries) |
| Should: dev override | P5 |
