# Specification: 003-format-selection-recipe

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-06-28 |
| **Current Phase** | Implemented |
| **Last Updated** | 2026-06-28 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | 5 must-have features, 14 acceptance criteria, 0 clarifications |
| solution.md | completed | Settings model + parameterized tidyFootnotes + fusedFormatNote gating + UI; ADR-18/19 |
| plan/ | completed | 4 phases, 7 tasks; refs drift-checked against current code |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-28 | Toggle is a recipe for "Format selection" only, not a global built-in enable/disable | Paste flow is compositional (one script wins, calls built-ins explicitly); individual commands stay always-registered; scripts stay deterministic. "Format selection" is the only command bundling steps the user can't pick individually. |
| 2026-06-28 | Granularity = FINE (5 toggles: cascade, normalize, fromCitations, identity, move) | Matches "one toggle per built-in step"; consistent per-step UI. (Chosen over coarse 3-toggle option.) |
| 2026-06-28 | "Tidy footnotes" composite stays FIXED, ignores toggles | Deliberately-named footnote op; invoking it means you want all three steps. |
| 2026-06-28 | Default = all 5 steps ON | Preserves today's Format selection behavior (no behavior change on upgrade). |
| 2026-06-28 | ADR-18: paste flow is compositional — no auto-pipeline/veto | One script wins and explicitly composes mason.* built-ins; suppression = don't call. Continues project ADR sequence (last was ADR-17). |
| 2026-06-28 | ADR-19: Format selection is the only settings-driven composite | Only fusedFormatNote reads the recipe; Tidy footnotes fixed; individual commands + mason.* API ignore it. |
| 2026-06-28 | Validated (/validate 003) — 1 FAIL + LOW WARNs, all fixed | 3-agent validation: all code/line claims verified to the digit, cascade-offset gating sound. Fixed: PRD step-order typo (normalize→cascade), tidyFootnotes `= {}` default, SDD null-guard snippet, setHeading-not-a-pattern + 4-spot segment nav, CommandHost orphan, frontmatter status, vague language, added settings-tab test + notice/live-effect tests. |
| 2026-06-28 | Implementation complete | Branch `spec/003-format-selection-recipe`, 8 commits (`d1285e7`→plan docs). Recipe resolver + settings field + parameterized `tidyFootnotes`; `fusedFormatNote` gated (all-on byte-identical, all-off→"Nothing to format"); 5-toggle settings section (default on); ADR-19 isolation proven. Gates green: tsc + eslint + vitest (1239, +53) + production build + core-purity sweep. Per-task TDD with spec-compliance + code-quality review each. Manual Obsidian smoke handed to maintainer. Ships via semantic-release on merge to main. |

## Context

Make Mason's **"Format selection"** composite command a configurable recipe via
5 per-built-in-step toggles. Only that command consults the toggles.

**Architecture grounding (already verified in code):**
- Paste flow is strictly compositional — on "Paste and format" exactly one script
  wins (`chain.find(h => h.canHandle(rawText))`, `src/main.ts`) and explicitly
  calls the `mason.*` built-ins it wants. Built-ins never auto-run. → no
  auto-pipeline, no need for a script veto mechanism.
- `fusedFormatNote` (`src/commands.ts:276`) is an in-memory scratch-string
  pipeline: `normalize → cascade → tidyFootnotes(C→O+D→M) → diff(original→final)`.
  Skipping normalize/cascade is trivial (pass the prior string through).
- `tidyFootnotes` (`src/core/noteFootnotes.ts:592`) is OFFSET-FUSED (fromCitations
  expands `[n]` shifting offsets; identity and move edit the same def spans). To
  toggle fromCitations/identity/move individually it must be **parameterized** to
  accept an include-set `{fromCitations, identity, move}`.
- Settings: add a per-step enabled config to `MasonSettings` (default all true),
  surfaced in a new "Format selection" settings section with 5 checkboxes.
  Constraint: `Plugin.settings` typing forces Catalyst minAppVersion — use the
  established CommandHost-interface pattern, add no unsupported-API surface.

**ADRs to capture:** (a) paste is compositional — no auto-pipeline/veto;
(b) "Format selection" is the only settings-driven composite command.

**Out of scope (future spec 004):** new `cleanup.*`/`lists.*` built-in transforms
(text-format adoption — dewrap md-aware, dehyphenate, ligatures, tidyWhitespace,
normalizeBullets/Ordered). They will plug into THIS recipe mechanism as
additional Format-selection steps with their own toggles — no special case.

Authoring contract already documented at `catalog/CLAUDE.md` (compositional model).

---
*This file is managed by the xdd-meta skill.*
