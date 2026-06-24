---
title: "Phase 5: Dev Override, Catalog Migration & E2E"
status: in_progress
version: "1.0"
phase: 5
---

# Phase 5: Dev Override, Catalog Migration & E2E

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/ADR-15]` — dev-override via build-time DCE (`__MASON_DEV__`)
- `[ref: SDD/Deployment View]` — pinned-SHA release flow, rollback
- `[ref: SDD/Directory Map]` — vetted-repo `index.json` + envelope scripts
- `[ref: PRD/Detailed Feature Specifications]` — cross-device + Blocked recovery flows
- Existing code: `esbuild.config.mjs` (no `define` today), `src/scripts/library/perplexity{App,Web,WebDownload}.ts` + `src/parsers/perplexity*.ts` (logic to migrate), `test/e2e/happyPath.e2e.test.ts`

**Key Decisions**:
- ADR-15: `__MASON_DEV__` esbuild `define` (literal `false` in prod) gates `devDirAdapter`; prod bundle physically omits it; override never in `data.json`.
- ADR-16: the three Perplexity scripts become envelope `.cjs` catalog entries (priorities app 300 / web-download 200 / web 100); the plugin copies are deleted.
- Distribution: a plugin release pins the catalog SHA (script published first, then release).

**Dependencies**: Phases 1-4 (full lifecycle, materializer, chain, UI).

---

## Tasks

This phase delivers the developer loop, the production-safety build guarantee, the migrated curated catalog, and end-to-end proof of the headline flows.

- [x] **T5.1 Build flag + `devDirAdapter` (DCE)** `[activity: build-platform]`

  1. Prime: Read ADR-15 + the DCE gotcha `[ref: SDD/ADR-15; SDD/Implementation Gotchas]`; current `esbuild.config.mjs:43-69`.
  2. Test (RED): dev build with override configured → curated code read from the local working-tree dir via `devDirAdapter`; a **prod-bundle assertion test** confirms the built `main.js` string contains no dev-adapter marker; override value is never written to `data.json`.
  3. Implement (GREEN): Add `define: { __MASON_DEV__: isProd ? "false" : "true" }` to `esbuild.config.mjs`; create `src/scripts/catalog/devDirAdapter.ts` guarded by `if (__MASON_DEV__)`; read the override from a gitignored dev config / env var.
  4. Validate: unit + prod-bundle test; `npm run build`; lint; types.
  - Success: dev reads local dir; prod physically omits the path `[ref: PRD/Should; SDD/ADR-15]`.

- [x] **T5.2 Migrate Perplexity scripts to catalog entries** `[activity: domain-modeling]`

  1. Prime: Read each `parsers/perplexity*.ts` `canParse` + `library/perplexity*.ts` `run` + the migration note `[ref: SDD/Directory Map; PRD/F11]`.
  2. Test (RED): each migrated envelope exports `{ run, paste:{canHandle, priority} }` with `canHandle === canParse` behavior and the correct priority; an `index.json` with `{version, checksum, path}` validates against the catalog schema; checksums are byte-exact over the published `.cjs`.
  3. Implement (GREEN): Produce the three envelope `.cjs` + `index.json` (in the vetted repo / a fixtures dir for tests); **delete** `src/scripts/library/perplexity*.ts` and `src/parsers/perplexity*.ts` from the plugin once the catalog path is proven; embed the pinned SHA.
  4. Validate: catalog-load + per-script paste tests (reuse existing parser fixtures); lint; types.
  - Success: curated scripts are catalog entries, not compiled in `[ref: PRD/F11; SDD/ADR-16]`; autodetect order preserved `[ref: PRD/F10]`.

- [ ] **T5.3 End-to-end & integration tests** `[activity: test-strategy]`

  1. Prime: Read the cross-device + Blocked-recovery specs `[ref: PRD/Detailed Feature Specifications; SDD/Runtime View]`; existing `test/e2e/happyPath.e2e.test.ts`.
  2. Test (RED) — with fake `CatalogSource` + in-memory adapters:
     - **Full curated lifecycle**: Available→disclose→materialize→Active→run via paste→disable→remove→Available.
     - **Device-B materialization**: synced record + absent code → materialize on match → Active, **no disclosure**; offline → Blocked(offline) → retry → Active.
     - **Drift**: tampered bytes (same version) → Blocked(drift) → re-review → Active.
     - **Import lifecycle**: import→disclose→Active; source removed → Blocked(source-missing) → re-import.
     - **Update**: catalog version bump → UpdateAvailable → update→re-disclose→Active.
     - **Nothing auto-enables** on fresh load; paste with no match → raw fallback.
  3. Implement (GREEN): Add `test/e2e/scriptLifecycle.e2e.test.ts` + integration wiring; reuse fakes from Phases 1-2.
  4. Validate: `npm test` (full suite green); `npm run compliance`; lint; types.
  - Success: all headline PRD flows proven end-to-end `[ref: PRD/F1-F6, F10, F11]`.

- [ ] **T5.4 Release & docs** `[activity: document]` `[parallel: true]`

  1. Prime: Read the deployment/rollback flow + community-compliance constraints `[ref: SDD/Deployment View; SDD/CON-2]`.
  2. Test (RED): `npm run check:manifest` passes; `npm run build` produces a lean `main.js` (no curated bodies / no `detect.ts`); release-asset attestation step documented.
  3. Implement (GREEN): Document the publish-script-then-pin-SHA release flow + the dev-override setup; update README/manifest as needed; record the parked `pasteOrder` overlay as a GitHub issue.
  4. Validate: manifest check + build; docs reviewed.
  - Success: reproducible release flow; `main.js` leaner `[ref: PRD value prop; SDD/Deployment View]`.

- [ ] **T5.5 Final Validation** `[activity: validate]`

  - Run the **entire** suite (`npm test`), `npm run lint`, `npm run compliance`, `npm run build`. Walk the PRD→Phase coverage map and confirm every acceptance criterion is exercised by a test. Record any deviations.
