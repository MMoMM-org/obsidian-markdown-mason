---
title: "Phase 3: Registry, mason.* API, Commands & Editor Adapters"
status: completed
version: "1.0"
phase: 3
---

# Phase 3: Registry, mason.* API, Commands & Editor Adapters

## Phase Context

**GATE**: Read before starting.

**Specification References**:
- `[ref: SDD/Internal API — mason.* operations]` `[ref: SDD/Building Block View]`
- `[ref: SDD/Runtime View — applyEditPlan]` `[ref: PRD/Feature 5,6,7,11]`

**Key Decisions**:
- One registry → command + API (ADR-5); versioned API gate; single CM6 transaction (ADR-1);
  explicit-invoke (ADR-10).

**Dependencies**: Phase 2.

---

## Tasks

Makes the operations usable inside Obsidian as commands, and exposes the versioned `mason.*` API.

- [x] **T3.1 Operation registry + versioned mason.* API** `[activity: backend-api]`
  1. Prime: `[ref: SDD/Internal API]` `[ref: PRD/Feature 11]`
  2. Test: registering an operation exposes it under `mason.<ns>.<op>` AND yields a command descriptor; `requiredApiVersion` gate accepts compatible, rejects incompatible with a "requires API vX" signal; no duplicated logic between command and API paths.
  3. Implement: `src/core/registry.ts` — register H/normalize/C/identity/M; build `MasonApi`; version compare.
  4. Validate: unit tests (pure, no Obsidian).
  - Success: `[ref: PRD/AC F11.1–F11.4]`

- [x] **T3.2 applyEditPlan — atomic CM6 transaction** `[activity: backend-api]`
  1. Prime: `[ref: SDD/Implementation Gotchas — internal editor.cm]`
  2. Test (CM6 harness outline): build an `EditorView` with known text; apply a two-range EditPlan (e.g. insert at offset 10 AND at note-end ~200, computed against the original doc); assert `view.state.doc.toString()` contains both inserts at the right places; assert the cursor lands at the end of the body insert (mapped position); dispatch one undo and assert BOTH reverts atomically (one step).
  3. Implement: `src/sources/apply.ts` `applyEditPlan(editor, plan)` — single `view.dispatch({changes, selection})`.
  4. Validate: integration test against a CM6 `EditorView` fixture.
  - Success: one undo step `[ref: PRD/AC F4.4, F7.1; SDD/ADR-1]`

- [x] **T3.3 Source adapters: selection & whole-note** `[activity: backend-api]` `[parallel: true]`
  1. Prime: `[ref: SDD/Building Block View]` `[ref: SDD/Implementation Gotchas — vault.process TOCTOU]`
  2. Test: selection adapter builds `OperationContext` from the selected range; whole-note adapter builds it from the file; prefers editor path when an editor is open.
  3. Implement: `src/sources/selection.ts`, `src/sources/note.ts`.
  4. Validate: unit/integration tests with mock editor.
  - Success: `[ref: PRD/AC F6.1]`

- [x] **T3.4 Standalone Mason: commands + Notices/undo** `[activity: backend-api]`
  1. Prime: `[ref: SDD/User Interface & UX]` `[ref: PRD/Feature 7]`
  2. Test: each op registers a `Mason:` command (sentence case, no default hotkey); no-op emits a descriptive Notice; offscreen change emits a count Notice; presets chain ops in one undo.
  3. Implement: command registration in `src/main.ts` driven by the registry; Notice helpers.
  4. Validate: integration tests with mock App/editor.
  - Success: `[ref: PRD/AC F5.1–F5.4, F7.1–F7.4]`

- [x] **T3.5 Phase Validation** `[activity: validate]`
  - Registry/API/apply/commands tests green; single-undo verified; lint + typecheck clean.
