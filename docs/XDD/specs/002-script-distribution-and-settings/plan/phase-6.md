---
title: "Phase 6: Live GUI Wiring"
status: in_progress
version: "1.0"
phase: 6
---

# Phase 6: Live GUI Wiring

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Why this phase exists**: Phase 4 built the settings UI driven by *injected seams* and deferred the live resolvers to "P5"; Phase 5 delivered the services (catalog, materializer, loader), the dev loop, the migrated catalog, and proof-by-tests — but no Phase-5 task connected the GUI to the engine. T5.5 recorded this deviation; this phase closes it so an end user can drive `enable → disclosure → materialize → Active → run` (paste + launcher) through the real UI.

**Specification References**:
- `[ref: SDD/Runtime View]` — primary enable flow; lifecycle transition resolution
- `[ref: SDD/ADR-11..16]` — derived state, materializer, catalog port, byte-exact I/O, envelope/chain
- `[ref: SDD/Implementation Gotchas]` — navigator.onLine is a hint (fetch-failure is authoritative); binary I/O; onLayoutReady timing
- Existing seams to replace: `src/ui/settingsTab.ts` (`_buildScriptItems` hardcodes `online:false`/`local:null`/`catalogVersion:undefined`; `_buildLifecycleOps` ops are `_comingSoon`; `_buildCommandResolvers`/`getState` placeholders), `src/main.ts` (`_buildEnabledPasteScripts()` returns `[]`; `buildCatalogSource()` defined but never called)
- Existing engine: `src/scripts/lifecycle.ts` (evaluateState), `src/scripts/materializer.ts`, `src/scripts/catalog/*`, `src/scripts/loader.ts`, `src/scripts/disclosure.ts`, `src/scripts/runner.ts`, `src/scripts/paste/buildPasteChain.ts`, `src/scripts/commandManager.ts`

**Key Decisions**:
- **Per-device materialization fingerprint.** `evaluateState.local` needs `{version, checksum}` for the on-device code. Checksum is recomputable from the materialized bytes; the materialized **version** is tracked in a per-device (NOT synced) fingerprint manifest written by the materialize path, living alongside the per-device `<id>.cjs` (consistent with ADR-12 keeping per-device materialization out of synced `data.json`).
- **Online is fetch-authoritative.** Treat a catalog fetch failure (not just `navigator.onLine===false`) as the offline signal → `Blocked(offline)` (SDD gotcha).
- **Reuse, don't rebuild.** All wiring composes existing Phase 1–5 services; no new lifecycle logic. The injected-seam design from Phase 4 stays — Phase 6 supplies the real implementations behind the seams.

**Dependencies**: Phases 1–5 (full engine, UI shell, catalog artifacts, dev loop).

---

## Tasks

This phase replaces every `// P5:` seam with a real implementation and proves the wired path end-to-end through the actual plugin objects.

- [ ] **T6.1 Live state resolver + production CatalogSource** `[activity: backend-api]`

  1. Prime: Read `evaluateState` inputs (`src/scripts/lifecycle.ts`), `buildCatalogSource()` + `_buildScriptItems` stubs, the materializer's per-device write path `[ref: SDD/ADR-11; SDD/Runtime View]`.
  2. Test (RED): a `LifecycleResolver` assembles a real `EvaluateStateInput` per script — `inCatalog`/`catalogVersion` from a fetched-and-cached catalog index; `local` from a per-device fingerprint reader (materialized bytes → checksum; version from the per-device manifest; `null` when absent); `online` from `navigator.onLine` AND fetch-failure-authoritative; `record` from the store. `getState(id)` returns the correct `LifecycleState` for each combination (Available/Active/UpdateAvailable/Blocked(drift|offline)/Disabled/Materializing). Catalog fetch failure → `online:false` path → `Blocked(offline)` for an enabled+okayed script with absent local. Per-device fingerprint is NOT written to synced `data.json`.
  3. Implement (GREEN): create the resolver (e.g. `src/scripts/lifecycleResolver.ts`) + the per-device fingerprint store; call `buildCatalogSource()` in the plugin (dev→devDirAdapter, prod→requestUrl) with on-demand caching; replace the `settingsTab._buildScriptItems` `online/local/catalogVersion` stubs and the command-tab `getState` placeholder with the resolver.
  4. Validate: unit tests for the resolver + fingerprint store; `npm test`; lint; types.
  - Success: live `getState` drives the Scripts/Commands tabs; a curated script can render **Active**/**UpdateAvailable** in the real UI `[ref: PRD/F1, F4, F5]`.

- [ ] **T6.2 Live lifecycle ops (enable→disclosure→materialize; retry/update/re-review/remove/view/import/browse)** `[activity: frontend-ui]`

  1. Prime: Read `_buildLifecycleOps` `_comingSoon` stubs, `disclosure.ts` (`makeAskCallback`/modal), `materializer.ts`, the card state→action mapping `[ref: SDD/Runtime View; SDD/User Interface & UX]`.
  2. Test (RED): **enable** an un-consented curated script → disclosure modal shown with `{version,checksum}` → on consent, `okayed` persisted and `materialize` runs → re-render shows Active; re-enable with unchanged `{v,c}` shows NO modal. **retry** (Blocked) → materialize. **update** (UpdateAvailable) → re-disclose new `{v,c}` → materialize → Active@new. **reReview** → re-show disclosure. **remove** → clear record + delete the materialized file + per-device fingerprint → Available/Absent. **viewSource** → curated repo link / imported reveal-in-vault. **importFromVault** → file-pick an imported `.cjs` → disclosure → materialize. **browseOfficial** → list catalog entries (minimal, real index). No `_comingSoon` remains.
  3. Implement (GREEN): real `_buildLifecycleOps` composing disclosure + materializer + store + resolver + per-device fingerprint, each action re-rendering via the guarded path.
  4. Validate: UI tests (drive each op, assert state transitions + modal/materialize calls); `npm run compliance`; lint; types.
  - Success: every Scripts-card action works end-to-end in the real UI; enable implies consent `[ref: PRD/F1, F2, F4, F6]`.

- [ ] **T6.3 Module loading, paste-chain assembly & launcher run** `[activity: backend-api]`

  1. Prime: Read `main._buildEnabledPasteScripts` (returns `[]`), `loadScriptModule`/`FsScriptLoader` (`src/scripts/loader.ts`), `buildPasteChain`, the command-tab `resolveScriptFn` placeholder `[ref: SDD/ADR-16]`.
  2. Test (RED): `_buildEnabledPasteScripts` loads the materialized module (`loadScriptModule`) for each enabled+**Active** script and assembles `LoadedScript[]` so `buildPasteChain` orders them (curated→imported, priority desc, id) and "Paste and format" runs the first match against a real fixture; a disabled/Blocked script is excluded. The launcher/`CommandManager` `resolveScriptFn` returns the loaded `run` for an Active script (and fails safe for non-Active). Module loads happen lazily (no load for disabled scripts).
  3. Implement (GREEN): wire `_buildEnabledPasteScripts` + the command `resolveScriptFn` to the loader (per-device materialized path), gated by the resolver's Active state.
  4. Validate: integration tests over the real run paths; `npm test`; lint; types.
  - Success: paste autodetect + launcher execute materialized curated scripts `[ref: PRD/F9, F10, F11]`.

- [ ] **T6.4 Wired end-to-end test + final validation** `[activity: validate]`

  1. Prime: existing `test/e2e/scriptLifecycle.e2e.test.ts` (composed-unit flows) — now assert through the **wired plugin objects**.
  2. Test (RED): a live integration test that constructs the plugin (or the real settings tab + resolver + ops + main paste path) with a fake `CatalogSource` + in-memory adapters and drives: Scripts-tab enable → disclosure → materialize → Active → run via "Paste and format" AND via "Run script…" → disable → remove. Assert NO `_comingSoon` Notices fire on the happy path.
  3. Validate: run the **entire** suite (`npm test`), `npm run lint`, `npm run compliance`, `npm run build`, `npm run check:manifest`. Re-walk the PRD→Phase coverage map; confirm the live-GUI ACs (F1/F2/F4/F6/F9/F10) are now exercised through the wired path, not only composed units. Grep the production seams to confirm no `online:false`/`_comingSoon`/empty-`_buildEnabledPasteScripts` stubs remain. Record any residual deviations.
  - Success: the GUI drives the full lifecycle end-to-end; spec 002 deviation closed `[ref: PRD/F1–F11]`.
