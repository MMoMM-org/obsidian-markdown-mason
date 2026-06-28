---
title: "Format selection recipe — configurable per-step toggles"
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

- [x] Problem is validated by evidence (current code: `fusedFormatNote` always runs all 5 steps)
- [x] Context → Problem → Solution flow makes sense
- [x] Every persona has at least one user journey
- [x] All MoSCoW categories addressed (Must/Should/Could/Won't)
- [x] Quality metrics defined (no-regression, correctness)
- [x] No feature redundancy
- [x] No technical implementation details included (deferred to SDD)
- [x] A new team member could understand this PRD

---

## Output Schema

### PRD Status Report

| Field | Value |
|-------|-------|
| specId | 003-format-selection-recipe |
| title | Format selection recipe — configurable per-step toggles |
| status | COMPLETE |
| clarificationsRemaining | 0 |
| acceptanceCriteria | 14 |
| openQuestions | none (design decided) |

---

## Product Overview

### Vision
"Format selection" becomes the user's own formatting recipe: they choose which of
its built-in steps run, instead of being forced into the full fused pipeline.

### Problem Statement
Mason's **"Format selection"** command fuses five built-in steps —
cascade → normalize → convert-citations → resolve-identity → move-to-resources —
and **always runs all five** (`fusedFormatNote`, `src/commands.ts:276`). A user who
wants most of that recipe but not one step (e.g. keep footnotes inline rather than
moving definitions to a Resources section, or skip heading normalization) has no way
to opt out. Their only workarounds are to run the individual commands one by one
(losing the single-undo convenience) or to avoid "Format selection" entirely. It is
the *only* command whose steps are bundled and otherwise unpickable, so this is the
one place the rigidity actually hurts.

### Value Proposition
A small, opt-in configuration that lets each user tailor the one kitchen-sink command
to their workflow — without changing any other command, the scripting API, or the
default behavior. Off by default means "off the radar": existing users see no change.

## User Personas

### Primary Persona: Power note-taker (Mason user)
- **Demographics:** Obsidian user, comfortable with commands and plugin settings;
  pastes/cleans research notes regularly; has a personal formatting convention.
- **Goals:** One command that formats a selection exactly the way *they* like —
  consistently, in a single undo step.
- **Pain Points:** "Format selection" does one thing they don't want (commonly:
  moving footnote definitions into a Resources section, or re-leveling headings) and
  they can't turn just that off.

### Secondary Personas
None. (Script authors are explicitly *unaffected* — see Won't Have and the scripting
non-interaction rule below — so they are not a persona for this feature.)

## User Journey Maps

### Primary User Journey: Tailor the recipe
1. **Awareness:** User runs "Format selection", notices one step they dislike (e.g.
   their footnote defs got moved to Resources).
2. **Consideration:** They look in Settings for a way to keep the command but drop
   that step.
3. **Adoption:** In the new "Format selection" settings section they untick that one
   step; the other four stay on.
4. **Usage:** Next "Format selection" applies only the enabled steps, still as one
   atomic edit / one undo.
5. **Retention:** The command now matches their convention, so they use it as their
   default formatting action.

### Secondary User Journeys
None.

## Feature Requirements

### Must Have Features

#### Feature 1: Per-step toggles for "Format selection"
- **User Story:** As a Mason user, I want to enable/disable each step of "Format
  selection" so that the command applies only the transformations I want.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given all five toggles are on, When I run "Format selection", Then the output is byte-identical to the current (pre-feature) behavior.
  - [ ] Given the "move" step is off (others on), When I run "Format selection", Then citations are converted and footnotes renumbered/deduplicated but definitions are NOT moved to the Resources section.
  - [ ] Given the "normalize" step is off (others on), When I run "Format selection", Then heading levels are not gap-closed but the remaining steps still apply.
  - [ ] Given any subset of steps is enabled, When I run "Format selection", Then the result is produced as a single atomic edit (one undo step), exactly as today.
  - [ ] Given a step is toggled off, When I run "Format selection", Then none of that step's edits appear in the result.

#### Feature 2: Default-on, behavior-preserving
- **User Story:** As an existing user upgrading, I want "Format selection" to behave
  exactly as before unless I change settings, so that the upgrade is invisible.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a fresh install or an upgrade with no saved recipe settings, When the plugin loads, Then all five steps default to enabled.
  - [ ] Given I never open the new settings section, When I run "Format selection", Then it behaves identically to the previous version.

#### Feature 3: Settings section with five labeled toggles
- **User Story:** As a user, I want a clear settings section listing the five steps so
  that I can see and change my recipe.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given I open plugin settings, When I scroll to the "Format selection" section, Then I see five labeled checkboxes (Cascade headings, Normalize headings, Convert citations to footnotes, Resolve footnote identity, Move footnotes to resources), each reflecting its current state.
  - [ ] Given I toggle a checkbox, When I reload Obsidian, Then the toggle retains its value (settings persist).
  - [ ] Given I toggle a checkbox, When I next run "Format selection", Then the change takes effect without requiring a reload.

#### Feature 4: Scope isolation (no leakage to other surfaces)
- **User Story:** As a user, I want the toggles to affect ONLY "Format selection", so
  that my individual commands, "Tidy footnotes", and scripts stay predictable.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given any toggle state, When I run an individual built-in command (e.g. "Move footnotes to resources"), Then it performs its full operation regardless of the toggles.
  - [ ] Given any toggle state, When I run "Tidy footnotes", Then it always performs convert-citations → resolve-identity → move (unchanged by the toggles).
  - [ ] Given any toggle state, When a paste-formatter script runs, Then the `mason.*` built-in API it calls behaves identically (toggles never change script behavior).

#### Feature 5: Empty-recipe handling
- **User Story:** As a user, if I disable every step, I want a clear, harmless result
  rather than a confusing partial edit.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given all five steps are disabled, When I run "Format selection", Then nothing is applied and the user is informed (e.g. a "Nothing to format" notice), with no document change and no error.

### Should Have Features
- Sensible label/help text on each toggle so the effect is self-explanatory (e.g.
  "Move footnote definitions into your Resources section").

### Could Have Features
- A one-line summary of the active recipe shown in the section header (e.g. "Runs:
  Cascade, Normalize, Convert citations"). Nice-to-have, not required.

### Won't Have (This Phase)
- New built-in transforms (`cleanup.*` / `lists.*` from the text-format adoption).
  These are **spec 004**; they will later plug into this same recipe mechanism as
  additional Format-selection steps with their own toggles.
- Toggles or enable/disable for individual built-in commands (they stay always
  registered).
- Any change to "Tidy footnotes", the `mason.*` scripting API, or the compositional
  paste flow.
- Re-ordering of the steps (order stays fixed: normalize → cascade → footnotes).

## Detailed Feature Specifications

### Feature: Per-step toggles for "Format selection"
**Description:** The "Format selection" command reads five boolean settings, one per
built-in step, and composes its fused result from only the enabled steps. Step order
is unchanged. The result remains a single atomic edit.

**User Flow:**
1. User opens Settings → Mason → "Format selection" section.
2. System shows five checkboxes, all on by default.
3. User unticks the step(s) they don't want.
4. User selects text in a note and runs "Format selection".
5. System applies only the enabled steps as one edit; a notice reports the change
   count (as today), or "Nothing to format" if the recipe produced no edits.

**Business Rules:**
- Rule 1: Each step toggle is independent; any combination (including all-off) is valid.
- Rule 2: Default for every step is **on**; absence of a saved value means on.
- Rule 3: Only "Format selection" consults the toggles. No other command, the
  scripting API, or the paste flow reads them.
- Rule 4: Disabling a step omits exactly that step's contribution; remaining steps are
  unaffected in behavior and still combine into one atomic edit.
- Rule 5: Step order is fixed and not user-configurable in this phase.

**Edge Cases:**
- All steps disabled → no-op + "Nothing to format" notice; no document mutation.
- Only "move" enabled but there are no movable definitions → behaves as today's
  no-definitions case (no Resources section created, no-op for that step).
- Selection with nothing to change under the enabled steps → "Nothing to format"
  (same as today's empty-plan path).

## Success Metrics

This is an internal, opt-in plugin feature; success is correctness and zero
regression, not adoption volume.

### Key Performance Indicators
- **No regression:** With all toggles on, "Format selection" output is byte-identical
  to the prior release (verified by tests).
- **Correctness:** Each toggle-off omits exactly its step and nothing else (verified
  per-combination by tests).
- **Isolation:** Individual commands, "Tidy footnotes", and scripts are provably
  unaffected by toggle state (verified by tests).

### Tracking Requirements
No telemetry. Mason ships no analytics; verification is via the automated test suite
and the compliance sweep, not runtime events.

---

## Constraints and Assumptions

### Constraints
- Obsidian plugin: settings persist via the plugin data store; UI uses the standard
  Settings API. No new unsupported-API surface (the `Plugin.settings` typing already
  forces a minAppVersion concern — see SDD; use the established CommandHost pattern).
- Behavior must be preserved by default (existing users, published 0.3.0 install base).
- Core transforms stay pure (`src/core/*` has zero Obsidian imports).

### Assumptions
- Users who want this will find it in settings; no migration or onboarding is needed.
- The fixed step order (normalize → cascade → footnotes) is acceptable to users; only
  inclusion, not ordering, is requested.

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Toggling footnote sub-steps (fromCitations/identity/move) breaks atomicity because they are offset-fused in `tidyFootnotes` | High | Medium | SDD: parameterize `tidyFootnotes` with an include-set; cover every subset with tests, asserting single-edit output |
| Default-off-by-accident changes behavior for existing users | High | Low | Default every step ON; treat missing setting as ON; regression test for byte-identical all-on output |
| Scope creep into global built-in enable/disable | Medium | Medium | PRD fixes scope to "Format selection only"; individual commands and scripts explicitly out of scope |
| Confusing UX if all steps disabled | Low | Low | Clear "Nothing to format" notice; no silent document change |

## Open Questions
None — design is decided (granularity = 5 fine toggles; Tidy footnotes fixed; default
all-on).

---

## Supporting Research

### Competitive Analysis
`benature/obsidian-text-format` exposes ~40 independent text commands but no composite
"recipe" command — users chain many commands manually. Mason's differentiator is the
fused single-undo composite; this feature keeps that strength while adding the
selectivity text-format gets only by virtue of having separate commands.

### User Research
Direct user (maintainer) feedback drove this: the desire to keep "Format selection"
but suppress individual steps (notably "move to Resources"), without affecting other
commands or scripts.

### Market Data
N/A — single-maintainer open-source Obsidian plugin; no market sizing relevant.
