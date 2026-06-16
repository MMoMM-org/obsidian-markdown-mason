---
title: "Phase 5: Script Runtime & Trust"
status: pending
version: "1.0"
phase: 5
---

# Phase 5: Script Runtime & Trust

## Phase Context

**GATE**: Read before starting.

**Specification References**:
- `[ref: SDD/Cross-Cutting — Security]` `[ref: SDD/ScriptContext]` `[ref: SDD/Storage schema]`
- `[ref: SDD/ADR-3, ADR-4, ADR-6, ADR-10]` `[ref: PRD/Feature 8,9]`
- `https://github.com/MMoMM-org/miyo-tomo-hashi` `src/hooks/` (loader/runner/disclosure)

**Key Decisions**:
- Port hashi runtime (ADR-3); consent per checksum/version (ADR-4); plugin-dir + sidecar (ADR-6);
  explicit-invoke paste (ADR-10).

**Dependencies**: Phase 3 (`mason.*` API + applyEditPlan) and Phase 4 (the scripts to run).

---

## Tasks

Delivers the engine that loads, gates, and runs user scripts, plus the v0.1 Perplexity scripts.

- [ ] **T5.1 Script loader (ported)** `[activity: backend-api]`
  1. Prime: hashi `FsHookLoader.ts` / `loadHookFresh` `[ref: SDD/ADR-3]`
  2. Test: resolves `.cjs` in the plugin script dir; fresh-load via `createRequire`; evicts `require.cache` by directory prefix (stale-helper test); returns `{size, mtimeMs}` fingerprint; rejects a path escaping the script dir (realpath guard).
  3. Implement: `src/scripts/loader.ts`.
  4. Validate: unit tests incl. helper-eviction and escape-guard.
  - Success: `[ref: SDD/Implementation Gotchas; PRD/AC F8.3]`

- [ ] **T5.2 Script runner — policy, timeout, fallback** `[activity: backend-api]`
  1. Prime: hashi `HookRunner.ts` `[ref: SDD/Error Handling]`
  2. Test: `enabled|disabled|ask`; `disabled` blocks execution (kill-switch); async timeout aborts; a throwing/timed-out script leaves input intact (raw fallback) and reports a Notice; returned EditPlan applied via `applyEditPlan`.
  3. Implement: `src/scripts/runner.ts` + `src/scripts/context.ts` (`ScriptContext` with `mason` API).
  4. Validate: unit tests for each policy + failure path.
  - Success: `[ref: PRD/AC F8.1,F8.2,F8.4]`

- [ ] **T5.3 Consent: disclosure modal + per-checksum/version store** `[activity: frontend-ui]`
  1. Prime: hashi `HookDisclosureModal.ts` `[ref: SDD/ADR-4]`
  2. Test: first run at a checksum/version shows the full-privilege disclosure; acknowledgement persists per (script, checksum, version); fingerprint change re-prompts; Esc = cancel; vetted-repo scripts use the lighter enable path.
  3. Implement: `src/scripts/disclosure.ts` (Modal + consent store, XSS-safe rendering).
  4. Validate: unit/integration tests with mock App.
  - Success: `[ref: PRD/AC F8.5; SDD/ADR-4]`

- [ ] **T5.4 Store: data.json manifest + per-device sidecar** `[activity: data-architecture]`
  1. Prime: `[ref: SDD/Storage schema; ADR-6]`
  2. Test: manifest `{source,checksum,version}` in `data.json`; `enabled`/`consent` in `device.json` via `vault.adapter` (NOT plugin data); drift (same version, different checksum) hard-blocks until resolved.
  3. Implement: `src/scripts/store.ts`.
  4. Validate: unit tests incl. drift hard-block.
  - Success: `[ref: PRD/AC F10 drift; SDD/ADR-6]`

- [ ] **T5.5 Vault import + command binding + paste invocation** `[activity: backend-api]`
  1. Prime: `[ref: SDD/Runtime View; ADR-10]` `[ref: PRD/Feature 8]`
  2. Test: import a `.cjs` from a vault path into the script dir (checksum recorded); a bound script registers a `Mason:` command and runs on selection; paste invocation runs an enabled paste-script via `editor-paste` (explicit command in v0.1) with raw fallback on error.
  3. Implement: import flow + binding in `src/main.ts`; `src/sources/paste.ts`.
  4. Validate: integration tests with mock App/editor.
  - Success: `[ref: PRD/AC F8.1,F8.2]`

- [ ] **T5.6 The v0.1 Perplexity scripts** `[activity: backend-api]`
  1. Prime: Phase 4 parsers + `mason.*` `[ref: PRD/Feature 9; SDD/ADR-9]`
  2. Test: `perplexity-app/web/web-download` `.cjs` each compose parser→`mason.headings.cascade`→`identity`→`move` and produce the golden output for their fixture; `perplexity-auto` routes via `detect` and delegates.
  3. Implement: the four `.cjs` scripts shipped under the official-source layout (also usable via import).
  4. Validate: E2E-ish test: fixture in → expected structured note out.
  - Success: `[ref: PRD/AC F9.2,F9.3]`

- [ ] **T5.7 Phase Validation** `[activity: validate]`
  - Runtime + consent + store + scripts tests green; kill-switch and drift hard-block verified; lint + typecheck clean.
