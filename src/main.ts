import { Notice, Plugin, FileSystemAdapter, normalizePath } from "obsidian";
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
import { UpdateSplashModal } from "./ui/updateSplashModal";
import { CommandManager } from "./scripts/commandManager";
import { RunScriptModal } from "./ui/runScriptModal";
import type { CatalogSource } from "./scripts/catalog/catalogSource";
import { createCatalogSource } from "./scripts/catalog/requestUrlAdapter";
import { LifecycleResolver } from "./scripts/lifecycleResolver";
import { MaterializedFingerprintStore } from "./scripts/materializedFingerprint";
import { LifecycleController } from "./scripts/lifecycleController";
import type { LifecycleVault } from "./scripts/lifecycleController";
import { ImportPickerModal } from "./ui/importPickerModal";
import { loadScriptModule, buildRequireFn, loadRunFnSafe, resolveScriptsDir } from "./scripts/loader";
import { buildEnabledPasteScripts } from "./scripts/pasteAssembly";
import { debug, setDebugLogging } from "./core/debug";
import { resolveFormatSelectionRecipe } from "./core/formatSelection";
import { applyTextCleanup } from "./core/formatPipeline";

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
 *
 * ADR-15 amendment: pluginDir (absolute path) enables the config-file fallback
 * (.mason-dev.json) when MASON_DEV_DIR env var is unset — needed because Obsidian
 * runs outside the dev container where env vars are unavailable.
 */
export async function buildCatalogSource(pluginDir?: string): Promise<CatalogSource> {
	if (__MASON_DEV__) {
		// Dev-only path: dynamically import so esbuild sees no static reference
		// to devDirAdapter from outside the guarded branch. The dynamic import
		// is inlined at build time when __MASON_DEV__ is "true" and eliminated
		// entirely when it is "false".
		const { createDevDirAdapter } = await import("./scripts/catalog/devDirAdapter");
		return createDevDirAdapter(pluginDir);
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
	/**
	 * Replaces editor.replaceSelection() in the paste+format command.
	 * Only consumed by runPasteAndFormatCommand; runPasteCommand ignores this field.
	 */
	replaceSelection?: (text: string) => void;
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

	/**
	 * Retained settings-tab instance — used by the post-update splash to pre-select
	 * the Scripts segment before opening the settings pane.
	 */
	private _settingTab?: MasonSettingTab;

	/**
	 * Count of curated scripts whose catalog version now exceeds the consented one
	 * (lifecycle state UpdateAvailable). Computed once at layout-ready and refreshed
	 * by the Scripts settings section; read by MasonSettingTab to render the Scripts
	 * segment badge. Undefined until first computed (offline/no-resolver → stays 0).
	 */
	updatableScriptCount?: number;

	override async onload(): Promise<void> {
		await this.loadSettings();
		this._initStore();
		await this._initLifecycleResolver();
		this._settingTab = new MasonSettingTab(this.app, this);
		this.addSettingTab(this._settingTab);
		this.app.workspace.onLayoutReady(() => this.onLayoutReady());
		debug("[MarkdownMason] loaded");
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
				addCommand: (spec) => this.addCommand(spec),
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
			// Compute absolute plugin dir for the dev config-file fallback (ADR-15).
			// FileSystemAdapter is a desktop-only Obsidian API; cast via unknown when
			// unavailable (mobile) — pluginDir stays undefined and the env-or-throw
			// path applies on mobile (which is expected: dev builds are desktop-only).
			let pluginDir: string | undefined;
			if (__MASON_DEV__) {
				if (this.app.vault.adapter instanceof FileSystemAdapter) {
					pluginDir = `${this.app.vault.adapter.getBasePath()}/${this.manifest.dir}`;
				}
			}

			const catalog = await buildCatalogSource(pluginDir);
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
				unregisterCommand: (id) => this.commandManager.unregister(id),
				// After a successful (re)materialize, rebind the command to the new
				// module + refreshed state so an updated script becomes runnable again
				// without a plugin reload (no-op when the script has no command).
				reRegisterCommand: (id) => this._registerScriptCommands([id]),
			});

			debug("[MarkdownMason] lifecycle resolver + controller initialized");
		} catch (err: unknown) {
			debug("[MarkdownMason] lifecycle resolver init failed — using offline stubs:", err);
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
	 *
	 * Obsidian's `vault.getFiles()` only returns files whose extension it indexes,
	 * and `.cjs` is NOT one of them — so getFiles never surfaces script files (this
	 * was the "no .cjs found" bug). Walk the raw filesystem via the data adapter
	 * instead, which sees every file regardless of extension. The config dir
	 * (`.obsidian`) is skipped: it holds plugin internals and already-materialized
	 * scripts, neither of which is an import candidate.
	 */
	private async _listVaultCjsFiles(): Promise<string[]> {
		const adapter = this.app.vault.adapter as unknown as {
			list(path: string): Promise<{ files: string[]; folders: string[] }>;
		};
		const configDir = this.app.vault.configDir;
		const found: string[] = [];

		const walk = async (dir: string): Promise<void> => {
			let listing: { files: string[]; folders: string[] };
			try {
				listing = await adapter.list(normalizePath(dir === "" ? "/" : dir));
			} catch {
				return; // unreadable folder — skip it, keep scanning the rest
			}
			for (const file of listing.files) {
				if (file.toLowerCase().endsWith(".cjs")) found.push(file);
			}
			for (const folder of listing.folders) {
				// folder paths are vault-relative; the config dir is its last segment.
				if (folder === configDir || folder.split("/").pop() === configDir) continue;
				await walk(folder);
			}
		};

		await walk("");
		return found.sort();
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
		debug("[MarkdownMason] layout ready");
		registerCommands(this);
		this._registerPasteCommand();
		this._registerPasteAndFormatCommand();
		this._registerRunScriptLauncher();
		// Re-create per-script commands the user had turned on (record.command).
		// Obsidian drops dynamically-added commands on reload, so without this the
		// commands — and any hotkeys bound to them — vanish until the user re-toggles.
		void this._restoreScriptCommands();
		// Detect a plugin-version change and, if so, surface waiting script updates.
		// Also seeds updatableScriptCount for the Scripts segment badge.
		void this._maybeShowUpdateSplash();
	}

	// -------------------------------------------------------------------------
	// Post-update splash (script-update awareness)
	//
	// Curated scripts ride pinned plugin releases, so a script version can only
	// change when the plugin updates. This one-shot splash makes that visible:
	// on the first run after manifest.version changes, it counts scripts now in
	// UpdateAvailable and offers a one-click route to review them.
	// -------------------------------------------------------------------------

	/**
	 * Show the post-update splash once per version bump, gated by showUpdateSplash.
	 *
	 * Fresh install (no recorded lastSeenVersion) is recorded silently — no splash.
	 * A genuine version change always advances lastSeenVersion (so we never nag on
	 * the next load) and, when the gate is on, computes the updatable-script count
	 * and presents UpdateSplashModal. Best-effort: never throws into onLayoutReady.
	 */
	private async _maybeShowUpdateSplash(): Promise<void> {
		try {
			const current = this.manifest.version ?? "";
			const last = this.settings.lastSeenVersion ?? "";

			// Already current → nothing changed; still refresh the badge count so the
			// Scripts segment badge is accurate without waiting for the user to visit.
			if (current === "" || current === last) {
				this.updatableScriptCount = await this._countUpdatableScripts();
				return;
			}

			// Fresh install: record the version silently, no splash.
			if (last === "") {
				this.settings.lastSeenVersion = current;
				await this.saveSettings();
				this.updatableScriptCount = await this._countUpdatableScripts();
				return;
			}

			// Genuine update. Advance the marker first so a dismissed/suppressed splash
			// never re-fires on the next load.
			this.settings.lastSeenVersion = current;
			await this.saveSettings();

			const count = await this._countUpdatableScripts();
			this.updatableScriptCount = count;

			if (this.settings.showUpdateSplash === false) return;

			new UpdateSplashModal(this.app, {
				version: current,
				updatableCount: count,
				showSplash: this.settings.showUpdateSplash ?? true,
				onToggleSplash: async (value) => {
					this.settings.showUpdateSplash = value;
					await this.saveSettings();
				},
				onOpenScripts: () => this._openScriptsSettings(),
			}).open();
		} catch (err: unknown) {
			debug("[MarkdownMason] update splash skipped:", err);
		}
	}

	/**
	 * Count curated scripts currently in the UpdateAvailable lifecycle state.
	 * Returns 0 when the resolver is absent (offline stubs / tests) or on error.
	 */
	private async _countUpdatableScripts(): Promise<number> {
		const resolver = this.lifecycleResolver;
		if (resolver === undefined) return 0;
		try {
			const records = await this.store.getScripts();
			const items = await resolver.resolveItems(records);
			return items.filter((it) => it.state.kind === "UpdateAvailable").length;
		} catch {
			return 0;
		}
	}

	/**
	 * Open Settings → Scripts. Pre-selects the Scripts segment, then opens the
	 * settings pane and Mason's tab via Obsidian's (semi-private) setting API,
	 * guarded so a missing/renamed API degrades to a no-op rather than throwing.
	 */
	private _openScriptsSettings(): void {
		this._settingTab?.selectScriptsSegment();
		const setting = (this.app as unknown as {
			setting?: { open?: () => void; openTabById?: (id: string) => void };
		}).setting;
		setting?.open?.();
		setting?.openTabById?.(this.manifest.id);
	}

	/**
	 * Re-register every script command persisted with command:true.
	 *
	 * Runs once at layout-ready. Each command keeps its STABLE id (the script id),
	 * so any user hotkey bound to `markdown-mason:<id>` survives the reload — only
	 * the registration is recreated, not the binding. Commands are restored even
	 * for non-Active scripts so their hotkeys persist; invoking a non-runnable one
	 * surfaces a Notice (CommandManager._invokeScript re-checks state at call time).
	 */
	private async _restoreScriptCommands(): Promise<void> {
		const records = await this.store.getScripts();
		const ids = Object.entries(records)
			.filter(([, rec]) => rec.command)
			.map(([id]) => id);
		await this._registerScriptCommands(ids);
		if (ids.length > 0) debug("[MarkdownMason] restored", ids.length, "script command(s)");
	}

	/**
	 * (Re-)register the Obsidian commands for the given script ids with a FRESH
	 * state snapshot and a FRESHLY-loaded module.
	 *
	 * Shared by _restoreScriptCommands (load-time, all command ids) and the
	 * lifecycle controller's reRegisterCommand hook (after a successful update/
	 * retry/re-enable, a single id). Resolving state + module here is what lets an
	 * UpdateAvailable→Active transition rebind the command to the new code without
	 * a plugin reload. Ids whose record has command:false are skipped.
	 */
	private async _registerScriptCommands(ids: string[]): Promise<void> {
		if (ids.length === 0) return;
		const records = await this.store.getScripts();
		const targets = ids.filter((id) => records[id]?.command);
		if (targets.length === 0) return;

		// Build getState + resolveScriptFn the same way the launcher does.
		const resolver = this.lifecycleResolver;
		let getState: (id: string) => import("./scripts/lifecycle").LifecycleState;
		if (resolver !== undefined) {
			const items = await resolver.resolveItems(records);
			const stateMap = new Map(items.map((item) => [item.id, item.state]));
			getState = (id: string) => stateMap.get(id) ?? { kind: "Disabled" };
		} else {
			getState = () => ({ kind: "Disabled" });
		}

		const scriptsDir = resolveScriptsDir(this.app.vault.adapter, this.manifest.dir);
		const requireFn = buildRequireFn(scriptsDir);
		const resolveScriptFn = (id: string): import("./scripts/context").ScriptFunction =>
			getState(id).kind !== "Active" ? (): undefined => undefined : loadRunFnSafe(id, scriptsDir, requireFn);

		for (const id of targets) {
			const name = (records[id].commandName ?? "").trim() || id;
			this.commandManager.register(id, name, resolveScriptFn(id), getState);
		}
	}

	override onunload(): void {
		// Obsidian automatically invokes all callbacks registered via
		// this.register() and this.registerEvent() on unload — no manual
		// teardown is needed here.
		debug("[MarkdownMason] unloaded");
	}

	async loadSettings(): Promise<void> {
		// pickSettingsFields keeps this.settings a PURE MasonSettings object — it
		// drops foreign keys (notably the ScriptStore `scripts` namespace, which
		// shares data.json). Without this, this.settings would carry a stale scripts
		// snapshot that saveSettings could write back over ScriptStore's newer data.
		this.settings = Object.assign({}, DEFAULT_SETTINGS, pickSettingsFields(await this.loadData()));
		// Seed the diagnostic-logging gate before any debug() trace fires.
		setDebugLogging(this.settings.debugLogging);
	}

	async saveSettings(): Promise<void> {
		// Read-modify-write: data.json is SHARED with ScriptStore (the `scripts`
		// namespace) and potentially other keys. Overlay only the canonical settings
		// fields onto the freshly-loaded blob so concurrent ScriptStore writes — e.g.
		// a script enabled earlier this session — are never clobbered.
		const persisted: unknown = await this.loadData();
		const base =
			persisted !== null && typeof persisted === "object"
				? (persisted as Record<string, unknown>)
				: {};
		await this.saveData({ ...base, ...pickSettingsFields(this.settings) });
	}

	// -------------------------------------------------------------------------
	// Mason: Paste and run scripts — Phase 5 real implementation (T5.5C)
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
			id: "mason.pasteAndRunScripts",
			name: "Paste and run scripts",
			// Obsidian editorCallback return type is `any`, so returning Promise<void>
			// is valid and lets tests await the async work without fire-and-forget.
			// Arrow function captures `this` lexically — no alias needed.
			editorCallback: async (editor: Editor): Promise<void> => {
				const enabledScripts = await this._buildEnabledPasteScripts();
				return runPasteCommand(
					editor,
					this.settings,
					this._commandInjection,
					enabledScripts,
				);
			},
		});
	}

	private _registerPasteAndFormatCommand(): void {
		this.addCommand({
			id: "mason.pasteAndFormatText",
			name: "Paste and format",
			editorCallback: async (editor: Editor): Promise<void> => {
				return runPasteAndFormatCommand(
					editor,
					this.settings,
					this._commandInjection,
				);
			},
		});
	}

	/**
	 * Assemble the enabled paste-capable scripts for the data-driven paste chain.
	 *
	 * Network-free: determines runnability via the per-device fingerprint store only
	 * (no catalog fetch). Only scripts that are ENABLED and locally present (Active
	 * when evaluated with catalogVersion:undefined) are included. Module loads are
	 * lazy — only runnable scripts are loaded via loadScriptModule.
	 *
	 * The chain only ever contains scripts that are enabled AND verified (consent +
	 * match-gate enforced upstream by the store/lifecycle layer), so the runner can
	 * safely run them with policy "enabled" (SEC-006).
	 */
	private async _buildEnabledPasteScripts(): Promise<LoadedScript[]> {
		const resolver = this.lifecycleResolver;
		if (resolver === undefined) {
			return [];
		}

		const records = await this.store.getScripts();
		// ABSOLUTE path — require/createRequire need it (manifest.dir is vault-relative).
		const scriptsDir = resolveScriptsDir(this.app.vault.adapter, this.manifest.dir);
		const requireFn = buildRequireFn(scriptsDir);

		return buildEnabledPasteScripts({
			records,
			resolver,
			scriptsDir,
			loadModule: loadScriptModule,
			requireFn,
		});
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
	// State + run path are wired live (T6.1/T6.3): getState is backed by the
	// LifecycleResolver state map and resolveScriptFn loads the materialized
	// module via loadRunFnSafe; both fail safe for non-Active scripts.
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
				let items: import("./ui/scriptsTab").ScriptItem[] = [];

				if (resolver !== undefined) {
					const scripts = await this.store.getScripts();
					items = await resolver.resolveItems(scripts);
					const stateMap = new Map(items.map((item) => [item.id, item.state]));
					getState = (id: string) => stateMap.get(id) ?? { kind: "Disabled" };
					debug("[MarkdownMason] Run script launcher: pre-resolved state map", stateMap.size, "entries");
				} else {
					getState = () => ({ kind: "Disabled" });
				}

				// T6.3: resolveScriptFn — loads the module for a runnable (Active) script
				// and returns its run function. Falls back to a safe no-op for non-runnable
				// ids (CommandManager._invokeScript re-checks getState before invoking, so
				// this no-op is never actually invoked for non-Active scripts).
				const scriptsDir = resolveScriptsDir(this.app.vault.adapter, this.manifest.dir);
				const requireFn = buildRequireFn(scriptsDir);
				const resolveScriptFn = (id: string): import("./scripts/context").ScriptFunction => {
					if (getState(id).kind !== "Active") {
						return (): undefined => undefined;
					}
					return loadRunFnSafe(id, scriptsDir, requireFn);
				};

				// Runnable (Active) scripts, with name + description for the picker cards.
				const entries = items
					.filter((it) => it.state.kind === "Active")
					.map((it) => ({ id: it.id, name: it.displayName, description: it.description }));

				const modal = new RunScriptModal(this.app, entries, async (entry) => {
					const fn = resolveScriptFn(entry.id);
					await this.commandManager.runScript(entry.id, entry.id, fn, getState, editor);
				});
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
		debug(`[MarkdownMason] paste: clipboard read (${rawText.length} chars)`);
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
		// and inform the user. This avoids a silent no-op when the user invokes "Paste and run scripts"
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
			debug(`[MarkdownMason] paste outcome: ${outcome.kind} (${outcome.count} edits)`);
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
// runPasteAndFormatCommand — paste + 7-step cleanup (spec 005 T2.2)
//
// Reads clipboard, applies the 7 formatPipeline cleanup steps gated by the
// user's formatSelection recipe, and inserts the result via replaceSelection.
//
// Does NOT run the paste-script chain (no ScriptRunner, no buildPasteChain).
// Clipboard guards match runPasteCommand for consistent UX across both commands.
//
// "\n" prepend guard (G4): prepending one newline prevents a clipboard snippet
// whose first line is "---" from being classified as YAML frontmatter by
// segmentBlocks(). The leading "\n" is stripped from the result before insert.
// ---------------------------------------------------------------------------

async function runPasteAndFormatCommand(
	editor: Editor,
	settings: MasonSettings,
	injection: CommandInjection | undefined,
): Promise<void> {
	// 1. Read clipboard (reuse same reader + guard idiom as runPasteCommand)
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

	// 3. Apply 7-step cleanup via applyTextCleanup
	const recipe = resolveFormatSelectionRecipe(settings);
	const log = settings.debugLogging
		? (l: string) => debug(`[MarkdownMason] ${l}`)
		: undefined;
	// G4: prepend "\n" so a snippet whose first line is "---" is NOT classified
	// as frontmatter by segmentBlocks (only line 0 triggers the frontmatter guard).
	// Strip exactly the one leading "\n" from the result — never trim().
	const formatted = applyTextCleanup("\n" + rawText, recipe, log).replace(/^\n/, "");

	// 4. Single insert → one undo step
	const insert = injection?.replaceSelection ?? ((t: string) => editor.replaceSelection(t));
	insert(formatted);

	// 5. Notice
	new Notice(
		formatted !== rawText
			? countNoticeMessage(1)
			: "Mason: pasted (nothing to clean up)",
	);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pick only the canonical MasonSettings fields from an arbitrary persisted-data
 * blob. The key set is DERIVED from DEFAULT_SETTINGS, so it stays correct as
 * settings fields are added (every field has a default by convention).
 *
 * Why: data.json is shared between the plugin settings and the ScriptStore
 * (`scripts`) namespace. Restricting both load and save to these keys keeps the
 * two namespaces from clobbering one another.
 */
export function pickSettingsFields(data: unknown): Partial<MasonSettings> {
	const out: Record<string, unknown> = {};
	if (data !== null && typeof data === "object") {
		const rec = data as Record<string, unknown>;
		for (const key of Object.keys(DEFAULT_SETTINGS)) {
			if (rec[key] !== undefined) out[key] = rec[key];
		}
	}
	return out;
}

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
