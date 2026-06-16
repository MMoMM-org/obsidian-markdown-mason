---
title: "Markdown Mason — structure-aware paste & footnote tooling for Obsidian"
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

- [x] Problem is validated by evidence (not assumptions)
- [x] Context → Problem → Solution flow makes sense
- [x] Every persona has at least one user journey
- [x] All MoSCoW categories addressed (Must/Should/Could/Won't)
- [x] Every metric has corresponding tracking events
- [x] No feature redundancy (check for duplicates)
- [x] No technical implementation details included
- [x] A new team member could understand this PRD

---

## Output Schema

### PRD Status Report

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| specId | string | Yes | Spec identifier (NNN-name format) |
| title | string | Yes | Feature title |
| status | enum: `DRAFT`, `IN_REVIEW`, `COMPLETE` | Yes | Document readiness |
| sections | SectionStatus[] | Yes | Status of each PRD section |
| clarificationsRemaining | number | Yes | Count of `[NEEDS CLARIFICATION]` markers |
| acceptanceCriteria | number | Yes | Total testable acceptance criteria defined |
| openQuestions | string[] | No | Unresolved items requiring stakeholder input |

### SectionStatus

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Section name |
| status | enum: `COMPLETE`, `NEEDS_CLARIFICATION`, `IN_PROGRESS` | Yes | Current state |
| detail | string | No | What clarification is needed or what's in progress |

---

## Product Overview

### Vision
Pasted research from Perplexity, other LLMs, or the web drops into an Obsidian note already fitting that note's structure — heading levels cascaded, citations turned into real footnotes, numbering reconciled, sources deduplicated and filed — in one command, from a transform library the plugin curates instead of loose scripts in the vault.

### Problem Statement
When a user pastes an answer from Perplexity (or another LLM/web source) into a structured Obsidian note, the result almost never fits, and fixing it by hand is repetitive and error-prone:

1. **Heading levels collide.** The paste arrives with `#`/`##` while the cursor sits under a `### ` section, breaking the note's hierarchy until every heading is manually re-leveled.
2. **Footnote numbers restart at 1.** Perplexity-style inline citations (`[1]`, `[2]`) and their source block restart numbering on every paste, colliding with footnotes already in the note across multiple paste sessions.
3. **Sources scatter.** Citations should become real `[^n]` footnotes filed in a canonical section (`## Resources`), in a consistent two-line format, deduplicated against what's already there — instead they land inline and unmanaged.

Existing plugins each solve only a fragment (heading cascade *or* footnote tidying, never the citation→footnote→dedup→file pipeline), and the closest conceptual predecessor (Advanced Paste) was **removed from the community catalog** (verified against `obsidianmd/obsidian-releases`; archived 2024-08-06, delisted 2024-09-13). The cost of the gap is measurable: a multi-section Perplexity paste today requires manual heading edits plus per-source footnote renumbering and filing — minutes of fiddly work per paste, every paste.

### Value Proposition
Markdown Mason is the only Obsidian tool that covers the **whole** paste-to-structured-note flow as composable operations, and it ships them as a **curated, plugin-managed declarative transform library** rather than executable scripts living in the vault. Users get:

- **One command** for the common case (`Mason: Paste and format`) instead of five manual cleanups.
- **Surgical control** when needed — each operation (cascade / convert / renumber / dedup / file) is its own command.
- **Safety by construction** — the core transform format is declarative data, so "this transform only does Markdown operations" is guaranteed by the format, not by trust.
- **No vault clutter** — transforms live in the plugin's own directory, not as notes Obsidian syncs and surfaces.

---

## User Personas

### Primary Persona: The Research Journaler
- **Demographics:** Experienced Obsidian user; non-developer to lightly-technical; maintains a large, deliberately hierarchical vault (e.g. a travel/research vault with H1 wikilink title → `## Notes`/`## Resources` → `###` area → `####` sub-area). Comfortable with the command palette and footnote syntax.
- **Goals:** Capture LLM/web research into living notes quickly, keeping every source as a real footnote in a canonical `## Resources` section, without breaking heading hierarchy or footnote numbering. Wants the cleanup to be one deliberate action they can undo.
- **Pain Points:** Manual heading re-leveling after each paste; footnote numbers that restart at 1 and collide; citations stranded inline; existing plugins that only fix one piece, run globally on save (breaking writing flow), or discard custom footnote labels (`[^A]`).

### Secondary Personas
- **The Transform Tinkerer:** A power user who wants pipelines beyond the built-in Perplexity case — composing declarative transforms, importing community ones, and (desktop-only, with explicit consent) the occasional JavaScript escape-hatch transform. Deferred to v0.2/v0.3 but shapes the library design.
- **The Community Installer:** A general Obsidian user who finds Markdown Mason in the community directory and installs it for its core operations, never touching the library. They must be safe by default: no unvetted code runs, nothing breaks their notes silently, everything is undoable. Their existence is why community-submission compliance and the trust model are Must-Haves, not later polish.

## User Journey Maps

### Primary User Journey: Paste a Perplexity answer into a structured note
1. **Awareness:** The user repeatedly hand-fixes headings and footnotes after pasting LLM research and looks for a plugin that does the whole cleanup.
2. **Consideration:** They evaluate Paste Reformatter (headings only), Perplexity Converter (links only, no real footnotes), Tidy/Better Footnotes (assume unique IDs, collide on restart-at-1), and Linter (global, on-save, breaks flow). None covers the pipeline.
3. **Adoption:** They install Markdown Mason from the community directory, read that the core operations need no configuration, and map `Mason: Paste and format` to a hotkey.
4. **Usage:** Cursor under `### Shinjuku`, they run the command. The pasted body lands with headings cascaded (`#`→`####`…), inline `[n]` converted to `[^n]`, numbers offset past existing footnotes, duplicate URLs merged (reusing existing numbers), and definitions filed into `## Resources` in the two-line format — as a single undoable edit.
5. **Retention:** It works every paste, never clobbers their `[^A]` annotations or orphaned resources, and one Cmd+Z fully reverts if they don't like a result. They start using the per-operation commands and, later, the transform library.

### Secondary User Journeys
- **Tidy an accumulated note (whole-note):** A note has drifted over many pastes — colliding footnote numbers, scattered definitions. The user runs `Mason: Tidy footnotes` once to renumber, dedup, and file everything into `## Resources`, with a count Notice of what changed.
- **Import a community transform:** The Tinkerer browses a configured source, imports a declarative transform (seeing its name/author/version), enables it, and later gets an explicit, changelog-bearing prompt when a newer version exists — never an automatic upgrade. A JavaScript transform additionally requires an explicit "this runs unreviewed code" consent, desktop-only.

## Feature Requirements

### Must Have Features

#### Feature 1: Heading cascade (H)
- **User Story:** As a research journaler, I want pasted/selected headings shifted relative to my cursor's heading context so my note hierarchy isn't broken.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given the cursor is under an `### ` heading and the paste's shallowest heading is `# `, When I run H, Then every pasted heading is shifted by +3 (`#`→`####`, `##`→`#####`) and relative structure is preserved.
  - [ ] Given a shift would exceed H6, When H runs, Then those headings are clamped to H6 (documented as lossy).
  - [ ] Given the cursor has no heading above it, When H runs, Then headings are inserted unchanged and a Notice states no cascade was applied.
  - [ ] Given the paste contains no headings, When H runs, Then the content is unchanged and no error is shown.

#### Feature 2: Citation to footnote (C)
- **User Story:** As a research journaler, I want inline LLM citations converted to real `[^n]` footnotes so my sources become first-class footnotes.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a paste with recognized inline citation markers and a sources block, When I run C, Then each inline marker becomes `[^n]` at the same position and the sources block is parsed into per-source snippet/title/url.
  - [ ] Given alphabetic markers like `[A]` in the text, When C runs, Then they are never treated as citations or altered.
  - [ ] Given no recognized citation format, When C runs, Then the content is unchanged and a Notice states no citations were found.
  - [ ] Given C has converted markers, When the pipeline continues, Then numeric `[^n]` markers remain for the next stage to renumber (C itself does not renumber).

#### Feature 3: Footnote identity — offset + dedup (O+D)
- **User Story:** As a research journaler, I want new numeric footnotes renumbered past my existing ones and duplicate sources merged so numbering never collides and sources aren't duplicated.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given the note's highest numeric footnote is `[^6]` (ignoring `[^A]`/`[^B]`), When the paste has `[^1]`,`[^2]`,`[^3]`, Then they become `[^7]`,`[^8]`,`[^9]` with inline references and definitions updated in sync.
  - [ ] Given two sources in the paste share a URL, When O+D runs, Then they collapse to one footnote and both inline references point to the same number.
  - [ ] Given a paste URL already exists in `## Resources` as `[^7]`, When O+D runs, Then the existing number 7 is reused and no new definition is added for that URL.
  - [ ] Given alphabetic footnotes exist, When O+D runs, Then they are not renumbered, not counted toward the maximum, and not displaced.

#### Feature 4: Move footnotes to Resources (M)
- **User Story:** As a research journaler, I want footnote definitions filed into a canonical Resources section in a consistent format so my sources live in one predictable place.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given footnote definitions to file, When M runs, Then each is written in the two-line format (`[^n]: snippet` then `[title](url)`) inside `## Resources`.
  - [ ] Given the note has no `## Resources` section, When M runs and there are definitions to write, Then the section is created at the note end (default name "Resources", configurable) and no personal callout block is imposed.
  - [ ] Given orphaned resources (a snippet+link with no `[^n]:` prefix) exist in `## Resources`, When M runs, Then they are not deleted, moved, or modified.
  - [ ] Given M files definitions at the Resources section while the body changes at the cursor, When M runs, Then both locations change as a single undoable edit (one Cmd+Z reverts everything).
  - [ ] Given there is nothing to file, When M runs, Then no empty `## Resources` section is created.

#### Feature 5: Presets (chained operations)
- **User Story:** As a research journaler, I want one command for the common case so I don't chain five operations by hand.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given clipboard content, When I run `Mason: Paste and format`, Then H → C → O+D → M run as one undoable edit producing correctly structured output.
  - [ ] Given a selection, When I run `Mason: Format selection`, Then the same operations apply to the selection.
  - [ ] Given a whole note, When I run `Mason: Tidy footnotes`, Then C → O+D → M run across the note.
  - [ ] Given the clipboard is empty, When I run `Mason: Paste and format`, Then no edit is made and a Notice says nothing is on the clipboard.

#### Feature 6: Three sources + whole-note normalize
- **User Story:** As a research journaler, I want the same operations available on a paste, a selection, or the whole note so I can clean up new and accumulated content alike.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given each operation, When invoked, Then it is available for paste, selection, and whole-note sources per the operations×sources matrix.
  - [ ] Given the whole-note source, When heading normalize runs, Then it closes hierarchy gaps (e.g. an H4 directly under an H2) and does NOT apply the cursor-relative cascade — a deliberately distinct behavior.

#### Feature 7: Command, feedback, and undo behavior
- **User Story:** As any user, I want predictable, reversible commands with clear feedback so I always know what happened and can undo it.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given any mutating command, When it runs, Then it produces exactly one undo step.
  - [ ] Given a command that finds nothing to do, When it runs, Then it emits a descriptive Notice (e.g. "No numeric footnotes found") rather than failing silently.
  - [ ] Given a change not visible at the cursor (e.g. footnotes filed offscreen), When it completes, Then a success Notice includes a count of what changed.
  - [ ] Given the plugin registers commands, When installed, Then no default hotkeys are assigned; all commands are reachable via the palette.

#### Feature 8: Community-directory compliance & safety baseline
- **User Story:** As a community installer, I want the plugin to be safe and compliant so installing it can't run unvetted code or break Obsidian conventions.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given any externally-sourced text (transform description, changelog, author) rendered in the UI, When displayed, Then it is rendered with escaping (never raw HTML injection).
  - [ ] Given the plugin manifest, When submitted, Then the id contains no "obsidian", the description ends with a period and omits "Obsidian", and submission lint passes.
  - [ ] Given the codebase, When built for release, Then it uses `console.debug` (not `console.log`), uses the Obsidian-sanctioned network call for any fetch, and ships release-asset attestation.
  - [ ] Given the core operations, When the plugin runs, Then nothing executes external code and no network call is made without an explicit user action.

#### Feature 9: Declarative transform format + built-in Perplexity example
- **User Story:** As a research journaler, I want the built-in operations expressed as a curated, self-describing transform so the same machinery powers built-ins and (later) community transforms.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a transform, When defined, Then it is a single self-describing file carrying id, version, description, changelog, and an ordered pipeline of safe primitives.
  - [ ] Given the built-in Perplexity transform, When shipped, Then it is maintainer-reviewed, opt-in to enable, and documented in-repo with the rationale for how it is built.
  - [ ] Given a declarative transform, When executed, Then it can only perform bounded Markdown operations — no file access beyond the active note, no network, no code evaluation.

### Should Have Features
*(Roadmap v0.2 — the transform library. Valuable but not required for the first useful release.)*
- **Transform library UI:** browse configured sources, import a transform (from a source URL or a vault file), enable/disable, all within the settings tab.
- **Manifest & integrity model:** per-transform `{source, checksum, version, enabled}`; existence-check → fetch-from-source on missing; **same-version + different-checksum hard-blocks** the transform until the user explicitly resolves it; higher version triggers a user-confirmed update prompt showing the changelog (never auto-upgrade).
- **Cross-device behavior:** per-device enable/consent state kept outside synced plugin data; on a new device, transforms the user hasn't enabled there require an explicit enable/consent before first use.
- **Core settings:** configurable Resources section name; numeric-only renumber policy surfaced as a setting.

### Could Have Features
*(Roadmap v0.3 — power and polish.)*
- **JavaScript escape-hatch transforms:** desktop-only; explicit per-session "you are running unreviewed code with full plugin permissions" consent; re-consent on restart and whenever the file fingerprint changes; a kill-switch that blocks all JS execution; never auto-pulled.
- **Auto-on-paste mode:** opt-in interception of paste for a chosen preset, with a Notice on every fire and a way to pause it for raw pastes.
- **Dry-run / preview:** show the proposed change before applying, especially for whole-note tidy.

### Won't Have (This Phase)
- **Telemetry or analytics of any kind** (explicit non-goal).
- **Storing transforms as vault notes** (the problem being solved — transforms live in the plugin directory).
- **On-save / global auto-formatting** (the Linter pattern, explicitly rejected as flow-breaking).
- **Renumbering alphabetic footnotes** (`[^A]` are user annotations, outside the operations' authority).
- **HTML / rich-text paste conversion** (plugin operates on Markdown text only).
- **Sandboxed JS execution** (the JS hatch runs in-process at full privilege with disclosure; true sandboxing is out of scope — see Risks).

## Detailed Feature Specifications

### Feature: Paste and format (the full footnote pipeline)
**Description:** The happy-path preset that applies, in order, heading cascade (H), citation→footnote (C), fused offset+dedup (O+D), and move-to-Resources (M) to clipboard content, landing the result as a single undoable edit. It is the heart of the product and carries the most business rules.

**User Flow:**
1. User places the cursor under a heading and copies a Perplexity (or similar) answer.
2. User runs `Mason: Paste and format`.
3. System cascades pasted heading levels relative to the cursor's heading context.
4. System converts recognized inline citations to `[^n]` and parses the sources block.
5. System reconciles footnote identity: dedup within the paste by URL, reuse numbers for URLs already in `## Resources`, and assign the next numbers above the existing maximum to genuinely new sources.
6. System inserts the body at the cursor and files new definitions into `## Resources` (creating it at note end if absent) in the two-line format — as one editor transaction.
7. System shows a success Notice if filing happened offscreen; the user can Cmd+Z once to revert everything.

**Business Rules:**
- Rule 1: Only numeric footnotes participate in offset/renumber; alphabetic markers (`[^A]`) are inert throughout.
- Rule 2: A URL already present in `## Resources` reuses its existing number; no duplicate definition is created.
- Rule 3: Duplicate URLs within a single paste collapse to one footnote before numbers are assigned.
- Rule 4: Inline references and their definitions always change together; no dangling reference or orphaned definition may result.
- Rule 5: Orphaned resources and the existing Resources callout, if any, are passed through untouched.
- Rule 6: The whole operation is one undo step; partial application must never be observable.
- Rule 7: If the clipboard is empty or nothing is recognized, no edit is made and a Notice explains why.

**Edge Cases:**
- No heading above cursor → Expected: headings inserted unchanged, Notice that no cascade applied.
- Paste with no footnotes → Expected: C/O/D no-op, M writes nothing, no empty Resources section created.
- Note with only alphabetic footnotes → Expected: maximum numeric is 0, new numbers start at 1, alpha untouched.
- URL matches an existing non-sequential number (note has `[^1]` and `[^7]`) → Expected: reuse 7, not 8.
- `## Resources` absent → Expected: created at note end with the default/configured name, no callout imposed.
- Shift would exceed H6 → Expected: clamp to H6 (accepted lossy behavior, documented).

## Success Metrics

This is a free, no-telemetry community plugin. Success is measured by **functional correctness, review acceptance, and public (non-telemetry) community signals**, never by in-app tracking.

### Key Performance Indicators
- **Adoption (gate):** Accepted into the Obsidian community directory on first or second review submission; ≥0 review rejections for safety/compliance issues after the first fix cycle.
- **Engagement (qualitative):** The primary workflow (paste → structured note) is achievable in a single command; the author's real Japan-vault fixture round-trips correctly through `Mason: Paste and format`.
- **Quality (hard):** 100% of committed golden-fixture tests pass; zero regressions against the "must not break" invariants (alpha markers, orphaned resources, single-undo).
- **Safety (hard):** Zero code paths execute external/JS code or make a network call without an explicit user action; zero `innerHTML`-with-external-content sinks.
- **Business impact (proxy):** Public GitHub signals (stars, issues, install count surfaced by community stats) — observed externally, not collected by the plugin.

### Tracking Requirements
No in-application telemetry will be implemented (explicit non-goal). "Tracking" is satisfied entirely by repository-side and review-side evidence:

| Event | Properties | Purpose |
|-------|------------|---------|
| Golden-fixture test run (CI) | fixture id, pass/fail, diff on failure | Validate correctness & invariants every change |
| Community review submission | result, reviewer notes | Validate compliance/safety (adoption gate) |
| GitHub repository metrics | stars, installs (community stats), issues | External adoption/quality signal, no user data collected |
| Two-device Sync verification (manual spike) | does plugin-dir subtree replicate? | Settle the load-bearing Sync question before v0.2 |

## Constraints and Assumptions

### Constraints
- **Platform:** Obsidian plugin (desktop + mobile). Core operations and the declarative engine must run on mobile; the JavaScript escape hatch is desktop-only.
- **Compliance:** Must pass Obsidian community-directory review (manifest rules, `console.debug`, sanctioned network API, XSS-safe DOM, release attestation).
- **Privacy:** No telemetry; no silent network calls — the only network activity is an explicit, user-triggered transform-source pull.
- **Storage:** Transforms live in the plugin's own directory, never as vault notes; per-device state must not ride synced plugin data.
- **Verifiability:** Domain logic must be exercisable by committed fixtures independent of Obsidian (a project principle).
- **Known blocker:** Full implementation of C/O/D depends on a raw Perplexity sample (copy + export) to fix the parser grammar; H and M are unblocked. The author will supply one committable sample (golden fixture) and one personal sample (kept local/gitignored).

### Assumptions
- **Perplexity format (to be confirmed by fixtures):** inline markers are bare `[n]` (superscript is render-only); the sources-block header is a localized alternation (`Citations:`/`Sources:`/`Quellen:` …); copy and export differ, so both fixtures are needed; Perplexity already globally dedups its own numbering, so the restart-at-1 collision occurs *across* pastes.
- **Sync behavior (to be verified):** Obsidian Sync replicates the entire plugin folder (including subdirectories) when "Installed community plugin list" sync is enabled — evidence from forum sync logs, high-confidence but not vendor-confirmed. The design assumes this and verifies via a two-device test before v0.2.
- **User footnote convention:** users keep sources as `[^n]` footnotes filed under a Resources section; the plugin defaults to this convention while allowing the section name to be configured.

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Raw Perplexity sample unavailable / format more variable than expected | High | Medium | Ship H+M first (unblocked); design C/D as a tolerant, fixture-driven parser; gate C/O/D on the committed sample |
| Unvetted JavaScript transform propagates across devices via Sync | High | Medium | Per-device enable/consent state outside synced data; consent re-checked per device and on file-fingerprint change; kill-switch; JS desktop-only and never auto-pulled |
| "Declarative" transform leaks capability (regex ReDoS, unsafe replacement) | High | Medium | Bound the primitive set; string-only regex replacement with a safe parser; import-time pattern validation; formal "no access beyond active note, no network" rule |
| Trust-on-first-use: first import establishes an unverified checksum baseline | Medium | Medium | Pin curated sources to commit SHAs; reserve a manifest field for signed/attested curated index; display resolved URL at import |
| Same-version malicious source change clicked past as a warning | Medium | Low | Drift at same-version+different-checksum hard-blocks (disable until explicit resolution), not a dismissable notice |
| Scope creep across v0.1–v0.3 in one spec | Medium | Medium | MoSCoW gating; v0.1 = core ops + compliance; library and JS hatch are Should/Could |
| In-place edits lose data on partial failure | High | Low | Single atomic editor transaction per command; one-undo guarantee; on parse failure apply nothing and report |

## Open Questions
- [ ] Deliver the two raw Perplexity samples (copy + export) so the C/O/D parser grammar and golden fixtures can be finalized.
- [ ] Regex-primitive policy for declarative transforms: none / denylist / linear-time validator / worker-timeout? (security vs. capability trade-off)
- [ ] Should the curated transform index be cryptographically signed/attested, and with what key material?
- [ ] Update-check cadence for installed transforms: on load / throttled on first command (e.g. 24h) / manual only?
- [ ] Preset source resolution: should `Mason: Paste and format` fall back to the selection when the clipboard is empty, or stay strictly clipboard-scoped?
- [ ] Should pastes inside code fences / frontmatter be excluded from Mason handling?
- [ ] Blank-line policy between Resources entries: enforce exactly one between all entries, or only for newly written ones?
- [ ] Library UI home: settings-tab section (simpler) vs. a dedicated view (scales better) — confirm for v0.2.

---

## Supporting Research

### Competitive Analysis
No existing plugin covers the citation→footnote→offset→dedup→file pipeline; each solves a fragment, and the closest predecessor is gone:

| Plugin | Status / License | Covers | Gap |
|---|---|---|---|
| Advanced Paste (kxxt) | Removed (archived 2024-08-06, delisted 2024-09-13) | Custom JS transforms on clipboard | Dead; conceptual predecessor; "scripts loose in vault" is the anti-pattern Mason fixes |
| Paste Reformatter (keathmilligan) | Active / 0BSD | Heading cascade incl. "Contextual Cascade" (== Mason H), regex rules | No footnote logic at all |
| Perplexity Converter (heseber) | Active / BSD-3 | Fixes Perplexity citation hyperlinks; confirms localized `Citations:`/`Sources:`/`Quellen.` block | No real `[^n]` footnotes |
| Paste transform (rekby) | Active / Apache-2.0 | Sequential regex/JS rules on paste | Regex-only; no stateful renumber/dedup |
| Tidy / Better Footnotes | Tidy active (MIT); Better abandoned (0BSD) | Renumber/sort footnotes | Assume unique IDs → collide on restart-at-1; Better discards custom labels (anti-pattern) |
| Linter (platers) | Active / MIT | Global footnote normalization, move-to-bottom | On-save, global, breaks writing flow |

All comparable plugins are permissively licensed; Markdown Mason borrows **ideas, not code** (notably Paste Reformatter's contextual cascade), so reimplementation carries no licensing obligation. No surveyed plugin hosts a curated remote transform index — Mason's library model borrows from Obsidian's own plugin-release mechanism rather than a peer precedent (a noted design risk).

### User Research
Grounded in the author's real vault (the canonical fixture, §2 of the briefing): H1 wikilink title → `## Notes`/`## Resources` → `###` area → `####`; sources kept as two-line `[^n]: snippet` / `[title](url)` entries; mixed numeric (`[^1]`,`[^7]`) and alphabetic (`[^A]`,`[^B]`) markers where only numerics are renumbered; orphaned resources that must survive. This first-person, fixture-backed evidence is the primary persona and the acceptance-criteria source. No broader formal user research exists yet; community feedback post-release is the next input.

### Market Data
The Obsidian plugin ecosystem is large and active; the specific niche (structure-aware paste + footnote pipeline) is currently unserved following Advanced Paste's removal. No quantitative market sizing is available or required for a free community plugin; the relevant signal is the demonstrated personal need plus the documented absence of a complete solution in the catalog.
