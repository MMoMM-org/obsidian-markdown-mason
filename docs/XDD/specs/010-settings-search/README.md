# Specification: 010-settings-search

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-11-21 |
| **Current Phase** | Implementing |
| **Decomposition tier** | Incremental |
| **Model tier** | frontier |
| **Last Updated** | 2026-11-21 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | v1.0: 10 features (7 Must, 3 Should), 38 acceptance criteria |
| solution.md | completed | v1.0: 8 ADRs confirmed, 19 EARS criteria, 9 components |
| plan/ | completed | Incremental: 4 phases, 19 tasks (9 parallel), all 38 PRD criteria mapped |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

**Decomposition tier**: `Direct` (no plan) | `Incremental` (phase plan). Set by the classifier at the decomposition step and confirmed by the user; leave the placeholder until then. Read back by `spec.py --read`, which treats anything it does not recognise as absent.

**Model tier**: `routine` | `hard` | `frontier`. The classifier recommends it at the decomposition step and the user confirms it; leave the placeholder until then. `spec.py --read` treats anything it does not recognise as absent.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-11-21 | Spec created from scorecard warning | community.obsidian.md scorecard (0.9.2): "This PluginSettingTab does not implement getSettingDefinitions(); its settings will not appear in Obsidian's settings search for users on 1.13.0 or later" (src/ui/settingsTab.ts:86). Spec-first chosen over a quick wrapper because on 1.13+ a non-empty getSettingDefinitions() replaces display() entirely. |
| 2026-11-21 | Start with PRD; Standard research mode | Three parallel research agents: settings-tab inventory, 1.13 API capability map, UX/ecosystem. |
| 2026-11-21 | **Path A**: raise minAppVersion 1.7.2 → 1.13.0, remove display() and the segment nav | Research showed 1.13 Desktop has been public since 2026-07-30 (1.13.4; current public 1.15.1), so the original "1.13 is beta, keep 1.7.2" constraint is stale. Obsidian's migration guide recommends Path A; Linter, Templater and Switcher++ took it. One definition per setting (SSOT), no requireApiVersion guards, no dual UI to test. Users below 1.13 stay on 0.9.4. Supersedes the minAppVersion constraint in Context. |
| 2026-11-21 | Scripts → declarative `list` with per-script `render` rows | Each script is searchable by name. Status pill, toggle and ⋯ menu live in each row's render. Import and Browse move to list header buttons or addItem. Native look replaces the custom cards. |
| 2026-11-21 | Layout: mixed | General ungrouped at the top (style guide). Format selection and Advanced are headed groups on the main page. Scripts and Commands are sub-pages (dynamic, heavier). |
| 2026-11-21 | In scope: doc and comment drift fixes | Stale "four-segment", "eleven toggles" and "Run-script launcher" comments; README minimum version (1.6.6) and step counts; eslint.config.mjs:44 "not GA" comment, plus re-enabling prefer-setting-definitions. |
| 2026-11-21 | PRD approved → SDD | User approved requirements.md v1.0 as drafted (no changes). Brainstorm step folded into the research plus decision round to avoid re-asking settled questions. |
| 2026-11-21 | SDD approved; ADR-1 to ADR-8 confirmed | ADR-1 minAppVersion **1.13.1**, refining Path A's 1.13.0: page displayValue/status are @since 1.13.1, and 1.13.0 and 1.13.1 were early-access only. ADR-2 umbrella Format selection group + 4 sibling groups. ADR-3 Documentation row at the end of Advanced (user asked about tabs; the API has none; About sub-page declined). ADR-4 private openPagePath + fallback. ADR-5 get/setControlValue override via saveSettings (the base saveData would erase the scripts namespace). ADR-6 ScriptsCache single flight. ADR-7 header icons + searchable action rows. ADR-8 pure builders + definition-level tests. Runtime behaviour verified by reading the obsidian-1.15.1 bundle. |
| 2026-11-21 | Decomposition tier: Incremental | Classifier recommended Incremental (rule 1: 7 Must features, 6 new components; 38 PRD / 19 SDD criteria). Accepted. |
| 2026-11-21 | Model tier: frontier | Classifier recommended frontier (rule 2: novel_pattern=true, declarative definition builders; high_risks=2, settings reset and script rows losing actions; adr_count=8). Accepted; frontier cost sentence shown. |
| 2026-11-21 | PLAN complete → Ready; commit only | Plan written without a second discovery round (SDD research already covered sequencing, tests and risks). User chose commit only: no push or PR yet. Implementation branch: spec/010-settings-search-impl. |
| 2026-11-21 | Deviation D-1: pages and rows keyed by stable names, not `id` | Found in T1.1: Obsidian 1.13.1 typings declare no `id` on SettingDefinition*, and the 1.15.1 runtime keys by `id ?? name`. User approved: drop `id`; the deep link becomes openPagePath(pluginId, ['Scripts']). SDD (ADR-4 text, gotchas, interfaces) and phases 2-3 updated. |
| 2026-11-21 | Phase 1 drift check: update spec + add T1.6 | Drift and alignment checks: 0 FAIL, mostly SDD text lagging approved code. Recorded D-2 (old tab reads strings from the module already). SDD updated: no "intro" in the section enum, exports documented (FIXED_KEYS, fixedSetting, MainPageParts, FixedGroupRow, shared constants, REPO_URL, parseAuthorName, openUrl seam), code-context refs point at pluginIdentity.ts, responsibility row, directory map. New task T1.6 tests search reach and noise (PRD F1.2, F8.1, F8.2); the OCR→Dehyphenate and paste→suffix overlaps are pinned as related. |
| 2026-11-21 | Phase 2 drift check: update spec + add T2.6 | Drift and alignment checks: 0 FAIL. The SDD was updated for the approved review refinements (scriptsCache deps/getters/buildOfflineScriptItems, new scriptLifecycleOps block noting setRerender is registered by buildLifecycleOps and it must be built once, ScriptsPageState, rowName params, commandsPage types, a Build Commands page algorithm, Name (id) rule, split aliases, row DOM details, cache guards, D-3 trace cleanup). T2.6 added: iterative row-name disambiguation, plus tests for search by description and row removal on refresh. D-3 recorded (no generation guard). |
| 2026-11-21 | T4.1 pulled forward into Phase 3 (D-4) | The declarative tab calls SettingTab.update(), which lint rejects below minAppVersion 1.13.0; T4.1 (minAppVersion 1.13.1 + compliance test) committed first in d660bea. |
| 2026-11-21 | Phase 3 drift check: update spec + add T3.5 | Drift 0 FAIL / 7 WARN, all SDD text lagging approved code; SDD updated. T3.4 validation found partial alias-uniqueness coverage and a triplicated Active-or-no-op resolver; T3.5 added a whole-tree alias test (script-id aliases exempt) and buildScriptFnResolver. Phase 3 closed at 0e2e236: 2101 tests, tsc and lint clean. |

## Context

Make Markdown Mason's settings discoverable through Obsidian's settings search (1.13.0+ declarative settings API, `PluginSettingTab.getSettingDefinitions()`).

Known constraints going in:
- On 1.13+, a non-empty `getSettingDefinitions()` means `display()` is no longer called, so the whole segmented tab (General / Scripts / Commands / Advanced) has to render from definitions (pages, groups, lists, `render` rows for custom UI).
- ~~`minAppVersion` stays 1.7.2 with display() as the fallback~~. Superseded 2026-11-21 by the Path A decision: minAppVersion becomes 1.13.0 and display() is removed.
- SSOT: each setting is defined once (declaratively).
- API typings: `node_modules/obsidian/obsidian.d.ts` (SettingDefinition*, getControlValue/setControlValue, update(), refreshDomState()).

---
*This file is managed by the xdd-meta skill.*
