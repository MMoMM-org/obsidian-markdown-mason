---
title: "Phase 6: Integration & verification"
status: completed
version: "1.0"
phase: 6
---

# Phase 6: Integration & verification

## Phase Context

**GATE**: Read all referenced files before starting this phase. Phases 4 and 5 must both be complete.

**Specification References**:
- `[ref: SDD/Quality Requirements]` — idempotency, single atomic edit, markdown-safety, all-on byte-identity, isolation, performance
- `[ref: SDD/Implementation Examples/Example 6: Test assertions as interface contracts]` — regression/omission/isolation/idempotency/all-off test patterns
- `[ref: SDD/CON-2]` — compliance sweep: `src/core/markdownBlocks.ts`, `src/core/cleanup.ts`, `src/core/lists.ts` carry zero `obsidian` imports; enforced by `test/compliance.test.ts`
- `[ref: SDD/CON-4]` — all-on byte-identity: new transforms contribute `[]` on clean notes
- `[ref: PRD Feature 7 / AC]` — all seven acceptance criteria for recipe integration and isolation (full compliance map)
- `[ref: PRD Feature 1-6 / AC]` — 31 acceptance criteria across the six transforms (correctness + markdown safety)
- `[ref: PRD Success Metrics]` — tracking table: regression, per-transform correctness, idempotency, markdown-safety, isolation, single-undo, manual smoke
- Existing code: `test/compliance.test.ts` (CON-2 purity sweep — must extend to cover three new core modules); `src/commands.ts` (fusedFormatNote, "Tidy footnotes"); all test files created in Phases 1-5

**Key Decisions**:
- The compliance sweep in `test/compliance.test.ts` must be extended (or verified to already cover) `markdownBlocks.ts`, `cleanup.ts`, and `lists.ts` — any `obsidian` import in those files must cause the test to fail.
- Full integration verification means: (a) every PRD AC maps to a passing test by name or fixture label; (b) the production build succeeds (`node esbuild.config.mjs production`); (c) a manual Obsidian smoke checklist passes.
- The plan README and spec README are updated to mark Phase 6 complete on success.
- No new production code is written in this phase — only test infrastructure, compliance extensions, and build verification. If gaps are found, they are fixed in the relevant previous phase's files (not by adding production code here).

**Dependencies**: Phases 4 and 5 (all production code complete).

---

## Tasks

- [x] **T6.1 Full gates: type-check, lint, test suite, compliance sweep, production build, manual smoke** `[activity: test-strategy]` _(automated gates + CON-2 sweep + 38/38 AC map + prod build all green; manual Obsidian smoke — 4 scenarios — passed 2026-06-29)_

  1. Prime: Read `test/compliance.test.ts` — understand the purity sweep mechanism. Read `[ref: SDD/Implementation Examples/Example 6]` for the exact test assertion patterns for each of the four integration scenarios (regression, omission, isolation, idempotency, all-off). Read `[ref: PRD Feature 7 / AC]` all 7 criteria. Read `[ref: PRD Feature 1-6 / AC]` — 31 criteria across the six transforms.
  2. Test (RED → verify GREEN):
     **Compliance sweep extension:**
     - Extend `test/compliance.test.ts` to assert that `src/core/markdownBlocks.ts`, `src/core/cleanup.ts`, and `src/core/lists.ts` contain no import from `"obsidian"` (static source scan). If the sweep already covers all `src/core/*.ts` files dynamically, verify it catches a synthetic `import ... from "obsidian"` injected into a copy of one of the new files.

     **PRD Feature 7 AC compliance map (all 7 criteria, each backed by a named test):**
     - AC 7.1 — All-on byte-identity: `fusedFormatNote(edClean, allOn)` returns `[]` on a structured clean note.
     - AC 7.2 — Per-step omission: disabling each of the 11 recipe keys individually omits exactly that step's effect; all other 10 still apply; result is one `Edit`.
     - AC 7.3 — All-off → `[]` and "Nothing to format" Notice path.
     - AC 7.4 — Individual-command isolation: each of the 6 new `RegistryEntry.run(ctx)` produces a non-empty plan on trigger-content with `allOff` settings.
     - AC 7.5 — API isolation: each `mason.cleanup.*` and `mason.lists.*` method produces a non-empty plan on trigger-content regardless of `formatSelection`.
     - AC 7.6 — Idempotency (composite): apply `fusedFormatNote` twice on the same text with the same settings; second result equals first result (fixpoint).
     - AC 7.7 — Markdown-structure preservation: run all 6 new transforms on a doc containing fenced code, indented code, ATX heading, setext heading, blockquote, list items, table row, thematic break, and YAML frontmatter; assert byte-identity for every structural line.

     **PRD Features 1-6 AC spot-check (verify each criterion has a named passing test):**
     - Enumerate every AC from PRD Features 1-6 (31 total); confirm each maps to a test assertion that is currently passing. Document the mapping as a comment block in the integration test file or as a checklist in this phase file.

     **Build gate:**
     - Run `node esbuild.config.mjs production` and confirm zero errors; confirm `main.js` is emitted.

     **Manual Obsidian smoke checklist (maintainer-run before merge):**
     - Paste a multi-line paragraph from a PDF (hard-wrapped, with an OCR hyphen split, a curly quote, and a `*` bullet) into a note. Select the pasted text. Run "Format selection". Verify: lines are joined into a paragraph; OCR hyphen is stitched; curly quote is ASCII; bullet is `-`. Undo once — full original content restored.
     - Open Settings → Mason → Format selection. Toggle "Dewrap paragraphs" off. Run "Format selection" on the same pasted text. Verify: lines are NOT joined (dewrap disabled); OCR hyphen IS stitched; other steps still apply.
     - Toggle all 11 toggles off. Run "Format selection". Verify: "Nothing to format" notice appears; document is unchanged.
     - Run "Dewrap paragraphs" as an individual command with dewrap toggled off in settings. Verify: paragraphs ARE joined (individual command ignores recipe).

  3. Implement (GREEN — production code only if gaps discovered):
     - If the compliance sweep does not already cover the three new modules, extend `test/compliance.test.ts` to include them.
     - If any PRD AC from Features 1-7 lacks a passing test, locate the gap in the relevant phase's test file and add the missing assertion there (not in a new file here).
     - If the production build fails, identify the error (TypeScript, import path, or esbuild external) and fix in the relevant source file.
     - No net-new production source files are created in this phase.

  4. Validate:
     - `npx tsc -noEmit -skipLibCheck` → zero errors.
     - `npx eslint src/` → zero errors.
     - `npx vitest run` → all tests green, including the compliance sweep for the three new core modules.
     - `node esbuild.config.mjs production` → zero errors; `main.js` emitted.
     - All 7 PRD Feature 7 ACs have named passing tests.
     - All 31 PRD Features 1-6 ACs have passing tests (documented in the compliance map).
     - Manual smoke checklist completed and all items pass.
  - Success: the complete implementation satisfies every documented PRD acceptance criterion; the production bundle builds without error; no `obsidian` import exists in any `src/core/` new module; the all-on byte-identity regression holds; idempotency holds for all six transforms and the composite; isolation holds; single-undo invariant holds `[ref: SDD/Quality Requirements; PRD Feature 7 / AC; PRD Success Metrics]`.

## Phase Validation

- `npx tsc -noEmit -skipLibCheck` → zero errors.
- `npx eslint src/` → zero errors.
- `npx vitest run` → zero failures; compliance sweep passes for `markdownBlocks.ts`, `cleanup.ts`, `lists.ts`.
- `node esbuild.config.mjs production` → zero errors; `main.js` emitted.
- PRD Feature 7 AC compliance map: all 7 ACs mapped to named passing tests.
- PRD Features 1-6 AC compliance map: all 31 ACs mapped to named passing tests.
- Manual smoke checklist: all 4 scenarios pass.
- Plan README phases checklist: all 6 phases marked `[x]`.
- Spec README updated to reflect `status: complete`.
