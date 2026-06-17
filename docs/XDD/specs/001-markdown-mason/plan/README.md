---
title: "Markdown Mason — Implementation Plan (v0.1)"
status: draft
version: "1.0"
---

# Implementation Plan

## Validation Checklist

### CRITICAL GATES (Must Pass)

- [x] All `[NEEDS CLARIFICATION: ...]` markers have been addressed
- [x] All specification file paths are correct and exist
- [x] Each phase follows TDD: Prime → Test → Implement → Validate
- [x] Every task has verifiable success criteria
- [x] A developer could follow this plan independently

### QUALITY CHECKS (Should Pass)

- [x] Context priming section is complete
- [x] All implementation phases are defined with linked phase files
- [x] Dependencies between phases are clear (no circular dependencies)
- [x] Parallel work is properly tagged with `[parallel: true]`
- [x] Activity hints provided for specialist selection `[activity: type]`
- [x] Every phase references relevant SDD sections
- [x] Every test references PRD acceptance criteria
- [x] Integration & E2E tests defined in final phase
- [x] Project commands match actual project setup

---

## Scope

This plan implements **v0.1 (Must-Have)**: the operations, the versioned `mason.*` API, the
editor adapters, the three Perplexity parsers + auto-dispatcher, the script runtime, settings, and
release readiness. **v0.2** (official-repo download + manifest/integrity) and **v0.3** (auto-on-paste,
preview, more scripts) are out of this plan — see *Future Phases* at the bottom.

---

## Context Priming

*GATE: Read all files in this section before starting any implementation.*

**Specification**:
- `docs/XDD/specs/001-markdown-mason/requirements.md` — Product Requirements (PRD v1.1)
- `docs/XDD/specs/001-markdown-mason/solution.md` — Solution Design (10 ADRs)
- `README.md` — briefing (§5 algorithms, §7 extensibility, §8 architecture, §9 Obsidian notes)
- `assets/sakura-in-tokyo-{app,web,web-download}.md` — golden fixtures
- `https://github.com/MMoMM-org/miyo-tomo-hashi` `src/hooks/` — runtime to port

**Key Design Decisions** (from SDD):
- **ADR-1** EditPlan + single CM6 transaction — pure core returns `{from,to,insert}[]`; applied atomically.
- **ADR-2** Fused O+D footnote-identity — one numbering-owning stage.
- **ADR-3** Script runtime ported from `miyo-tomo-hashi/src/hooks/`.
- **ADR-4** Consent per checksum/version; fingerprint re-prompt.
- **ADR-5** Versioned `mason.*` operation registry — one definition → command + API.
- **ADR-6** Plugin-dir scripts; manifest in `data.json`; per-device enable/consent in a sidecar.
- **ADR-7** Desktop-only. **ADR-9** three Perplexity scripts + `perplexity-auto` dispatcher.
- **ADR-10** Explicit-invoke paste in v0.1.

**Implementation Context**:
```bash
# Testing
npm test                    # vitest run (unit + fixtures)
npm run test:watch          # vitest watch

# Quality
npm run lint                # eslint src/
# typecheck is part of build:
npm run build               # tsc -noEmit -skipLibCheck && esbuild production

# Dev
npm run dev                 # esbuild watch -> main.js
```

---

## Implementation Phases

Each phase is a separate file. Tasks follow red-green-refactor: **Prime** → **Test** (red) →
**Implement** (green) → **Validate** (refactor + verify).

- [x] [Phase 1: Scaffolding & Build Harness](phase-1.md)
- [x] [Phase 2: Core Operations (pure domain)](phase-2.md)
- [x] [Phase 3: Registry, mason.* API, Commands & Editor Adapters](phase-3.md)
- [ ] [Phase 4: Perplexity Parsers & Auto-Dispatcher](phase-4.md)
- [ ] [Phase 5: Script Runtime & Trust](phase-5.md)
- [ ] [Phase 6: Settings UI & Compliance](phase-6.md)
- [ ] [Phase 7: Integration, E2E & Release Readiness](phase-7.md)

---

## Dependencies (no cycles)

```
P1 ─▶ P2 ─▶ P3 ─▶ P5 ─▶ P6 ─▶ P7
        └─▶ P4 ──────────▲
```
- P2 depends on P1 (build/test harness).
- P3 and P4 both depend on P2 (P4 uses core types; can run parallel to P3).
- P5 depends on P3 (API/apply) and P4 (the scripts it wires + runs).
- P6 depends on P5; P7 depends on all.

---

## Future Phases (not in this plan)
- **v0.2 — Distribution:** official-repo fetch (`requestUrl`, commit-SHA pinned `index.json`),
  manifest/integrity (drift hard-block, update prompts), cross-device per-device-consent flow,
  the 2-device Sync verification spike. `[ref: SDD/ADR-8, ADR-6; PRD/Should-Have]`
- **v0.3 — Polish:** auto-on-paste mode, dry-run/preview, HTML-paste script, richer library UI.
  `[ref: PRD/Could-Have]`

---

## Plan Verification

| Criterion | Status |
|-----------|--------|
| A developer can follow this plan without additional clarification | ✅ |
| Every task produces a verifiable deliverable | ✅ |
| All PRD acceptance criteria map to specific tasks | ✅ |
| All SDD components have implementation tasks | ✅ |
| Dependencies are explicit with no circular references | ✅ |
| Parallel opportunities are marked with `[parallel: true]` | ✅ |
| Each task has specification references `[ref: ...]` | ✅ |
| Project commands in Context Priming are accurate | ✅ |
| All phase files exist and are linked from this manifest | ✅ |
