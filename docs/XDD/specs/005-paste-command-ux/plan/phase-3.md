---
title: "Phase 3: Settings marker"
status: completed
version: "1.0"
phase: 3
---

# Phase 3: Settings marker

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Cross-Cutting Concepts/User Interface & UX]` — settings marker wireframe; section copy naming both commands
- `[ref: SDD/ADR-27]` — which steps "Paste and format" runs (the marker rationale)
- `[ref: SDD/Constraints CON-3]` — supported `Setting`/`setDesc` API; sentence case; no custom DOM
- `[ref: PRD Feature 3 / AC]` — the four non-applicable toggles marked; the seven applied toggles unmarked; section copy names both commands
- Existing code: `src/ui/settingsTab.ts` `_renderFormatSelectionSection` (11 toggles in 4 setHeading groups from spec 004); `test/ui/formatSelectionSection.test.ts` (harness with `capturedSettings`/`isHeading`/`setDesc`)

**Key Decisions**:
- Mark only the four toggles "Paste and format" does NOT run — cascade + the three footnote toggles (fromCitations, identity, move) — by appending a clause to their `setDesc`. The seven applied toggles (all Cleanup + all Lists + Normalize headings) get no marker. The section description names both commands.
- Pure UI copy change; no new API, no behavior change.

**Dependencies**: none beyond the existing recipe/settings UI. `[parallel: true]` with Phases 1–2.

---

## Tasks

This phase makes the 7-vs-11 step distinction visible in settings.

- [x] **T3.1 Mark non-applicable toggles + update section copy** `[activity: build-feature]` `[parallel: true]`

  1. Prime: Read `src/ui/settingsTab.ts` `_renderFormatSelectionSection` (the 11 toggles + their `setDesc`). Read `[ref: SDD/Cross-Cutting Concepts/User Interface & UX]` for the exact marker text. Read `test/ui/formatSelectionSection.test.ts` for the capture harness (each `CapturedSetting` exposes `name`, `desc`, `isHeading`).
  2. Test (RED): extend `test/ui/formatSelectionSection.test.ts`:
     - The four toggles "Cascade headings", "Convert citations to footnotes", "Resolve footnote identity", "Move footnotes to resources" have a `setDesc` containing "not applied by Paste and format" (or the agreed marker phrase).
     - The seven applied toggles (the 4 Cleanup, 2 Lists, and "Normalize headings") do NOT contain that marker phrase.
     - The section intro `setDesc` names both "Format selection" and "Paste and format".
  3. Implement (GREEN): In `_renderFormatSelectionSection`, append " Format selection only — not applied by Paste and format." to the `setDesc` of the four non-applicable toggles; update the section intro `setDesc` to name both commands. Sentence case; no other change.
  4. Validate: settings-tab tests pass; `tsc -noEmit`; `eslint`.
  - Success: the 4 non-applicable toggles are marked, the 7 applied toggles are not, and the section copy names both commands `[ref: PRD Feature 3 / AC; SDD/Cross-Cutting Concepts/User Interface & UX; SDD/CON-3]`.

## Phase Validation

- `npx vitest run` green for settings-tab tests; `tsc -noEmit -skipLibCheck` + `eslint src/` clean.
- Exactly the four contextual toggles carry the marker; the seven cleanup/list/normalize toggles do not; section copy names both commands.
- No `removeCommand`, no Catalyst-beta API, no custom DOM (CON-3).
