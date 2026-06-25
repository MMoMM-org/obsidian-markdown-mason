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
// TOGGLE WIRING
// ─────────────
// Toggle ON  → commandManager.register(id, name, fn, getState) + store.setRecord command=true
// Toggle OFF → commandManager.unregister(id) + store.setRecord command=false, enabled preserved
//
// COMMUNITY COMPLIANCE
// ────────────────────
// - All UI text: sentence case.
// - DOM via Setting helpers only — never innerHTML/outerHTML/insertAdjacentHTML.
// - No default hotkeys.

import { Setting } from "obsidian";
import type { ScriptFunction } from "../scripts/context";
import type { LifecycleState } from "../scripts/lifecycle";
import type { ScriptRecord, ScriptStore } from "../scripts/store";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Minimal CommandManager surface consumed by the Commands tab. */
export interface CommandsTabCommandManager {
	register(
		id: string,
		name: string,
		script: ScriptFunction,
		getState: (id: string) => LifecycleState,
	): void;
	unregister(id: string): void;
}

/** Resolver that returns a ScriptFunction for a given script id. P5: real module loader. */
export type ScriptFnResolver = (id: string) => ScriptFunction;

/** Resolver that returns the current LifecycleState for a given script id. */
export type StateResolver = (id: string) => LifecycleState;

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

	for (const [id, record] of enabled) {
		_renderScriptRow(containerEl, id, record, store, commandManager, resolveScriptFn, getState);
	}
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function _renderEmptyState(containerEl: HTMLElement): void {
	new Setting(containerEl)
		.setName("No enabled scripts")
		.setDesc(
			"Enable a script in the Scripts tab first, then return here to create a command for it.",
		);
}

function _renderScriptRow(
	containerEl: HTMLElement,
	id: string,
	record: ScriptRecord,
	store: Pick<ScriptStore, "getScripts" | "setRecord">,
	commandManager: CommandsTabCommandManager,
	resolveScriptFn: ScriptFnResolver,
	getState: StateResolver,
): void {
	// Effective command label = the user's chosen name, else the script id.
	const effectiveName = (rec: ScriptRecord): string => (rec.commandName ?? "").trim() || id;

	new Setting(containerEl)
		.setName(id)
		.setDesc("Name the command, toggle to create it, then bind keys in core hotkeys.")
		// Editable command name. Empty → the script id is used. Changing it while a
		// command exists re-registers so the palette / Hotkeys label updates live.
		.addText((text) => {
			text
				.setPlaceholder(id)
				.setValue(record.commandName ?? "")
				.onChange(async (value) => {
					const existing = (await store.getScripts())[id];
					if (existing === undefined) return;
					const trimmed = value.trim();
					const next: ScriptRecord = { ...existing };
					if (trimmed.length > 0) next.commandName = trimmed;
					else delete next.commandName;
					await store.setRecord(id, next);
					// Re-register live only if a command is currently active.
					if (existing.command) {
						commandManager.register(id, effectiveName(next), resolveScriptFn(id), getState);
					}
				});
		})
		.addToggle((toggle) => {
			toggle
				.setValue(record.command)
				.onChange(async (on) => {
					const existing = (await store.getScripts())[id];
					if (on) {
						const name = existing !== undefined ? effectiveName(existing) : id;
						commandManager.register(id, name, resolveScriptFn(id), getState);
						if (existing !== undefined) {
							await store.setRecord(id, { ...existing, command: true });
						}
					} else {
						commandManager.unregister(id);
						if (existing !== undefined) {
							await store.setRecord(id, { ...existing, command: false });
						}
					}
				});
		});
}
