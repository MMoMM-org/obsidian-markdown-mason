---
title: "Paste command UX — honest naming, paste-and-clean, and diagnosability"
status: draft
version: "1.0"
---

# Product Requirements Document

## Validation Checklist

### CRITICAL GATES (Must Pass)

- [x] All required sections are complete
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Problem statement is specific and measurable
- [x] Every feature has testable acceptance criteria (Gherkin format)
- [x] No contradictions between sections

### QUALITY CHECKS (Should Pass)

- [x] Problem is validated by evidence (spec-004 smoke-test finding)
- [x] Context → Problem → Solution flow makes sense
- [x] Every persona has at least one user journey
- [x] All MoSCoW categories addressed (Must/Should/Could/Won't)
- [x] Every metric has corresponding verification method
- [x] No feature redundancy (check for duplicates)
- [x] No technical implementation details included
- [x] A new team member could understand this PRD

---

## Output Schema

### PRD Status Report

| Field | Value |
|-------|-------|
| specId | 005-paste-command-ux |
| title | Paste command UX — honest naming, paste-and-clean, and diagnosability |
| status | COMPLETE |
| clarificationsRemaining | 0 |
| acceptanceCriteria | 22 |

---

## Product Overview

### Vision
Make Markdown Mason's paste and formatting commands do exactly what their names promise — so a user can paste messy external text and clean it up in one obvious step, and can see what happened when something doesn't.

### Problem Statement
During spec-004 smoke testing, the command **"Paste and format"** was found to be misleading. It runs only the enabled paste-converter **scripts** (e.g. Perplexity/citation converters via a `canHandle` match); when no script matches, it pastes the raw clipboard and shows a terse *"no recognized format — pasted as-is"* notice. Three concrete pains:

1. **The name oversells it.** "Paste and format" implies general text formatting, but it does **not** run the spec-004 cleanup transforms (dewrap, dehyphenate, decompose ligatures, tidy whitespace, normalize bullets/ordered). Those run only via the separate **"Format selection"** command. A real user (the maintainer) expected paste to clean up the text and it didn't.
2. **No "paste and clean" path exists.** The most common real flow — drop in hard-wrapped PDF/web text with OCR hyphens, curly quotes, and odd bullets, and tidy it — requires pasting, then selecting, then running a different command.
3. **The outcome is undiagnosable.** When a paste doesn't transform, the debug log shows only a clipboard read; the user cannot tell which scripts were considered or why none fired. Separately, the "Format selection" command logs **nothing at all**, so a legitimate no-op run is indistinguishable from a broken one (also hit during smoke testing).

### Value Proposition
Users get commands whose names match their behavior, a one-step "paste and clean up" command that reuses their configured cleanup preferences, a clear in-settings indication of which steps that command applies, and — when debug logging is on — a transparent trace of what each command did. This removes a confusing dead-end and makes the plugin's behavior self-explanatory.

## User Personas

### Primary Persona: The note-taker pasting external text
- **Demographics:** Obsidian desktop user, moderate technical comfort, collects research/notes from PDFs, web articles, and AI tools.
- **Goals:** Paste external text into a note and have it become clean, readable Markdown (joined paragraphs, ASCII punctuation, consistent bullets) without manual cleanup.
- **Pain Points:** Pasted text arrives hard-wrapped, with OCR hyphenation, curly quotes, and inconsistent bullet glyphs. The command that *sounds* like it cleans up ("Paste and format") doesn't, and it's unclear which command does.

### Secondary Personas
- **The plugin maintainer / power user (debugging):** Enables debug logging to understand why a paste didn't transform or whether a command actually ran. Needs the log to say which scripts were considered and which formatting steps fired or were skipped.

## User Journey Maps

### Primary User Journey: Paste messy text and clean it
1. **Awareness:** User copies a passage from a PDF/web page that is hard-wrapped with OCR artifacts.
2. **Consideration:** User looks at Mason's commands; the names must make it obvious which one cleans pasted text vs. which one runs converter scripts.
3. **Adoption:** User runs **"Paste and format"** expecting cleanup — and gets it (text inserted and tidied in one step, one undo).
4. **Usage:** Repeated for each external paste; user optionally tunes which cleanup steps apply via the existing Format-selection toggles and can see in settings which steps "Paste and format" uses.
5. **Retention:** The command reliably does what its name says; behavior is consistent with the user's configured toggles.

### Secondary User Journey: Diagnose a paste that didn't transform
1. **Awareness:** A converter paste produced raw text; the user expected a conversion.
2. **Usage:** User enables debug logging and re-runs; the log lists each enabled script and whether it claimed the clipboard, plus the matched handler if any — or, for the cleanup recipe, which steps fired or were skipped.
3. **Resolution:** User understands the outcome (no script matched / a toggle was off / nothing needed changing) without guessing.

## Feature Requirements

### Must Have Features

#### Feature 1: Honest command naming for the paste-script command
- **User Story:** As a user, I want the existing paste-script command to be named for what it does, so that I don't expect it to run text cleanup.
- **Acceptance Criteria:**
  - [ ] Given the command palette is open, When the user searches Mason's paste commands, Then the command that runs enabled paste-converter scripts is named **"Paste and run scripts"** (not "Paste and format").
  - [ ] Given the command "Paste and run scripts" is invoked, When the clipboard matches an enabled script, Then it behaves exactly as the previous command did (runs the matched converter; inserts the result).
  - [ ] Given the command "Paste and run scripts" is invoked, When no enabled script matches the clipboard, Then the raw clipboard is inserted and the existing "no recognized format" outcome occurs (behavior unchanged from before the rename).

#### Feature 2: New "Paste and format" command (paste + cleanup)
- **User Story:** As a user, I want a "Paste and format" command that pastes the clipboard and cleans it up, so that messy external text becomes tidy Markdown in one step.
- **Acceptance Criteria:**
  - [ ] Given a clipboard containing hard-wrapped text with an OCR hyphen split, curly quotes, and `*` bullets, When the user runs "Paste and format", Then the inserted text is de-wrapped, the hyphen is stitched, the quotes are ASCII, and the bullets are `-`.
  - [ ] Given any result of "Paste and format", When it is applied, Then the paste **and** the cleanup are a single undo step (one Ctrl/Cmd-Z fully reverts to the pre-command state).
  - [ ] Given the cleanup steps it runs, When "Paste and format" executes, Then it applies only the **7 cleanup steps** (dehyphenate, dewrap, tidy whitespace, decompose ligatures, normalize bullets, normalize ordered, normalize headings) and does **not** run heading-cascade or any footnote step.
  - [ ] Given the user has turned a cleanup toggle off in Format-selection settings (e.g. "Dewrap paragraphs"), When "Paste and format" runs, Then that step is skipped (the command respects the same toggles).
  - [ ] Given the cleanup changed nothing (clipboard already clean for the enabled steps), When "Paste and format" runs, Then the raw clipboard is still inserted and a notice indicates a paste occurred (never "Nothing to format").
  - [ ] Given there is an active selection, When "Paste and format" runs, Then the formatted clipboard text replaces the selection (standard paste-over-selection behavior); with no selection it inserts at the cursor.
  - [ ] Given an empty or unavailable clipboard, When "Paste and format" runs, Then the user sees the same guard notice as the paste-script command and no edit is made.
  - [ ] Given "Paste and format" runs, When it executes, Then it does **not** run any paste-converter scripts (it is independent of the script chain).
  - [ ] Given the cleanup applies, When the inserted text is scoped, Then only the pasted text is affected — pre-existing note content is not reformatted.

#### Feature 3: Settings marker for steps "Paste and format" does not run
- **User Story:** As a user configuring the cleanup toggles, I want to see which toggles "Paste and format" doesn't use, so I understand why it behaves differently from "Format selection".
- **Acceptance Criteria:**
  - [ ] Given the Format-selection settings tab, When the user views the toggles, Then the toggles that "Paste and format" does **not** apply (heading cascade and the three footnote steps) are clearly marked as "Format selection only — not applied by Paste and format".
  - [ ] Given the same tab, When the user views the cleanup/list toggles and "Normalize headings", Then they carry **no** such marker (they ARE applied by "Paste and format").
  - [ ] Given the section description, When the user reads it, Then it names both "Format selection" and "Paste and format" and states that "Paste and format" runs the cleanup, lists, and normalize-headings steps only.

#### Feature 4: Diagnostic logging (debug-gated)
- **User Story:** As a debugging user, I want the log to explain what the paste/format commands did, so I can tell why text was or wasn't transformed.
- **Acceptance Criteria:**
  - [ ] Given debug logging is ON, When "Paste and run scripts" runs, Then the log records, for each enabled script, whether it claimed the clipboard, and the matched handler if one fired.
  - [ ] Given debug logging is ON, When the cleanup recipe runs (via either "Format selection" or "Paste and format"), Then the log records, per step, whether it was skipped (toggle off) or ran and how many changes it made, plus a final-result line.
  - [ ] Given debug logging is OFF, When any of these commands run, Then nothing is logged.
  - [ ] Given any logging occurs, When entries are written, Then the document text and clipboard contents are **never** logged (only step/script names, statuses, and counts).

#### Feature 5: Documentation of the three commands
- **User Story:** As a user reading the docs, I want a clear explanation of the paste/format commands, so I pick the right one.
- **Acceptance Criteria:**
  - [ ] Given the user-facing docs, When the user reads the commands reference, Then a table distinguishes **"Paste and run scripts"** (converter scripts), **"Paste and format"** (the 7 cleanup steps, scoped to the paste), and **"Format selection"** (the full 11-step recipe on the note/selection).
  - [ ] Given the README and usage docs, When the user reads them, Then references to the old "Paste and format" behavior are updated to the new naming and behavior.
  - [ ] Given a troubleshooting page, When a user wonders why a paste "pasted as-is" without formatting, Then there is an entry explaining the paste-vs-format distinction.

### Should Have Features
- A short status note in the command's notice summarizing the count of changes (already covered by the simple change-count notice; no rich per-step notice — that detail lives in the debug log).

### Could Have Features
- A status-bar indicator summarizing the last paste/format outcome.

### Won't Have (This Phase)
- A combined "smart paste" that runs converter scripts and then the cleanup recipe in one command (keeps the two commands distinct).
- Making the cleanup transforms range-aware to format an existing in-note selection in place via "Paste and format" (the command formats the clipboard text it inserts).
- Per-command toggle overrides (a separate toggle set just for "Paste and format"); it reuses the single Format-selection recipe.
- Any telemetry/analytics (the plugin collects none, by design).

## Detailed Feature Specifications

### Feature: "Paste and format" command
**Description:** A new command that reads the clipboard, applies the user's configured cleanup steps to that text, and inserts the cleaned result as a single, undoable edit scoped to the pasted text.

**User Flow:**
1. User copies messy external text and places the cursor (or selects text to replace).
2. User runs "Paste and format".
3. System reads the clipboard, applies the 7 cleanup steps (respecting toggles), and inserts the cleaned text in one edit.
4. System shows a simple notice (change count, or "pasted — nothing to clean up").

**Business Rules:**
- Runs the 7 cleanup steps only (dehyphenate, dewrap, tidy whitespace, decompose ligatures, normalize bullets, normalize ordered, normalize headings); never cascade or footnote steps.
- Honors the same per-step toggles as "Format selection".
- Never runs paste-converter scripts.
- Single undo step; scoped to the inserted text only.
- Notices are simple; per-step detail goes only to the debug log.

**Edge Cases:**
- Clipboard text begins with `---` → must not be mistaken for YAML frontmatter and skipped; the first line is still cleaned. → Expected: the content is cleaned normally.
- Clipboard already clean for the enabled steps → Expected: raw text inserted, "pasted — nothing to clean up" notice; never "Nothing to format".
- Empty/unavailable clipboard → Expected: guard notice, no edit.
- Active selection present → Expected: formatted clipboard text replaces the selection.

## Success Metrics

### Key Performance Indicators
This is a local, no-telemetry Obsidian plugin; success is measured by correctness and clarity rather than analytics.

- **Adoption (qualitative):** "Paste and format" is discoverable and used for the paste-and-clean flow that previously required three steps.
- **Engagement:** The paste-and-clean flow is a single command + single undo.
- **Quality:** Automated tests cover every acceptance criterion; the `fusedFormatNote` refactor remains byte-identical (regression test); CON-2 core purity holds.
- **Clarity:** With debug logging on, a user can determine why a paste/format command did or didn't change text without reading source.

### Tracking Requirements
No telemetry is collected (privacy by design). Success is verified by:

| Verification | What it confirms | Purpose |
|--------------|------------------|---------|
| Automated test suite | Every acceptance criterion has a passing test | Behavioral correctness |
| `fusedFormatNote` byte-identity regression test | The shared-helper refactor changes nothing | No regression to "Format selection" |
| Manual smoke checklist | The commands behave as named in real Obsidian | End-to-end confidence |
| Debug-log inspection | Log lines appear for scripts and recipe steps, never content | Diagnosability + privacy |

---

## Constraints and Assumptions

### Constraints
- Obsidian plugin; UI text must be sentence case; no Catalyst-beta APIs; no custom DOM beyond supported `Setting` methods.
- Core purity (CON-2): cleanup logic stays free of `obsidian` imports.
- Single atomic edit / single undo per command invocation (consistent with existing Mason commands).
- No telemetry/analytics.
- Releases are automated via semantic-release on merge to main.

### Assumptions
- No meaningful installed user base yet, so renaming/reassigning command identifiers is acceptable (a stale hotkey going inert is preferable to silently triggering different behavior).
- Users who need diagnostics will enable the existing debug-logging toggle.
- The spec-004 cleanup recipe and toggles already exist and are the single source of truth for cleanup configuration.

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Renaming/reassigning the paste command identifier silently changes a user's hotkey behavior | Medium | Low | Use a fresh identifier for the new command so any stale binding goes inert rather than triggering new behavior; document the rename. |
| The "Format selection" refactor to share cleanup logic alters its output | High | Low | A byte-identity regression test gates the refactor; existing "Format selection" tests must stay green. |
| Clipboard text starting with `---` is skipped as frontmatter | Medium | Low | Ensure the first line of pasted text is never treated as document frontmatter during cleanup. |
| Users confuse "Paste and run scripts" vs "Paste and format" | Medium | Medium | Honest names, a settings marker, and a docs table covering all three commands. |

## Open Questions
- [ ] None — all design decisions resolved during brainstorming and gap review (see `docs/XDD/ideas/2026-06-29-paste-command-ux.md`).

---

## Supporting Research

### Competitive Analysis
The reference competitor `benature/obsidian-text-format` is markdown-blind and applies transforms indiscriminately. Mason's differentiator (established in spec 004) is markdown-aware cleanup that preserves structure. This spec extends that differentiator to the paste entry point while keeping the converter-script flow distinct.

### User Research
Direct maintainer dogfooding during spec-004 smoke testing surfaced every problem this spec addresses: the misleading command name, the missing paste-and-clean flow, and the absence of diagnostic logging on both the paste-script and recipe paths.

### Market Data
N/A — internal plugin feature; success measured by correctness and clarity, not market metrics.
