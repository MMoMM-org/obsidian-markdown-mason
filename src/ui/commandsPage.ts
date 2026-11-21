// Commands page — turn enabled scripts into named commands (ADR-17, spec 010).
//
// buildCommandsPage returns the declarative page: an intro row that is always
// there, then one row per ENABLED script, or the empty-state row. Until the
// ScriptsCache has loaded, a loading row stands in for both, so the page never
// claims "no enabled scripts" about scripts it has not read yet. It builds
// synchronously from the ScriptsCache and performs no I/O.
//
// A command row has a name field (placeholder = the script id) and a toggle:
//   toggle on  → commandManager.register(id, name, fn, getState) + record.command = true
//   toggle off → commandManager.unregister(id) + record.command = false, enabled kept
//   rename     → record.commandName (trimmed; empty removes it), and a live
//                re-register while the command is active
//
// NO RE-RENDER ON EDIT
// ────────────────────
// A command row is a `render` row, which the settings runtime rebuilds on
// `update()` — that would take the focus out of the name field on every
// keystroke. So an edit saves through the store and patches `cache.records` in
// place; the next build, whenever it comes, starts from the edited values.
//
// The script function is resolved when a command is registered, never while a
// row is built.
//
// Community compliance: sentence-case UI text, DOM via Setting helpers only,
// no default hotkeys.

import type { Setting, SettingDefinition, SettingDefinitionEmpty, SettingDefinitionPage } from "obsidian";
import type { ScriptFunction } from "../scripts/context";
import type { LifecycleState } from "../scripts/lifecycle";
import type { ScriptRecord, ScriptStore } from "../scripts/store";
import type { ScriptsCache } from "./scriptsCache";
import { SCRIPTS_LOADING_TEXT } from "./scriptsPage";

/** Minimal CommandManager surface a command row needs. */
export interface CommandsTabCommandManager {
	register(
		id: string,
		name: string,
		script: ScriptFunction,
		getState: (id: string) => LifecycleState,
	): void;
	unregister(id: string): void;
}

/** Returns the ScriptFunction for a script id. */
export type ScriptFnResolver = (id: string) => ScriptFunction;

/** Returns the current LifecycleState for a script id. */
export type StateResolver = (id: string) => LifecycleState;

/**
 * The part of ScriptsCache a command row reads and patches. Narrower than
 * CommandPageCache on purpose: a row never needs `items`, so a caller can hand
 * it a bare records holder.
 */
export type CommandRecordsCache = Pick<ScriptsCache, "records">;

/** The part of ScriptsCache the Commands page builds from; `items === null` means not loaded yet. */
export type CommandPageCache = Pick<ScriptsCache, "records" | "items">;

/** The narrow collaborators the Commands page needs. */
export interface CommandPageDeps {
	store: Pick<ScriptStore, "getScripts" | "setRecord">;
	commandManager: CommandsTabCommandManager;
	resolveScriptFn: ScriptFnResolver;
	getState: StateResolver;
}

/** What one command row needs: the page collaborators plus the cache its edits patch. */
export interface CommandRowDeps extends CommandPageDeps {
	cache: CommandRecordsCache;
}

export const COMMANDS_PAGE_NAME = "Commands";

/** How the page works. Shown once, above the rows; carries the search vocabulary. */
export const COMMANDS_INTRO = {
	name: "Script commands",
	desc: "Name the command, toggle to create it, then bind keys in core hotkeys.",
	aliases: ["hotkey", "command palette"],
} as const;

export const COMMANDS_EMPTY_STATE = {
	name: "No enabled scripts",
	desc: "Enable a script in the Scripts tab first, then return here to create a command for it.",
} as const;

/**
 * Build the Commands page from the cached script records.
 *
 * Row names are the script ids: stable and unique among siblings, which is what
 * the settings runtime keys rows by. Only an id that reads like one of the
 * page's own rows is listed under another name (see commandRowName).
 */
export function buildCommandsPage(cache: CommandPageCache, deps: CommandPageDeps): SettingDefinitionPage {
	return {
		type: "page",
		name: COMMANDS_PAGE_NAME,
		items: [introRow(), ...scriptRows(cache, deps)],
	};
}

/** The rows below the intro: loading, one per enabled script, or the empty state. */
function scriptRows(cache: CommandPageCache, deps: CommandPageDeps): SettingDefinition[] {
	if (cache.items === null) return [loadingRow()];

	const rowDeps: CommandRowDeps = { ...deps, cache };
	const commandRows: SettingDefinition[] = Object.entries(cache.records)
		.filter(([, record]) => record.enabled)
		.map(([id, record]) => {
			const rowName = commandRowName(id, cache.records);
			return {
				name: rowName,
				render: (setting: Setting) => configureCommandRow(setting, id, record, rowDeps, rowName),
			};
		});
	return commandRows.length > 0 ? commandRows : [emptyStateRow()];
}

/** The names of the page's own rows; no script row may be listed under one of them. */
const PAGE_ROW_NAMES: ReadonlySet<string> = new Set([
	COMMANDS_INTRO.name,
	COMMANDS_EMPTY_STATE.name,
	SCRIPTS_LOADING_TEXT,
]);

const SCRIPT_ROW_SUFFIX = " (script)";

/**
 * The name script `id` is listed under: the id itself, unless that is the name
 * of one of the page's own rows. Such an id gets a suffix, repeated until the
 * name is free of the page's rows and of every other script id.
 */
function commandRowName(id: string, records: Record<string, ScriptRecord>): string {
	let name = id;
	while (PAGE_ROW_NAMES.has(name) || (name !== id && name in records)) {
		name += SCRIPT_ROW_SUFFIX;
	}
	return name;
}

/**
 * Turn `setting` into the command row of script `id`: name field plus
 * create-command toggle. `rowName` is the name the row is listed under; it
 * differs from the id only when the id is the name of one of the page's own rows.
 */
export function configureCommandRow(
	setting: Setting,
	id: string,
	record: ScriptRecord,
	deps: CommandRowDeps,
	rowName: string = id,
): void {
	const { store, commandManager, resolveScriptFn, getState, cache } = deps;

	const save = async (next: ScriptRecord): Promise<void> => {
		await store.setRecord(id, next);
		cache.records[id] = next;
	};
	const register = (rec: ScriptRecord | undefined): void => {
		commandManager.register(id, commandLabel(id, rec), resolveScriptFn(id), getState);
	};

	setting
		.setName(rowName)
		.addText((text) => {
			text
				.setPlaceholder(id)
				.setValue(record.commandName ?? "")
				.onChange(async (value) => {
					const existing = (await store.getScripts())[id];
					if (existing === undefined) return;
					const next = withCommandName(existing, value);
					await save(next);
					// Only an active command has a palette / hotkeys label to refresh.
					if (existing.command) register(next);
				});
		})
		.addToggle((toggle) => {
			toggle
				.setValue(record.command)
				.onChange(async (on) => {
					const existing = (await store.getScripts())[id];
					if (on) register(existing);
					else commandManager.unregister(id);
					if (existing !== undefined) await save({ ...existing, command: on });
				});
		});
}

function introRow(): SettingDefinitionEmpty {
	return { ...COMMANDS_INTRO, aliases: [...COMMANDS_INTRO.aliases] };
}

function loadingRow(): SettingDefinitionEmpty {
	return { name: SCRIPTS_LOADING_TEXT };
}

function emptyStateRow(): SettingDefinitionEmpty {
	return { ...COMMANDS_EMPTY_STATE };
}

/** The command's label: the user's chosen name, else the script id. */
function commandLabel(id: string, record: ScriptRecord | undefined): string {
	return (record?.commandName ?? "").trim() || id;
}

/** A copy of `record` named `name` (trimmed); an empty name removes commandName. */
function withCommandName(record: ScriptRecord, name: string): ScriptRecord {
	const next: ScriptRecord = { ...record };
	const trimmed = name.trim();
	if (trimmed.length > 0) next.commandName = trimmed;
	else delete next.commandName;
	return next;
}
