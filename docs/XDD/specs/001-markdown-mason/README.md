# Specification: 001-markdown-mason

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-06-16 |
| **Current Phase** | PRD |
| **Last Updated** | 2026-06-16 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | Full-plugin scope (v0.1–v0.3); 34 Gherkin acceptance criteria |
| solution.md | pending | |
| plan/ | pending | |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-16 | Spec scope = **full plugin (v0.1–v0.3)** | User chose one comprehensive spec over per-version specs; covers core ops, sources, transform library/registry, manifest/integrity model, trust boundary, settings, JS escape hatch. |
| 2026-06-16 | Start phase = **PRD**; Mode = **Agent Team** | No formal requirements doc exists yet; 3 phases planned over a complex domain (Perplexity parser, security/supply-chain, Obsidian sync) with conflicting concerns (security vs flexibility) → persistent researcher teammates. |
| 2026-06-16 | **Sync finding flips open-decision #3** (Tech + Integration research) | Obsidian Sync replicates the **whole plugin folder** (incl. subdirs) when "Installed community plugin list" is on (off by default) — evidence is forum sync logs, high-confidence but not vendor-confirmed. ⇒ self-heal demotes to a fallback; **JS-propagation via Sync is real**; per-device state (JS `enabled`/consent) must live in a **sidecar via `vault.adapter`, never `data.json`**; execution consent must be **per-device**. **Action:** run the 2-device file-drop test before SDD finalize; update briefing §9. |
| 2026-06-16 | **O+D fused** (resolves open-decision #4) | Sequential O-then-D collides (gaps/reuse contradiction); the single "footnote-identity" pass (dedup-in-paste → match existing URL/reuse number → assign max+1 to new) is the only consistent design. Core returns an **EditPlan**; two-place edit applied as one CM6 transaction. |
| 2026-06-16 | **Drift = hard-block** (not dismissable warning) | Security: same-version+different-checksum must disable the transform until explicit user resolution, else a same-version malicious push can be clicked past. |

### Research agents (resumable via SendMessage)

| Perspective | Agent ID |
|---|---|
| Requirements | `afbf4cb28b34bf975` |
| Technical | `a89385b0a50d53155` |
| Security | `a3f037658990a01cd` |
| Integration | `a35b78e5b0a80589c` |
| UX | `a435ad3b19d3b48c5` |

## Context

Source briefing: project-root [`README.md`](../../../../README.md) — full concept/spec for the
**Markdown Mason** Obsidian plugin (paste/selection/whole-note Markdown structuring: heading
cascade, citation→footnote, footnote offset/renumber, dedup, move-to-Resources; plus a curated,
plugin-managed declarative transform library).

Open decisions inherited from briefing §12 (carry into PRD/SDD, do **not** silently resolve):
1. Raw Perplexity paste sample — partially resolved (author to supply; committable golden fixture + gitignored-local). Blocks C/O/D parser **implementation**, not the spec.
2. ~~Declarative vs JS~~ — DECIDED: declarative core (A); JS = desktop-only, consent-gated escape hatch, never auto-pulled.
3. Obsidian plugin-dir **sync behavior** (LOAD-BEARING) — does Sync replicate plugin-dir script files or only `data.json`? The self-heal/re-import model depends on it. → verify via `tcs-patterns:obsidian-plugin`.
4. O↔D coupling — fuse into one footnote-identity stage; EditPlan as core return type. Confirm before SDD finalizes algorithms.
5. PR vetting process for the curated set (perspectively automatable: "markdown-ops only, no external access").
6. M target default — prefer existing `## Resources`, else note-end. Confirm.
7. Final name — "Markdown Mason" is a working title.

---
*This file is managed by the xdd-meta skill.*
