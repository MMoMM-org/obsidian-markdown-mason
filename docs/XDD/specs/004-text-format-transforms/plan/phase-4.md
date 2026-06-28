---
title: "Phase 4: Command wiring, registry & API"
status: pending
version: "1.0"
phase: 4
---

# Phase 4: Command wiring, registry & API

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Implementation Examples/Example 4: Extended fusedFormatNote]` — complete 11-step pipeline; scratch-string gate pattern; cascade null-guard; `{ ...ctx, doc: sN }` per step
- `[ref: SDD/Implementation Examples/Example 5: Registry entries + extended MasonApi]` — six `RegistryEntry` factories; `MasonApi` `cleanup` and `lists` namespaces; `buildApi()` additions
- `[ref: SDD/ADR-21]` — step order rationale: dehyphenate(1) → dewrap(2) → tidyWhitespace(3) → decomposeLigatures(4) → normalizeBullets(5) → normalizeOrdered(6) → normalize(7) → cascade(8) → tidyFootnotes(9)
- `[ref: SDD/ADR-19]` — only `fusedFormatNote` reads the recipe; individual commands and API methods do not
- `[ref: SDD/ADR-24]` — full built-in exposure: command + API + recipe toggle for each transform
- `[ref: SDD/Cross-Cutting Concepts]` — `EMPTY_NOTICES` map pattern; command names sentence-case; registry id strings
- `[ref: SDD/Runtime View]` — primary flow; offset fusion ordering (item 9 in Implementation Gotchas)
- `[ref: SDD/Risks and Technical Debt/Implementation Gotchas]` — item 9 (offset fusion: every step must use `{ ...ctx, doc: sN }`)
- `[ref: PRD Feature 7 / AC]` — all-on byte-identity; per-step omission; all-off → "Nothing to format"; isolation; idempotency
- Existing code: `src/commands.ts` (`fusedFormatNote` implementation, `selectionContext`, `applyToString` import, `resolveFormatSelectionRecipe` import, `cascadeSelectionPlan`, `buildRegistry`, `diffToEditPlan`, `EMPTY_NOTICES` map, "Tidy footnotes" command); `src/core/registry.ts` (`RegistryEntry`, `buildEntries`, `buildApi`, `MasonApi`, `buildRegistry`); `src/core/applyToString.ts`

**Key Decisions**:
- `fusedFormatNote` gains exactly 6 new gated scratch-string steps prepended before the existing step 7 (normalize). The cascade null-guard pattern (`if (recipe.cascade && ctx.selection !== undefined)`) is preserved unchanged. The final `diffToEditPlan(original, s9)` is unchanged. Each new step follows `recipe.<key> ? applyToString(sN, transform({ ...ctx, doc: sN })) : sN` exactly (ADR-21, SDD Example 4).
- Every new import into `src/commands.ts` is from `./core/cleanup` and `./core/lists` — never from `obsidian` (CON-2 does not constrain `commands.ts`, but the import path must be correct).
- Six new `RegistryEntry` factories in `src/core/registry.ts` follow the identical shape as existing factories. `MasonApi` gains `cleanup` and `lists` namespaces; `buildApi()` adds them.
- `EMPTY_NOTICES` in `src/commands.ts` gains 6 new entries keyed by registry id: `"cleanup.dewrap"`, `"cleanup.dehyphenate"`, `"cleanup.decomposeLigatures"`, `"cleanup.tidyWhitespace"`, `"lists.normalizeBullets"`, `"lists.normalizeOrdered"`.
- Isolation is structural: `RegistryEntry.run(ctx)` delegates directly to the pure transform; it reads no `MasonSettings.formatSelection`.

**Dependencies**: Phases 2 and 3 (all six transform functions must exist). Phase 1 (extended resolver and recipe type).

---

## Tasks

- [ ] **T4.1 Extend `fusedFormatNote` to the 11-step gated pipeline** `[activity: build-feature]`

  1. Prime: Read `src/commands.ts` in full — find `fusedFormatNote`, `selectionContext`, the cascade null-guard, `diffToEditPlan`, `EMPTY_NOTICES`, and the "Tidy footnotes" command (confirm it calls `tidyFootnotes(ctx)` with no include arg — must NOT change). Read `[ref: SDD/Implementation Examples/Example 4]` — the complete new `fusedFormatNote` body including the exact variable names `s1`–`s9`, import lines, and offset-fusion comment. Read `[ref: SDD/ADR-21]` for ordering rationale. Read `[ref: SDD/Risks and Technical Debt/Implementation Gotchas]` item 9 — each step receives `{ ...ctx, doc: sN }`.
  2. Test (RED): `test/commands/formatSelection.test.ts` — extend existing test file:
     - All-11-on regression: run `fusedFormatNote` on a clean structured note (no pasted artifacts); result is `[]` (byte-identical to pre-004 — new transforms contribute `[]` when their conditions are absent).
     - Per-step omission: disable each of the 6 new recipe keys one at a time; for a fixture that triggers that step, the disabled step's effect is absent and all other enabled steps still apply.
     - All-off (`formatSelection: {cascade:false, normalize:false, fromCitations:false, identity:false, move:false, dewrap:false, dehyphenate:false, decomposeLigatures:false, tidyWhitespace:false, normalizeBullets:false, normalizeOrdered:false}`) → returns `[]`.
     - Atomicity: any non-empty result is exactly one `Edit` (length ≤ 1 assertion on the returned `EditPlan`).
     - Single-edit: a fixture triggering all 6 new steps → result is still exactly one `Edit` (offset fusion via `diffToEditPlan`).
     - Live-effect: call `fusedFormatNote` with `dewrap:true`, capture result; flip `settings.formatSelection.dewrap = false` on the SAME settings object; call again → result excludes dewrap effect (fresh-read-per-invocation invariant).
     - "Tidy footnotes" command: confirm it still calls `tidyFootnotes(ctx)` with no include arg and is unchanged.
  3. Implement (GREEN): In `src/commands.ts`, add imports for `dewrap, dehyphenate, decomposeLigatures, tidyWhitespace` from `./core/cleanup` and `normalizeBullets, normalizeOrdered` from `./core/lists`. Rewrite `fusedFormatNote` body to prepend steps 1-6 (dehyphenate → dewrap → tidyWhitespace → decomposeLigatures → normalizeBullets → normalizeOrdered) before existing steps 7-9, per the SDD Example 4 reference. Each step uses `{ ...ctx, doc: sN }`. Add 6 new entries to `EMPTY_NOTICES` using the registry id strings. Do NOT change the "Tidy footnotes" command.
  4. Validate: tests pass; `tsc -noEmit`; `eslint`. Run the full existing test suite — zero regressions. Confirm "Tidy footnotes" test still passes.
  - Success: all-on is byte-identical to pre-004; per-step omission works; all-off is `[]`; result is always 0 or 1 edit; live-read invariant holds `[ref: SDD/Implementation Examples/Example 4; SDD/ADR-21; PRD Feature 7 / AC]`.

- [ ] **T4.2 Six `RegistryEntry` factories + extend `MasonApi`** `[activity: build-feature]`

  1. Prime: Read `src/core/registry.ts` in full — existing `RegistryEntry` shape, `buildEntries()`, `buildApi()`, `MasonApi` interface. Read `[ref: SDD/Implementation Examples/Example 5]` — the six factory functions and the extended `MasonApi` interface with `cleanup` and `lists` namespaces. Note: each factory's `run(ctx)` calls the pure transform directly and reads NO settings.
  2. Test (RED): add to the registry tests (or create `test/core/registry.test.ts` if none exists):
     - `buildEntries()` returns entries including ids `"cleanup.dewrap"`, `"cleanup.dehyphenate"`, `"cleanup.decomposeLigatures"`, `"cleanup.tidyWhitespace"`, `"lists.normalizeBullets"`, `"lists.normalizeOrdered"`.
     - Each entry's `command.name` is sentence-case as specified: `"Dewrap paragraphs"`, `"Dehyphenate words"`, `"Decompose ligatures and punctuation"`, `"Tidy whitespace"`, `"Normalize bullets"`, `"Normalize ordered list"`.
     - `buildApi()` returns an object with `cleanup.dewrap`, `cleanup.dehyphenate`, `cleanup.decomposeLigatures`, `cleanup.tidyWhitespace`, `lists.normalizeBullets`, `lists.normalizeOrdered` callable methods.
     - Each `api.cleanup.*` and `api.lists.*` method executes fully on a doc with matching content regardless of settings (isolation — no recipe read in registry path).
     - Existing registry ids and API namespaces (`headings.*`, `footnotes.*`) are untouched.
  3. Implement (GREEN): In `src/core/registry.ts`, add imports for `dewrap, dehyphenate, decomposeLigatures, tidyWhitespace` from `./cleanup` and `normalizeBullets, normalizeOrdered` from `./lists`. Add the six factory functions per SDD Example 5. Call them in `buildEntries()`. Extend `MasonApi` interface with `cleanup` and `lists` namespaces. Extend `buildApi()` to build those namespaces from the pure transform functions. Zero net change to existing entries/namespaces.
  4. Validate: registry tests pass; `tsc -noEmit`; `eslint`. Confirm existing `mason.headings.*` and `mason.footnotes.*` API is unchanged.
  - Success: 6 new entries in registry; 6 new API methods callable; command names sentence-case; ADR-19 isolation structural — `run(ctx)` reads no recipe `[ref: SDD/Implementation Examples/Example 5; SDD/ADR-24; SDD/ADR-19]`.

- [ ] **T4.3 Isolation tests: individual commands + `mason.*` API + "Tidy footnotes" unaffected** `[activity: test-strategy]`

  1. Prime: Re-read `[ref: SDD/ADR-19]` and `[ref: SDD/ADR-24]`. Read the "Tidy footnotes" command in `src/commands.ts` — it calls `tidyFootnotes(ctx)` with no include arg and must remain so. Review the `mason.*` API output from T4.2.
  2. Test (RED): add isolation tests to `test/commands/formatSelection.test.ts` or a dedicated `test/commands/isolation.test.ts`:
     - With `settings.formatSelection` set to all-off, each of the six new commands (invoked via their `RegistryEntry.run(ctx)`) produces a non-empty `EditPlan` on a doc containing their trigger content (e.g. `dewrap.run(ctx)` on a multi-line paragraph → non-empty plan, regardless of recipe).
     - `mason.cleanup.dewrap(ctx)` on a multi-line paragraph → non-empty plan regardless of `settings.formatSelection`.
     - `mason.lists.normalizeBullets(ctx)` on a `*` bullet list → non-empty plan regardless of `settings.formatSelection`.
     - All five existing spec-003 individual commands (cascade, normalize, fromCitations, identity, move) produce identical results with and without the six new recipe keys set to `false`.
     - "Tidy footnotes" command output is identical regardless of the `formatSelection` field value.
  3. Implement (GREEN): no production change expected — these tests verify the structural isolation already established in T4.1 and T4.2. If any leakage is found (a command or API method accidentally reads `formatSelection`), fix by removing the recipe read from that path.
  4. Validate: all isolation tests pass; `tsc -noEmit`; `eslint`.
  - Success: recipe toggles affect ONLY `fusedFormatNote`; every individual command and API method is fully recipe-blind; "Tidy footnotes" is unchanged `[ref: SDD/ADR-19; PRD Feature 7 / AC — isolation; PRD Feature 7 / AC — "Tidy footnotes" unaffected]`.

## Phase Validation

- `npx vitest run` green for all command, registry, and isolation tests.
- `npx tsc -noEmit -skipLibCheck`; `npx eslint src/` — both clean.
- All-11-on regression fixture returns `[]` on a clean structured note.
- "Tidy footnotes" command behavior demonstrably unchanged.
- Existing spec-003 individual commands and `mason.*` API are demonstrably recipe-blind.
