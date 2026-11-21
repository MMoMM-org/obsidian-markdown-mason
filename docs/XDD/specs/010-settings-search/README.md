# Specification: 010-settings-search

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-11-21 |
| **Current Phase** | SDD |
| **Decomposition tier** | {{DECOMPOSITION_TIER}} |
| **Model tier** | {{MODEL_TIER}} |
| **Last Updated** | 2026-11-21 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | v1.0: 10 features (7 Must, 3 Should), 38 acceptance criteria |
| solution.md | pending | |
| plan/ | pending | |

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

## Context

Make Markdown Mason's settings discoverable through Obsidian's settings search (1.13.0+ declarative settings API, `PluginSettingTab.getSettingDefinitions()`).

Known constraints going in:
- On 1.13+, a non-empty `getSettingDefinitions()` means `display()` is no longer called, so the whole segmented tab (General / Scripts / Commands / Advanced) has to render from definitions (pages, groups, lists, `render` rows for custom UI).
- ~~`minAppVersion` stays 1.7.2 with display() as the fallback~~. Superseded 2026-11-21 by the Path A decision: minAppVersion becomes 1.13.0 and display() is removed.
- SSOT: each setting is defined once (declaratively).
- API typings: `node_modules/obsidian/obsidian.d.ts` (SettingDefinition*, getControlValue/setControlValue, update(), refreshDomState()).

---
*This file is managed by the xdd-meta skill.*
