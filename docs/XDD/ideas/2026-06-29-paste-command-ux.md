# Idea: Paste command UX (spec 005)

**Date:** 2026-06-29
**Status:** Validated design — ready for `/xdd`
**Builds on:** spec 004 (text-format-transforms — implemented; six markdown-aware cleanup transforms + 11-step "Format selection" recipe).

## Problem

During spec-004 smoke testing, the command **"Paste and format"** was found to be misleading. It only runs the enabled paste-converter **scripts** (the `canHandle` chain — e.g. Perplexity/citation converters); when no script matches it raw-pastes with a terse *"no recognized format — pasted as-is"* notice. Two problems surfaced:

1. The name "Paste and format" implies general text formatting, but it does **not** run the spec-004 cleanup recipe. That recipe is reachable only via the **"Format selection"** command (ADR-19: only `fusedFormatNote` reads the recipe; the paste flow is isolated).
2. The no-match outcome is undiagnosable — the log shows only a clipboard read; the user can't tell which scripts were considered or why none fired.

There is also no single command to **paste raw text and immediately clean it up** with the cleanup recipe — the common "drop in messy PDF/web text and tidy it" flow.

## Goals

- Disambiguate the paste commands so each name honestly describes what it runs.
- Add a true "paste and clean up" command using the spec-004 cleanup transforms, scoped to the pasted text.
- Make both the paste-script selection AND the cleanup recipe pipeline diagnosable via debug logging (today the Format-selection command logs nothing — a no-op run is indistinguishable from a broken one).
- Document the distinction clearly (settings copy already partially does; user docs do not).

## Non-goals (parking lot)

- A combined "paste → run scripts → then run cleanup" smart command (rejected: blurs the two commands).
- Making the cleanup transforms range-aware for in-place selection cleanup (the new command formats the clipboard string in isolation instead).
- Per-command toggle overrides (the new command reuses the single `FormatSelectionRecipe`).

## Approaches considered

- **Chosen — extract a shared pure helper.** Pull the 7 self-contained cleanup steps out of `fusedFormatNote` into a pure core function reused by both the existing recipe command and the new paste command. DRY, pure, testable, scopes naturally to a snippet. Selected because the 7 steps are *already* steps 1–7 of `fusedFormatNote`; only steps 8–9 (cascade, footnotes) are document-contextual.
- *Rejected — inline composition in the new command:* duplicates the gate/scratch-string chaining from `fusedFormatNote`.
- *Rejected — insert-then-range-format in the editor:* would require teaching the whole-note transforms range-awareness; invasive and risks touching pre-existing content.

## Design

### Component 1 — Rename existing command (a)

`src/main.ts`: the existing paste-script command becomes:
- **id:** `mason.pasteAndRunScripts` (was `mason.pasteAndFormat`)
- **name:** "Paste and run scripts" (was "Paste and format")
- **behavior:** unchanged (enabled paste-script `canHandle` chain; raw fallback if none match).

Update all internal references and tests that use the old id. The plan task should **grep for `mason.pasteAndFormat` across all of `test/`** rather than enumerate files (~20+ cases span at least `test/main.commands.test.ts`, `test/scripts/integration.test.ts`, `test/invariants.test.ts`, `test/e2e/scriptLifecycle.e2e.test.ts`). Id change is acceptable — no install base ([[no-backcompat-without-install-base]]).

### Component 2 — Shared pure cleanup helper (refactor)

New **pure** core function (zero `obsidian` import — CON-2), e.g. in `src/core/formatPipeline.ts`:

```
applyTextCleanup(doc: string, recipe: FormatSelectionRecipe): string
```

Runs the **7 gated cleanup steps in order**, each gated by its recipe key, chained via `applyToString` on scratch strings:

1. dehyphenate → 2. dewrap → 3. tidyWhitespace → 4. decomposeLigatures → 5. normalizeBullets → 6. normalizeOrdered → 7. normalize (headings)

Context construction for each transform uses a minimal `OperationContext` with `cursor: 0` (the 7 transforms read only `ctx.doc`; confirmed none reads cursor/selection/input/settings). The function takes the full 11-key `FormatSelectionRecipe` but ignores the 4 non-cleanup keys (cascade, fromCitations, identity, move) — document this so callers aren't surprised.

`fusedFormatNote` (`src/commands.ts`) is refactored to call `applyTextCleanup(original, recipe)` for steps 1–7, then keep cascade (8) + tidyFootnotes (9) on top. **Must be byte-identical** to the current behavior — gated by a regression test (see Testing).

> Terminology note for the SDD/plan: the pipeline has **9 transform stages** (the 7 cleanup steps + cascade + tidyFootnotes) but the `FormatSelectionRecipe` exposes **11 toggles** (cascade, normalize, fromCitations, identity, move + the 6 spec-004 keys) — the 3 footnote toggles (fromCitations/identity/move) all gate the single tidyFootnotes stage. "Paste and format" uses 7 of those toggles.

### Component 3 — New "Paste and format" command (d)

`src/main.ts`: new command
- **id:** `mason.pasteAndFormatText`
- **name:** "Paste and format"
- **behavior:**
  1. Read clipboard (reuse the existing `readClipboard` + empty/unavailable guards).
  2. `formatted = applyTextCleanup("\n" + rawText, resolveFormatSelectionRecipe(settings))` then strip the leading `\n` — the prepended newline prevents a snippet whose first line is `---` from being misclassified as YAML frontmatter by `segmentBlocks` (frontmatter is only recognized at line 0). [G4]
  3. Insert via `editor.replaceSelection(formatted)` — single transaction, **one undo**, scoped to the pasted text (replaces an active selection if present; inserts at cursor otherwise).
  - **Does NOT run paste scripts.** Respects the same toggles via `resolveFormatSelectionRecipe`.
- **Notices** [G5]: keep a SIMPLE notice — if cleanup changed the text (`formatted !== rawText`) → `countNoticeMessage(N)` style ("Mason: N change(s)"); if no cleanup was needed → "Mason: pasted (nothing to clean up)". Never "Nothing to format" (a paste always happened). Empty/unavailable clipboard → existing guard notices. The **per-step breakdown** (which transforms fired / were skipped) goes to the **debug log** (component 4b), NOT the notice — the user confirmed the plain notice is the right user-facing signal.

### Component 4 — Diagnostic logging (c)

All logging is gated by `settings.debugLogging`. Two paths get instrumented:

**4a. Paste-script path** (the "Paste and run scripts" command, `src/main.ts`):
- For each enabled script in the built chain, log its id and `canHandle(rawText)` result.
- On success, log the matched handler id.
- **Never log the clipboard contents** — only the boolean result and the handler id (carry forward the existing `rawText.length`-only convention). [G8]

This makes the "no recognized format" outcome diagnosable (which scripts were considered, why each declined).

**4b. Recipe pipeline path** (the `fusedFormatNote` / `applyTextCleanup` chain — used by both "Format selection" and the new "Paste and format"):
- Currently the Format-selection command path has **zero** diagnostic logging — `commands.ts` only logs a startup "registered N commands" line. Running "Format selection" tells the user nothing, even with `debugLogging` on. This was a real pain point during spec-004 smoke testing (a no-op run is indistinguishable from a broken one).
- Add per-step `debug()` traces in the pipeline: for each step, log whether it was **skipped (toggle off)** or ran and how many edits it produced, e.g. `format: dewrap skipped (toggle off)`, `format: decomposeLigatures 2 edits`, and a final-result line (`format: 1 change` / `format: nothing to change`).
- The natural home is `applyTextCleanup` (logs the 7 cleanup steps for both commands) plus the cascade/footnote stages in `fusedFormatNote`. Since `applyTextCleanup` is a pure core fn (CON-2, no `obsidian`), pass logging in via an injected logger callback (or return per-step counts the caller logs) rather than importing a logger into core — keep core pure. The exact seam is an SDD decision.
- **Never log document/clipboard contents** — only step names, skipped/ran status, and edit counts.

### Component 6 — Settings marker for steps "Paste and format" skips (user request)

In `_renderFormatSelectionSection` (`src/ui/settingsTab.ts`), visually mark the toggles that **"Paste and format" does NOT run**, so the 7-vs-11 distinction is obvious in the UI. "Paste and format" runs the 7 cleanup steps (all of Cleanup + all of Lists + "Normalize headings"); it does **not** run **cascade** (Headings group) or the 3 **Footnotes** toggles (fromCitations, identity, move).

- Append a short clause to those four toggles' `setDesc`, e.g. *"Format selection only — not applied by Paste and format."* on cascade, fromCitations, identity, move.
- Keep "Normalize headings" and all Cleanup/Lists toggles unmarked (they ARE applied by both).
- Optionally add a one-line intro under the section desc: *"'Paste and format' runs the Cleanup, Lists, and Normalize-headings steps only; 'Format selection' runs all of these."* (This also satisfies [G6] — the section copy now names both commands.)
- Pure-ish UI change; no new API, sentence-case copy, no custom DOM (reuse existing `setDesc`).

### Component 5 — Documentation (b)

Update user-facing docs to disambiguate the three entry points and **explicitly document the step-subset difference** (the user emphasized this):

- Root `README.md` — Features bullet, Quick start step, Commands table, clipboard-permission note.
- `docs/commands-reference.md`, `docs/usage.md`, `docs/configuration.md`, and a `docs/troubleshooting.md` entry for the "pasted as-is / why didn't it format" confusion.
- `src/ui/settingsTab.ts` settings copy is handled in **Component 6** (intro line naming both commands + per-toggle markers). [G6]

Include a **command/step table**:

| Command | Runs | Scope |
|---|---|---|
| **Paste and run scripts** | Enabled paste-converter scripts (`canHandle` chain); raw paste if none match | Inserts at cursor |
| **Paste and format** | 7 cleanup steps: dehyphenate, dewrap, tidyWhitespace, decomposeLigatures, normalizeBullets, normalizeOrdered, normalize headings (respects toggles) | The pasted text only; replaces selection if present [G10] |
| **Format selection** | Full 11-step recipe (the 7 above + cascade + 3 footnote steps) | Current note / selection |

## Testing strategy

- **`applyTextCleanup` (pure unit):** runs the 7 gated steps in order; respects each toggle (key off → step skipped); idempotent; produces **no** cascade/footnote effects; `---`-first-line snippet is cleaned (not skipped as frontmatter).
- **`fusedFormatNote` byte-identity regression:** identical output on several known-dirty inputs before vs after the refactor. [G9]
- **New command:** clipboard → formatted insert (via a `replaceSelection` test seam added to `CommandInjection` [G7]); empty-clipboard guard; respects toggles; one undo; does **not** run paste scripts; correct notices for the change/no-change/empty cases.
- **Logging:** with `debugLogging` on, (4a) per-script `canHandle` results + matched handler id are logged; (4b) the recipe pipeline logs per-step skipped/edit-count + a final-result line for both "Format selection" and "Paste and format"; with `debugLogging` off, nothing is logged; document/clipboard content is never logged. `applyTextCleanup` stays pure (logger injected, not imported).
- **Rename:** command id/name updated; existing paste-script behavior intact; all old-id test references migrated.
- **Settings marker (Component 6):** the four toggles cascade/fromCitations/identity/move render the "not applied by Paste and format" desc clause; the 7 applied toggles do not; section intro names both commands. (Extend `test/ui/formatSelectionSection.test.ts`.)

## Open implementation notes (for SDD/plan)

- `CommandInjection` (`src/main.ts`) needs a `replaceSelection?: (text: string) => void` seam (or equivalent) so the new command's inserted text is testable — it uses `editor.replaceSelection`, not `applyEditPlan`. [G7]
- Confirm `normalize` (headings) reads only `ctx.doc` (no `resourcesName`/settings) so `applyTextCleanup` stays settings-free. [G3]
- Verify per-script command id derivation (`src/scripts/commandManager.ts`) doesn't collide with the renamed/new built-in ids. [G2]
