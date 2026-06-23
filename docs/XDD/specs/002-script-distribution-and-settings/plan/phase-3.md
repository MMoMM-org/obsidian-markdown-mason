---
title: "Phase 3: Module Envelope, Paste Chain & Disclosure"
status: in_progress
version: "1.0"
phase: 3
---

# Phase 3: Module Envelope, Paste Chain & Disclosure

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Internal API Changes]` — module envelope `{ run, paste? }`
- `[ref: SDD/Implementation Examples/buildPasteChain]`
- `[ref: SDD/ADR-16]` (envelope-only) and `[ref: SDD/ADR-14/Materializer]` (loaded code is already verified)
- Existing code: `src/scripts/loader.ts:193-220` (`loadScriptFresh`), `src/scripts/context.ts:73` (`ScriptFunction`), `src/parsers/detect.ts`, `src/scripts/library/perplexityAuto.ts`, `src/main.ts:142-153, 264-352` (paste command + fallback), `src/scripts/disclosure.ts`

**Key Decisions**:
- ADR-16: **envelope-only** — `loadScriptModule` returns `{ run, paste? }`; a module with no callable `run` is a load error (no bare-function fallback). `perplexity-auto` + `parsers/detect.ts` deleted.
- All paste ordering flows through one `buildPasteChain` (future `pasteOrder` overlay stays additive).
- Disclosure modal (`disclosure.ts`) is reused for the `Disclosing` state; consent writes the `okayed` record (from Phase 1).

**Dependencies**: Phase 1 (state/store), Phase 2 (materialized, verified code on disk).

---

## Tasks

This phase delivers the script contract, the data-driven paste autodetect, and the consent step — replacing the compiled-in detector.

- [ ] **T3.1 Envelope loader (`loadScriptModule`)** `[activity: backend-api]`

  1. Prime: Read `loadScriptFresh` (returns a function today) + the envelope contract `[ref: SDD/Internal API Changes; SDD/ADR-16]`.
  2. Test (RED): valid `{run, paste}` → returns both; `{run}` only → `paste` undefined; missing/`non-callable run` → **throws a load error**; prefix cache-evict behavior preserved (peer `.cjs` re-read).
  3. Implement (GREEN): Add `loadScriptModule(absolutePath, requireFn)` to `src/scripts/loader.ts` returning the validated envelope; keep the realpath escape guard and prefix cache-evict.
  4. Validate: update `test/scripts/loader.test.ts`; lint; types.
  - Success: envelope-only enforced `[ref: SDD/ADR-16]`; `run` is the unchanged `ScriptFunction` `[ref: context.ts:73]`.

- [ ] **T3.2 `buildPasteChain` ordering chokepoint** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: Read the buildPasteChain example + precedence rules `[ref: SDD/Implementation Examples/buildPasteChain; PRD/F10]`.
  2. Test (RED): only scripts with a `paste` block join; order = curated→imported, then priority desc, then id asc; a curated `canHandle:()=>true` is tried before any imported; command-only scripts never appear.
  3. Implement (GREEN): Create `src/scripts/paste/buildPasteChain.ts` (single sort function returning ordered handlers).
  4. Validate: unit tests cover ordering + shadowing; lint; types.
  - Success: imported catch-all cannot hijack a curated-claimed format `[ref: PRD/F10]`.

- [ ] **T3.3 Rewire `pasteAndFormat` to the chain; retire detector** `[activity: backend-api]`

  1. Prime: Read `main.ts` paste command (`:142-153`, hardcoded `perplexityAutoScript` `:326`, raw fallback `:343-348`) + `detect.ts` `[ref: SDD/Directory Map]`.
  2. Test (RED): paste builds the chain from **enabled** scripts and runs the first `canHandle` match via `ScriptRunner` with `source:"paste"`; no match → raw-paste + "no recognized format" notice (unchanged); blocked/disabled scripts excluded from the chain.
  3. Implement (GREEN): Update `src/main.ts` to call `buildPasteChain`; **delete** `src/parsers/detect.ts` and `src/scripts/library/perplexityAuto.ts` and their imports/registrations; remove the `perplexityAutoScript` selection command.
  4. Validate: update `test/main*.test.ts` and remove `test/parsers/detect.test.ts`; lint; types.
  - Success: autodetect is data-driven; `detect.ts`/`perplexity-auto` gone `[ref: PRD/F10, F11; SDD/ADR-16]`; raw fallback preserved `[ref: main.ts:343-348]`.

- [ ] **T3.4 Disclosure for the `Disclosing` state** `[activity: backend-api]` `[parallel: true]`

  1. Prime: Read `disclosure.ts` (`ScriptDisclosureModal`, `makeAskCallback`) + enable-implies-consent `[ref: PRD/F2; SDD/Runtime View]`.
  2. Test (RED): first enable shows the modal with `{version, checksum}`; accept writes `okayed` and proceeds; cancel/Esc/close → no run, prior state kept; re-enable with unchanged `{v,c}` → no modal; changed `{v,c}` → modal again.
  3. Implement (GREEN): Adapt `src/scripts/disclosure.ts` so the modal shows version+checksum and records the `okayed` record; ensure the lighter "already-ok" path uses `evaluateState`.
  4. Validate: update `test/scripts/disclosure.test.ts`; lint; types.
  - Success: disclosure on first-enable and every identity change only `[ref: PRD/F2]`.

- [ ] **T3.5 Phase Validation** `[activity: validate]`

  - Run all Phase 3 tests; `npm run lint`; `npm run compliance`. Verify `detect.ts`/`perplexityAuto.ts` are deleted and no import references remain.
