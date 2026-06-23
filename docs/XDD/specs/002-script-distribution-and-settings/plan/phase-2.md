---
title: "Phase 2: Distribution & Materialization"
status: completed
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

- [x] **T2.1 `CatalogSource` port + index types** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: Read the port + catalog schema `[ref: SDD/Internal API Changes; SDD/Application Data Models]`.
  2. Test (RED): type-level/compile test that `CatalogIndex`/`CatalogEntry` carry `{schemaVersion, ref, scripts:{id:{version,checksum,path,name,description}}}`; a fake `CatalogSource` satisfies the interface.
  3. Implement (GREEN): Create `src/scripts/catalog/catalogSource.ts` — `CatalogSource` interface (`fetchIndex`, `fetchScript`) + `CatalogIndex`/`CatalogEntry` types.
  4. Validate: types compile; lint.
  - Success: port defined, network-free fakeable `[ref: SDD/ADR-13]`.

- [x] **T2.2 `requestUrl` catalog adapter** `[activity: integration]`

  1. Prime: Read ADR-13 + compliance requestUrl rule `[ref: SDD/ADR-13; test/compliance.test.ts]`.
  2. Test (RED): builds URLs from the pinned `ref` + `entry.path`; uses Obsidian `requestUrl` (NOT `fetch`); returns `Uint8Array` from the arrayBuffer; surfaces network failure as a thrown/typed error (so caller maps to offline). Use an injected `requestUrl` double.
  3. Implement (GREEN): Create `src/scripts/catalog/requestUrlAdapter.ts` — concrete `CatalogSource` over `requestUrl`; pinned SHA read from a build-time constant.
  4. Validate: unit tests with the double; `npm run compliance` stays green (no `fetch`); lint; types.
  - Success: CORS-safe fetch at pinned SHA `[ref: PRD/F4; SDD/ADR-13]`; no polling of a moving ref `[ref: PRD/F4]`.

- [x] **T2.3 Byte-exact import path (binary)** `[activity: backend-api]` `[parallel: true]`

  1. Prime: Read `runtime.ts` `importScript` (string I/O at `:93-108`) + ADR-14 + the binary-I/O gotcha `[ref: SDD/ADR-14; SDD/Implementation Gotchas]`.
  2. Test (RED): import reads via `readBinary`, hashes raw bytes, writes via `writeBinary` verbatim (CRLF bytes survive round-trip); absolute-path and `..`-traversal guards still reject (reuse existing tests).
  3. Implement (GREEN): Update `src/scripts/runtime.ts` (and `VaultAdapterPort` to add `readBinary`/`writeBinary`) — switch import I/O to binary; record `okayed` via the new store.
  4. Validate: update `test/scripts/loader.test.ts`/import tests; lint; types.
  - Success: imported code materialized byte-exact; guards intact `[ref: PRD/F6 edge; SDD/ADR-14]`.

- [x] **T2.4 `Materializer` (fetch/copy → verify → write verbatim)** `[activity: backend-api]`

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

- [x] **T2.5 Phase Validation** `[activity: validate]`

  - Run all Phase 2 tests; `npm run lint`; `npm run compliance`. Confirm zero real network in tests (fakes only) and that every Blocked reason is produced by a covered branch.

---

## Deviations (recorded per Deviation Protocol)

- **T2.3 `okayed` semantics reconciled to the PRD (not the plan's literal wording).** The plan said "record `okayed`" at import; the PRD (F2; user journey "Import → Disclosure modal → accept"; glossary "okayed = the identity the user consented to") is authoritative: consent is recorded by the **disclosure** flow (T3.4), not by `importScript`. So `importScript` records `okayed: null` and **returns** the byte-exact `{version, checksum}` for disclosure to present + persist on accept. This preserves enable-implies-consent (F2) — importing your own vault code does NOT auto-grant execution. No ADR/PRD change; the plan phrasing was loose.
- **Pinned distribution coordinates are source-level constants** (`src/scripts/catalog/pinnedRef.ts`: `RAW_BASE`, placeholder `PINNED_REF`), maintainer-bumped per release. The esbuild `define`-based override is ADR-15 / Phase 5 — a build-time source constant satisfies ADR-13's "pinned at build time" for now.
- **12 importScript skips burned down** (T2.3 re-enabled them on the binary contract). Remaining skips after Phase 2: **15** (disclosure → T3.4; settings → T4.2).
