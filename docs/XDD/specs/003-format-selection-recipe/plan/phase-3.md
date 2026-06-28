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
- Existing code: `src/ui/settingsTab.ts` (`_renderGeneralSection` 228 and `_renderAdvancedSection` 492 as patterns, `_renderSegmentNav` 134, `Setting.setHeading()`), `saveSettings` in `src/main.ts`

**Key Decisions**:
- Bind toggles to `settings.formatSelection.*`; persist via the existing `saveSettings`.
- No live re-registration needed — `fusedFormatNote` reads settings fresh per run.
- Sentence-case labels matching the command names.

**Dependencies**: Phase 1 (the `formatSelection` settings field). `[parallel: true]` with Phase 2.

---

## Tasks

- [ ] **T3.1 Format selection settings section** `[activity: build-feature]`

  1. Prime: Read the existing `_render*Section` methods and `_renderSegmentNav` in `src/ui/settingsTab.ts`; note `Setting.setHeading()` usage and the `addToggle(t => t.setValue(...).onChange(...))` pattern.
  2. Test (RED): a settings-tab test (mirroring existing UI tests) — rendering the section produces five toggles whose initial values reflect `resolveFormatSelectionRecipe(settings)`; toggling one invokes `saveSettings` and mutates `settings.formatSelection.<key>`; the section appears in the segment nav.
  3. Implement (GREEN): add `_renderFormatSelectionSection(containerEl)` rendering a `Setting.setHeading()` "Format selection" + a short description, then five `new Setting(...).setName(<sentence-case>).setDesc(<effect>).addToggle(...)` rows for cascade / normalize / fromCitations / identity / move, each reading `resolveFormatSelectionRecipe(this._plugin.settings)` and writing the chosen key back into `this._plugin.settings.formatSelection` before `await this._plugin.saveSettings()`. Register the section in the segment nav alongside the others. Ensure `formatSelection` is initialized (default object) before writing a key.
  4. Validate: tests pass; `tsc -noEmit`; `eslint`. Visual check that labels are sentence case and descriptions explain the effect (e.g. "Move footnote definitions into your Resources section").
  - Success: five labeled toggles render, reflect state, persist across reload, and take effect on the next "Format selection" run `[ref: SDD/User Interface & UX; PRD Feature 3]`.

## Phase Validation
- `vitest run` green for the settings-tab test.
- Toggles persist (written through `saveSettings`) and default on for a fresh install.
- No new unsupported-API usage introduced (CON-3).
