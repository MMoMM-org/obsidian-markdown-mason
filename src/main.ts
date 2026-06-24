import { Notice, Plugin } from "obsidian";
import type { Editor } from "obsidian";
import { DEFAULT_SETTINGS, type MasonSettings } from "./core/types";
import type { EditPlan } from "./core/types";
import { registerCommands, countNoticeMessage } from "./commands";
import { pasteContext } from "./sources/paste";
import { applyEditPlan } from "./sources/apply";
import { buildScriptContext, buildGatedLogger } from "./scripts/context";
import { ScriptRunner } from "./scripts/runner";
import type { RunnerEffects } from "./scripts/runner";
import { buildRegistry } from "./core/registry";
import { countFootnoteDefs } from "./core/footnotes";
import { ScriptStore } from "./scripts/store";
import { buildPasteChain } from "./scripts/paste/buildPasteChain";
import type { LoadedScript } from "./scripts/paste/buildPasteChain";
import { MasonSettingTab } from "./ui/settingsTab";
import { CommandManager } from "./scripts/commandManager";
import { RunScriptModal } from "./ui/runScriptModal";
import type { CatalogSource } from "./scripts/catalog/catalogSource";
import { createCatalogSource } from "./scripts/catalog/requestUrlAdapter";
import { LifecycleResolver } from "./scripts/lifecycleResolver";
import { MaterializedFingerprintStore } from "./scripts/materializedFingerprint";
import { LifecycleController } from "./scripts/lifecycleController";
import type { LifecycleVault } from "./scripts/lifecycleController";
import { ImportPickerModal } from "./ui/importPickerModal";

// Re-export so consumers that import from "src/main" still resolve.
export { DEFAULT_SETTINGS, type MasonSettings };

// ---------------------------------------------------------------------------
// ADR-15: build-time catalog source selection
//
// `__MASON_DEV__` is injected by esbuild as a literal boolean at bundle time:
//   - "false" in production → esbuild eliminates the dev branch + DevDirAdapter import
//   - "true"  in dev        → DevDirAdapter reads local working-tree files
//
// IMPORTANT: the dynamic import + createDevDirAdapter() call MUST be inside the
// `if (__MASON_DEV__)` block so esbuild can tree-shake the entire devDirAdapter
// module (class + factory) from the production bundle.
// ---------------------------------------------------------------------------

/**
 * ADR-15: build-time catalog source selection.
 * Exported so Phase-5 wiring (Materializer consumers) can call without re-implementing
 * the dev/prod gate. The `if (__MASON_DEV__)` guard ensures esbuild tree-shakes
 * DevDirAdapter and its Node fs imports entirely from the production bundle.
 *
 * T6.1: called from _initLifecycleResolver() in onload() to wire the real catalog
 * source into the LifecycleResolver. Previously only a TODO comment.
 */
export async function buildCatalogSource(): Promise<CatalogSource> {
	if (__MASON_DEV__) {
		// Dev-only path: dynamically import so esbuild sees no static reference
		// to devDirAdapter from outside the guarded branch. The dynamic import
		// is inlined at build time when __MASON_DEV__ is "true" and eliminated
		// entirely when it is "false".
		const { createDevDirAdapter } = await import("./scripts/catalog/devDirAdapter");
		return createDevDirAdapter();
	}
	return createCatalogSource();
}

// ---------------------------------------------------------------------------
// CommandInjection — test seam for the paste command
//
// The paste command's editorCallback must honour Obsidian's fixed signature
// `(editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => any`.
// Injecting test doubles via a second argument would violate that type contract.
//
// Instead the plugin exposes `_commandInjection?: CommandInjection`, a test-only
// property that tests set BEFORE triggering the command. Production code leaves
// it undefined (all defaults apply). The property is intentionally prefixed
// with `_` to signal "test seam, not public API".
//
// Fields:
//   clipboardReader  — replaces navigator.clipboard.readText()
//   applyPlan        — replaces the CM6 applyEditPlan side-effect
//   failScript       — when true, forces the paste script to throw (rawFallback tests)
//   pasteScripts     — when set, replaces the enabled paste-script set fed to the
//                      data-driven paste chain
// ---------------------------------------------------------------------------

export interface CommandInjection {
	/** Replaces navigator.clipboard.readText() in tests. */
	clipboardReader?: () => Promise<string>;
	/** Replaces the real applyEditPlan side-effect in tests. */
	applyPlan?: (plan: EditPlan) => void;
	/** When true, forces the paste script to throw (for paste rawFallback tests). */
	failScript?: boolean;
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
	 * Live lifecycle resolver — wires real catalog + vault + per-device fingerprint store.
	 * Initialised lazily in _initLifecycleResolver() called from onload().
	 * Exposed so MasonSettingTab can build real ScriptItems with live states (T6.1).
	 * Optional so test doubles can omit it; settingsTab falls back to stub when absent.
	 */
	lifecycleResolver?: LifecycleResolver;

	/**
	 * Live lifecycle controller (T6.2) — composes disclosure + materializer + store
	 * + per-device fingerprint + catalog into one method per Scripts-tab op.
	 * Initialised in _initLifecycleResolver() reusing the same catalog/vault/
	 * scriptsDir/fingerprint wiring. Exposed so MasonSettingTab can delegate its
	 * lifecycle ops. Optional so test doubles can omit it; the tab falls back to
	 * the minimal store-only ops when absent.
	 */
	lifecycleController?: LifecycleController;

	/**
	 * Test seam for the paste command.
	 * Set this property before triggering a command in tests.
	 * Undefined in production — all defaults apply.
	 */
	_commandInjection?: CommandInjection;

	override async onload(): Promise<void> {
		await this.loadSettings();
		this._initStore();
		await this._initLifecycleResolver();
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
	 * Build and wire the live LifecycleResolver (T6.1).
	 *
	 * Called once during onload(), after settings and store are ready.
	 * Constructs the per-device scripts dir path from manifest.dir, then
	 * builds the real catalog source (ADR-15 dev/prod gate) and wires it
	 * into a LifecycleResolver with the Obsidian vault adapter.
	 *
	 * The resolver is exposed as plugin.lifecycleResolver for MasonSettingTab.
	 * On error (e.g. buildCatalogSource fails), lifecycleResolver remains undefined
	 * and the settings tab falls back to safe offline stubs.
	 */
	private async _initLifecycleResolver(): Promise<void> {
		try {
			const catalog = await buildCatalogSource();
			const scriptsDir = `${this.manifest.dir}/scripts`;
			const manifestPath = `${scriptsDir}/.materialized.json`;

			// Obsidian's vault.adapter satisfies the VaultAdapterPort surface:
			// readBinary, writeBinary, exists are available on the DataAdapter.
			// Cast via unknown: Obsidian's TS types don't expose the exact interface
			// but the runtime methods are present on FileSystemAdapter.
			const vaultAdapter = this.app.vault.adapter as unknown as import("./scripts/runtime").VaultAdapterPort;
			const fingerprintStore = new MaterializedFingerprintStore(vaultAdapter, manifestPath);

			const destPath = (id: string): string => `${scriptsDir}/${id}.cjs`;

			this.lifecycleResolver = new LifecycleResolver({
				catalog,
				vault: vaultAdapter,
				fingerprints: fingerprintStore,
				scriptsDir,
				destPath,
				onlineProbe: () =>
					typeof navigator !== "undefined" ? navigator.onLine : true,
			});

			// T6.2: live lifecycle controller — reuses the SAME catalog/vault/
			// scriptsDir/fingerprint wiring. rerender is overridden by the settings
			// tab's guarded _selectSegment path when it builds its lifecycle ops.
			this.lifecycleController = new LifecycleController({
				app: this.app,
				store: this.store,
				catalog,
				vault: this._buildControllerVault(vaultAdapter),
				fingerprints: fingerprintStore,
				destPath,
				rerender: () => { /* overridden by settings tab via setRerender() */ },
				listCjsFiles: () => this._listVaultCjsFiles(),
				pickCjsFile: (paths) => this._pickVaultCjsFile(paths),
			});

			console.debug("[MarkdownMason] lifecycle resolver + controller initialized");
		} catch (err: unknown) {
			console.debug("[MarkdownMason] lifecycle resolver init failed — using offline stubs:", err);
		}
	}

	/**
	 * Wrap the vault adapter with a best-effort `remove` for the lifecycle controller
	 * (used by remove() to delete a materialized `<id>.cjs`). Obsidian's DataAdapter
	 * exposes remove(normalizedPath); we surface it as the optional LifecycleVault.remove.
	 */
	private _buildControllerVault(
		vaultAdapter: import("./scripts/runtime").VaultAdapterPort,
	): LifecycleVault {
		const adapterRemove = (this.app.vault.adapter as unknown as {
			remove?: (path: string) => Promise<void>;
		}).remove;
		return {
			readBinary: (p) => vaultAdapter.readBinary(p),
			writeBinary: (p, d) => vaultAdapter.writeBinary(p, d),
			exists: (p) => vaultAdapter.exists(p),
			mkdir: vaultAdapter.mkdir ? (p) => vaultAdapter.mkdir!(p) : undefined,
			remove: adapterRemove ? (p) => adapterRemove.call(this.app.vault.adapter, p) : undefined,
		};
	}

	/**
	 * List vault-relative `.cjs` files as candidates for import-from-vault.
	 * Uses the loaded-file index (getFiles) so no recursive scan is needed.
	 */
	private async _listVaultCjsFiles(): Promise<string[]> {
		const files = this.app.vault.getFiles();
		return files
			.filter((f) => f.extension === "cjs")
			.map((f) => f.path)
			.sort();
	}

	/**
	 * Minimal real picker: open ImportPickerModal listing the candidate `.cjs`
	 * paths and resolve with the chosen path (or null when cancelled).
	 */
	private _pickVaultCjsFile(paths: string[]): Promise<string | null> {
		return new ImportPickerModal(this.app, paths).pick();
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
		this._registerRunScriptLauncher();
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
	// Curated scripts are NO LONGER compiled-in selection commands.
	//
	// In v0.1 each bundled library script (Perplexity app / web / web-download)
	// was registered here as a per-script selection command. As of the catalog
	// migration (T5.2, PRD F11 / ADR-16) curated scripts ship as standalone
	// catalog .cjs entries, materialized into the vault and enabled via the
	// Scripts settings tab (Phase 4 UI) — not compiled into the plugin bundle.
	// The paste path consumes them through the data-driven paste chain; the
	// command path goes through the CommandManager launcher below.
	// -------------------------------------------------------------------------

	// -------------------------------------------------------------------------
	// Mason: Run script… — built-in launcher (T4.4 ADR-17)
	//
	// Opens RunScriptModal listing only Active scripts.
	// No default hotkey (ADR-17). The editor is available via editorCallback.
	//
	// P5 seam: resolveScriptFn and getState return placeholder values until
	// the live module loader and lifecycle resolver wire in (P5).
	// -------------------------------------------------------------------------

	private _registerRunScriptLauncher(): void {
		this.addCommand({
			id: "mason.runScript",
			name: "Run script…",
			// T6.1: editorCallback is async so we can await the resolver before
			// constructing the modal. States are pre-resolved into a Map and a sync
			// getState facade is passed to RunScriptModal. Falls back to fail-closed
			// Disabled when the resolver is absent.
			editorCallback: async (editor: Editor): Promise<void> => {
				const resolver = this.lifecycleResolver;
				let getState: (id: string) => import("./scripts/lifecycle").LifecycleState;

				if (resolver !== undefined) {
					const scripts = await this.store.getScripts();
					const items = await resolver.resolveItems(scripts);
					const stateMap = new Map(items.map((item) => [item.id, item.state]));
					getState = (id: string) => stateMap.get(id) ?? { kind: "Disabled" };
					console.debug("[MarkdownMason] Run script launcher: pre-resolved state map", stateMap.size, "entries");
				} else {
					getState = () => ({ kind: "Disabled" });
				}

				// T6.3: resolveScriptFn placeholder — real module loader wires in at T6.3.
				const resolveScriptFn = (): import("./scripts/context").ScriptFunction => {
					return (): undefined => undefined;
				};

				const modal = new RunScriptModal(
					this.app,
					this.store,
					this.commandManager,
					getState,
					resolveScriptFn,
					editor,
				);
				modal.open();
			},
		});
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
