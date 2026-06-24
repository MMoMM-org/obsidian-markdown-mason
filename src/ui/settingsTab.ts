import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { PluginManifest } from "obsidian";
import type { MasonSettings } from "../core/types";
import type { ScriptRecord, ScriptStore } from "../scripts/store";
import { evaluateState } from "../scripts/lifecycle";
import { HeaderSection } from "./HeaderSection";
import { renderScriptsTab } from "./scriptsTab";
import type { ScriptItem, LifecycleOps } from "./scriptsTab";
import { renderCommandsTab } from "./commandsTab";
import type { CommandsTabCommandManager, ScriptFnResolver, StateResolver } from "./commandsTab";
import type { LifecycleResolver } from "../scripts/lifecycleResolver";

// ---------------------------------------------------------------------------
// Minimal plugin interface — avoids a hard import cycle with main.ts
//
// MasonSettingTab depends on the plugin for settings + saveSettings; it does
// NOT need the full MarkdownMasonPlugin type.
// ---------------------------------------------------------------------------

/** Minimal plugin surface consumed by MasonSettingTab. */
export interface MasonPlugin extends Plugin {
	manifest: PluginManifest & { authorUrl?: string };
	settings: MasonSettings;
	saveSettings(): Promise<void>;
	store: Pick<ScriptStore, "getScripts" | "setRecord">;
	commandManager: CommandsTabCommandManager;
	/**
	 * Live lifecycle resolver (T6.1). Optional: tests that don't exercise the
	 * live resolver inject a fake or leave it undefined; the tab falls back to
	 * safe offline stubs when absent.
	 */
	lifecycleResolver?: LifecycleResolver;
}

// ---------------------------------------------------------------------------
// Segment labels — the four tabs in the segmented control.
// ---------------------------------------------------------------------------

type Segment = "General" | "Scripts" | "Commands" | "Advanced";

const SEGMENTS: readonly Segment[] = ["General", "Scripts", "Commands", "Advanced"];

// ---------------------------------------------------------------------------
// MasonSettingTab
//
// COMMUNITY COMPLIANCE
// - All UI text follows SENTENCE CASE (only the first word capitalised).
// - DOM is built exclusively via Setting helpers, setText, and createEl —
//   never innerHTML / outerHTML / insertAdjacentHTML.
// - Section headings use Setting.setHeading() — not bare <h2> elements.
// - No default hotkeys are registered.
// - Diagnostic output uses console.debug only.
// ---------------------------------------------------------------------------

/**
 * Settings tab for Markdown Mason.
 *
 * Renders a four-segment control (General · Scripts · Commands · Advanced)
 * in a single PluginSettingTab. Only the active segment's controls are shown.
 *
 * Segments:
 *   1. General  — resourcesName text field, numericOnly toggle
 *   2. Scripts  — card rows (status pill, ⋯ menu, inline recovery) + toolbar
 *   3. Commands — placeholder heading (T4.4 seam)
 *   4. Advanced — debugLogging toggle
 */
export class MasonSettingTab extends PluginSettingTab {
	private readonly _plugin: MasonPlugin;
	private _activeSegment: Segment = "General";
	private _rendering: boolean = false;

	constructor(app: App, plugin: MasonPlugin) {
		super(app, plugin);
		this._plugin = plugin;
	}

	/**
	 * Build (or rebuild) the settings UI.
	 * Clears containerEl first so repeated calls do not duplicate controls.
	 * Renders the header, segment nav, then the active segment's content.
	 */
	override async display(): Promise<void> {
		const { containerEl } = this;
		containerEl.empty();

		new HeaderSection({ manifest: this._plugin.manifest }).render(containerEl);
		this._renderSegmentNav(containerEl);
		await this._renderSegment(containerEl, this._activeSegment);
	}

	// -------------------------------------------------------------------------
	// Segment navigation
	// -------------------------------------------------------------------------

	/**
	 * Render the segmented control nav bar.
	 * Each segment label becomes a <button> element with a click handler
	 * that switches the active section and re-renders the content area.
	 */
	private _renderSegmentNav(containerEl: HTMLElement): void {
		const nav = containerEl.createEl("div", { cls: "mason-segment-nav" });

		for (const segment of SEGMENTS) {
			const btn = nav.createEl("button");
			btn.setText(segment);
			if (segment === this._activeSegment) {
				btn.addClass("mason-segment-active");
			}
			btn.addEventListener("click", () => {
				void this._selectSegment(containerEl, segment);
			});
		}
	}

	/**
	 * Switch the active segment, re-render the content area.
	 * Ignores clicks that arrive while a render is already in flight (early-return
	 * guard — the in-flight render wins; the duplicate click is dropped).
	 */
	private async _selectSegment(containerEl: HTMLElement, segment: Segment): Promise<void> {
		if (this._rendering) return;
		this._rendering = true;
		try {
			this._activeSegment = segment;
			// Full re-render: clear the container and rebuild header, nav, and the
			// selected section. Simpler than partial DOM patching and preserves the
			// idempotency contract.
			containerEl.empty();
			new HeaderSection({ manifest: this._plugin.manifest }).render(containerEl);
			this._renderSegmentNav(containerEl);
			await this._renderSegment(containerEl, segment);
		} finally {
			this._rendering = false;
		}
	}

	/**
	 * Dispatch to the correct section renderer for the given segment.
	 */
	private async _renderSegment(containerEl: HTMLElement, segment: Segment): Promise<void> {
		switch (segment) {
			case "General":
				this._renderGeneralSection(containerEl);
				break;
			case "Scripts":
				await this._renderScriptsSection(containerEl);
				break;
			case "Commands":
				await this._renderCommandsSection(containerEl);
				break;
			case "Advanced":
				this._renderAdvancedSection(containerEl);
				break;
		}
	}

	// -------------------------------------------------------------------------
	// General section
	// -------------------------------------------------------------------------

	/** Render the General section heading and its controls. */
	private _renderGeneralSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("General").setHeading();

		new Setting(containerEl)
			.setName("Resources section name")
			.setDesc("Folder name used as the Resources section in heading cascades.")
			.addText((text) => {
				text
					.setValue(this._plugin.settings.resourcesName)
					.setPlaceholder("Resources")
					.onChange(async (value) => {
						this._plugin.settings.resourcesName = value;
						await this._plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Numeric-only footnotes")
			.setDesc(
				"Process only numeric footnote references (e.g. [^1]). " +
				"Alpha markers such as [^A] are excluded. " +
				"Note: disabling this is a planned feature — the setting persists " +
				"but alpha-marker support is not yet wired into the core.",
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this._plugin.settings.numericOnly ?? true)
					.onChange(async (value) => {
						this._plugin.settings.numericOnly = value;
						await this._plugin.saveSettings();
					});
			});
	}

	// -------------------------------------------------------------------------
	// Scripts section
	// -------------------------------------------------------------------------

	/**
	 * Render the Scripts section: a heading plus the card-based Scripts tab
	 * (scriptsTab.ts). This method is the thin CONTROLLER: it resolves each
	 * ScriptRecord into a ScriptItem (computing LifecycleState via the live
	 * resolver or offline stubs), builds a concrete LifecycleOps action seam,
	 * then hands BOTH to the synchronous, rendering-focused renderScriptsTab().
	 * All async I/O lives here; the render path stays pure and unit-testable.
	 *
	 * T6.1: uses the live LifecycleResolver when wired (plugin.lifecycleResolver);
	 * falls back to safe offline stubs (_buildScriptItemsFallback) when absent.
	 * renderScriptsTab itself remains synchronous.
	 */
	private async _renderScriptsSection(containerEl: HTMLElement): Promise<void> {
		new Setting(containerEl).setName("Scripts").setHeading();

		const scripts = await this._plugin.store.getScripts();
		let items: ScriptItem[];
		if (this._plugin.lifecycleResolver !== undefined) {
			// T6.1: live resolver — creates a fresh cache per render pass
			this._plugin.lifecycleResolver.clearCache();
			items = await this._plugin.lifecycleResolver.resolveItems(scripts);
		} else {
			items = this._buildScriptItemsFallback(scripts);
		}
		renderScriptsTab(containerEl, items, this._buildLifecycleOps(containerEl));
	}

	/**
	 * Offline fallback: resolve persisted records into ScriptItems with safe defaults.
	 *
	 * Used when the live resolver is not available (tests that don't wire it, or
	 * when _initLifecycleResolver failed). evaluateState fails closed: online=false,
	 * local=null → no false Active state.
	 */
	private _buildScriptItemsFallback(scripts: Record<string, ScriptRecord>): ScriptItem[] {
		return Object.entries(scripts).map(([id, record]) => {
			const state = evaluateState({
				record,
				inCatalog: record.provenance === "curated",
				local: null,
				catalogVersion: undefined,
				online: false,
			});
			return {
				id,
				displayName: id,
				description: `Source: ${record.source}`,
				record,
				state,
				version: record.okayed?.version ?? 0,
				provenance: record.provenance,
				catalogVersion: undefined,
			};
		});
	}

	/**
	 * Build the concrete LifecycleOps action seam.
	 *
	 * What EXISTS now is wired directly:
	 *   enable/disable → store.setRecord (toggle the persisted record), then
	 *                    re-render so the card reflects the new state.
	 *   remove         → clear the record's consent + disable, then re-render.
	 *
	 * P5: actions that require the LIVE catalog (browseOfficial, and the network
	 * fetch inside update/retry/reReview's materialization) are backed by a
	 * "coming soon" Notice seam. The real catalog adapter + browse modal land in
	 * Phase 5 (T5.x); replace these notice bodies with the live calls there.
	 */
	private _buildLifecycleOps(containerEl: HTMLElement): LifecycleOps {
		const rerender = (): void => { void this._selectSegment(containerEl, "Scripts"); };
		const store = this._plugin.store;

		const setEnabled = async (id: string, enabled: boolean): Promise<void> => {
			const rec = (await store.getScripts())[id];
			if (rec === undefined) return;
			await store.setRecord(id, { ...rec, enabled });
			rerender();
		};

		return {
			enable: (id) => setEnabled(id, true),
			disable: (id) => setEnabled(id, false),
			remove: async (id) => {
				const rec = (await store.getScripts())[id];
				if (rec === undefined) return;
				// Clear consent + disable (single-store removal of the active decision).
				await store.setRecord(id, { ...rec, enabled: false, okayed: null });
				rerender();
			},
			// P5: retry/update require the live catalog (materializer fetch path).
			retry: (id) => { this._comingSoon("retry", id); },
			update: (id) => { this._comingSoon("update", id); },
			// P5: re-review re-shows the disclosure modal once materialization metadata
			// (size/checksum/version) is available from the catalog/materializer.
			reReview: (id) => { this._comingSoon("re-review consent", id); },
			// P5: view source — curated→repo link, imported→reveal in vault.
			viewSource: (id) => { this._comingSoon("view source", id); },
			// P5: import-from-vault file picker.
			importFromVault: () => { this._comingSoon("import from vault"); },
			// P5: browse-official catalog modal.
			browseOfficial: () => { this._comingSoon("browse official"); },
		};
	}

	/** P5 seam: surface a sentence-case "coming soon" Notice for unwired actions. */
	private _comingSoon(action: string, id?: string): void {
		const suffix = id === undefined ? "" : ` for "${id}"`;
		new Notice(`Mason: ${action}${suffix} is coming soon.`);
		console.debug(`[MarkdownMason] P5 action not yet wired: ${action}${suffix}`);
	}

	// -------------------------------------------------------------------------
	// Commands section — T4.4
	// -------------------------------------------------------------------------

	/**
	 * Render the Commands section heading and the Commands tab.
	 *
	 * T6.1: getState is wired to the live resolver when available, falling back
	 * to the fail-closed Disabled stub. resolveScriptFn remains a stub until T6.3
	 * (module loader) lands.
	 */
	private async _renderCommandsSection(containerEl: HTMLElement): Promise<void> {
		new Setting(containerEl).setName("Commands").setHeading();

		// T6.3: resolveScriptFn placeholder — real module loader wires in at T6.3.
		const resolveScriptFn: ScriptFnResolver = () => {
			return (): undefined => undefined;
		};

		// T6.1: getState uses the live resolver when wired; fails closed to Disabled
		// when absent. The resolver's async resolveInput is wrapped in a sync facade
		// that returns Disabled immediately (safe default); the async result is not
		// awaited here since CommandsTab renders synchronously.
		const resolver = this._plugin.lifecycleResolver;
		const getState: StateResolver = (id: string) => {
			if (resolver === undefined) return { kind: "Disabled" };
			// resolveInput is async; return sync Disabled until T6.3 provides
			// a sync-capable lookup (e.g. pre-computed state cache). For now
			// the resolver is used for the Scripts tab (async) only.
			void id;
			return { kind: "Disabled" };
		};

		await renderCommandsTab(
			containerEl,
			this._plugin.store,
			this._plugin.commandManager,
			resolveScriptFn,
			getState,
		);
	}

	// -------------------------------------------------------------------------
	// Advanced section
	// -------------------------------------------------------------------------

	/** Render the Advanced section heading and its controls. */
	private _renderAdvancedSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Advanced").setHeading();

		new Setting(containerEl)
			.setName("Debug logging")
			.setDesc("Enable verbose console.debug traces. Reload Obsidian after toggling.")
			.addToggle((toggle) => {
				toggle
					.setValue(this._plugin.settings.debugLogging)
					.onChange(async (value) => {
						this._plugin.settings.debugLogging = value;
						await this._plugin.saveSettings();
					});
			});
	}
}
