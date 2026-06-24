// T4.3  CommandManager — per-script Obsidian command registration and cleanup
//
// DESIGN
// ──────
// CommandManager is the single place that owns per-script command lifecycle:
//   register(id, name, script, getState)   — add command; idempotent (removes first)
//   unregister(id)                          — remove command; no-op if unknown
//   disableScript(id)                       — unregister + persist command=false (ADR-17)
//   removeScript(id)                        — same as disableScript for removal flows
//
// The class is fully dependency-injected (no Plugin import) so it is unit-testable
// without a live Obsidian runtime. The minimal surface needed from the plugin is:
//   { addCommand(spec), removeCommand(fullId), pluginId }
//
// FAIL-SAFE (ADR-17)
// ──────────────────
// The editorCallback re-derives the script's state at invocation time via the
// injected getState resolver. If the script is no longer Active (Disabled /
// Blocked / any other non-Active state) the command notifies the user and returns
// WITHOUT running the script. This handles the "stale command" race condition where
// the user registered a command, then disabled/removed the script, but the Obsidian
// command palette still shows the old entry.
//
// COMMAND ID CONVENTION
// ─────────────────────
// Obsidian auto-prefixes command ids with `${manifest.id}:` when stored internally.
// The full id used by removeCommand is therefore `${pluginId}:${localId}`.
//
// ADR-17: command state rides data.json (ScriptRecord.command). On disable/remove
// the manager persists record.command=false through store.setRecord, preserving all
// other record fields.

import { Notice } from "obsidian";
import type { MasonSettings, EditPlan } from "../core/types";
import { DEFAULT_SETTINGS } from "../core/types";
import { ScriptRunner } from "./runner";
import type { RunnerEffects } from "./runner";
import type { ScriptFunction } from "./context";
import { buildScriptContext, buildGatedLogger } from "./context";
import type { LifecycleState } from "./lifecycle";
import type { ScriptStore } from "./store";
import { selectionContext } from "../sources/selection";
import { buildRegistry } from "../core/registry";
import type { Editor } from "obsidian";
import { applyEditPlan } from "../sources/apply";

// ---------------------------------------------------------------------------
// Public surface — minimal plugin surface needed from the caller
// ---------------------------------------------------------------------------

/** Minimal plugin surface injected into CommandManager. No Plugin class required. */
export interface PluginCommandSurface {
	/**
	 * Register a command. Returns the registered command.
	 *
	 * The editorCallback parameter is typed as `(editor: unknown)` rather than
	 * `(editor: Editor)` so the interface is compatible with both:
	 *   (a) the production Plugin.addCommand (cast to Editor inside the callback), and
	 *   (b) the test mock CommandSpec (where the callback receives `unknown`).
	 * The CommandManager's register() method casts the `unknown` argument to Editor
	 * internally — this is safe because Obsidian ALWAYS passes an Editor instance.
	 */
	addCommand(spec: {
		id: string;
		name: string;
		editorCallback: (editor: unknown) => void | Promise<void>;
	}): unknown;
	/** Unregister a command using the FULL prefixed id (e.g. "markdown-mason:my-id"). */
	removeCommand(fullId: string): void;
	/** The plugin's manifest id (used to construct full command ids). */
	pluginId: string;
}

/** A function that derives the current lifecycle state of a script by id. */
export type StateResolver = (id: string) => LifecycleState;

/**
 * Optional injection seam for testing — mirrors main.ts _commandInjection pattern.
 * Production code leaves this undefined; tests inject a spy for applyPlan.
 */
export interface CommandManagerInjection {
	/** Override for applyEditPlan — receives (editor, plan). Injected by tests. */
	applyPlan?: (editor: Editor, plan: EditPlan) => void;
}

// ---------------------------------------------------------------------------
// CommandManager
// ---------------------------------------------------------------------------

/**
 * Manages per-script Obsidian command registration and cleanup.
 *
 * Construct once; call register/unregister/disableScript/removeScript
 * to drive the command lifecycle. All state is tracked internally.
 *
 * Thread-safe assumption: single-threaded Obsidian plugin environment.
 */
export class CommandManager {
	private readonly _surface: PluginCommandSurface;
	private readonly _store: Pick<ScriptStore, "getScripts" | "setRecord">;
	private readonly _settings: MasonSettings;
	private readonly _injection: CommandManagerInjection | undefined;
	/** Set of script ids that currently have a registered command. */
	private readonly _registered: Set<string> = new Set();

	constructor(
		surface: PluginCommandSurface,
		store: Pick<ScriptStore, "getScripts" | "setRecord">,
		settings: MasonSettings = DEFAULT_SETTINGS,
		injection?: CommandManagerInjection,
	) {
		this._surface = surface;
		this._store = store;
		this._settings = settings;
		this._injection = injection;
	}

	/**
	 * Register an Obsidian command for a script.
	 * Idempotent: if the command is already registered, it is removed first.
	 * No default hotkeys are set (ADR-17).
	 *
	 * The editorCallback re-derives state at invoke time via getState.
	 * If the script is not Active, the command notifies the user and returns.
	 */
	register(
		id: string,
		name: string,
		script: ScriptFunction,
		getState: StateResolver,
	): void {
		// Idempotent: remove before re-adding
		if (this._registered.has(id)) {
			this._doRemoveCommand(id);
		}

		this._surface.addCommand({
			id,
			name,
			// Obsidian always passes a real Editor instance. Casting from unknown is
			// safe here; the unknown type is required by PluginCommandSurface for
			// mock-compatibility (see interface comment above).
			editorCallback: (rawEditor: unknown): Promise<void> => {
				return this._invokeScript(id, name, script, getState, rawEditor as Editor);
			},
		});

		this._registered.add(id);
	}

	/**
	 * Unregister an Obsidian command by script id.
	 * No-op if the id has never been registered.
	 */
	unregister(id: string): void {
		if (!this._registered.has(id)) {
			return;
		}
		this._doRemoveCommand(id);
	}

	/**
	 * Unregister the command for a script AND persist record.command=false.
	 * Called when a script is disabled by the user.
	 * No-op (no crash) if the script has no command registered.
	 */
	async disableScript(id: string): Promise<void> {
		await this._cleanupScript(id);
	}

	/**
	 * Unregister the command for a script AND persist record.command=false.
	 * Called when a script is removed from the store.
	 * No-op (no crash) if the script has no command registered.
	 */
	async removeScript(id: string): Promise<void> {
		await this._cleanupScript(id);
	}

	/**
	 * Run a script directly — reuses the private _invokeScript effects path.
	 *
	 * Used by RunScriptModal (T4.4) so the launcher does not duplicate the
	 * effects wiring (applyPlan/rawFallback/notify). Delegates entirely to
	 * _invokeScript, which re-derives state at call time via getState and
	 * fail-safes if the script is not Active.
	 */
	async runScript(
		id: string,
		name: string,
		script: ScriptFunction,
		getState: StateResolver,
		editor: Editor,
	): Promise<void> {
		await this._invokeScript(id, name, script, getState, editor);
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	/** Remove the command from Obsidian and our tracking set. */
	private _doRemoveCommand(id: string): void {
		const fullId = `${this._surface.pluginId}:${id}`;
		this._surface.removeCommand(fullId);
		this._registered.delete(id);
	}

	/**
	 * Shared cleanup: unregister the command (if registered) and persist
	 * record.command=false via the store.
	 */
	private async _cleanupScript(id: string): Promise<void> {
		// Only unregister if we have a command for this id
		if (this._registered.has(id)) {
			this._doRemoveCommand(id);
		}

		// Persist command=false, preserving all other record fields
		const scripts = await this._store.getScripts();
		const existing = scripts[id];
		if (existing !== undefined) {
			await this._store.setRecord(id, { ...existing, command: false });
		}
	}

	/**
	 * The editorCallback body — re-derives state at call time and:
	 *   Active  → run via ScriptRunner (source:"command", policy "enabled")
	 *   other   → notify the user with the reason; do NOT execute
	 */
	private async _invokeScript(
		id: string,
		name: string,
		script: ScriptFunction,
		getState: StateResolver,
		editor: Editor,
	): Promise<void> {
		const state = getState(id);

		if (state.kind !== "Active") {
			const reason = _describeNonActiveState(state, name);
			new Notice(reason);
			return;
		}

		// Build context and run
		const op = selectionContext(editor, this._settings);
		const { api: mason } = buildRegistry();
		const ctx = buildScriptContext({
			// Parity with _runScriptOnSelection: fall back to full doc when no selection.
			input: op.input ?? op.doc,
			source: "command",
			op,
			mason,
			logger: buildGatedLogger(this._settings.debugLogging),
		});

		const applyPlanFn: (editor: Editor, plan: EditPlan) => void =
			this._injection?.applyPlan ?? ((ed: Editor, plan: EditPlan): void => applyEditPlan(ed, plan));

		const effects: RunnerEffects = {
			applyPlan: (plan: EditPlan): void => { applyPlanFn(editor, plan); },
			// Raw fallback for command: selection already lives in the document — leave intact.
			rawFallback: (): void => { /* command raw fallback: leave intact */ },
			notify: (msg: string): void => { new Notice(msg); },
		};

		const runner = new ScriptRunner(effects, { policy: "enabled" });
		await runner.run(script, ctx);
	}
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

/**
 * Produce a sentence-case user notice describing why a stale command cannot run.
 * Sentence-case per compliance rules; no innerHTML.
 */
function _describeNonActiveState(state: LifecycleState, name: string): string {
	switch (state.kind) {
		case "Disabled":
			return `Mason: "${name}" is disabled`;
		case "Blocked":
			return `Mason: "${name}" is blocked (${state.reason})`;
		case "Materializing":
			return `Mason: "${name}" is not ready yet`;
		case "Available":
		case "Absent":
		case "UpdateAvailable":
		case "Active":
			return `Mason: "${name}" is not active`;
	}
}
