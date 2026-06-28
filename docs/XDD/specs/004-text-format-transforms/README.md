# Specification: 004-text-format-transforms

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-06-28 |
| **Current Phase** | PRD |
| **Last Updated** | 2026-06-28 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | 7 must-have features, 38 Gherkin acceptance criteria, 0 clarifications |
| solution.md | pending | |
| plan/ | pending | |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-28 | Spec 004 scaffolded | Deferred scope from spec 003 (PRD "Won't Have This Phase"): new built-in transforms that plug into the Format-selection recipe with their own toggles. |
| 2026-06-28 | Scope = both families, all 6 transforms | cleanup.{dewrap, dehyphenate, ligatures, tidyWhitespace} + lists.{normalizeBullets, normalizeOrdered}. |
| 2026-06-28 | `ligatures` = glyphs + smart-punctuation, renamed "Decompose ligatures & punctuation" | Source plugin covers only glyphs; punctuation (curly quotes/dashes/ellipsis) is net-new. Direction = decompose to ASCII (not apply). Avoid W→VV homoglyph. |
| 2026-06-28 | Full built-in exposure | Each transform = individual command + `mason.*` API + recipe toggle. Consistent with the existing 6 built-ins; ADR-19: commands/API ignore the recipe. |
| 2026-06-28 | Settings UI: `setHeading` sub-groups | 5+6=11 toggles grouped Cleanup/Lists/Headings/Footnotes. Evolves the 003 no-setHeading pattern (setHeading is a supported standard API). |
| 2026-06-28 | `dewrap` default ON | Behavior-preserving model, conditioned on solid markdown-awareness + comprehensive edge-case tests. |
| 2026-06-28 | Markdown-awareness is THE differentiator | Reference plugin `benature/obsidian-text-format` is markdown-blind (destroys lists/code/tables). Mason's text transforms must segment markdown blocks and never corrupt structure. Defaults: bullet→`-`; ordered sequential per-level; dehyphenate lowercase→lowercase on `-\n` before dewrap; roman/alpha + tabs untouched. |
| 2026-06-28 | PRD complete (4-agent research: Requirements/Technical/Source/UX) | 7 features (one per transform + recipe-integration/isolation), 38 Gherkin AC, 0 clarifications. Idempotency added as an explicit invariant. |

## Context

**Seed (from spec 003):** Add new built-in transforms — `cleanup.*` (dewrap md-aware,
dehyphenate, ligatures, tidyWhitespace) and `lists.*` (normalizeBullets,
normalizeOrdered) — adopted from the `benature/obsidian-text-format` feature set
(~40 independent commands, no composite). They plug into the **spec-003 Format-selection
recipe mechanism** as additional gated steps with their own toggles — no special case.
Mason's differentiator stays the fused single-undo composite plus selectivity.

**Anchors:** spec 003 (`resolveFormatSelectionRecipe`, gated `fusedFormatNote`, settings
section), `src/core/registry.ts` (built-in entry pattern), `catalog/CLAUDE.md`
(compositional authoring contract).

---
*This file is managed by the xdd-meta skill.*
