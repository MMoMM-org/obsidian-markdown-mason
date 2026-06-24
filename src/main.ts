import { Notice, Plugin } from "obsidian";
import type { Editor } from "obsidian";
import { DEFAULT_SETTINGS, type MasonSettings } from "./core/types";
import type { EditPlan } from "./core/types";
import { registerCommands, countNoticeMessage } from "./commands";
import { pasteContext } from "./sources/paste";
import { selectionContext } from "./sources/selection";
import { applyEditPlan } from "./sources/apply";
import { buildScriptContext, buildGatedLogger } from "./scripts/context";
import { ScriptRunner } from "./scripts/runner";
import type { RunnerEffects } from "./scripts/runner";
import type { ScriptFunction } from "./scripts/context";
import { buildRegistry } from "./core/registry";
import { countFootnoteDefs } from "./core/footnotes";
import { perplexityAppScript } from "./scripts/library/perplexityApp";
import { perplexityWebScript } from "./scripts/library/perplexityWeb";
import { perplexityWebDownloadScript } from "./scripts/library/perplexityWebDownload";
import { ScriptStore } from "./scripts/store";
import { buildPasteChain } from "./scripts/paste/buildPasteChain";
import type { LoadedScript } from "./scripts/paste/buildPasteChain";
import { MasonSettingTab } from "./ui/settingsTab";
import { CommandManager } from "./scripts/commandManager";

// Re-export so consumers that import from "src/main" still resolve.
export { DEFAULT_SETTINGS, type MasonSettings };

// ---------------------------------------------------------------------------
// CommandInjection — test seam for paste AND selection commands
//
// Both the paste command and _runScriptOnSelection's editorCallback must honour
// Obsidian's fixed signature `(editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => any`.
// Injecting test doubles via a second argument would violate that type contract.
//
// Instead the plugin exposes `_commandInjection?: CommandInjection`, a test-only
// property that tests set BEFORE triggering the command. Production code leaves
// it undefined (all defaults apply). The property is intentionally prefixed
// with `_` to signal "test seam, not public API".
//
// Fields:
//   clipboardReader  — replaces navigator.clipboard.readText() (paste only)
//   applyPlan        — replaces the CM6 applyEditPlan side-effect (paste + selection)
//   failScript       — when true, forces the paste script to throw (paste rawFallback tests)
//   scriptOverride   — when set, replaces the script for SELECTION commands only
//   pasteScripts     — when set, replaces the enabled paste-script set fed to the
//                      data-driven paste chain (paste only)
// ---------------------------------------------------------------------------

export interface CommandInjection {
	/** Replaces navigator.clipboard.readText() in tests. */
	clipboardReader?: () => Promise<string>;
	/** Replaces the real applyEditPlan side-effect in tests. */
	applyPlan?: (plan: EditPlan) => void;
	/** When true, forces the paste script to throw (for paste rawFallback tests). */
	failScript?: boolean;
	/** When set, replaces the script function for SELECTION commands only. */
	scriptOverride?: ScriptFunction;
	/**
	 * When set, replaces the enabled paste-script set passed to buildPasteChain
	 * (paste command only). Production passes _buildEnabledPasteScripts().
	 */
	pasteScripts?: LoadedScript[];
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export class MarkdownMasonPlugin extends Plugin {
	declare settings: MasonSettings;

	/**
	 * Script store — manages all script decisions in the synced data.json
	 * (plugin.loadData/saveData). Initialised in onload() after loadSettings().
	 */
	declare store: ScriptStore;

	/**
	 * Command manager — owns per-script Obsidian command registration and cleanup.
	 * Exposed so the Scripts settings tab (T4.2) and Commands tab (T4.4) can call
	 * register/unregister without importing Plugin directly.
	 * Initialised in _initStore(); safe to call after onLayoutReady.
	 */
	declare commandManager: CommandManager;

	/**
	 * Test seam for paste AND selection commands.
	 * Set this property before triggering a command in tests.
	 * Undefined in production — all defaults apply.
	 */
	_commandInjection?: CommandInjection;

	override async onload(): Promise<void> {
		await this.loadSettings();
		this._initStore();
		this.addSettingTab(new MasonSettingTab(this.app, this));
		this.app.workspace.onLayoutReady(() => this.onLayoutReady());
		console.debug("[MarkdownMason] loaded");
	}

	/**
	 * Initialise the ScriptStore and CommandManager with the synced data.json port.
	 * Called once during onload, after settings are loaded.
	 */
	private _initStore(): void {
		const pluginDataPort = {
			load: (): Promise<unknown> => this.loadData(),
			save: (data: unknown): Promise<void> => this.saveData(data),
		};
		this.store = new ScriptStore(pluginDataPort);
		this.commandManager = new CommandManager(
			{
				addCommand: (spec) => this.addCommand(spec as Parameters<typeof this.addCommand>[0]),
				removeCommand: (fullId: string) => this.removeCommand(fullId),
				pluginId: this.manifest.id,
			},
			this.store,
			this.settings,
		);
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
			name: "Paste and format",
			// Obsidian editorCallback return type is `any`, so returning Promise<void>
			// is valid and lets tests await the async work without fire-and-forget.
			// Arrow function captures `this` lexically — no alias needed.
			editorCallback: (editor: Editor): Promise<void> => {
				return runPasteCommand(
					editor,
					this.settings,
					this._commandInjection,
					this._buildEnabledPasteScripts(),
				);
			},
		});
	}

	/**
	 * Assemble the enabled paste-capable scripts for the data-driven paste chain.
	 *
	 * The chain only ever contains scripts that are enabled AND verified (consent +
	 * match-gate enforced upstream by the store/lifecycle layer), so the runner can
	 * safely run them with policy "enabled" (SEC-006).
	 */
	private _buildEnabledPasteScripts(): LoadedScript[] {
		// TODO(P4/P5): assemble from store.getScripts() enabled+Active records, loading
		// each materialized module via loadScriptModule; empty until enable-flow (P4) +
		// catalog population (P5) exist.
		return [];
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
			{ id: "mason.script.perplexity-app", name: "Perplexity app", script: perplexityAppScript },
			{ id: "mason.script.perplexity-web", name: "Perplexity web", script: perplexityWebScript },
			{ id: "mason.script.perplexity-web-download", name: "Perplexity web download", script: perplexityWebDownloadScript },
		];

		for (const { id, name, script } of scripts) {
			this.addCommand({
				id,
				name,
				// _commandInjection is the shared test seam for both paste and selection commands.
				// scriptOverride (for selection throw-path tests) and applyPlan are read here.
				editorCallback: (editor: Editor): Promise<void> => {
					return this._runScriptOnSelection(editor, script, this._commandInjection);
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
	 * The `injection` parameter is the shared test seam (_commandInjection).
	 * Tests set plugin._commandInjection.applyPlan to spy on applyEditPlan.
	 * Tests set plugin._commandInjection.scriptOverride to force a specific script
	 * (e.g. a throwing script) for selection throw-path coverage.
	 */
	private async _runScriptOnSelection(
		editor: Editor,
		script: ScriptFunction,
		injection?: CommandInjection,
	): Promise<void> {
		const op = selectionContext(editor, this.settings);
		const { api: mason } = buildRegistry();
		const ctx = buildScriptContext({
			input: op.input ?? op.doc,
			source: "selection",
			op,
			mason,
			logger: buildGatedLogger(this.settings.debugLogging),
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

		const activeScript = injection?.scriptOverride ?? script;
		// SEC-006: policy "enabled" bypasses the per-checksum consent gate because these are
		// FIRST-PARTY bundled library scripts compiled into the plugin bundle. Their sha256 is
		// fixed at build time and there is no external file that an attacker can tamper with.
		// The consent model (ScriptStore + disclosure modal) protects user-imported external
		// .cjs files; it does not apply to code shipped inside the plugin itself.
		const runner = new ScriptRunner(effects, { policy: "enabled" });
		const outcome = await runner.run(activeScript, ctx);
		// PRD F8-AC2 / F7-AC3: fire a Notice when the script applies changes.
		// Prefer footnote-count ("N footnotes filed") when the plan contains defs;
		// fall back to edit-count ("N change(s)") for non-footnote plans.
		if (outcome.kind === "applied") {
			if (this.settings.debugLogging) {
				console.debug(`[MarkdownMason] selection outcome: ${outcome.kind} (${outcome.count} edits)`);
			}
			const fn = countFootnoteDefs(outcome.plan);
			effects.notify(
				fn > 0
					? `Mason: ${fn} footnote${fn === 1 ? "" : "s"} filed`
					: countNoticeMessage(outcome.count),
			);
		}
	}
}

// ---------------------------------------------------------------------------
// runPasteCommand — extracted for single-responsibility
//
// Accepts an optional CommandInjection (set on the plugin instance in tests).
// ---------------------------------------------------------------------------

async function runPasteCommand(
	editor: Editor,
	settings: MasonSettings,
	injection: CommandInjection | undefined,
	enabledPasteScripts: LoadedScript[],
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

	if (settings.debugLogging) {
		console.debug(`[MarkdownMason] paste: clipboard read (${rawText.length} chars)`);
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
		logger: buildGatedLogger(settings.debugLogging),
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

	// 6. Build runner — policy "enabled" bypasses the per-checksum consent gate because the
	//    paste chain contains ONLY scripts that are already enabled AND verified: consent
	//    and the canHandle match-gate are enforced upstream (store/lifecycle + buildPasteChain)
	//    before a handler ever reaches this runner. The consent model (ScriptStore + disclosure
	//    modal) gates a script INTO the enabled set; once there, running it is the user's
	//    standing decision, so re-gating per invocation would be redundant. (SEC-006)
	const runner = new ScriptRunner(effects, { policy: "enabled" });

	// 7. failScript injection forces a throw — preserves the rawFallback-on-failure test path.
	if (injection?.failScript === true) {
		await runner.run(buildFailScript(), ctx);
		// runner already called rawFallback + notify on failure (atomicity).
		return;
	}

	// 8. Data-driven dispatch (ADR-16): pick the first handler in the ordered chain whose
	//    canHandle(rawText) claims the input. The chain is the single ordering chokepoint
	//    (curated-before-imported, priority DESC, id ASC). When no handler matches (or the
	//    chain is empty), fall back to a plain paste.
	const enabled = injection?.pasteScripts ?? enabledPasteScripts;
	const chain = buildPasteChain(enabled);
	const handler = chain.find((h) => h.canHandle(rawText));

	if (handler === undefined) {
		// No recognized format: insert the raw clipboard text at cursor (plain paste semantics)
		// and inform the user. This avoids a silent no-op when the user invokes "Paste and format"
		// on text that no enabled script recognizes.
		effects.rawFallback();
		effects.notify("Mason: no recognized format — pasted as-is.");
		return;
	}

	// 9. Run the matched handler (ScriptRunner enforces atomicity: applyPlan XOR rawFallback).
	const outcome = await runner.run(handler.run, ctx);
	// PRD F8-AC2 / F7-AC3: fire a Notice when the script applies changes.
	// Prefer footnote-count ("N footnotes filed") when the plan contains defs;
	// fall back to edit-count ("N change(s)") for non-footnote plans.
	if (outcome.kind === "applied") {
		if (settings.debugLogging) {
			console.debug(`[MarkdownMason] paste outcome: ${outcome.kind} (${outcome.count} edits)`);
		}
		const fn = countFootnoteDefs(outcome.plan);
		effects.notify(
			fn > 0
				? `Mason: ${fn} footnote${fn === 1 ? "" : "s"} filed`
				: countNoticeMessage(outcome.count),
		);
	} else if (outcome.kind === "noop") {
		// A matched handler that nonetheless produced no plan (e.g. canHandle was broad
		// but parse found nothing) → plain paste + inform the user.
		effects.rawFallback();
		effects.notify("Mason: no recognized format — pasted as-is.");
	}
	// failed/blocked: runner already called rawFallback + notify on failure;
	// blocked is a policy decision (no user action expected).
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
