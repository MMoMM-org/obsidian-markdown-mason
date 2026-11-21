// T4.4  Commands tab — "Create command" toggles for enabled scripts (ADR-17).
//
// DESIGN
// ──────
// renderCommandsTab is a thin async controller: it reads the store, filters to
// enabled scripts, then renders one Setting row per script. Each row has:
//   - The script id as the name (P5: will be replaced with a display name)
//   - A "Create command" toggle reflecting record.command
//   - Hint text pointing the user to core Hotkeys for keybinding
//
// P5 SEAM
// ───────
// The real script function and getState resolver are injected via:
//   resolveScriptFn(id) → ScriptFunction   (P5: real module loader)
//   getState(id)        → LifecycleState   (P5: live lifecycle resolver)
// Tests inject fakes; main.ts injects P5 adapters when they exist.
//
// ROW WIRING
// ──────────
// A row is configured by configureCommandRow (commandsPage.ts), which the
// declarative Commands page shares. This renderer goes away with spec 010 T3.1.
//
// COMMUNITY COMPLIANCE
// ────────────────────
// - All UI text: sentence case.
// - DOM via Setting helpers only — never innerHTML/outerHTML/insertAdjacentHTML.
// - No default hotkeys.

import { Setting } from "obsidian";
import type { ScriptStore } from "../scripts/store";
import { COMMANDS_EMPTY_STATE, COMMANDS_INTRO, configureCommandRow } from "./commandsPage";
import type { CommandRowDeps, CommandsTabCommandManager, ScriptFnResolver, StateResolver } from "./commandsPage";

export type { CommandsTabCommandManager, ScriptFnResolver, StateResolver } from "./commandsPage";

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Render the Commands tab content into containerEl.
 *
 * Lists each ENABLED script (record.enabled === true) with a "Create command"
 * toggle. Disabled scripts are never shown.
 *
 * P5 seam: resolveScriptFn and getState are injected — not wired to live modules.
 */
export async function renderCommandsTab(
	containerEl: HTMLElement,
	store: Pick<ScriptStore, "getScripts" | "setRecord">,
	commandManager: CommandsTabCommandManager,
	resolveScriptFn: ScriptFnResolver,
	getState: StateResolver,
): Promise<void> {
	const scripts = await store.getScripts();
	const enabled = Object.entries(scripts).filter(([, rec]) => rec.enabled);

	if (enabled.length === 0) {
		_renderEmptyState(containerEl);
		return;
	}

	// This tab re-reads the store on every render, so the cache is a throwaway.
	const deps: CommandRowDeps = {
		store,
		commandManager,
		resolveScriptFn,
		getState,
		cache: { records: { ...scripts } },
	};
	for (const [id, record] of enabled) {
		const setting = new Setting(containerEl);
		configureCommandRow(setting, id, record, deps);
		// Without an intro row, every row carries the hint.
		setting.setDesc(COMMANDS_INTRO.desc);
	}
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function _renderEmptyState(containerEl: HTMLElement): void {
	new Setting(containerEl)
		.setName(COMMANDS_EMPTY_STATE.name)
		.setDesc(COMMANDS_EMPTY_STATE.desc);
}
