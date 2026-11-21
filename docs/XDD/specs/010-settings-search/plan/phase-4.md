---
title: "Phase 4: Release hygiene and end-to-end validation"
status: pending
version: "1.0"
phase: 4
---

# Phase 4: Release hygiene and end-to-end validation

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Deployment View]`
- `[ref: SDD/Acceptance Criteria/Version and tooling]`
- `[ref: SDD/Implementation Gotchas]`: compliance test, sentence-case lint scope
- `[ref: PRD/Success Metrics/Tracking Requirements]`: manual search smoke test, scorecard scan

**Key Decisions**:
- ADR-1: minAppVersion 1.13.1; `versions.json` history untouched (0.9.4 → 1.7.2 stays).
- Feature 10 scope: lint rule on, stale comments fixed, user docs rewritten.

**Dependencies**: Phase 3 complete.

---

## Tasks

Makes the release correct and honest (version floor, lint, docs) and proves the feature end to end in a real Obsidian.

- [ ] **T4.1 Minimum version bump** `[activity: build-config]`

  1. Prime: manifest.json, versions.json, version-bump.mjs L16-29, scripts/check-manifest.mjs, test/compliance.test.ts L283-290 `[ref: SDD/Deployment View]`
  2. Test: Update the compliance test:
     - it passes when `manifest.minAppVersion` is greater than the entry recorded for the current `manifest.version` (pending release);
     - it still requires an exact match once a `versions.json` entry exists for the new version;
     - it asserts `minAppVersion >= 1.13.1`;
     - it asserts no existing `versions.json` entry changed.
  3. Implement: Set `manifest.json` `minAppVersion` to `1.13.1`. Leave versions.json for version-bump.mjs at release time.
  4. Validate: `npm run check:manifest`, compliance and full suite pass.
  5. Success: Listing states the new minimum `[ref: PRD/F7.1]`; users below 1.13.1 keep 0.9.4 `[ref: PRD/F7.2]`

- [ ] **T4.2 Lint rule and stale comments** `[activity: build-config]` `[parallel: true]`

  1. Prime: eslint.config.mjs L42-44; stale comments at src/ui/settingsTab.ts (removed in T3.1, so verify), src/core/types.ts (~L52 "eleven"), src/core/formatSelection.ts (~L5), src/commands.ts (~L340 "Catalyst beta" / "force minAppVersion past stable") `[ref: PRD/F10.2]` `[ref: PRD/F10.3]`
  2. Test: Lint itself is the test: with the `prefer-setting-definitions` override removed, `npm run lint` passes, and `no-deprecated-display` / `prefer-update-over-display` report nothing.
  3. Implement:
     - remove the `"off"` override and its "not yet generally available" comment;
     - fix the stale comments (thirteen toggles; the CommandHost note now explains it predates `Plugin.settings`);
     - change no code behaviour.
  4. Validate: Lint, types and tests green; `rg -i "eleven toggles|four-segment|run-script launcher|not yet generally available"` returns nothing in src/ and the config.
  5. Success: Lint enforces the declarative API `[ref: PRD/F10.3]`; comments match the code `[ref: PRD/F10.2]`

- [ ] **T4.3 User documentation** `[activity: documentation]` `[parallel: true]`

  1. Prime: README.md (L23/L49 version, step counts), docs/configuration.md (five segments, twelve toggles), docs/installation.md (L8, L43) `[ref: PRD/F10.1]`
  2. Test: A doc check (rg-based, in the validation step):
     - every fixed setting name from `FIXED_SETTINGS` appears in docs/configuration.md;
     - the stated minimum Obsidian version is 1.13.1 in README and installation;
     - no doc says "segment";
     - the step counts match `resolveFormatSelectionRecipe` (13 Format selection steps; Paste and format = the non-"Format selection only" set).
  3. Implement:
     - rewrite configuration.md around the main page, the Scripts and Commands pages and settings search, including example search words;
     - update the README and installation version and counts.
     - Release notes come from the `feat:` commit body, which mentions the 1.13.1 minimum and settings search (Feature 7.3); the commit message for the user-visible change says so.
  4. Validate: Doc check passes; links resolve.
  5. Success: Docs describe the new layout and the correct version `[ref: PRD/F10.1]`; release notes mention the minimum version and search `[ref: PRD/F7.3]`

- [ ] **T4.4 End-to-end smoke test in Obsidian** `[activity: validate]`

  Depends on T4.1–T4.3. Run by the user in host Obsidian ≥ 1.13.1 via `npm run dev` (Markdown Mason dev loop, `.mason-dev.json`). Never `npm run build` here.

  1. Prime: PRD Success Metrics / Tracking Requirements; the PRD's open question on search navigation `[ref: PRD/Open Questions]`
  2. Test (checklist, record pass/fail per row in the phase file):
     - search each of the 18 setting names: each hits and lands on the setting;
     - search OCR, TextSniper, paste, footnotes, hotkey, command palette, catalog, official scripts, console, debug: each reaches its target, with no unrelated noise;
     - search a script name: it lands on the Scripts page row;
     - toggle Reflow and Debug logging, restart Obsidian: values persist and logging follows immediately;
     - with a copy of a real 0.9.4 data.json: all values unchanged after upgrade, and scripts intact after a settings change;
     - enable, disable, update and remove a script: the row and the main-page indicator update;
     - Commands: create, rename and remove a command, checking the palette;
     - splash "open Scripts settings" opens the Scripts page directly;
     - keyboard: arrow navigation and Back restore focus.
  3. Implement: Fix any defect found as its own `fix:` commit with a regression test. Record observed search-result navigation behaviour (closing the PRD open question) in the spec README decisions log.
  4. Validate: Every checklist row passes, or a deviation is documented and approved.
  5. Success: Adoption and engagement KPIs met (100% of targets findable) `[ref: PRD/Success Metrics/Key Performance Indicators]`; sub-page navigation confirmed `[ref: PRD/Open Questions]`

- [ ] **T4.5 Final validation** `[activity: validate]`

  Run the full CI-equivalent check: `npx tsc -noEmit -skipLibCheck && npm run lint && npm test && npm run check:manifest`.
  - Run `/validate` for spec 010 (drift between SDD and code).
  - Confirm every PRD acceptance criterion is ticked by a task, and update the spec README (phase → Ready).
  - Open the PR on branch `spec/010-settings-search-impl` (per the branch-name convention), with release notes in the `feat:` message.
  - After release, run `/obsidian-eval` to confirm the scorecard no longer lists the `getSettingDefinitions()` warning (Business Impact KPI).
