---
title: "Markdown Mason — structure-aware paste & footnote tooling for Obsidian"
status: draft
version: "1.1"
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
Markdown Mason is the only Obsidian tool that covers the **whole** paste-to-structured-note flow as composable operations **and** is extensible by **custom scripts in the Advanced-Paste spirit** — a script can run **during a paste** or **as a command on a selection**. Users get:

- **One command** for the common case instead of five manual cleanups; the Perplexity flow is a script that composes the operations.
- **Surgical control** when needed — each operation (cascade / convert / renumber / dedup / file) is its own command and an API scripts can call.
- **Extensibility without a rebuild** — drop a script into the plugin's script directory (downloaded from the vetted official repo, or copied in from your vault) and bind it to a command/hotkey, à la Templater. Script support is foundational, not bolted on later.
- **A bounded trust model** — the official repo only hosts maintainer-vetted scripts that do Markdown-in-note only (no network, no cross-plugin, no external access); anything else you bring in from the community is imported from your vault **at your own discretion**, with explicit disclosure and consent.
- **No vault clutter** — scripts live in the plugin's own directory, not as notes Obsidian surfaces.

---

## User Personas

### Primary Persona: The Research Journaler
- **Demographics:** Experienced Obsidian user; non-developer to lightly-technical; maintains a large, deliberately hierarchical vault (e.g. a travel/research vault with H1 wikilink title → `## Notes`/`## Resources` → `###` area → `####` sub-area). Comfortable with the command palette and footnote syntax.
- **Goals:** Capture LLM/web research into living notes quickly, keeping every source as a real footnote in a canonical `## Resources` section, without breaking heading hierarchy or footnote numbering. Wants the cleanup to be one deliberate action they can undo.
- **Pain Points:** Manual heading re-leveling after each paste; footnote numbers that restart at 1 and collide; citations stranded inline; existing plugins that only fix one piece, run globally on save (breaking writing flow), or discard custom footnote labels (`[^A]`).

### Secondary Personas
- **The Transform Tinkerer:** A power user who writes or imports custom JS scripts beyond the Perplexity case, binds them to commands/hotkeys, and runs them on paste or selection (desktop-only, with explicit consent). A first-class v0.1 audience — script support is the extensibility backbone, not a deferred add-on.
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
- **Add or import a custom script:** The Tinkerer either installs a vetted script from the official repo (name/version/doc shown, enable it) or copies a community script into the vault and imports it — seeing an explicit "this runs unreviewed code with full plugin privileges" disclosure and acknowledging once per checksum/version. They then bind the script to a command/hotkey, or have it fire on paste.

## Feature Requirements

### Must Have Features

v0.1 ships the **operations as an in-plugin API + standalone commands** (Features 1–7), the **custom-script runtime and invocation** that is the extensibility backbone (Feature 8), the **script package format with the three Perplexity scripts delivered as downloadable scripts — not built-ins** (Feature 9), and the **compliance + trust model** required for community release (Feature 10).

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

#### Feature 8: Custom-script runtime and invocation (extensibility backbone)
- **User Story:** As a tinkerer, I want to drop a JavaScript script into the plugin and invoke it during a paste or as a command on my selection, so I can extend the plugin without modifying its code.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given an enabled script in the plugin's script directory, When I bind it to a command and run it on a selection, Then it executes against my selection and applies its result as one undoable edit.
  - [ ] Given an enabled paste-script, When I paste, Then the script runs on the clipboard content before insertion (Advanced-Paste model) and a Notice indicates it fired.
  - [ ] Given a script is invoked, When it runs, Then it is loaded fresh with its module cache evicted by directory prefix (no stale helper code) and the plugin exposes the operations (H/C/O+D/M) and editor/selection/clipboard context as a documented, versioned API.
  - [ ] Given a script's policy is `disabled` (kill-switch), When anything would invoke it, Then it does not execute.
  - [ ] Given an imported/community script (not from the vetted repo), When it would run for the first time at a given checksum/version, Then a disclosure modal states it runs with full plugin privileges and the user must acknowledge once per checksum/version (re-prompted when the file fingerprint changes).
  - [ ] Given a script throws or exceeds a timeout, When it is invoked, Then the paste/selection is left intact (raw fallback) and the error is surfaced as a Notice, never a silent partial edit.

#### Feature 9: Script package format + the Perplexity scripts
- **User Story:** As a research journaler, I want the Perplexity handling delivered as downloadable scripts so the same machinery powers the built-in case and community scripts, and so each Perplexity surface is handled correctly.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a script package, When defined, Then it is self-describing (id, version, description, changelog, required-API-version) and bindable to a command.
  - [ ] Given the three Perplexity surfaces, When shipped, Then each is a separate downloadable script — *app copy* (bare `[n]` + `Sources` block, restart-per-answer → C→O+D→M), *web copy* (inline `[domain](url)` links), and *web download* (existing `[^a_b]` footnotes + URL-only definition list) — NOT a built-in.
  - [ ] Given the author's three committed samples (`assets/sakura-in-tokyo-{app,web,web-download}.md`), When the matching script runs, Then the golden-fixture output is produced.

#### Feature 10: Community-directory compliance & bounded trust model
- **User Story:** As a community installer, I want the plugin safe and compliant so installing it can't silently run unvetted code or break Obsidian conventions.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given the plugin, When released, Then it is desktop-only (`isDesktopOnly: true`) and its manifest passes submission lint (id without "obsidian", description ends with a period and omits "Obsidian").
  - [ ] Given any externally-sourced text (script description/changelog/author) rendered in the UI, When displayed, Then it is escaped (never raw HTML injection); and the codebase uses `console.debug`, the sanctioned network API, and ships release-asset attestation.
  - [ ] Given the official script repo, When a script is submitted by PR, Then it must include a document describing what it does, and scripts performing network/external/cross-plugin access are not merged (Markdown-in-note only).
  - [ ] Given the plugin runs, When no user action is taken, Then no script executes and no network call is made; the only network activity is a user-triggered pull from the official repo.

#### Feature 11: Extensible, versioned plugin-integrated operations API
- **User Story:** As a maintainer or contributor, I want to add new first-party operations to the plugin's API over time so scripts gain new built-in capabilities without each script reimplementing them, and so the plugin itself can grow new features that are exposed through the same API.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given the operations API, When a new plugin-integrated operation is added (e.g. beyond H/C/O+D/M), Then it becomes available to every script under the same documented namespace (e.g. `mason.*`) without changing the script-runtime contract.
  - [ ] Given operations are registered, When the plugin loads, Then each operation is exposed both as a standalone `Mason:` command and as an API call from a single internal registry (no duplicated logic, no separate code paths).
  - [ ] Given the API is versioned, When a script declares a required API version it depends on, Then the plugin runs it only if the available API satisfies that version, and otherwise surfaces a clear "requires API vX" Notice instead of failing obscurely.
  - [ ] Given a new operation is released, When it ships, Then it is additive (existing API surface is not removed or renamed) or it is a documented major API-version bump with a migration note.
  - [ ] Given the API is the contract scripts depend on, When the plugin documents it, Then the exposed operation signatures, the editor/selection/clipboard context, and the version are published as a stable, documented surface.

### Should Have Features
*(Roadmap v0.2 — official-repo distribution on top of the v0.1 script runtime. Because the runtime, invocation, and vault-import are already Must-Haves, v0.2 adds the **download/update** layer without re-architecting.)*
- **Official-repo download UI:** browse the vetted scripts in the official repo's script directory, install/enable, all within the settings tab; plus the existing vault-import flow.
- **Manifest & integrity model:** per-script `{source, checksum, version, enabled}`; existence-check → fetch-from-source on missing; **same-version + different-checksum hard-blocks** the script until the user explicitly resolves it; higher version triggers a user-confirmed update prompt showing the changelog (never auto-upgrade).
- **Cross-device behavior:** per-device enable/consent state kept outside synced plugin data; on a new device, scripts the user hasn't enabled there require explicit enable/consent before first use.
- **Core settings:** configurable Resources section name; numeric-only renumber policy surfaced as a setting.

### Could Have Features
*(Roadmap v0.3 — power and polish. Custom JS scripts are already Must-Have in v0.1; the script runtime should reuse the proven execution model in [`MMoMM-org/miyo-tomo-hashi`](https://github.com/MMoMM-org/miyo-tomo-hashi) `src/hooks/` — fresh-load + prefix cache-evict, fingerprint re-prompt, `enabled|disabled|ask` kill-switch, disclosure modal, hooksDir-escape guard.)*
- **Auto-on-paste refinement:** per-script paste interception with a Notice on every fire and a way to pause it for raw pastes.
- **Dry-run / preview:** show the proposed change before applying, especially for whole-note tidy.
- **More official scripts:** e.g. HTML / rich-text paste handling delivered as its own script (not core).
- **Richer library UI:** a dedicated view if the script list outgrows the settings tab.

### Won't Have (This Phase)
- **Mobile support** (`isDesktopOnly: true` — the script runtime needs desktop Node).
- **Telemetry or analytics of any kind** (explicit non-goal).
- **Storing scripts as vault notes** (the problem being solved — scripts live in the plugin directory).
- **On-save / global auto-formatting** (the Linter pattern, explicitly rejected as flow-breaking).
- **Renumbering alphabetic footnotes** (`[^A]` are user annotations, outside the operations' authority).
- **HTML / rich-text paste conversion in core** — delivered later as a separate script (Could-Have), not core.
- **Official-repo scripts with network / external / cross-plugin access** — rejected at PR review; such scripts exist only as user-discretion community imports.
- **Sandboxed JS execution** (scripts run in-process at full privilege with disclosure; true sandboxing is out of scope — see Risks).

## Detailed Feature Specifications

### Feature: Paste and format (the full footnote pipeline)
**Description:** The happy-path flow that applies, in order, heading cascade (H), citation→footnote (C), fused offset+dedup (O+D), and move-to-Resources (M) to clipboard content, landing the result as a single undoable edit. It carries the most business rules and is realized as the **perplexity-app script** composing the operations API (Features 8, 9, 11) — the same machinery any script uses. A generic `Mason: Paste and format` preset chains the same operations for non-Perplexity content.

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
- **Platform:** Obsidian plugin, **desktop-only** (`isDesktopOnly: true`) — the custom-script runtime needs desktop Node (`require`, fresh-load + cache-evict).
- **Foundational extensibility:** Custom-script support (invocation on paste / on selection / as command) and the operations API are **v0.1 architecture**, not a later addition — the plugin must not need re-architecting to support external scripts.
- **Compliance:** Must pass Obsidian community-directory review (manifest rules, `console.debug`, sanctioned network API, XSS-safe DOM, release attestation), with the heightened scrutiny that applies to a plugin which downloads and runs scripts.
- **Trust policy:** The official repo's script directory accepts only maintainer-vetted, Markdown-in-note-only scripts (PR + descriptive doc required); no network/external/cross-plugin scripts are merged. Community scripts are imported from the vault at the user's discretion, with disclosure + per-checksum/version consent.
- **Privacy:** No telemetry; no silent network calls — the only network activity is an explicit, user-triggered pull from the official repo.
- **Storage:** Scripts live in the plugin's own directory, never as vault notes; per-device enable/consent state must not ride synced plugin data.
- **Verifiability:** Domain logic must be exercisable by committed fixtures independent of Obsidian (a project principle).
- **Samples in hand:** The three Perplexity samples are committed (`assets/sakura-in-tokyo-{app,web,web-download}.md`); the §2 parser blocker is resolved.

### Assumptions
- **Perplexity formats (now known from the committed samples):** three distinct surfaces — *app copy* (bare `[n]` + `Sources` block, restart-per-answer), *web copy* (inline `[domain](url)` links, no markers/block), *web download* (existing `[^a_b]` footnotes + URL-only definition list, with HTML cruft). Each is handled by its own script, not one parser.
- **Sync behavior (to be verified):** Obsidian Sync replicates the entire plugin folder (including subdirectories) when "Installed community plugin list" sync is enabled — evidence from forum sync logs, high-confidence but not vendor-confirmed. Desktop-only narrows the blast radius; per-device consent still required. Verify via a two-device test before v0.2.
- **User footnote convention:** users keep sources as `[^n]` footnotes filed under a Resources section; the plugin defaults to this convention while allowing the section name to be configured.

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Obsidian review wariness of a plugin that downloads and runs scripts | High | Medium | Official source is maintainer-vetted, Markdown-in-note-only, doc-required; full-privilege disclosure + consent; desktop-only; precedent (Templater/Dataview/QuickAdd). Keep v0.1 to local + vault-import; remote download in v0.2 |
| Full-privilege scripts misbehave or are malicious | High | Medium | Vetting policy for the official repo; disclosure + per-checksum/version consent for imports; kill-switch; fresh-load + prefix cache-evict; timeout; raw-paste fallback on error |
| Unvetted community script propagates across devices via Sync | High | Medium | Per-device enable/consent state outside synced data; consent re-checked per device and on file-fingerprint change; desktop-only |
| Trust-on-first-use: first import establishes an unverified checksum baseline | Medium | Medium | Pin official-repo sources to commit SHAs; reserve a manifest field for signed/attested index; display resolved URL at import |
| Same-version malicious source change clicked past as a warning | Medium | Low | Drift at same-version+different-checksum hard-blocks (disable until explicit resolution), not a dismissable notice |
| Retrofitting script support later forces a rewrite | High | Low | **Eliminated** — script runtime + operations API are foundational v0.1 |
| Scope creep across v0.1–v0.3 in one spec | Medium | Medium | MoSCoW gating; v0.1 = ops + script runtime + local/import; remote repo download is v0.2 |
| In-place edits lose data on partial failure | High | Low | Single atomic editor transaction per command; one-undo guarantee; on parse/script failure apply nothing and report |

## Open Questions
- [ ] Official-repo vetting process specifics: who reviews, the required per-script doc template, and whether the "Markdown-in-note only" check can be (partly) automated vs. purely manual PR review.
- [ ] Exact operations-API surface and how scripts declare a required API version (signatures, context shape) — to be designed in the SDD.
- [ ] Do vetted official-repo scripts still show a disclosure prompt, or only community/vault-imported ones? (Proposed: vetted = light enable; community = full disclosure + per-checksum/version consent — confirm.)
- [ ] Update-check cadence for installed official scripts: on load / throttled on first command (e.g. 24h) / manual only?
- [ ] Preset source resolution: should `Mason: Paste and format` fall back to the selection when the clipboard is empty, or stay strictly clipboard-scoped?
- [ ] Should pastes inside code fences / frontmatter be excluded from Mason/script handling?
- [ ] Blank-line policy between Resources entries: enforce exactly one between all entries, or only for newly written ones?

---

## Supporting Research

### Competitive Analysis
No existing plugin covers the citation→footnote→offset→dedup→file pipeline; each solves a fragment, and the closest predecessor is gone:

| Plugin | Status / License | Covers | Gap |
|---|---|---|---|
| Advanced Paste (kxxt) | Removed (archived 2024-08-06, delisted 2024-09-13) | Custom JS transforms on clipboard | Dead, but its **custom-script-on-paste model is what Mason adopts**; Mason fixes its "scripts loose in vault" weakness with a managed plugin-dir + vetted official source |
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
