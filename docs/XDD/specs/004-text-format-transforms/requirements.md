---
title: "Text format transforms — six markdown-aware cleanup and list transforms"
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

- [x] Problem is validated by evidence (benature/obsidian-text-format: ~40 independent commands, markdown-blind, no composite)
- [x] Context → Problem → Solution flow makes sense
- [x] Every persona has at least one user journey
- [x] All MoSCoW categories addressed (Must/Should/Could/Won't)
- [x] Quality metrics defined (no-regression, correctness, idempotency)
- [x] No feature redundancy
- [x] No technical implementation details included (deferred to SDD)
- [x] A new team member could understand this PRD

---

## Output Schema

### PRD Status Report

| Field | Value |
|-------|-------|
| specId | 004-text-format-transforms |
| title | Text format transforms — six markdown-aware cleanup and list transforms |
| status | DRAFT |
| clarificationsRemaining | 0 |
| acceptanceCriteria | 38 |
| openQuestions | none (all resolved in research dialogue) |

### Section Status

| Section | Status |
|---------|--------|
| Product Overview | complete |
| User Personas | complete |
| User Journey Maps | complete |
| Feature Requirements (Must) | complete — 7 features, 38 criteria |
| Feature Requirements (Should/Could/Won't) | complete |
| Detailed Feature Specifications | complete — dewrap |
| Success Metrics | complete |
| Constraints and Assumptions | complete |
| Risks and Mitigations | complete |
| Open Questions | complete — none remaining |
| Supporting Research | complete |

---

## Product Overview

### Vision
"Format selection" becomes the power note-taker's single-undo cleanup engine: six
new markdown-aware transforms eliminate the messy artifacts of pasted external text —
hard-wrapped lines, OCR hyphens, Unicode ligatures, stray whitespace, and
inconsistent list markers — without ever corrupting the markdown structure beneath.

### Problem Statement
Users who paste text from external sources (web pages, PDFs, Perplexity exports, OCR
scans) routinely encounter a cluster of structural artifacts that markdown-aware tooling
should handle automatically: hard-wrapped lines that break paragraph flow, words split
by end-of-line hyphens, Unicode ligature glyphs and smart punctuation that break search
and export, stray double-spaces and trailing whitespace, and bullet or ordered list
markers that vary by source. Mason's **"Format selection"** command (spec 003) already
provides the right architectural foundation — a fused, single-undo, recipe-driven
composite — but currently covers only footnote and heading normalization. The six
cleanup and list transforms from this scope are the natural next layer: they address the
pasted-text problem class that no existing step touches.

The closest competitor, `benature/obsidian-text-format`, exposes roughly 40 independent
commands for similar cleanup tasks. Each command is a separate undo step; there is no
composite and no recipe. More critically, its line-merge and list-normalization commands
are markdown-blind: they destroy code fences, headings, list structure, and tables
indiscriminately. Mason's differentiator is precisely the inverse: the same single-undo
composite the user already knows, extended with transforms that are deeply aware of
markdown block structure and will never corrupt it.

### Value Proposition
Six new built-in transforms — each individually commandable, API-accessible, and
recipe-gated — that give the power note-taker a one-pass, one-undo pasted-text
cleanup that `benature/obsidian-text-format` requires ~40 separate commands and ~40
undo steps to approximate, and that it still cannot do without corrupting markdown
structure.

---

## User Personas

### Primary Persona: Power note-taker / maintainer (Mason user)
- **Demographics:** Obsidian user comfortable with plugin settings and commands;
  regularly pastes research notes from web sources, PDFs, or AI-assistant outputs;
  values consistent markdown formatting and uses a personal note-taking convention.
- **Goals:** One command that cleans the full pasted-text artifact class — unwrapped
  paragraphs, stitched OCR hyphens, normalized punctuation, tidy whitespace, consistent
  list markers — in a single undo step, without touching their markdown structure.
- **Pain Points:** Pasted text from PDFs or web pages carries hard line breaks that
  break paragraph reflow. OCR output splits words mid-hyphen. Smart quotes and ligature
  glyphs break search. Bullet lists from different sources use *, +, or • inconsistently.
  Fixing these manually, or running ~40 separate plugin commands, defeats the convenience
  Mason was built to provide.

### Secondary Personas
None. Script authors invoke `mason.*` API methods directly and are explicitly unaffected
by recipe toggle state (ADR-19 isolation). Individual-command users are likewise
unaffected: each new command is always fully available regardless of settings. Neither
group constitutes a distinct persona for this feature.

---

## User Journey Maps

### Primary User Journey: Clean pasted text in one pass

1. **Trigger:** User pastes a section copied from a PDF or web article. The pasted text
   contains hard line breaks, a few split words ("exam-\nple"), curly quotes, and mixed
   bullet markers.
2. **Action:** User selects the pasted block and runs "Format selection".
3. **Result:** The recipe applies all enabled steps in sequence. Hard-wrapped lines
   are re-joined into paragraphs (dewrap). Split OCR words are stitched (dehyphenate).
   Ligature glyphs and smart quotes become plain ASCII (decompose ligatures &
   punctuation). Double-spaces vanish (tidyWhitespace). Bullet markers all become `-`
   (normalizeBullets). The entire operation lands as one undo step.
4. **Tune:** User visits Settings → Mason → Format selection and disables
   "Decompose ligatures & punctuation" because their vault already handles that
   elsewhere. On the next paste run, the step is silently skipped; everything else still
   applies.
5. **Retention:** The single-undo, recipe-tuned cleanup becomes the user's default
   paste-finishing action.

### Secondary User Journeys
None — scripts and individual commands are unaffected by recipe state and present no
distinct journey.

---

## Feature Requirements

### Must Have Features

#### Feature 1: Dewrap — markdown-aware paragraph unwrapping
- **User Story:** As a Mason user, I want "Format selection" to join hard-wrapped lines
  back into full paragraphs so that text pasted from PDFs or web pages flows correctly
  in Reading View, without touching code, headings, lists, blockquotes, tables, or
  frontmatter.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a selection containing one or more paragraphs with hard-wrapped lines (consecutive non-blank lines with no structural marker), When I run "Format selection" with dewrap enabled, Then consecutive soft-wrapped lines within each paragraph are joined into a single line.
  - [ ] Given a selection containing a fenced code block, When I run "Format selection" with dewrap enabled, Then lines inside the opening and closing fences are not joined or altered.
  - [ ] Given a selection where adjacent lines include an ATX heading (line starting with one or more `#`) or a setext heading underline (`===` or `---`), When I run "Format selection" with dewrap enabled, Then the heading line is never joined to the line before or after it.
  - [ ] Given a selection containing list-item lines (starting with `-`, `*`, `+`, or a digit followed by `.`), When I run "Format selection" with dewrap enabled, Then list-item boundary lines are not joined to preceding lines.
  - [ ] Given a selection containing blockquote lines (starting with `>`), When I run "Format selection" with dewrap enabled, Then no merging occurs across a blockquote boundary.
  - [ ] Given two paragraphs separated by one or more blank lines, When I run "Format selection" with dewrap enabled, Then the blank-line paragraph boundary is preserved and the two paragraphs are not joined.

#### Feature 2: Dehyphenate — stitch OCR-split words
- **User Story:** As a Mason user, I want "Format selection" to remove end-of-line
  hyphens that split words across lines (as OCR and PDF copy-paste produce) so that
  words are restored without affecting genuine compound hyphens, code, or URLs.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a selection containing a word split by a hyphen at line end (e.g. "exam-\nple") where both sides are entirely lowercase letters, When I run "Format selection" with dehyphenate enabled, Then the hyphen and line break are removed and the joined word appears on a single line (e.g. "example").
  - [ ] Given a split where at least one side contains an uppercase letter or a digit (e.g. "PDF-\nconverter" or "base-\n64"), When I run "Format selection" with dehyphenate enabled, Then the split is left untouched.
  - [ ] Given a genuine compound-hyphenated word on a single line (e.g. "well-known"), When I run "Format selection" with dehyphenate enabled, Then the compound is preserved unchanged.
  - [ ] Given a hyphen-at-line-end that falls inside a fenced code block or inline code span, When I run "Format selection" with dehyphenate enabled, Then the code content is not altered.
  - [ ] Given a selection where both dehyphenate and dewrap are enabled, When I run "Format selection", Then dehyphenate resolves split words first and dewrap subsequently joins the resulting unwrapped lines, producing a correct combined result.

#### Feature 3: Decompose ligatures & punctuation — ASCII normalization
- **User Story:** As a Mason user, I want "Format selection" to replace Unicode ligature
  glyphs and typographic punctuation with their plain-ASCII equivalents so that my
  notes are searchable, portable, and export-safe, without touching code.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given text containing any of the ligature glyphs ﬁ ﬂ ﬀ ﬃ ﬄ æ œ, When I run "Format selection" with this transform enabled, Then each glyph is replaced by its ASCII decomposition (ﬁ→fi, ﬂ→fl, ﬀ→ff, ﬃ→ffi, ﬄ→ffl, æ→ae, œ→oe) and no other characters are altered.
  - [ ] Given text containing Unicode curly double quotes (" ") or curly single quotes (' '), When I run "Format selection" with this transform enabled, Then they are replaced with straight ASCII double-quote (") and apostrophe (') respectively.
  - [ ] Given text containing an em dash (—) or en dash (–), When I run "Format selection" with this transform enabled, Then each is replaced with a single ASCII hyphen-minus (-).
  - [ ] Given text containing a Unicode ellipsis (…), When I run "Format selection" with this transform enabled, Then it is replaced with three consecutive ASCII full stops (...).
  - [ ] Given text inside a fenced code block or an inline code span, When I run "Format selection" with this transform enabled, Then the code content is not altered.

#### Feature 4: Tidy whitespace — intra-line and blank-line normalization
- **User Story:** As a Mason user, I want "Format selection" to collapse spurious extra
  spaces within lines, remove trailing whitespace, and squeeze excessive blank lines so
  that my pasted notes are clean without touching code or table alignment.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a line whose body (non-leading portion) contains two or more consecutive spaces, When I run "Format selection" with tidyWhitespace enabled, Then the run of spaces is collapsed to a single space.
  - [ ] Given a line with one or more trailing spaces or tabs, When I run "Format selection" with tidyWhitespace enabled, Then the trailing whitespace is removed.
  - [ ] Given a selection containing three or more consecutive blank lines, When I run "Format selection" with tidyWhitespace enabled, Then they are collapsed to a single blank line.
  - [ ] Given text inside a fenced code block, When I run "Format selection" with tidyWhitespace enabled, Then whitespace inside the block is not modified.
  - [ ] Given a markdown table row that uses multiple spaces to align columns, When I run "Format selection" with tidyWhitespace enabled, Then the table cell separators and column alignment are not altered.

#### Feature 5: Normalize bullets — canonical marker unification
- **User Story:** As a Mason user, I want "Format selection" to replace every non-standard
  bullet marker with the canonical `-` so that my lists are uniform, without disturbing
  nesting, checkboxes, or ordered lists.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a bullet list with items using any mix of *, +, •, –, or · as markers, When I run "Format selection" with normalizeBullets enabled, Then every marker is replaced with a canonical `-` while the item text is unchanged.
  - [ ] Given a nested bullet list with multiple indentation levels, When I run "Format selection" with normalizeBullets enabled, Then the indentation of each level is preserved exactly and all markers at all levels become `-`.
  - [ ] Given a task-list item in the form `- [ ] task` or `- [x] task`, When I run "Format selection" with normalizeBullets enabled, Then the checkbox syntax is preserved intact and not altered.
  - [ ] Given an ordered list (1. 2. 3.), When I run "Format selection" with normalizeBullets enabled, Then the ordered list is not altered.
  - [ ] Given bullet item text that contains a hyphen-like or bullet-like character mid-sentence (e.g. "buy milk • eggs"), When I run "Format selection" with normalizeBullets enabled, Then the mid-sentence character is not rewritten; only line-start markers are targeted.

#### Feature 6: Normalize ordered lists — sequential renumbering
- **User Story:** As a Mason user, I want "Format selection" to renumber ordered lists
  sequentially per nesting level so that gaps or restarted counters from pasted content
  are corrected, without touching bullet, alphabetic, or roman-numeral lists.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given an ordered list with non-sequential numbers (e.g. 1. 3. 7.) or repeated counters, When I run "Format selection" with normalizeOrdered enabled, Then the list is renumbered 1. 2. 3. from the top.
  - [ ] Given a nested ordered list with multiple indentation levels, When I run "Format selection" with normalizeOrdered enabled, Then each nesting level is renumbered independently starting from 1 and indentation is preserved.
  - [ ] Given a loose ordered list with blank lines between items, When I run "Format selection" with normalizeOrdered enabled, Then the blank-line structure between items is preserved and only the numbers change.
  - [ ] Given a list using alphabetic markers (a. b. c.) or roman-numeral markers (i. ii. iii.), When I run "Format selection" with normalizeOrdered enabled, Then the list is left untouched.
  - [ ] Given a bullet list, When I run "Format selection" with normalizeOrdered enabled, Then the bullet list is not altered.

#### Feature 7: Recipe integration and isolation
- **User Story:** As a Mason user, I want the six new transforms to behave consistently
  with all spec-003 invariants — default-on, behavior-preserving, individually
  omittable, single-undo, isolated from individual commands and the API, idempotent, and
  always markdown-safe — so that the recipe extension is invisible until I change settings.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given all 11 recipe toggles are enabled and the selected note does not trigger any new transform (no hard-wrapped lines, no ligatures, etc.), When I run "Format selection", Then the output is byte-identical to a pre-004 release running the same note (behavior-preserving default).
  - [ ] Given any subset of the 11 toggles is disabled, When I run "Format selection", Then exactly the disabled steps' effects are absent from the result, all enabled steps still apply, and the entire result is produced as a single atomic edit (one undo step).
  - [ ] Given all 11 toggles are disabled, When I run "Format selection", Then no document change occurs and the existing "Nothing to format" notice is shown.
  - [ ] Given any recipe toggle state, When I run any of the six new transforms as an individual command (e.g. "Dewrap paragraphs"), Then it performs its complete operation regardless of toggle state (ADR-19 isolation: individual commands do not read the recipe).
  - [ ] Given any recipe toggle state, When a `mason.*` API method for any of the six new transforms is called by a script, Then it executes its full operation (the recipe toggles never alter API behavior).
  - [ ] Given a selection processed once by "Format selection" with any subset of the 11 toggles enabled, When "Format selection" is run a second time on the same text with the same toggle state, Then the output is identical to the first run (each transform converges to a fixpoint; idempotency holds).
  - [ ] Given a note containing markdown structure — fenced code blocks, indented code, tables, ordered lists, bullet lists, ATX headings, setext headings, blockquotes, thematic breaks, or YAML frontmatter — When "Format selection" is run with any combination of the six new transforms enabled, Then none of the structural markdown elements are corrupted, deleted, or reordered.

### Should Have Features
- The 11 recipe toggle settings are organized into labeled sub-groups via `setHeading`:
  Cleanup (dewrap, dehyphenate, decompose ligatures & punctuation, tidy whitespace) and
  Lists (normalize bullets, normalize ordered lists), alongside the existing Headings and
  Footnotes groups from spec 003.
- Each of the six new toggles carries a `setDesc` sentence (sentence case) stating its
  concrete effect (e.g. the dewrap toggle reads "Re-join hard-wrapped lines into full
  paragraphs, skipping code, headings, and lists").

### Could Have Features
- A one-line active-recipe summary in the "Format selection" settings section header
  (e.g. "Runs: Dewrap, Tidy whitespace, Normalize bullets, …") that updates as toggles
  change. Nice-to-have; not required for this phase.

### Won't Have (This Phase)
- The inverse smarten-punctuation direction (straight quotes → curly/typographic). The
  decompose/normalize-to-ASCII direction is locked; adding the reverse is a separate
  future decision.
- Markdown-link normalization (trailing slashes, URL percent-encoding).
- YAML frontmatter key normalization or value cleanup.
- Citation-style reformatting (APA, MLA, Chicago).
- User-defined regex transforms.
- User-reorderable step order (order is fixed).
- Per-selection toggle subsets (a per-run modal to pick steps).
- Converting tabs to spaces or vice versa (tidyWhitespace explicitly does not touch
  tabs).
- Any change to "Tidy footnotes", existing spec-003 steps, the `mason.*` scripting API
  contract, or the compositional paste flow.

---

## Detailed Feature Specifications

### Feature: Dewrap — markdown-aware paragraph unwrapping

**Description:**
Dewrap identifies contiguous runs of non-blank lines that belong to the same markdown
paragraph block and joins them into a single line. It does this entirely at the block
level: before any line-joining occurs, the selection is segmented into markdown block
units (paragraphs, headings, list items, code fences, blockquotes, table rows, thematic
breaks, YAML frontmatter). Only lines within a single paragraph block are candidates for
joining; block boundaries are never crossed.

Dewrap is the transform most likely to corrupt markdown structure if block detection is
imperfect, and it is therefore subject to the most comprehensive edge-case test
coverage. Its default-on status is conditioned on that coverage being in place before
the feature ships.

**User Flow:**
1. User selects a block of text pasted from a PDF — paragraphs with hard line breaks
   every 70–80 characters.
2. User runs "Format selection" with dewrap enabled (default).
3. The recipe's dewrap step segments the selection into blocks. Each paragraph block
   has its internal line breaks removed, producing a single continuous line per
   paragraph.
4. Headings, list items, code fences, blockquotes, and the blank lines separating
   paragraphs remain exactly as they were.
5. The result, combined with other enabled steps, is written as one atomic edit.

**Business Rules:**
- Rule 1: Dewrap operates only within paragraph blocks. A paragraph block is a
  contiguous run of lines that do not carry a block-level structural marker.
- Rule 2: The following line types are never joined to an adjacent line — they are
  block boundaries: ATX headings (`# … ######`), setext heading underlines (`===…` /
  `---…`), list-item start lines (`-`, `*`, `+`, `N.`, `N)`), blockquote lines
  (`> …`), table rows (`| …`), thematic breaks (`---`, `***`, `___`), code-fence
  delimiters (`` ``` `` / `~~~`), and lines inside an open code fence.
- Rule 3: YAML frontmatter (the block between opening and closing `---` at the document
  start) is treated as opaque and is never touched by dewrap.
- Rule 4: Blank lines are paragraph separators; they are preserved and never joined.
- Rule 5: Dewrap runs after dehyphenate in the fixed step order, so split words are
  already stitched before paragraph-level joining begins.

**Edge Cases:**
- A paragraph immediately followed by a setext heading underline: the paragraph line
  must not be joined to the underline (the underline remains a separate block element).
- A blockquote that itself contains hard-wrapped lines: lines within the blockquote body
  are soft-wrapped prose; dewrap must treat each `>` prefix consistently and not merge
  across the prefix boundary.
- A list item whose continuation lines are indented prose (a lazy continuation
  paragraph): the continuation is treated as part of the list item block, not a
  standalone paragraph; dewrap does not join list continuations to the surrounding
  prose.
- A thematic break (`---`) that could be confused with a setext underline: both are
  block boundaries; neither is ever joined to adjacent content.
- A selection ending mid-paragraph: the final partial paragraph is still joined
  (dewrap operates on what is selected, not whole-document paragraphs).
- An all-code-fence selection: no lines are joined; the result is byte-identical to the
  input.

---

## Success Metrics

This is a local, single-maintainer open-source Obsidian plugin with no telemetry or
analytics infrastructure. Success is defined entirely in terms of correctness and
regression-freedom, verified by the automated test suite and a manual smoke checklist.

### Key Performance Indicators

- **No regression (behavior-preserving default):** With all 11 recipe toggles on,
  "Format selection" produces byte-identical output to the pre-004 release for any note
  that does not trigger the new transforms. Verified by an automated regression fixture.
- **Transform correctness:** Each of the six transforms produces the specified output
  for its canonical cases and all documented edge cases. Verified by dedicated unit
  tests per transform.
- **Idempotency:** Running "Format selection" twice equals running it once for every
  enabled transform combination. Verified by automated idempotency tests that apply the
  recipe twice and assert identical output.
- **Markdown-safety:** No transform corrupts code fences, headings, tables, lists,
  blockquotes, or frontmatter. Verified by a suite of markdown-structure fixture tests
  that covers each transform against every structural element.
- **Isolation (ADR-19):** Individual commands and `mason.*` API methods for the six
  new transforms are unaffected by toggle state. Verified by tests that assert full
  execution regardless of recipe settings.
- **Single-undo:** The composite applies all enabled steps as one atomic edit. Verified
  by the existing atomic-edit test mechanism extended to include the new steps.

### Tracking Requirements

| Metric | How Tracked | Owner |
|--------|-------------|-------|
| Regression (byte-identical all-on output) | Automated test fixture | Test suite |
| Per-transform correctness | Unit tests per transform | Test suite |
| Idempotency | Two-pass automated tests | Test suite |
| Markdown-safety | Structural fixture tests | Test suite |
| ADR-19 isolation | Toggle-independence tests | Test suite |
| Single-undo | Atomic-edit test assertion | Test suite |
| Manual smoke (per-step omission, "Nothing to format") | Pre-release manual checklist | Maintainer |

There is no runtime telemetry. This plugin ships no analytics events and collects no
usage data. All tracking is through the automated test suite and the maintainer's
manual smoke checklist run before each release.

---

## Constraints and Assumptions

### Constraints
- Obsidian plugin: settings persist via the plugin data store; new toggles use the
  standard Settings API (`addToggle` / `setHeading`). The six new commands are
  registered via the same `addCommand` pattern as existing built-ins.
- Core transforms remain pure (`src/core/*` carries zero Obsidian imports); the new
  transforms follow this constraint.
- ADR-19 isolation is non-negotiable: recipe toggles affect only "Format selection".
  Individual commands, `mason.*` API methods, "Tidy footnotes", and the compositional
  paste flow are all unaffected by toggle state.
- The step order within the recipe is fixed for this phase: dehyphenate → dewrap →
  decompose ligatures & punctuation → tidy whitespace → normalize bullets → normalize
  ordered lists (appended after the existing spec-003 steps). User reordering is out of
  scope.
- Behavior must be preserved by default for existing users (all new toggles default on,
  and the transforms are behavior-preserving: they only fire when there is actual cleanup
  to do).

### Assumptions
- Users who want to tune the recipe will find the new toggles in settings; no migration
  or onboarding flow is required.
- The dewrap block-detection logic is the highest-risk part of this feature; the
  requirement is that it ships with comprehensive edge-case test coverage, not that it is
  implemented in any particular way (implementation details are deferred to the SDD).
- The `benature/obsidian-text-format` plugin's markdown-blindness is a known, stable
  property — not something that will change before this spec ships.

---

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| dewrap corrupts markdown if block detection misclassifies a structural line (heading, list item, code fence boundary) as plain prose | High | Medium | Exhaustive structural fixture tests covering every block type; dewrap ships only after all edge cases in this PRD pass; behavior-preserving default review before merge |
| dehyphenate produces false positives on compound hyphens, code spans, or URL fragments | Medium | Medium | Restrict join to strictly lowercase→lowercase across `-\n`; skip all content inside code fences and inline code spans; run before dewrap so code-fence boundaries are still intact |
| Decompose ligatures homoglyph trap: mapping a visually similar glyph to the wrong ASCII character (e.g. a homoglyph of W mapped to VV) causes data loss | High | Low | Decomposition table is explicitly restricted to the seven canonical ligatures (ﬁ ﬂ ﬀ ﬃ ﬄ æ œ) and standard punctuation; ASCII W and w are never touched; reviewed against Unicode character database |
| normalizeOrdered drops or merges nesting levels if indentation parsing is incorrect | High | Low | Per-level renumbering with explicit indentation preservation; nested list fixtures at two and three levels; preserve loose/tight structure |
| normalizeBullets rewrites bullet-like characters inside item text or inside code spans | Medium | Low | Target only line-start markers; skip inline occurrences; skip code fences and inline code spans |
| 11-toggle settings section is visually overwhelming and hard to scan | Medium | Medium | `setHeading` sub-groups (Cleanup / Lists / Headings / Footnotes) as a Should-Have requirement; implementation detail in SDD |
| Non-idempotency: a transform applied twice produces different output than applied once | High | Medium | Fixed internal step order; line-based transforms designed to converge; automated two-pass idempotency tests required before ship |
| Step-ordering hazards (e.g. tidyWhitespace running before dewrap collapses spaces in a way that prevents correct join) | Medium | Low | Locked step order with dehyphenate first, dewrap second; SDD defines the canonical ordering rationale; integration tests cover multi-step combinations |

---

## Open Questions

None — all design decisions were resolved in the maintainer research dialogue prior to
this PRD being authored. The six transforms, their exact behaviors, the scope
constraints (direction of ligature normalization, no tab conversion, no smarten
direction), the ADR-19 isolation rule, the default-on posture, and the `setHeading`
sub-grouping are all locked decisions recorded in the Decisions section of
`docs/XDD/specs/004-text-format-transforms/README.md`.

---

## Supporting Research

### Competitive Analysis

`benature/obsidian-text-format` (github.com/benature/obsidian-text-format) is the
closest comparable plugin and the primary competitive reference for this spec. Key
findings, derived from inspection of the plugin's README and source:

- **Scale:** Approximately 40 independent commands covering tasks that overlap with the
  six transforms in this spec (line merging, ligature normalization, whitespace cleanup,
  bullet normalization, ordered-list renaming).
- **No composite:** Every command is a separate action and a separate undo step. There
  is no recipe-style command that applies a selected subset as one atomic edit. Cleaning
  a pasted document requires running many commands sequentially, accumulating many undo
  steps.
- **Markdown-blind:** The line-merge command (`merge line`) joins consecutive lines
  without any awareness of code fences, headings, list structure, or block boundaries.
  Running it on a selection that contains a list or heading produces structurally invalid
  markdown. This is the most critical quality gap versus Mason's approach.
- **Ligatures only (no punctuation):** The "ligature" feature in `obsidian-text-format`
  covers Unicode ligature glyphs but does not normalize smart/curly quotes or em/en
  dashes as part of the same command. Mason's "Decompose ligatures & punctuation"
  combines both into a single step.
- **No nesting preservation:** The bullet and ordered-list normalization commands in
  `obsidian-text-format` do not guarantee indentation or nesting-level preservation.
  Mason's normalizeBullets and normalizeOrdered explicitly preserve nesting.

Mason's differentiation is therefore threefold: (1) a single-undo composite recipe
that applies a user-selected subset of transforms in one step; (2) deep markdown block
awareness that prevents structural corruption; (3) a selectivity mechanism (recipe
toggles) that gives per-step control without sacrificing the composite convenience.

### User Research

This spec is maintainer-driven. The feature set was identified through direct maintainer
experience with the pasted-text problem class (PDF and web content cleanup) and confirmed
through the gap analysis of `benature/obsidian-text-format`. No external user interviews
were conducted; the single-maintainer install base makes structured user research
impractical and unnecessary for this phase.

### Market Data

Not applicable. Markdown Mason is a local, single-maintainer open-source Obsidian plugin.
No market sizing, revenue modeling, or adoption analytics are relevant to this feature
decision.
