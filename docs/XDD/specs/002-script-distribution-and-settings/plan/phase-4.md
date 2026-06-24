---
title: "Phase 4: Settings UI & Command Management"
status: completed
version: "1.0"
phase: 4
---

# Phase 4: Settings UI & Command Management

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/User Interface & UX]` — segmented nav, card row wireframe, Commands tab, state diagram
- `[ref: SDD/ADR-17]` (segmented nav + Templater-style commands), `[ref: SDD/Error Handling]` (inline Blocked)
- `[ref: SDD/Implementation Gotchas]` — command unregister API, onLayoutReady timing, sentence-case/no-innerHTML
- Existing code: `src/ui/settingsTab.ts` (single-section tab), `src/main.ts:172-191` (command registration), `test/ui/settingsTab.test.ts`, `test/ui/xss.test.ts`

**Key Decisions**:
- ADR-17: four segments in one `PluginSettingTab`; "Create command" is opt-in and **decoupled** from enable; one built-in "Run script…" launcher lists Active only; no default hotkeys.
- Command "create" state rides `data.json` (`ScriptRecord.command`); commands unregistered on disable/remove; a stale command vs non-Active script fails safe.
- All actions drive the Phase 1-3 lifecycle (enable/disable/remove/import/update/retry).

**Dependencies**: Phase 1 (state/store), Phase 2 (materialize for enable/update/retry), Phase 3 (chain/launcher run path).

---

## Tasks

This phase delivers the user-facing surface: the segmented settings, script cards with contextual actions, command management, and the run launcher.

- [x] **T4.1 Segmented settings shell** `[activity: frontend-ui]`

  1. Prime: Read the IA + segmented-nav decision `[ref: SDD/User Interface & UX; SDD/ADR-17]`; current `settingsTab.ts` render flow.
  2. Test (RED): renders exactly four segments (General · Scripts · Commands · Advanced); selecting a segment shows only that section; General/Advanced retain v0.1 controls; sentence-case; no `innerHTML`.
  3. Implement (GREEN): Refactor `src/ui/settingsTab.ts` into a segmented shell delegating to section renderers; keep General/Advanced content.
  4. Validate: update `test/ui/settingsTab.test.ts`; `npm run compliance`; lint; types.
  - Success: four-segment nav, no control loss `[ref: PRD/F7]`.

- [x] **T4.2 Scripts tab — card rows + ⋯ menu + toolbar** `[activity: frontend-ui]`

  1. Prime: Read the card wireframe + state→action mapping `[ref: SDD/User Interface & UX]`.
  2. Test (RED): each script renders name, provenance badge, status pill (Active/Disabled/Update/Blocked), version, toggle; ⋯ exposes only valid actions per state (update only when UpdateAvailable, retry only when Blocked, view-source curated=repo link/imported=reveal); Blocked shows reason+recovery inline; toolbar has Import/Browse official; meaningful empty state (no misleading "No scripts installed yet").
  3. Implement (GREEN): Create `src/ui/scriptsTab.ts` driven by `evaluateState`; actions call lifecycle ops (enable→disclosure→materialize, disable, remove→Available/Absent, retry, update, re-review).
  4. Validate: new `test/ui/scriptsTab.test.ts`; `npm run compliance` (XSS/sentence-case); lint; types.
  - Success: cards + contextual actions + inline Blocked `[ref: PRD/F1, F6, F8]`; UpdateAvailable badge `[ref: PRD/F4]`.

- [x] **T4.3 CommandManager (register/unregister + cleanup)** `[activity: backend-api]`

  1. Prime: Read Templater-model decision + command-unregister gotcha `[ref: SDD/ADR-17; SDD/Implementation Gotchas]`; verify the current Obsidian command unregister API (claude-code-guide/obsidian-plugin skill).
  2. Test (RED): toggling `command` on registers an Obsidian command (no default hotkey); off unregisters; disabling/removing a script unregisters and clears `command` state; a command invoked against a non-Active script notifies the Blocked/disabled reason and does not execute.
  3. Implement (GREEN): Create `src/scripts/commandManager.ts`; track registered ids; integrate with `main.ts` registration (respect `onLayoutReady` timing; safe to re-run).
  4. Validate: new `test/scripts/commandManager.test.ts`; lint; types.
  - Success: command lifecycle decoupled from enable + cleaned up `[ref: PRD/F9]`; stale command fails safe `[ref: PRD/F9]`.

- [x] **T4.4 Commands tab + "Run script…" launcher** `[activity: frontend-ui]` `[parallel: true]`

  1. Prime: Read the Commands-tab wireframe + launcher rule `[ref: SDD/User Interface & UX]`.
  2. Test (RED): Commands tab lists each **enabled** script with a "Create command" toggle (bound to CommandManager); built-in "Mason: Run script…" opens a modal listing **only Active** scripts; selecting one runs it via `ScriptRunner` with `source:"command"`; disabled/blocked never listed.
  3. Implement (GREEN): Create `src/ui/commandsTab.ts` and `src/ui/runScriptModal.ts`.
  4. Validate: new UI tests; `npm run compliance`; lint; types.
  - Success: opt-in commands + launcher lists Active only `[ref: PRD/F9]`.

- [x] **T4.5 Phase Validation** `[activity: validate]`

  - Run all Phase 4 tests; `npm run lint`; `npm run compliance`. Manually verify (dev vault) the four tabs render and a Blocked card shows reason+recovery.
