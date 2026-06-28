# Specification: 004-text-format-transforms

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-06-28 |
| **Current Phase** | Ready |
| **Last Updated** | 2026-06-28 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | 7 must-have features, 38 Gherkin acceptance criteria, 0 clarifications |
| solution.md | completed | 5 ADRs (ADR-20..24, all confirmed), 38 EARS criteria, pipeline order + markdownBlocks segmenter design |
| plan/ | completed | 6 phases, 14 tasks; alignment-checked against current code (no drift) |

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
| 2026-06-28 | ADR-20: markdown-awareness via custom pure line-based segmenter (`src/core/markdownBlocks.ts`) | No parser dependency — CON-2 purity, zero deps, bundle size, unit-testable. Trade-off: hand-maintained block detection (covered by exhaustive tests). Confirmed. |
| 2026-06-28 | ADR-21: step order Cleanup → Lists → Headings → Footnotes | dehyphenate before dewrap (keys on `-\n`); existing 5 keep relative order so the 003 byte-identity regression holds. Confirmed. |
| 2026-06-28 | ADR-22: flat recipe keys + two pure modules | `dewrap/dehyphenate/decomposeLigatures/tidyWhitespace/normalizeBullets/normalizeOrdered` on FormatSelectionRecipe; `src/core/cleanup.ts` + `src/core/lists.ts` + `markdownBlocks.ts`. Matches the flat 003 pattern. Confirmed. |
| 2026-06-28 | ADR-23: settings toggles grouped via `setHeading` | Cleanup/Lists/Headings/Footnotes sub-groups; 11 flat toggles unscannable. setHeading is supported standard API. Evolves the 003 no-setHeading choice. Confirmed. |
| 2026-06-28 | ADR-24: full built-in exposure | Each transform = individual command + `mason.*` API + recipe toggle, under ADR-19 isolation (commands/API ignore the recipe). Confirmed. |
| 2026-06-28 | SDD complete | 1240 lines, 5 ADRs, 38 EARS criteria, 0 clarifications. Pipeline insertion design + markdownBlocks segmenter + dewrap example + setHeading UI wireframe. |
| 2026-06-28 | PLAN complete → spec Ready | 6 phases, 14 tasks (TDD Prime→Test→Implement→Validate). Graph: P1→{P2,P3,P5}; {P2,P3}→P4; {P4,P5}→P6. Alignment-checked: all modify-targets exist in current code; the 3 new modules don't yet exist (correct). |

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
