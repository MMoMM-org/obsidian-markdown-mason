// T4.4  RunScriptModal — "Mason: Run script…" launcher.
//
// DESIGN
// ──────
// Opens a simple list modal (extends Modal, not FuzzySuggestModal) to minimize
// mock complexity. Lists only ACTIVE scripts (getState(id).kind === "Active").
//
// Async load: onOpen schedules the async work via Promise so the Modal base-class
// open() call returns synchronously. The content is filled in once the promise
// resolves. Tests drain microtasks (await Promise.resolve()) after open().
//
// P5 SEAM
// ───────
// resolveScriptFn(id) → ScriptFunction  (P5: real module loader)
// getState(id)        → LifecycleState  (P5: live lifecycle resolver)
//
// COMMUNITY COMPLIANCE
// ────────────────────
// - Sentence case: modal title, item labels, empty-state text.
// - DOM via createEl / createDiv / setText / setAttribute — never innerHTML.
// - No default hotkeys.

import { Modal } from "obsidian";
import type { App, Editor } from "obsidian";
import type { ScriptFunction } from "../scripts/context";
import type { LifecycleState } from "../scripts/lifecycle";
import type { ScriptStore } from "../scripts/store";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Minimal CommandManager surface consumed by RunScriptModal. */
export interface RunScriptModalCommandManager {
	runScript(
		id: string,
		name: string,
		script: ScriptFunction,
		getState: (id: string) => LifecycleState,
		editor: Editor,
	): Promise<void>;
}

/** Resolver that returns a ScriptFunction for a given script id. P5: real module loader. */
export type ScriptFnResolver = (id: string) => ScriptFunction;

/** Resolver that returns the current LifecycleState for a given script id. */
export type StateResolver = (id: string) => LifecycleState;

// ---------------------------------------------------------------------------
// RunScriptModal
// ---------------------------------------------------------------------------

/**
 * Launcher modal for "Mason: Run script…".
 *
 * Lists only scripts whose current LifecycleState is "Active". Selecting one
 * delegates execution to commandManager.runScript(), which reuses CommandManager's
 * existing _invokeScript effects wiring (applyPlan/rawFallback/notify).
 */
export class RunScriptModal extends Modal {
	private readonly _store: Pick<ScriptStore, "getScripts">;
	private readonly _commandManager: RunScriptModalCommandManager;
	private readonly _getState: StateResolver;
	private readonly _resolveScriptFn: ScriptFnResolver;
	private readonly _editor: Editor;

	constructor(
		app: App,
		store: Pick<ScriptStore, "getScripts">,
		commandManager: RunScriptModalCommandManager,
		getState: StateResolver,
		resolveScriptFn: ScriptFnResolver,
		editor: Editor,
	) {
		super(app);
		this._store = store;
		this._commandManager = commandManager;
		this._getState = getState;
		this._resolveScriptFn = resolveScriptFn;
		this._editor = editor;
	}

	onOpen(): void {
		// Set title synchronously (visible immediately)
		if (this.titleEl !== undefined) {
			this.titleEl.setText("Run script");
		}

		this.contentEl.empty();

		// Async content fill — tests drain with await Promise.resolve()
		void this._loadContent();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	private async _loadContent(): Promise<void> {
		const scripts = await this._store.getScripts();

		// Filter to only Active scripts
		const active = Object.entries(scripts).filter(
			([id]) => this._getState(id).kind === "Active",
		);

		this.contentEl.empty();

		if (active.length === 0) {
			this.contentEl.createEl("p", {
				text: "No active scripts. Enable and consent to a script in the Scripts tab first.",
				cls: "mason-run-empty",
			});
			return;
		}

		const list = this.contentEl.createDiv({ cls: "mason-run-list" });

		for (const [id] of active) {
			this._renderItem(list, id);
		}
	}

	private _renderItem(parent: HTMLElement, id: string): void {
		const btn = parent.createEl("button", {
			text: id,
			cls: "mason-run-item",
		});
		btn.setAttribute("type", "button");
		btn.addEventListener("click", () => {
			this.close();
			void this._runScript(id);
		});
	}

	private async _runScript(id: string): Promise<void> {
		// P5: resolveScriptFn returns a placeholder until real module loader exists
		const fn = this._resolveScriptFn(id);
		await this._commandManager.runScript(id, id, fn, this._getState, this._editor);
	}
}
