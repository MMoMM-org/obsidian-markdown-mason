---
title: "Phase 3: Tab swap and plugin wiring"
status: in_progress
version: "1.0"
phase: 3
---

# Phase 3: Tab swap and plugin wiring

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Interface Specifications/Internal API Changes]`: MasonSettingTab, MasonPlugin
- `[ref: SDD/Integration Points]`
- `[ref: SDD/Runtime View]`: primary flow, script action flow, splash flow
- `[ref: SDD/Directory Map]`: deletions (HeaderSection.ts, segment code, card CSS)
- `[ref: SDD/Quality Requirements]`

**Key Decisions**:
- ADR-5: overrides persist via `saveSettings()`; `debugLogging` calls `setDebugLogging` before saving; unknown keys are ignored.
- ADR-6: `setRerender` wired once; cache seeded at layout-ready; `hide()` marks it stale.
- ADR-4: splash calls `openPagePath(manifest.id, ["Scripts"])` when present, else `openTabById`.

**Dependencies**: Phases 1 and 2 complete. This phase removes the old segmented UI, so the build only stays green if T3.1 rewrites the obsolete tests in the same commit.

---

## Tasks

Swaps the segmented tab for the declarative one, wires it into the plugin lifecycle, and removes dead UI code, CSS and tests.

- [x] **T3.1 Declarative MasonSettingTab** `[activity: frontend-ui]`

  1. Prime: src/ui/settingsTab.ts (whole file), test/ui/settingsTab.test.ts, test/ui/formatSelectionSection.test.ts `[ref: SDD/Implementation Examples/Control-key resolution with nested Format selection]` `[ref: SDD/Implementation Gotchas]`
  2. Test (rewrite settingsTab.test.ts and formatSelectionSection.test.ts as definition-level tests):
     - `getSettingDefinitions()` assembles `buildMainPageItems` with the real Scripts and Commands pages and the Documentation row, and is never empty;
     - `getControlValue` delegates to `readControl`;
     - `setControlValue` writes, then calls `saveSettings` once (the throwing mock base proves the base is never used); `debugLogging` calls `setDebugLogging` before saving; an unknown key does nothing;
     - a `saveSettings` rejection shows the Notice and doesn't throw;
     - a write keeps the `scripts` namespace of a 0.9.4 `data.json` fixture;
     - `hide()` marks the cache stale, and the next `getSettingDefinitions()` triggers exactly one refresh (no loop);
     - a cache change calls `update()`;
     - the controller rerender is wired once in the constructor.

     Delete the obsolete tests: segment nav and badge, `display()` idempotency, `_rendering` guard (replaced by the T2.1 cache tests). Port the rest of scriptsTab.test.ts and commandsTab.test.ts onto the T2.3/T2.4 builders.
  3. Implement: Rewrite `src/ui/settingsTab.ts`:
     - delete `display`, `Segment`/`SEGMENTS`, all `_render*`, `_selectSegment`, `_rendering`, the badge, `selectScriptsSegment`;
     - delete `src/ui/HeaderSection.ts`; delete the old renderers in scriptsTab.ts and commandsTab.ts, then rename them to their page modules (git mv, so history follows);
     - update xss.test.ts XSS-2 to render hostile data through `configureScriptRow` (the static sink scan is unchanged).
     - reword the Commands empty-state text from "in the Scripts tab" to "on the Scripts page" (PRD F5 wording; flagged in T2.4, deferred until the old tab is gone).
     - rename leftover "tab" names in the page modules (e.g. `CommandsTabCommandManager` in commandsPage.ts) once commandsTab.ts is deleted (T2.4 review).
     - reword the comments moved verbatim into scriptsPage.ts that still mention renderScriptsTab, settingsTab P5 markers and "Minimal" menu (T2.3 review).
     - when deleting the old renderers, confirm the leftovers they still carry are gone with them: scriptsTab.ts's own `openMenu` (showAtMouseEvent) and its copies of the "No scripts yet…", "Import from vault" and "Browse official" strings (T2.5 check 1).
     - ScriptsCache logs a throwing `setUpdatableCount`/`onChange` and refresh failures via `debug()`, which is silent unless debug logging is on; per src/core/debug.ts genuine errors use console.warn — switch those catches to console.warn (T2.5 review).
     - strengthen two T2.6 tests (T2.6 review): pin `names[0]` ("Twin (first) (first)") in the collision test, and assert the search hits before removal in both removal tests.
  4. Validate:
     - `npx tsc -noEmit -skipLibCheck && npm run lint && npm test` green;
     - no references to `selectScriptsSegment`/`HeaderSection`/`renderScriptsTab` remain (`rg`);
     - lint with `obsidianmd/no-deprecated-display` has nothing to flag.
  5. Success:
     - [x] Behaviour parity `[ref: PRD/F3.1]` `[ref: PRD/F3.3]`
     - [x] Debug logging live `[ref: PRD/F3.4]`
     - [x] Commands use new values `[ref: PRD/F3.5]`
     - [x] Search result shows the setting `[ref: PRD/F1.3]`
     - [x] No Mason entry on a non-matching search `[ref: PRD/F1.4]`
     - [x] Segment bar gone `[ref: PRD/F2.4]`
     - [x] SDD behaviour-parity criteria `[ref: SDD/Acceptance Criteria/Behaviour parity]`

- [ ] **T3.2 Plugin wiring and splash deep link** `[activity: integration]`

  Depends on T3.1.

  1. Prime: src/main.ts L165-181 (onload order), L217-263 (resolver/controller, placeholder rerender), L350-456 (layout-ready, splash, `_countUpdatableScripts`, `_openScriptsSettings`) `[ref: SDD/Integration Points]` `[ref: SDD/ADR-4]`
  2. Test:
     - at layout-ready, `tab.scripts.refresh()` runs once and `updatableScriptCount` comes from the cache;
     - the splash's separate catalog count fetch is gone (one resolve per startup);
     - `_openScriptsSettings` calls `setting.open()` then `openPagePath("markdown-mason", ["Scripts"])` when it is a function;
     - when `openPagePath` is absent it falls back to `openTabById`;
     - when `app.setting` is missing it does nothing and doesn't throw;
     - script rows are present in `settingItems` after the seed refresh (searchable after startup).
  3. Implement: Update `src/main.ts`: seed the cache at layout-ready (replacing `_countUpdatableScripts`' own resolve), rewrite `_openScriptsSettings` per ADR-4, and remove the placeholder rerender comment. (The `selectScriptsSegment` call already went with T3.1.)
     - queued from the T3.1 reviews: reword the stale segment/badge/`_selectSegment` comments in src/main.ts (about L163, L171, L255, L361, L388), and the user-facing "Scripts tab" wording in src/ui/runScriptModal.ts:52 and src/ui/updateSplashModal.ts:14 to "Scripts page".
  4. Validate: Unit tests pass; lint and types clean; the splash modal tests still pass.
  5. Success: Splash opens the Scripts page `[ref: PRD/F6.4]`; indicator seeded `[ref: PRD/F6.1]`; script rows searchable after startup `[ref: PRD/F4.7]`; SDD deep-link criterion `[ref: SDD/Acceptance Criteria/Indicator and deep link]`

- [ ] **T3.3 Dead CSS removal** `[activity: frontend-ui]` `[parallel: true]`

  Depends on T3.1. Can run alongside T3.2.

  1. Prime: styles.css (segment nav, toolbar, card rules ~L11-174; pill/version/badge/blocked classes) `[ref: SDD/Directory Map]`
  2. Test: A static test asserts every `.mason-*` class referenced in styles.css is used somewhere in src/, and every class src/ applies exists in styles.css. This guards against dead rules and against missing styles for the new rows.
  3. Implement: Delete `.mason-segment-*`, `.mason-scripts-toolbar`, `.mason-scripts-list`, `.mason-script-card*` and the header/tagline rules; keep and adapt the pill/version/badge/blocked styles for rows inside a `Setting`.
  4. Validate: Static test passes; full suite green.
  5. Success: No dead CSS for removed UI `[ref: SDD/Implementation Gotchas]`; rows keep readable status styling `[ref: PRD/Detailed Feature Specifications/Business Rules]`

- [ ] **T3.4 Phase validation** `[activity: validate]`

  Run `npx tsc -noEmit -skipLibCheck && npm run lint && npm test`. Then:
  - walk the SDD responsibility table and confirm each component's file exists with exactly that responsibility;
  - confirm every SDD Acceptance Criteria line has a passing test;
  - confirm the UI test volume matches ADR-8's estimate (obsolete layout tests deleted, behaviour tests kept).
