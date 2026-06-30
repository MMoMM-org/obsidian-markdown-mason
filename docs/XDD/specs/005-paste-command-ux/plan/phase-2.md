---
title: "Phase 2: Paste commands (rename + new command + script logging)"
status: completed
version: "1.0"
phase: 2
---

# Phase 2: Paste commands (rename + new command + script logging)

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Implementation Examples/Example 3: new command handler + frontmatter guard]`
- `[ref: SDD/Interface Specifications/Internal API Changes]` — rename; `runPasteAndFormatCommand`; `CommandInjection.replaceSelection`; 4a logging
- `[ref: SDD/Runtime View/Primary Flow]`, `[ref: SDD/Error Handling]`
- `[ref: SDD/ADR-26]` (fresh ids), `[ref: SDD/ADR-27]` (7-step subset + toggles), `[ref: SDD/ADR-28]` (logging)
- `[ref: PRD Feature 1 / AC]` (rename), `[ref: PRD Feature 2 / AC]` (new command), `[ref: PRD Feature 4 / AC]` (4a logging)
- Existing code: `src/main.ts` (`_registerPasteCommand` :549, `runPasteCommand`, `CommandInjection` :91, clipboard read + guards, the no-match/rawFallback path, `buildGatedLogger`), `src/commands.ts` (`countNoticeMessage`), `src/core/formatPipeline.ts` (Phase 1)

**Key Decisions**:
- Rename is name+id only; the existing `runPasteCommand` handler is untouched (ADR-26).
- The new command runs `applyTextCleanup` on `"\n" + rawText` then strips exactly one leading newline (frontmatter guard, G4), inserts via `replaceSelection` (one undo), respects toggles, and never runs scripts (ADR-25/27).
- A `CommandInjection.replaceSelection` seam makes the inserted text testable (G7).

**Dependencies**: Phase 1 (`applyTextCleanup`).

---

## Tasks

This phase delivers honest command naming, the new paste-and-clean command, and paste-script diagnosability.

- [x] **T2.1 Rename the paste-script command → "Paste and run scripts"** `[activity: build-feature]`

  1. Prime: Read `src/main.ts` `_registerPasteCommand` and `runPasteCommand`. Read `[ref: SDD/ADR-26]`. Grep the whole `test/` tree for the old id `mason.pasteAndFormat`.
  2. Test (RED): update/extend tests — command registers with id `mason.pasteAndRunScripts` and name "Paste and run scripts"; script-match conversion and no-match raw-fallback behavior are unchanged. Migrate ALL old-id references across `test/` (e.g. `test/main.commands.test.ts`, `test/scripts/integration.test.ts`, `test/invariants.test.ts`, `test/e2e/scriptLifecycle.e2e.test.ts`).
  3. Implement (GREEN): In `src/main.ts`, change the command `id` → `mason.pasteAndRunScripts` and `name` → "Paste and run scripts". No handler/behavior change.
  4. Validate: full `npx vitest run` (no stale-id references remain); `tsc -noEmit`; `eslint`.
  - Success: paste-script command renamed; behavior identical; no test references the old id `[ref: PRD Feature 1 / AC; SDD/ADR-26]`.

- [x] **T2.2 New "Paste and format" command + `replaceSelection` test seam** `[activity: build-feature]`

  1. Prime: Read `[ref: SDD/Implementation Examples/Example 3]`, `[ref: SDD/Runtime View]`, `[ref: SDD/Error Handling]`. Review `runPasteCommand`'s clipboard read + empty/unavailable guards to reuse them. Confirm `applyTextCleanup` (Phase 1) and `resolveFormatSelectionRecipe`/`countNoticeMessage` imports.
  2. Test (RED): a new command test (e.g. `test/main.pasteAndFormat.test.ts`) using a `clipboardReader` + `replaceSelection` injection:
     - Artifact-laden clipboard → inserted text is de-wrapped, hyphen-stitched, ASCII punctuation, `-` bullets (7 steps applied).
     - Respects toggles: with `dewrap:false`, lines are not joined; other steps still apply.
     - Does NOT run paste scripts (no script side-effects even when scripts are enabled).
     - Single insert (one `replaceSelection` call → one undo).
     - `---`-first-line snippet is cleaned, not skipped as frontmatter (G4).
     - No-change clipboard → still inserts raw; notice "Mason: pasted (nothing to clean up)" (never "Nothing to format").
     - Empty / unavailable clipboard → guard notice; no insert.
     - Active selection → formatted text replaces the selection.
  3. Implement (GREEN): In `src/main.ts`, add `runPasteAndFormatCommand(editor, settings, injection)` per SDD Example 3 and register it via `_registerPasteAndFormatCommand` with id `mason.pasteAndFormatText`, name "Paste and format". Add `replaceSelection?: (text: string) => void` to `CommandInjection`. Use `applyTextCleanup("\n"+raw, recipe, gatedLog).replace(/^\n/, "")`; insert via `injection.replaceSelection ?? editor.replaceSelection`.
  4. Validate: tests pass; full `npx vitest run`; `tsc -noEmit`; `eslint`.
  - Success: command pastes + applies the 7 cleanup steps scoped to the paste, one undo, respects toggles, never runs scripts, handles all edge cases `[ref: SDD/Example 3; SDD/ADR-25,26,27; PRD Feature 2 / AC]`.

- [x] **T2.3 Paste-script diagnostic logging (4a)** `[activity: build-feature]`

  1. Prime: Read `runPasteCommand`'s chain-building + `canHandle` dispatch and the existing `buildGatedLogger`/`debug` usage. Read `[ref: SDD/ADR-28]` and `[ref: PRD Feature 4 / AC]`.
  2. Test (RED): with `debugLogging` on, running "Paste and run scripts" logs, for each enabled script, its id + `canHandle` result, and the matched handler id on success; with `debugLogging` off, nothing extra is logged; clipboard text is never logged.
  3. Implement (GREEN): In `runPasteCommand`, gated by `debugLogging`, emit `paste: <id> canHandle=<bool>` per enabled script and `paste: matched <id>` on a match. Log only ids/booleans (never `rawText`).
  4. Validate: tests pass; `tsc -noEmit`; `eslint`.
  - Success: the no-match outcome is diagnosable; logging is debug-gated and content-free `[ref: SDD/ADR-28; PRD Feature 4 / AC]`.

## Phase Validation

- `npx vitest run` green; `tsc -noEmit -skipLibCheck` + `eslint src/` clean.
- Both commands registered with correct ids/names; new command does the 7-step scoped cleanup with one undo; rename preserves behavior; no old-id references remain.
- Paste-script logging present, debug-gated, content-free.
