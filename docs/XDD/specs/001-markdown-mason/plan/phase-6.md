---
title: "Phase 6: Settings UI & Compliance"
status: completed
version: "1.0"
phase: 6
---

# Phase 6: Settings UI & Compliance

## Phase Context

**GATE**: Read before starting.

**Specification References**:
- `[ref: SDD/User Interface & UX]` `[ref: SDD/CON-3]` `[ref: PRD/Feature 10]`
- Skill: `tcs-patterns:obsidian-plugin` (settings, sentence case, XSS, Notice)

**Key Decisions**:
- XSS-safe rendering; sentence-case; `console.debug`; no default hotkeys; desktop-only gating absent (whole plugin desktop-only).

**Dependencies**: Phase 5.

---

## Tasks

Delivers the settings surface and the compliance hardening for community submission.

- [x] **T6.1 Settings tab** `[activity: frontend-ui]`
  1. Prime: `[ref: SDD/User Interface & UX]`
  2. Test: General (Resources section name, numeric-only) persists and is read by ops; Scripts section lists installed scripts with enable/disable + import-from-vault; Advanced (debug logging) toggle; headings via `Setting.setHeading()`; sentence case throughout.
  3. Implement: `src/ui/settingsTab.ts`; wire settings into `OperationContext`.
  4. Validate: integration tests with mock App; snapshot of rendered controls.
  - Success: settings drive op behavior `[ref: PRD/Should-Have settings; AC F4.2]`

- [x] **T6.2 XSS-safe rendering & DOM audit** `[activity: frontend-ui]`
  1. Prime: `[ref: SDD/Cross-Cutting — DOM safety]`
  2. Test: script `description`/`changelog`/author rendered via `setText`/`createEl`; a grep-assert finds zero `innerHTML`/`outerHTML`/`insertAdjacentHTML` in `src/`.
  3. Implement: ensure all external-string rendering uses Obsidian DOM helpers.
  4. Validate: static-analysis assert + unit test with a hostile description string.
  - Success: `[ref: PRD/AC F10.2; SDD/Quality]`

- [x] **T6.3 Compliance sweep** `[activity: build-tooling]`
  1. Prime: `[ref: SDD/CON-3]` skill `tcs-patterns:obsidian-plugin`
  2. Test: assert no `console.log` (only `console.debug`); no global `fetch` (use `requestUrl` where any network exists); manifest lint; sample-plugin residue absent.
  3. Implement: fix any violations; add a CI lint step.
  4. Validate: compliance assertions green.
  - Success: `[ref: PRD/AC F10.1, F10.2]`

- [x] **T6.4 Phase Validation** `[activity: validate]`
  - Settings + DOM + compliance tests green; lint + typecheck clean.

## v0.1 limitations (documented, carried forward)
- **numericOnly=false** is persisted + threaded into `OperationContext` but not yet honored by the core footnote logic (core is numeric-only); wiring alpha-marker support is a follow-up.
- **Import-from-vault** UI is a Notice placeholder (the underlying `importScript` + checksum/manifest exists from T5.5); a full file-picker is deferred. Imported user scripts still aren't wired to execute in v0.1 (loader is v0.2 scaffolding).
