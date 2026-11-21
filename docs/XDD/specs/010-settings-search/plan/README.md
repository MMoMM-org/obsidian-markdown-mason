---
title: "Settings search: declarative settings tab (Obsidian 1.13.1+)"
status: complete
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

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| specId | string | Yes | Spec identifier (NNN-name format) |
| title | string | Yes | Feature title |
| status | enum: `DRAFT`, `IN_REVIEW`, `COMPLETE` | Yes | Document readiness |
| phases | PhaseStatus[] | Yes | Status of each implementation phase |
| totalTasks | number | Yes | Total tasks across all phases |
| parallelTasks | number | Yes | Tasks marked `[parallel: true]` |
| specReferences | number | Yes | Count of `[ref: ...]` specification links |
| clarificationsRemaining | number | Yes | Count of `[NEEDS CLARIFICATION]` markers |

### PhaseStatus

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| phase | number | Yes | Phase number |
| name | string | Yes | Phase name |
| status | enum: `COMPLETE`, `NEEDS_CLARIFICATION`, `IN_PROGRESS` | Yes | Current state |
| tasks | number | Yes | Task count in this phase |
| file | string | Yes | Path to phase file (phase-N.md) |
| detail | string | No | What needs clarification or what's in progress |

---

## Specification Compliance Guidelines

### How to Ensure Specification Adherence

1. **Before Each Phase**: Complete the Pre-Implementation Specification Gate
2. **During Implementation**: Reference specific SDD sections in each task
3. **After Each Task**: Run Specification Compliance checks
4. **Phase Completion**: Verify all specification requirements are met

### Deviation Protocol

When implementation requires changes from the specification:
1. Document the deviation with clear rationale
2. Obtain approval before proceeding
3. Update SDD when the deviation improves the design
4. Record all deviations in this plan for traceability

Recorded deviations:
- **D-1 (2026-11-21, approved):** no `id` on pages or rows. The Obsidian 1.13.1 typings declare none, and the 1.15.1 runtime falls back to `id ?? name`. Pages and rows are keyed by stable names; the splash deep link uses `openPagePath(pluginId, ["Scripts"])`. SDD and phases 2-3 updated. Found by T1.1.
- **D-2 (2026-11-21, approved via drift resolution):** T1.4 switched the old settings tab to read its strings from `settingsDefinitions.ts`, although T1.4 step 4 said "not yet switched". The same step demanded no duplicated strings, so single-source won. Behaviour unchanged (old tab tests green).

## Metadata Reference

- `[parallel: true]` - Tasks that can run concurrently
- `[component: component-name]` - For multi-component features
- `[ref: document/section; lines: 1, 2-3]` - Links to specifications, patterns, or interfaces and (if applicable) line(s)
- `[activity: type]` - Activity hint for specialist agent selection
- `[model: routine|hard|frontier]` - Overrides the spec's model tier for this task

### Success Criteria

**Validate** = Process verification ("did we follow TDD?")
**Success** = Outcome verification ("does it work correctly?")

```markdown
# Single-line format
- Success: [Criterion] `[ref: PRD/AC-X.Y]`

# Multi-line format
- Success:
  - [ ] [Criterion 1] `[ref: PRD/AC-X.Y]`
  - [ ] [Criterion 2] `[ref: SDD/Section]`
```

Reference conventions in this plan:
- `PRD/F<n>` = requirements.md Feature n; `PRD/F<n>.<m>` = its m-th acceptance criterion.
- `SDD/<Section>` = a solution.md heading.

---

## Context Priming

*GATE: Read all files in this section before starting any implementation.*

**Specification**:

- `docs/XDD/specs/010-settings-search/requirements.md`: Product Requirements (10 features, 38 acceptance criteria)
- `docs/XDD/specs/010-settings-search/solution.md`: Solution Design (8 ADRs, 19 EARS criteria)
- `docs/XDD/specs/010-settings-search/README.md`: decisions log
- `node_modules/obsidian/obsidian.d.ts` (v1.13.1): declarative settings types (~L5866-6720), PluginSettingTab (~L5149-5175)

**Key Design Decisions**:

- **ADR-1**: minAppVersion 1.13.1, because page `displayValue`/`status` are `@since 1.13.1`. `versions.json` history stays untouched.
- **ADR-5**: override `getControlValue`/`setControlValue` and always persist via `plugin.saveSettings()`. The base implementation's `saveData(plugin.settings)` would erase the `scripts` namespace in `data.json`.
- **ADR-6**: `ScriptsCache` (single flight, coalescing, generation check) feeds `update()`. `getSettingDefinitions()` stays synchronous and never returns `[]`.
- **ADR-2/3/7**: main page = 4 bare General controls, Scripts and Commands pages, Format selection umbrella group (intro), then Cleanup / Lists / Headings / Footnotes groups, then Advanced ending with a Documentation row. Scripts actions get header icons plus searchable action rows.
- **ADR-8**: pure builders; tests assert on the returned definition tree; `render` rows are tested via `render(mockSetting, mockGroup)`.

**Implementation Context**:

```bash
# Testing
npm test                        # vitest run (unit + compliance)
npx vitest run test/ui          # settings UI tests only

# Quality
npm run lint                    # eslint src/
npx tsc -noEmit -skipLibCheck   # typecheck (includes test/)

# Full validation (CI-equivalent; do NOT run `npm run build` while the dev vault is under test)
npx tsc -noEmit -skipLibCheck && npm run lint && npm test && npm run check:manifest

# Manual smoke test (Phase 4): `npm run dev` per the Markdown Mason dev loop (.mason-dev.json), host Obsidian ≥ 1.13.1
```

Build-stays-green rule: every task leaves `tsc`, lint and tests passing, so phases 1–2 are additive.
- The old segmented tab keeps working until T3.1 swaps it out.
- Helpers moved out of `scriptsTab.ts`/`commandsTab.ts` are re-imported by the old renderers until those are deleted in T3.1.

---

## Implementation Phases

Each phase is defined in a separate file. Tasks follow red-green-refactor: **Prime** (understand context), **Test** (red), **Implement** (green), **Validate** (refactor + verify).

> **Tracking Principle**: Track logical units that produce verifiable outcomes. The TDD cycle is the method, not separate tracked items.

- [ ] [Phase 1: Foundations: test harness, storage adapter, fixed definitions](phase-1.md)
- [ ] [Phase 2: Scripts and Commands pages](phase-2.md)
- [ ] [Phase 3: Tab swap and plugin wiring](phase-3.md)
- [ ] [Phase 4: Release hygiene and end-to-end validation](phase-4.md)

---

## Plan Verification

Before this plan is ready for implementation, verify:

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
