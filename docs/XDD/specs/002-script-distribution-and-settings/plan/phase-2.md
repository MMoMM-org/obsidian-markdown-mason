---
title: "Phase 2: Distribution & Materialization"
status: pending
version: "1.0"
phase: 2
---

# Phase 2: Distribution & Materialization

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Internal API Changes]` — `CatalogSource` port, `Materializer`, `CatalogIndex/CatalogEntry`
- `[ref: SDD/Implementation Examples/byte-exact]` and `[ref: SDD/Implementation Examples/Test Examples]`
- `[ref: SDD/Runtime View/Primary Flow]` + `[ref: SDD/Error Handling]`
- `[ref: SDD/ADR-13, ADR-14]`
- Existing code: `src/scripts/runtime.ts` (`importScript` guards), `src/scripts/loader.ts` (escape guard), `test/compliance.test.ts` (requestUrl-only rule)

**Key Decisions**:
- ADR-13: `CatalogSource` port mirrors the existing DI ports; production adapter uses Obsidian `requestUrl`; URLs built from a SHA pinned at build time.
- ADR-14: fetch returns raw bytes; verify against catalog checksum; write verbatim via binary I/O.
- Fail-closed: materialize never writes on checksum mismatch; reasons = `drift | offline | source-missing | checksum-mismatch`.

**Dependencies**: Phase 1 (`checksum.ts`, `ScriptStore`, `evaluateState`).

---

## Tasks

This phase delivers on-demand fetching of curated code and per-device materialization with the match-gate — the heart of cross-device safety.

- [ ] **T2.1 `CatalogSource` port + index types** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: Read the port + catalog schema `[ref: SDD/Internal API Changes; SDD/Application Data Models]`.
  2. Test (RED): type-level/compile test that `CatalogIndex`/`CatalogEntry` carry `{schemaVersion, ref, scripts:{id:{version,checksum,path,name,description}}}`; a fake `CatalogSource` satisfies the interface.
  3. Implement (GREEN): Create `src/scripts/catalog/catalogSource.ts` — `CatalogSource` interface (`fetchIndex`, `fetchScript`) + `CatalogIndex`/`CatalogEntry` types.
  4. Validate: types compile; lint.
  - Success: port defined, network-free fakeable `[ref: SDD/ADR-13]`.

- [ ] **T2.2 `requestUrl` catalog adapter** `[activity: integration]`

  1. Prime: Read ADR-13 + compliance requestUrl rule `[ref: SDD/ADR-13; test/compliance.test.ts]`.
  2. Test (RED): builds URLs from the pinned `ref` + `entry.path`; uses Obsidian `requestUrl` (NOT `fetch`); returns `Uint8Array` from the arrayBuffer; surfaces network failure as a thrown/typed error (so caller maps to offline). Use an injected `requestUrl` double.
  3. Implement (GREEN): Create `src/scripts/catalog/requestUrlAdapter.ts` — concrete `CatalogSource` over `requestUrl`; pinned SHA read from a build-time constant.
  4. Validate: unit tests with the double; `npm run compliance` stays green (no `fetch`); lint; types.
  - Success: CORS-safe fetch at pinned SHA `[ref: PRD/F4; SDD/ADR-13]`; no polling of a moving ref `[ref: PRD/F4]`.

- [ ] **T2.3 Byte-exact import path (binary)** `[activity: backend-api]` `[parallel: true]`

  1. Prime: Read `runtime.ts` `importScript` (string I/O at `:93-108`) + ADR-14 + the binary-I/O gotcha `[ref: SDD/ADR-14; SDD/Implementation Gotchas]`.
  2. Test (RED): import reads via `readBinary`, hashes raw bytes, writes via `writeBinary` verbatim (CRLF bytes survive round-trip); absolute-path and `..`-traversal guards still reject (reuse existing tests).
  3. Implement (GREEN): Update `src/scripts/runtime.ts` (and `VaultAdapterPort` to add `readBinary`/`writeBinary`) — switch import I/O to binary; record `okayed` via the new store.
  4. Validate: update `test/scripts/loader.test.ts`/import tests; lint; types.
  - Success: imported code materialized byte-exact; guards intact `[ref: PRD/F6 edge; SDD/ADR-14]`.

- [ ] **T2.4 `Materializer` (fetch/copy → verify → write verbatim)** `[activity: backend-api]`

  1. Prime: Read the materialize contract, byte-exact example, and error-handling reasons `[ref: SDD/Internal API Changes; SDD/Error Handling]`.
  2. Test (RED) — with a fake `CatalogSource` (no network):
     - curated match → writes verbatim, returns `{ok:true}`
     - curated checksum ≠ catalog → returns `checksum-mismatch`, **does not write** (fail-closed)
     - materialized bytes ≠ okayed → `drift`
     - fetch throws (network) → `offline`
     - imported source path missing → `source-missing`
  3. Implement (GREEN): Create `src/scripts/materializer.ts` — chooses source by `provenance` (catalog fetch vs vault copy), verifies checksum **and** version against `okayed`, writes verbatim, returns the typed result.
  4. Validate: unit tests for every reason branch; lint; types.
  - Success: never runs/writes on mismatch `[ref: PRD/F4, F5, F6]`; match-gate is the device-B safety `[ref: SDD/ADR-11; sync-spike T7.5]`.

- [ ] **T2.5 Phase Validation** `[activity: validate]`

  - Run all Phase 2 tests; `npm run lint`; `npm run compliance`. Confirm zero real network in tests (fakes only) and that every Blocked reason is produced by a covered branch.
