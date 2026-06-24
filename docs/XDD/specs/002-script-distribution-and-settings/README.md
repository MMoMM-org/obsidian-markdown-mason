# Specification: 002-script-distribution-and-settings

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-06-23 |
| **Current Phase** | Implemented |
| **Last Updated** | 2026-06-24 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | 11 Must + 1 Should + 2 Could features; 47 acceptance criteria; approved 2026-06-23 |
| solution.md | completed | Hexagonal + derived-state lifecycle; ADR-11..17 confirmed 2026-06-23 (ADR-16 = envelope-only) |
| plan/ | completed | 5 phases, 22 tasks (7 parallel); README manifest + phase-1..5.md; full PRD→phase coverage |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-23 | Scaffold spec from converged idea brief | Source: `docs/XDD/ideas/2026-06-22-scripts-redesign.md` (status: converged-design); 7 parked open questions already resolved |
| 2026-06-23 | Start Full PRD → SDD → PLAN in Agent Team mode | User choice; converged brief warrants full traceability across 3 phases |
| 2026-06-23 | Research grounded directly (read-only), not via subagents | Agent dispatcher hit a model-classifier outage; read-only ops unaffected. Found: store.ts still on ADR-6 device.json sidecar (data.json migration is the spine); checksum computed over decoded text not raw bytes (byte-exact required); no esbuild `define` flag yet (needed for dev-override DCE); requestUrl not yet used in src |
| 2026-06-23 | PRD authored from brief without re-brainstorm | Brief is converged; re-litigating settled decisions is disallowed per project memory |
| 2026-06-23 | PRD approved → SDD | User chose "Continue to SDD" |
| 2026-06-23 | SDD: derived lifecycle state (ADR-11) | Minimal synced surface; last-write-wins safe; cross-device "enabled-but-unmaterialized" falls out for free |
| 2026-06-23 | SDD: envelope-only script shape (ADR-16, non-default) | User: no installed base / no existing scripts → no need for bare-function backward-compat; single canonical `{run, paste?}` shape |
| 2026-06-23 | SDD: byte-exact checksum & verbatim materialization (ADR-14) | Fixes latent CRLF/encoding false-drift from decoded-string hashing (runtime.ts:96) |
| 2026-06-23 | All 7 SDD ADRs (11-17) confirmed | User confirmed the full set |
| 2026-06-23 | PLAN authored: 5 phases, 22 tasks | Dependency-ordered: storage/lifecycle → distribution/materialization → envelope/chain/disclosure → settings/commands UI → dev-override/migration/E2E. All SDD components + PRD ACs covered; 3 known drift points owned by explicit tasks |
| 2026-06-24 | Implement Phases 4–5 via Agent Team (TDD + dual-review gates) | All tasks gated tdd-guardian → implementer → spec-compliance → code-quality; gates caught and fixed real defects (concurrent-render races, a silent edit-plan data-loss, a semantic mis-wire). 951 tests green after Phase 5 |
| 2026-06-24 | T5.5 recorded deviation: production GUI not wired to the live engine | Phase 4 deferred the UI resolvers to "P5"; no Phase-5 task scheduled the wiring (T5.3 added composed-unit e2e with "no production glue"). Lifecycle proven by tests, but the live settings UI cannot drive enable→materialize→run (online:false / _comingSoon / empty paste chain / buildCatalogSource unused) |
| 2026-06-24 | Added Phase 6 (Live GUI Wiring) | User decision: close the deviation now. 4 tasks (T6.1 resolver+catalog, T6.2 lifecycle ops, T6.3 module-load/chain/launcher, T6.4 wired-e2e + final validation) replacing every `// P5:` seam with a real implementation |
| 2026-06-24 | T6.3 security review caught a match-gate bypass | The network-free runnability check used okayed.checksum as the local checksum, so a tampered .cjs (same version) would run; fixed to byte-authoritative (recompute local checksum from on-disk bytes), preserving network-free + adding a regression-protected real-assembly test |
| 2026-06-24 | T6.4 validation found a remove deviation → added T6.5 | remove(curated) yielded Disabled not Available (store had no deleteRecord); T6.5 added ScriptStore.deleteRecord + made remove delete the record (+unregister command, delete file, remove fingerprint) → Available/Absent per the SDD state diagram |
| 2026-06-24 | Implementation complete | Phases 4-6 done via Agent Team (TDD + tdd-guardian→implementer→spec-compliance→code-quality gates; gates caught real defects: concurrent-render races, silent edit-plan data loss, semantic mis-wire, match-gate bypass, command-cleanup gap). v0.2: segmented settings, Scripts cards + ⋯ menu, Templater-style commands + Run-script launcher, full lifecycle wired live, per-device materialization fingerprint, byte-authoritative network-free match-gate, dev-override DCE, 3 Perplexity scripts → standalone catalog .cjs (main.js lean), docs/RELEASE.md. 1066 tests / lint / compliance / build / check:manifest all green. Branch feat/002-script-distribution-and-settings (not yet merged) |

## Context

Curated scripts (the four Perplexity scripts) move from compiled-into-`main.js` first-party
code to **first-class managed catalog content**: shipped in the SHA-pinned vetted repo,
pulled on demand via `requestUrl`, and given the same full lifecycle as imported scripts
(install, consent, enable/disable, remove/reinstall). One unified trust model and state
machine across curated + imported scripts, with a `provenance` flag controlling only the
re-materialization source and presentation badge. Settings gains a segmented top nav
(`General · Scripts · Commands · Advanced`). The hardcoded paste-and-format autodetect
generalizes into a data-driven `buildPasteChain()` matcher built from enabled scripts'
`paste.canHandle` predicates; `perplexity-auto` is retired.

Inherits ADR-8 (vetted-repo distribution) and the T7.5 Sync correction (consent rides
synced `data.json`; code re-materialized per-device, accepted only on version+checksum
match). No v0.1 migration — no existing users.

---
*This file is managed by the xdd-meta skill.*
