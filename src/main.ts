import { Notice, Plugin } from "obsidian";
import type { Editor } from "obsidian";
import { DEFAULT_SETTINGS, type MasonSettings } from "./core/types";
import type { EditPlan } from "./core/types";
import { registerCommands } from "./commands";
import { pasteContext } from "./sources/paste";
import { selectionContext } from "./sources/selection";
import { applyEditPlan } from "./sources/apply";
import { buildScriptContext } from "./scripts/context";
import { ScriptRunner } from "./scripts/runner";
import type { RunnerEffects } from "./scripts/runner";
import type { ScriptFunction } from "./scripts/context";
import { buildRegistry } from "./core/registry";
import { perplexityAutoScript } from "./scripts/library/perplexityAuto";
import { perplexityAppScript } from "./scripts/library/perplexityApp";
import { perplexityWebScript } from "./scripts/library/perplexityWeb";
import { perplexityWebDownloadScript } from "./scripts/library/perplexityWebDownload";

// Re-export so consumers that import from "src/main" still resolve.
export { DEFAULT_SETTINGS, type MasonSettings };

// ---------------------------------------------------------------------------
// PasteInjection — test seam for the paste command
//
// The paste command's editorCallback must honour Obsidian's fixed signature
// `(editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => any`. Injecting
// test doubles via a second argument would violate that type contract.
//
// Instead the plugin exposes `_pasteInjection?: PasteInjection`, a test-only
// property that tests set BEFORE triggering the command. Production code leaves
// it undefined (all defaults apply). The property is intentionally prefixed
// with `_` to signal "test seam, not public API".
//
// Fields:
//   clipboardReader — replaces navigator.clipboard.readText()
//   applyPlan       — replaces the CM6 applyEditPlan side-effect
//   failScript      — when true forces the runner to simulate a script failure
// ---------------------------------------------------------------------------

export interface PasteInjection {
	/** Replaces navigator.clipboard.readText() in tests. */
	clipboardReader?: () => Promise<string>;
	/** Replaces the real applyEditPlan side-effect in tests. */
	applyPlan?: (plan: EditPlan) => void;
	/** When true, forces the paste script to throw (for rawFallback tests). */
	failScript?: boolean;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export class MarkdownMasonPlugin extends Plugin {
	declare settings: MasonSettings;

	/**
	 * Test seam for the paste command.
	 * Set this property before triggering the paste command in tests.
	 * Undefined in production — all defaults apply.
	 */
	_pasteInjection?: PasteInjection;

	override async onload(): Promise<void> {
		await this.loadSettings();
		this.app.workspace.onLayoutReady(() => this.onLayoutReady());
		console.debug("[MarkdownMason] loaded");
	}

	/**
	 * Called once the workspace layout is ready.
	 * Registers all Mason commands via the registry-driven command layer (T3.4)
	 * and the Phase-5 paste command.
	 */
	onLayoutReady(): void {
		if (this.settings.debugLogging) {
			console.debug("[MarkdownMason] layout ready");
		}
		registerCommands(this);
		this._registerPasteCommand();
		this._registerScriptCommands();
	}

	override onunload(): void {
		// Obsidian automatically invokes all callbacks registered via
		// this.register() and this.registerEvent() on unload — no manual
		// teardown is needed here.
		console.debug("[MarkdownMason] unloaded");
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// -------------------------------------------------------------------------
	// Mason: Paste and format — Phase 5 real implementation (T5.5C)
	//
	// RunnerEffects wiring:
	//   applyPlan  → injected spy (tests) OR applyEditPlan(editor, plan) (production)
	//   rawFallback → editor.replaceSelection(rawClipboardText) — plain paste semantics
	//   notify     → new Notice(msg)
	//
	// RAW FALLBACK CHOICE: on failure, editor.replaceSelection(rawText) inserts
	// the raw clipboard text at cursor — identical to what a plain Ctrl+V would do.
	// This is the safest degradation (never a partial edit; always a complete paste).
	//
	// EMPTY CLIPBOARD: clipboard text that is empty after trim → Notice + early return.
	// No script runs, no rawFallback.
	// -------------------------------------------------------------------------

	private _registerPasteCommand(): void {
		this.addCommand({
			id: "mason.pasteAndFormat",
			name: "Mason: Paste and format",
			// Obsidian editorCallback return type is `any`, so returning Promise<void>
			// is valid and lets tests await the async work without fire-and-forget.
			// Arrow function captures `this` lexically — no alias needed.
			editorCallback: (editor: Editor): Promise<void> => {
				return runPasteCommand(editor, this.settings, this._pasteInjection);
			},
		});
	}

	// -------------------------------------------------------------------------
	// Mason: <Script name> — per-script selection commands
	//
	// Each bundled library script is registered as a command that runs on the
	// current selection.  The selection text is passed as ctx.input; the script
	// may inspect or transform it and return an EditPlan.
	//
	// RAW FALLBACK FOR SELECTION: unlike paste, where rawFallback re-inserts the
	// clipboard text, a selection-run raw fallback is a NO-OP — the selected text
	// already lives in the document.  Calling replaceSelection with the original
	// text would re-insert it unchanged, which is safe but redundant; the
	// intentional choice is to leave the selection intact on failure.
	//
	// Shared helper: _runScriptOnSelection factors out effects wiring + runner
	// creation so each per-script command is a one-liner editorCallback.
	// -------------------------------------------------------------------------

	private _registerScriptCommands(): void {
		const scripts: Array<{ id: string; name: string; script: ScriptFunction }> = [
			{ id: "mason.script.perplexity-auto", name: "Mason: Perplexity auto", script: perplexityAutoScript },
			{ id: "mason.script.perplexity-app", name: "Mason: Perplexity app", script: perplexityAppScript },
			{ id: "mason.script.perplexity-web", name: "Mason: Perplexity web", script: perplexityWebScript },
			{ id: "mason.script.perplexity-web-download", name: "Mason: Perplexity web download", script: perplexityWebDownloadScript },
		];

		for (const { id, name, script } of scripts) {
			const capturedScript = script;
			this.addCommand({
				id,
				name,
				// _pasteInjection is the shared test seam for both paste and selection.
				editorCallback: (editor: Editor): Promise<void> => {
					return this._runScriptOnSelection(editor, capturedScript, this._pasteInjection);
				},
			});
		}
	}

	/**
	 * Run a library script against the current selection.
	 * Shared by all per-script selection commands.
	 *
	 * RAW FALLBACK: on failure, the selection is left intact (no-op).
	 * The selected text already exists in the document — unlike paste,
	 * there is nothing to "re-insert" on failure.
	 *
	 * The `injection` parameter is the shared test seam (_pasteInjection).
	 * Tests set plugin._pasteInjection.applyPlan to spy on applyEditPlan.
	 */
	private async _runScriptOnSelection(
		editor: Editor,
		script: ScriptFunction,
		injection?: PasteInjection,
	): Promise<void> {
		const op = selectionContext(editor, this.settings);
		const { api: mason } = buildRegistry();
		const ctx = buildScriptContext({
			input: op.input ?? op.doc,
			source: "selection",
			op,
			mason,
		});

		const applyPlanFn: (plan: EditPlan) => void =
			injection?.applyPlan ?? ((plan: EditPlan): void => applyEditPlan(editor, plan));

		const effects: RunnerEffects = {
			applyPlan: (plan: EditPlan): void => { applyPlanFn(plan); },
			// Raw fallback for selection: leave the selection intact (no-op).
			// The selected text already lives in the document; unlike paste,
			// there is no clipboard text to re-insert on failure.
			rawFallback: (): void => { /* selection raw fallback: leave intact */ },
			notify: (msg: string): void => { new Notice(msg); },
		};

		const runner = new ScriptRunner(effects, { policy: "enabled" });
		await runner.run(script, ctx);
	}
}

// ---------------------------------------------------------------------------
// runPasteCommand — extracted for single-responsibility
//
// Accepts an optional PasteInjection (set on the plugin instance in tests).
// ---------------------------------------------------------------------------

async function runPasteCommand(
	editor: Editor,
	settings: MasonSettings,
	injection: PasteInjection | undefined,
): Promise<void> {
	// 1. Read clipboard text (or use injected reader in tests)
	const readClipboard = injection?.clipboardReader ?? defaultClipboardReader;
	let rawText: string;
	try {
		rawText = await readClipboard();
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		new Notice(`Mason: clipboard unavailable — ${msg}`);
		return;
	}

	// 2. Guard: empty clipboard
	if (rawText.trim() === "") {
		new Notice("Mason: clipboard is empty — nothing to paste.");
		return;
	}

	// 3. Build paste OperationContext
	const op = pasteContext(editor, settings, rawText);

	// 4. Build ScriptContext (mason api from registry)
	const { api: mason } = buildRegistry();
	const ctx = buildScriptContext({
		input: rawText,
		source: "paste",
		op,
		mason,
	});

	// 5. Wire RunnerEffects
	//    applyPlan: injected spy (tests) OR production applyEditPlan(editor, plan)
	//    rawFallback: plain paste — insert raw text at cursor via replaceSelection
	//    notify: Obsidian Notice
	const applyPlanFn: (plan: EditPlan) => void =
		injection?.applyPlan ?? ((plan: EditPlan): void => applyEditPlan(editor, plan));

	const effects: RunnerEffects = {
		applyPlan: (plan: EditPlan): void => { applyPlanFn(plan); },
		rawFallback: (): void => { editor.replaceSelection(rawText); },
		notify: (msg: string): void => { new Notice(msg); },
	};

	// 6. Build runner — bundled library scripts are pre-approved (no consent gate)
	const runner = new ScriptRunner(effects, { policy: "enabled" });

	// 7. Choose script — failScript injection forces a throw for test coverage
	const script = injection?.failScript === true
		? buildFailScript()
		: perplexityAutoScript;

	// 8. Run (ScriptRunner enforces atomicity: applyPlan XOR rawFallback)
	await runner.run(script, ctx);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Production clipboard reader — wraps navigator.clipboard (requires secure context). */
async function defaultClipboardReader(): Promise<string> {
	if (typeof navigator === "undefined" || navigator.clipboard === undefined) {
		throw new Error("Clipboard API unavailable (requires secure context)");
	}
	return navigator.clipboard.readText();
}

/** A ScriptFunction that always throws — used only via failScript injection in tests. */
function buildFailScript() {
	return function failingScript(): never {
		throw new Error("injected test failure");
	};
}

export default MarkdownMasonPlugin;
