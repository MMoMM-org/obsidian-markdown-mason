---
title: "Phase 1: Storage & Lifecycle Core"
status: completed
version: "1.0"
phase: 1
---

# Phase 1: Storage & Lifecycle Core

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Data Storage Changes]` — the new `data.json` `ScriptRecord` schema
- `[ref: SDD/Application Data Models]` — `ScriptRecord`, `LifecycleState`
- `[ref: SDD/Implementation Examples/evaluateState]` — derived-state algorithm + traced walkthrough
- `[ref: SDD/Complex Logic — lifecycle transition resolution]`
- `[ref: SDD/ADR-11, ADR-12, ADR-14]`
- Existing code: `src/scripts/store.ts` (evaluateTrust precedence 1-6), `src/scripts/runtime.ts` (sha256), `src/main.ts:87-95` (store init)

**Key Decisions**:
- ADR-11: only decisions persist; `LifecycleState` is derived by `evaluateState`.
- ADR-12: `device.json` sidecar removed; `enabled`+consent fold into `data.json` `ScriptRecord` (`okayed:{version,checksum}`). No migration.
- ADR-14: checksum helper operates on **raw bytes** (`Uint8Array`), prefixed `sha256:`.

**Dependencies**: none — this is the spine every later phase builds on.

---

## Tasks

This phase delivers the synced storage model and the derived lifecycle state machine — the trust core all other phases depend on.

- [x] **T1.1 Byte-exact checksum helper** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: Read the byte-exact materialization example and ADR-14 `[ref: SDD/Implementation Examples; ADR-14]`; review current `runtime.ts:96` decoded-string hashing.
  2. Test (RED): `sha256:` prefix preserved; identical bytes → identical digest; CRLF vs LF byte sequences produce **different** digests (proves byte-exactness); accepts `Uint8Array` and `ArrayBuffer`.
  3. Implement (GREEN): Create `src/scripts/checksum.ts` exporting `sha256Bytes(bytes): string` using `node:crypto` over raw bytes.
  4. Validate: unit tests pass; lint; types.
  - Success: hashing is byte-exact, no string normalization `[ref: PRD/F6; SDD/ADR-14]`.

- [x] **T1.2 `ScriptStore` on synced `data.json` (`ScriptRecord`)** `[activity: data-architecture]`

  1. Prime: Read the storage schema + data models `[ref: SDD/Data Storage Changes; SDD/Application Data Models]`; current `store.ts` (esp. `setManifestEntry` key-preservation `store.ts:150-158`).
  2. Test (RED): `getScripts()` returns `{}` when absent; `setRecord(id, rec)` preserves unrelated keys (`settings`); reads/writes `{provenance, enabled, okayed, source, command}`; defensive defaults (`enabled:false`, `okayed:null`) for partial entries; **no** `device.json` read/write occurs.
  3. Implement (GREEN): Rewrite `src/scripts/store.ts` — replace `ManifestEntry`/`ConsentRecord`/`DeviceState` with `ScriptRecord`; drop the `VaultAdapterPort`/`devicePath` constructor args and all device-file I/O; keep `PluginDataPort`.
  4. Validate: rewrite `test/scripts/store.test.ts`; lint; types.
  - Success: enable + consent persist in `data.json` only `[ref: SDD/ADR-12]`; unrelated keys preserved `[ref: PRD/F2]`.

- [x] **T1.3 `evaluateState` derived lifecycle** `[activity: domain-modeling]`

  1. Prime: Read the evaluateState example + traced walkthrough + transition algorithm `[ref: SDD/Implementation Examples/evaluateState; SDD/Complex Logic]`; preserve `evaluateTrust` precedence semantics (rule 5 = drift).
  2. Test (RED): table-driven over inputs (record × local-code presence/version/checksum × catalogVersion × online):
     - no record → `Available` (in catalog) / `Absent`
     - `!enabled` → `Disabled`; `okayed===null` → `Available`/`Absent`
     - enabled+okayed, local absent, online → `Materializing`; offline → `Blocked(offline)`
     - local version ≠ okayed → `Materializing`
     - same version, checksum ≠ okayed → `Blocked(drift)`
     - curated, catalogVersion > okayed.version → `UpdateAvailable`
     - else → `Active`
  3. Implement (GREEN): Create `src/scripts/lifecycle.ts` — `LifecycleState` type (with `Blocked` reason union) + `evaluateState(deps)` as a pure function of injected inputs (record getter, local-checksum getter, catalog-version getter, online probe).
  4. Validate: unit tests cover every branch; lint; types.
  - Success: state derived, never persisted `[ref: SDD/ADR-11]`; drift hard-blocks `[ref: PRD/F6]`; offline-unmaterialized → Blocked(offline) `[ref: PRD/F3]`.

- [x] **T1.4 Wire store init off the sidecar** `[activity: backend-api]`

  1. Prime: Read `main.ts:87-95` `_initStore` + consumers (`settingsTab.ts:19,112-115`, `disclosure.ts:196,222`).
  2. Test (RED): plugin onload constructs `ScriptStore` with only `PluginDataPort`; no `device.json` path is referenced anywhere (grep-asserted in a test); `disclosure` consent recording targets the new `okayed` record.
  3. Implement (GREEN): Update `main.ts:_initStore` to drop `vaultAdapterPort`/`devicePath`; update `disclosure.ts` `makeAskCallback`/`recordConsent` calls to write `okayed`; delete dead `device.json` references.
  4. Validate: `npm test` for touched suites; lint; types.
  - Success: no `device.json` code path remains `[ref: SDD/ADR-12]`.

- [x] **T1.5 Phase Validation** `[activity: validate]`

  - Run all Phase 1 tests; `npm run lint`; `npm run compliance`. Verify the derived-state table matches the SDD algorithm and that `data.json` is the sole persistence for decisions.

---

## Deviations (recorded per Deviation Protocol)

- **T1.4 scope expanded beyond its written text.** The store rewrite (T1.2) removed API that `src/ui/settingsTab.ts` and `src/scripts/runtime.ts` (importScript) also consumed — not just the `main.ts` + `disclosure.ts` named in T1.4. To keep `tsc`/build green at the phase boundary (the phase-validation gate), T1.4 was expanded to minimally/transitionally adapt **all four** broken consumers. `settingsTab.ts` is fully rebuilt in T4.1/T4.2; `runtime.ts` import path in T2.3; `disclosure.ts` gate in T3.4. **User-approved** (2026-06-23).
- **Tracked-skip strategy for downstream v0.1-behavior tests.** 27 tests that assert removed v0.1 behavior are `describe.skip`/`it.skip` with `TODO(T2.3/T3.4/T4.2)` annotations naming the phase that re-enables them. Phase-1 suites (checksum/store/lifecycle) stay fully green and un-skipped; the new transitional gate/guard logic got fresh active coverage. Chosen over full-migration-now (would pull P3/P4 forward) and over leaving-reds (would mask future regressions). **User-approved** (2026-06-23).
- **Robustness hardening (review-driven):** `okayed` is parsed fail-closed (malformed → `null` = not consented) — `store.ts parseOkayed`. Not in the SDD verbatim but consistent with ADR-12's "safety shifts to the match-gate"; no spec change needed.

These do not change any ADR or PRD acceptance criterion; they are sequencing/transition decisions within Phase 1's scope.
