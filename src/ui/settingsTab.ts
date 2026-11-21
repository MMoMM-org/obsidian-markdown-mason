import { App, Notice, Plugin, PluginSettingTab } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import type { MasonSettings } from "../core/types";
import type { ScriptStore } from "../scripts/store";
import type { LifecycleResolver } from "../scripts/lifecycleResolver";
import type { LifecycleController } from "../scripts/lifecycleController";
import { buildRequireFn, loadRunFnSafe, resolveScriptsDir } from "../scripts/loader";
import { debug, setDebugLogging } from "../core/debug";
import { buildCommandsPage } from "./commandsPage";
import type { CommandManagerPort, CommandPageDeps } from "./commandsPage";
import { buildDocumentationRow } from "./pluginIdentity";
import { buildLifecycleOps } from "./scriptLifecycleOps";
import { ScriptsCache } from "./scriptsCache";
import { buildScriptsPage } from "./scriptsPage";
import type { LifecycleOps } from "./scriptsPage";
import { isFixedKey, readControl, writeControl } from "./settingsControlStore";
import { buildMainPageItems } from "./settingsDefinitions";

// ---------------------------------------------------------------------------
// Minimal plugin interface — avoids a hard import cycle with main.ts
//
// MasonSettingTab depends on the plugin for settings + saveSettings; it does
// NOT need the full MarkdownMasonPlugin type.
// ---------------------------------------------------------------------------

/** Minimal plugin surface consumed by MasonSettingTab. */
export interface MasonPlugin extends Plugin {
	settings: MasonSettings;
	saveSettings(): Promise<void>;
	store: Pick<ScriptStore, "getScripts" | "setRecord">;
	commandManager: CommandManagerPort;
	/**
	 * Live lifecycle resolver. Optional: when absent, script states are derived
	 * offline from the persisted records alone (fail closed).
	 */
	lifecycleResolver?: LifecycleResolver;
	/**
	 * Live lifecycle controller. Optional: when absent, the Scripts page falls
	 * back to the store-only enable / disable / remove ops.
	 */
	lifecycleController?: LifecycleController;
	/**
	 * Count of scripts with a newer catalog version waiting (state
	 * UpdateAvailable). Written by the tab's ScriptsCache after every refresh.
	 */
	updatableScriptCount?: number;
}

// ---------------------------------------------------------------------------
// MasonSettingTab
//
// COMMUNITY COMPLIANCE
// - Declarative only: the tab returns setting definitions, so Obsidian renders
//   it and indexes it for the settings search. There is no display().
// - All UI text follows SENTENCE CASE (see the builders).
// - No default hotkeys are registered.
// ---------------------------------------------------------------------------

/**
 * Settings tab for Markdown Mason.
 *
 * Thin on purpose: the main page is assembled by buildMainPageItems from the
 * fixed settings, the Scripts page, the Commands page and the Documentation
 * row. The tab adds what only it can provide:
 *
 *   - control values are read and written through settingsControlStore and
 *     always persisted with plugin.saveSettings() — never with the base
 *     implementation, whose saveData(plugin.settings) would erase the scripts
 *     namespace that shares data.json;
 *   - the asynchronously resolved script state lives in `scripts`
 *     (ScriptsCache); every change of it redraws the tab through update().
 */
export class MasonSettingTab extends PluginSettingTab {
	/** Resolved script state behind the Scripts and Commands pages. */
	readonly scripts: ScriptsCache;

	private readonly _plugin: MasonPlugin;
	private readonly _lifecycleOps: LifecycleOps;
	private readonly _commandPageDeps: CommandPageDeps;

	constructor(app: App, plugin: MasonPlugin) {
		super(app, plugin);
		this._plugin = plugin;

		this.scripts = new ScriptsCache({
			store: plugin.store,
			resolver: plugin.lifecycleResolver,
			setUpdatableCount: (count) => {
				plugin.updatableScriptCount = count;
			},
		});
		this.scripts.onChange = () => this.update();

		// Built exactly once: buildLifecycleOps registers the controller's
		// re-render callback, and a second build would replace it.
		this._lifecycleOps = buildLifecycleOps(
			{ app, store: plugin.store, controller: plugin.lifecycleController },
			() => this.scripts.requestRefresh(),
		);
		this._commandPageDeps = this._buildCommandPageDeps();
	}

	/**
	 * The main settings page. Synchronous, free of I/O and never empty.
	 *
	 * A cache marked stale (the tab was hidden since the last refresh) is
	 * refreshed in the background; this build still returns the last known
	 * state, and the refresh redraws the tab when it lands. The refresh clears
	 * the stale flag before it awaits anything, so the build that update() then
	 * triggers does not start another one.
	 */
	override getSettingDefinitions(): SettingDefinitionItem[] {
		if (this.scripts.stale && !this.scripts.inFlight) {
			this.scripts.requestRefresh();
		}
		return buildMainPageItems({
			scriptsPage: buildScriptsPage(this.scripts, this._lifecycleOps),
			commandsPage: buildCommandsPage(this.scripts, this._commandPageDeps),
			identityRow: buildDocumentationRow(this._plugin.manifest),
		});
	}

	/** The value a control shows, with the default applied when nothing is stored. */
	override getControlValue(key: string): unknown {
		return isFixedKey(key) ? readControl(this._plugin.settings, key) : undefined;
	}

	/**
	 * Store a control's new value and persist it. A key that is not a fixed
	 * setting is ignored: nothing is written and nothing is saved.
	 *
	 * A failed save is reported but leaves the value set in memory, so the next
	 * successful save carries it.
	 */
	override async setControlValue(key: string, value: unknown): Promise<void> {
		if (!isFixedKey(key)) return;
		writeControl(this._plugin.settings, key, value);
		// Apply live so traces start or stop without a reload.
		if (key === "debugLogging") setDebugLogging(value === true);
		try {
			await this._plugin.saveSettings();
		} catch (err) {
			debug("[mason] saveSettings failed", err);
			new Notice("Mason: could not save settings.");
		}
	}

	/** Scripts may change while the tab is hidden, so the next build refreshes them. */
	override hide(): void {
		this.scripts.markStale();
		super.hide();
	}

	/**
	 * What a command row registers a command with.
	 *
	 * Both functions read the cache when they are called, so a command created
	 * earlier follows later refreshes. An unknown script counts as Disabled
	 * (fail closed), and only an Active script gets its real function: the
	 * materialized module is loaded when the command is registered, never while
	 * a row is built.
	 */
	private _buildCommandPageDeps(): CommandPageDeps {
		const plugin = this._plugin;
		const getState: CommandPageDeps["getState"] = (id) =>
			this.scripts.items?.find((item) => item.id === id)?.state ?? { kind: "Disabled" };
		return {
			store: plugin.store,
			commandManager: plugin.commandManager,
			getState,
			resolveScriptFn: (id) => {
				// CommandManager re-checks the state before it invokes a script, so
				// this no-op is never run for a script that is not Active.
				if (getState(id).kind !== "Active") return (): undefined => undefined;
				// Absolute path: require needs one, and manifest.dir is vault-relative.
				const scriptsDir = resolveScriptsDir(plugin.app.vault.adapter, plugin.manifest.dir);
				return loadRunFnSafe(id, scriptsDir, buildRequireFn(scriptsDir));
			},
		};
	}
}
