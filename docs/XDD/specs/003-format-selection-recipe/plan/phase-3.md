---
title: "Phase 3: Settings UI"
status: pending
version: "1.0"
phase: 3
---

# Phase 3: Settings UI

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/User Interface & UX]` — the Format selection section + wireframe
- `[ref: PRD Feature 3]` — five labeled toggles, persistence
- `[ref: CON-3]` — no unsupported-API surface; standard `Setting`/`addToggle` only
- Existing code: `src/ui/settingsTab.ts` — `_renderGeneralSection` 228 / `_renderAdvancedSection` 492 (section patterns; note: NO in-body heading — the tab label is the heading, comment at 227), the segment plumbing (`Segment` union 57, `SEGMENTS` 59, `_renderSegment` switch 206, `_renderSegmentNav` 134), and the `addToggle(t => t.setValue(...).onChange(...))` write pattern (e.g. 250). `saveSettings` in `src/main.ts`

**Key Decisions**:
- Bind toggles to `settings.formatSelection.*`; persist via the existing `saveSettings`.
- No live re-registration needed — `fusedFormatNote` reads settings fresh per run.
- Sentence-case labels matching the command names.

**Dependencies**: Phase 1 (the `formatSelection` settings field). `[parallel: true]` with Phase 2.

---

## Tasks

- [ ] **T3.1 Format selection settings section** `[activity: build-feature]`

  1. Prime: Read the existing `_render*Section` methods + the segment plumbing in `src/ui/settingsTab.ts`; note sections render NO in-body heading (the tab label is the heading) and the `addToggle(...)` write pattern.
  2. Test (RED): a settings-tab test (mirroring existing UI tests) — rendering the section produces five toggles whose initial values reflect `resolveFormatSelectionRecipe(settings)`; toggling one invokes `saveSettings` and mutates `settings.formatSelection.<key>`; the new "Format selection" segment appears in the nav.
  3. Implement (GREEN): wire a new "Format selection" segment by editing the FOUR coupled spots — add it to the `Segment` union (`:57`) and the `SEGMENTS` array (`:59`), add a `case "Format selection"` to the `_renderSegment` switch (`:206`), and add a `_renderFormatSelectionSection(containerEl)` method. The method renders an optional description-only intro `Setting`, then five `new Setting(...).setName(<sentence-case>).setDesc(<effect>).addToggle(...)` rows for cascade / normalize / fromCitations / identity / move — each reading `resolveFormatSelectionRecipe(this._plugin.settings)` for its value and writing the chosen key into `this._plugin.settings.formatSelection` (initialize the object if absent) before `await this._plugin.saveSettings()`. Do NOT add `setHeading` (none of the other sections use it).
  4. Validate: tests pass; `tsc -noEmit`; `eslint`. Visual check that labels are sentence case and descriptions explain the effect (e.g. "Move footnote definitions into your Resources section").
  - Success: five labeled toggles render, reflect state, persist across reload, and take effect on the next "Format selection" run `[ref: SDD/User Interface & UX; PRD Feature 3]`.

## Phase Validation
- `vitest run` green for the settings-tab test.
- Toggles persist (written through `saveSettings`) and default on for a fresh install.
- No new unsupported-API usage introduced (CON-3).
