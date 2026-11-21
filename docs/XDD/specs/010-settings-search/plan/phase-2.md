---
title: "Phase 2: Scripts and Commands pages"
status: pending
version: "1.0"
phase: 2
---

# Phase 2: Scripts and Commands pages

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Implementation Examples/Scripts cache refresh (single flight + coalescing + generation)]`
- `[ref: SDD/Complex Logic]`: Build Scripts page algorithm
- `[ref: SDD/Interface Specifications/Internal API Changes]`: scriptsCache, scriptsPage, commandsPage
- `[ref: SDD/Error Handling]`
- `[ref: SDD/Implementation Gotchas]`: wired-once list buttons, stable ids, ⋯ menu positioning, no `update()` on command edits

**Key Decisions**:
- ADR-6: ScriptsCache feeds `update()`; `items === null` means "Loading scripts…".
- ADR-7: list `addItem` = Import from vault, `extraButtons` = Browse official, plus a searchable action-row group (aliases catalog, official scripts, import).
- ADR-1: page `displayValue`/`status` for the update indicator.

**Dependencies**: Phase 1 complete (harness T1.1). Old renderers in scriptsTab.ts / commandsTab.ts keep working by importing the moved helpers; they are deleted in T3.1.

---

## Tasks

Enables the two dynamic sub-pages: async script state that refreshes safely, script rows with every state-dependent control, and command rows.

- [ ] **T2.1 Async script state: scriptsCache** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: `[ref: SDD/Implementation Examples/Scripts cache refresh (single flight + coalescing + generation)]`; today's I/O in src/ui/settingsTab.ts L313-331, L340-362 (offline `evaluateState` fallback), L472-484
  2. Test (with fake store and resolver using deferred promises):
     - before the first refresh, `items` is `null`;
     - a refresh calls `clearCache → getScripts → resolveItems` and applies items, records and `updatableCount`, calls `setUpdatableCount` and `onChange` once;
     - two `requestRefresh()` during an in-flight refresh produce exactly one follow-up pass (two `onChange` calls total, last state wins);
     - an older generation never overwrites a newer one;
     - never more than one refresh in flight;
     - with no resolver, the offline fallback states are used;
     - a throwing store or resolver keeps the last good state and still clears `inFlight`;
     - `markStale()` sets stale; a refresh clears it before awaiting.
  3. Implement: Create `src/ui/scriptsCache.ts` (`ScriptsCache` with narrow deps `{store, resolver?, setUpdatableCount}`).
  4. Validate: Unit tests pass; lint and types clean.
  5. Success:
     - [ ] The list reflects new state after any action `[ref: PRD/F4.6]`
     - [ ] Indicator count stays consistent `[ref: PRD/F6.3]`
     - [ ] SDD criterion on coalescing refresh `[ref: SDD/Acceptance Criteria/Scripts page]`
     - [ ] Offline edge case `[ref: PRD/Detailed Feature Specifications/Edge Cases]`

- [ ] **T2.2 LifecycleOps builder: scriptLifecycleOps** `[activity: refactoring]` `[parallel: true]`

  1. Prime: src/ui/settingsTab.ts L377-448 (controller-backed ops, store-only fallback, BrowseOfficialModal wiring, "catalog not available" Notice) `[ref: SDD/Building Block View/Components]`
  2. Test: Port the existing controller-delegation and fallback tests (settingsTab.test.ts ~L932-1005 and fallback behaviour):
     - each op delegates to the controller when present;
     - the fallback mutates the store only;
     - Browse official opens the modal with the current store state, or shows the Notice when no controller exists;
     - the re-render callback passed in is invoked after fallback ops.
  3. Implement: Create `src/ui/scriptLifecycleOps.ts` (`buildLifecycleOps(deps, onChanged)`). Make the old settingsTab.ts call it, passing its current re-render. This is a behaviour-preserving move.
  4. Validate: Old settings tab tests still green; new tests pass; lint and types clean.
  5. Success: Every script action behaves as today `[ref: PRD/F4.2]` `[ref: PRD/F4.3]`; fallback error handling `[ref: SDD/Error Handling]`

- [ ] **T2.3 Scripts page: scriptsPage** `[activity: frontend-ui]`

  Depends on T2.1, T2.2, T1.1.

  1. Prime: src/ui/scriptsTab.ts helpers (`pillLabel`, `pillIcon`, `toggleValue`, `showsToggle`, `blockedReasonText`, `blockedRecovery`, `menuActions`, `reReviewAction`, `provenanceBadge`, L143-349, L389-391); test/ui/scriptsTab.test.ts `[ref: SDD/Complex Logic]` `[ref: SDD/ADR-7]`
  2. Test:
     - `buildScriptsPage` returns a page with `id: "scripts"` and name "Scripts";
     - `displayValue` is "1 update available" / "N updates available" and `status` is "warning" when count > 0; both are empty/null at 0;
     - the list has one row per script in store order, with `id: "script:<id>"`, `name` = displayName, `desc` = description, and aliases including the id;
     - `emptyState` is "Loading scripts…" while `items` is null, and today's empty-state text when there are 0 scripts;
     - `addItem` = Import from vault; `extraButtons` = Browse official; both read ops at click time;
     - an action-row group "Import from vault" / "Browse official" carries the aliases catalog, official scripts, import.

     `configureScriptRow(mockSetting, item, ops)` per state (port the scriptsTab.test.ts coverage):
     - provenance badge, pill label and icon, and version are in `nameEl`;
     - a toggle exists only when `showsToggle`, with its value from `toggleValue`; changing it calls enable/disable;
     - the ⋯ extra button opens a Menu with `menuActions(state)` titles, and each item calls its op;
     - Blocked rows show `blockedReasonText` and the recovery button calls the right op;
     - hostile id, source and description render as literal text.
  3. Implement: Create `src/ui/scriptsPage.ts`. Move the helpers and the `ScriptItem`/`LifecycleOps` types here from scriptsTab.ts; scriptsTab.ts re-imports them, and lifecycleResolver.ts imports `ScriptItem` from the new path. Position the ⋯ menu from `extraSettingsEl.getBoundingClientRect()`.
  4. Validate: New tests pass; the old scriptsTab tests still pass on the re-imported helpers; lint and types clean.
  5. Success:
     - [ ] One row per script with status `[ref: PRD/F4.1]`
     - [ ] Enable/disable incl. consent `[ref: PRD/F4.2]`
     - [ ] Menu actions `[ref: PRD/F4.3]`
     - [ ] Blocked recovery `[ref: PRD/F4.4]`
     - [ ] Import/Browse and empty state `[ref: PRD/F4.5]`
     - [ ] Script name searchable `[ref: PRD/F4.7]`
     - [ ] Indicator on the Scripts entry `[ref: PRD/F6.1]` `[ref: PRD/F6.2]`
     - [ ] "catalog" / "official scripts" aliases `[ref: PRD/F8.1]`
     - [ ] Rule 6 literal text `[ref: PRD/Detailed Feature Specifications/Business Rules]`

- [ ] **T2.4 Commands page: commandsPage** `[activity: frontend-ui]` `[parallel: true]`

  Depends on T2.1, T1.1. Can run alongside T2.3.

  1. Prime: src/ui/commandsTab.ts (L74-153 row handlers, empty state L91-97); test/ui/commandsTab.test.ts; the script function resolver in settingsTab.ts L489-496 `[ref: SDD/Acceptance Criteria/Commands page]`
  2. Test:
     - `buildCommandsPage` returns a page with `id: "commands"` and name "Commands";
     - it always starts with an intro row (today's hint text, aliases hotkey and command palette), even with 0 enabled scripts;
     - it has one row per `enabled === true` script, or the empty-state message.

     `configureCommandRow` (port the commandsTab.test.ts coverage):
     - the toggle reflects `record.command`;
     - on registers under commandName or id; off unregisters and keeps `enabled`;
     - rename trims, persists, and re-registers when active; clearing the name falls back to the id;
     - edits patch the cache records and **never** call `update()`.
  3. Implement: Create `src/ui/commandsPage.ts`. Extract `configureCommandRow(setting, …)` from commandsTab.ts; the old `renderCommandsTab` calls it with `new Setting(containerEl)` until T3.1. The script function resolver is built lazily per toggle.
  4. Validate: New and old commands tests pass; lint and types clean.
  5. Success: PRD Feature 5 criteria `[ref: PRD/F5.1]` `[ref: PRD/F5.2]` `[ref: PRD/F5.3]` `[ref: PRD/F5.4]` `[ref: PRD/F5.5]`; hotkey aliases `[ref: PRD/F8.1]`

- [ ] **T2.5 Phase validation** `[activity: validate]`

  Run `npx tsc -noEmit -skipLibCheck && npm run lint && npm test`. Confirm:
  - every helper exists once (no copies between scriptsTab.ts and scriptsPage.ts, or between commandsTab.ts and commandsPage.ts);
  - list `extraButtons`/`addItem` callbacks don't capture stale snapshots;
  - every page and row has a stable `id`.
