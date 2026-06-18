# Specification: 001-markdown-mason

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-06-16 |
| **Current Phase** | Implemented |
| **Last Updated** | 2026-06-18 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | v1.1 (JS-scripts-first pivot); 11 features, 45 Gherkin acceptance criteria |
| solution.md | completed | Hexagonal; 10 ADRs all confirmed; EARS acceptance criteria |
| plan/ | completed | 7 phases (v0.1), TDD tasks; v0.2/v0.3 noted as future |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-16 | Spec scope = **full plugin (v0.1–v0.3)** | User chose one comprehensive spec over per-version specs; covers core ops, sources, transform library/registry, manifest/integrity model, trust boundary, settings, JS escape hatch. |
| 2026-06-16 | Start phase = **PRD**; Mode = **Agent Team** | No formal requirements doc exists yet; 3 phases planned over a complex domain (Perplexity parser, security/supply-chain, Obsidian sync) with conflicting concerns (security vs flexibility) → persistent researcher teammates. |
| 2026-06-16 | **Sync finding flips open-decision #3** (Tech + Integration research) | Obsidian Sync replicates the **whole plugin folder** (incl. subdirs) when "Installed community plugin list" is on (off by default) — evidence is forum sync logs, high-confidence but not vendor-confirmed. ⇒ self-heal demotes to a fallback; **JS-propagation via Sync is real**; per-device state (JS `enabled`/consent) must live in a **sidecar via `vault.adapter`, never `data.json`**; execution consent must be **per-device**. **Action:** run the 2-device file-drop test before SDD finalize; update briefing §9. |
| 2026-06-16 | **O+D fused** (resolves open-decision #4) | Sequential O-then-D collides (gaps/reuse contradiction); the single "footnote-identity" pass (dedup-in-paste → match existing URL/reuse number → assign max+1 to new) is the only consistent design. Core returns an **EditPlan**; two-place edit applied as one CM6 transaction. |
| 2026-06-16 | **Drift = hard-block** (not dismissable warning) | Security: same-version+different-checksum must disable the transform until explicit user resolution, else a same-version malicious push can be clicked past. |
| 2026-06-16 | **PIVOT: JS-scripts-first (Advanced Paste model), declarative core dropped** (PRD v1.1) | User feedback on PRD: extensibility is via custom JS scripts invokable on paste or as a command on a selection; ops H/C/O+D/M are an in-plugin **versioned, extensible API** scripts call; the 3 Perplexity surfaces ship as **downloadable scripts, not built-ins**; reuse the in-house `miyo-tomo-hashi` `src/hooks/` execution model. Script support is **foundational v0.1** (no later rewrite). **Desktop-only** accepted (`isDesktopOnly:true`). Storage = plugin dir; download from vetted official repo (Markdown-in-note only, doc-required PR) or vault-import community scripts at user discretion. Consent = once per **checksum/version**. §2 blocker **resolved** — 3 samples committed under `assets/`. |

| 2026-06-16 | **SDD: 10 ADRs confirmed** | Hexagonal core + hashi-derived script runtime. ADR-1 EditPlan+single CM6 transaction · ADR-2 fused O+D · ADR-3 hashi runtime · ADR-4 per-checksum/version consent · ADR-5 versioned `mason.*` registry/API · ADR-6 plugin-dir storage + per-device sidecar · ADR-7 desktop-only · ADR-8 official-repo distribution (v0.2) · **ADR-9 three Perplexity scripts + auto-dispatcher** (amended) · ADR-10 explicit-invoke paste in v0.1 (auto-on-paste → v0.3). |
| 2026-06-18 | **T7.5 Sync spike resolves open-decision #3 — corrects the 2026-06-16 assumption** | Empirically: Obsidian Sync replicates only the plugin's own core files (`manifest.json`, `main.js`, `data.json`) — **NOT** `scripts/*.cjs` or the `device.json` sidecar. So the earlier "whole plugin folder syncs" premise (and the per-device-sidecar rationale built on it) was wrong. **v0.1 ships unaffected** (the non-syncing `device.json` is a correct per-device store; local-import + per-device consent is consistent, fail-closed). **For v0.2, ADR-6 is superseded:** enable/consent rides synced `data.json`; code is re-materialized per-device from the vetted SHA-pinned repo (ADR-8) or vault-import, accepted only on `checksum`+`version` match. See [`sync-spike.md`](sync-spike.md). |
| 2026-06-18 | **Implementation complete (Phase 7 / v0.1)** | All 7 plan phases done. Phase 7: full-stack E2E harness over CM6 (T7.1), consolidated invariant/failure suite (T7.2), EARS↔test traceability 14/14 (T7.3, `trace.md`), release workflow with `actions/attest-build-provenance` + manifest submission-lint (T7.4), Sync spike (T7.5), phase validation (T7.6). Two drift fixes surfaced & repaired: **DRIFT-1** script-path success count Notice (PRD F8-AC2/F7-AC3); **DRIFT-2** `scanExistingRefs` prevents paste footnote collision (PRD F3/F9). **680 tests green; build + lint + `check:manifest` clean.** Branch `feat/001-markdown-mason`. Live GitHub Actions release run is the only unverified-in-sandbox item. |

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
