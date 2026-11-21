import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { PluginManifest } from "obsidian";
import type { MasonSettings } from "../core/types";
import type { ScriptStore } from "../scripts/store";
import { HeaderSection } from "./HeaderSection";
import { renderScriptsTab } from "./scriptsTab";
import type { ScriptItem, LifecycleOps } from "./scriptsPage";
import { renderCommandsTab } from "./commandsTab";
import type { CommandsTabCommandManager, ScriptFnResolver, StateResolver } from "./commandsTab";
import type { LifecycleResolver } from "../scripts/lifecycleResolver";
import type { LifecycleController } from "../scripts/lifecycleController";
import { buildLifecycleOps } from "./scriptLifecycleOps";
import { buildOfflineScriptItems } from "./scriptsCache";
import { buildRequireFn, loadRunFnSafe, resolveScriptsDir } from "../scripts/loader";
import { debug, setDebugLogging } from "../core/debug";
import { resolveFormatSelectionRecipe } from "../core/formatSelection";
import {
	FORMAT_SELECTION_INTRO,
	RESOURCES_NAME_PLACEHOLDER,
	SECTION_HEADINGS,
	fixedSetting,
} from "./settingsDefinitions";

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
	/**
	 * Live lifecycle controller (T6.2). Optional: tests that exercise only the
	 * card rendering inject a fake LifecycleOps and leave this undefined; the tab
	 * then falls back to the minimal store-only enable/disable/remove path.
	 */
	lifecycleController?: LifecycleController;
	/**
	 * Count of curated scripts with a newer catalog version waiting (state
	 * UpdateAvailable). Computed by the plugin at startup and refreshed by the
	 * Scripts section; read here to render the "needs attention" badge on the
	 * Scripts segment. Optional — absent in card-rendering unit tests → no badge.
	 */
	updatableScriptCount?: number;
}

// ---------------------------------------------------------------------------
// Segment labels — the tabs in the segmented control.
// ---------------------------------------------------------------------------

type Segment = "General" | "Scripts" | "Commands" | "Format selection" | "Advanced";

const SEGMENTS: readonly Segment[] = ["General", "Scripts", "Commands", "Format selection", "Advanced"];

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
 *   3. Commands — per-script "Create command" toggles + Run-script launcher (T4.4)
 *   4. Advanced — debugLogging toggle
 */
export class MasonSettingTab extends PluginSettingTab {
	private readonly _plugin: MasonPlugin;
	private _activeSegment: Segment = "General";
	private _rendering: boolean = false;
	/** Live badge element on the Scripts segment button; null until the nav renders. */
	private _scriptsBadgeEl: HTMLElement | null = null;

	constructor(app: App, plugin: MasonPlugin) {
		super(app, plugin);
		this._plugin = plugin;
	}

	/**
	 * Pre-select the Scripts segment so the next display() opens there.
	 *
	 * Used by the post-update splash's "Open scripts settings" action: the plugin
	 * sets the segment, then opens the settings pane (which triggers display()).
	 * Safe to call before the tab has rendered.
	 */
	selectScriptsSegment(): void {
		this._activeSegment = "Scripts";
	}

	/**
	 * Build (or rebuild) the settings UI.
	 * Clears containerEl first so repeated calls do not duplicate controls.
	 * Renders the header, segment nav, then the active segment's content.
	 */
	override display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new HeaderSection({ manifest: this._plugin.manifest }).render(containerEl);
		this._renderSegmentNav(containerEl);
		// PluginSettingTab.display() is typed void and Obsidian never awaits it;
		// fire-and-forget the async segment render (same pattern as the nav/segment
		// switch handlers) so we don't surface a Promise where void is expected.
		void this._renderSegment(containerEl, this._activeSegment);
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
		const nav = containerEl.createDiv({ cls: "mason-segment-nav" });

		for (const segment of SEGMENTS) {
			const btn = nav.createEl("button");
			btn.setText(segment);
			btn.setAttribute("type", "button");
			const active = segment === this._activeSegment;
			if (active) {
				btn.addClass("mason-segment-active");
			}
			// Convey the active tab to assistive tech, not by styling alone.
			btn.setAttribute("aria-selected", active ? "true" : "false");
			// Scripts segment carries a count badge for scripts with updates waiting.
			// The badge element is always created (text empty at 0) so _refreshScriptsBadge
			// can update it in place; CSS hides an empty badge via :empty.
			if (segment === "Scripts") {
				this._scriptsBadgeEl = btn.createSpan({ cls: "mason-segment-badge" });
				this._renderScriptsBadge();
			}
			btn.addEventListener("click", () => {
				void this._selectSegment(containerEl, segment);
			});
		}
	}

	/**
	 * Reflect the current updatable-script count onto the Scripts segment badge.
	 *
	 * Reads the plugin-cached count (set at startup + refreshed by the Scripts
	 * section). Sets the badge text to the count, or "" at zero so the `:empty`
	 * CSS rule hides it. Also mirrors the count into an aria-label so assistive
	 * tech announces it rather than relying on the badge glyph alone.
	 */
	private _renderScriptsBadge(): void {
		const el = this._scriptsBadgeEl;
		if (el === null) return;
		const count = this._plugin.updatableScriptCount ?? 0;
		el.setText(count > 0 ? String(count) : "");
		el.setAttribute(
			"aria-label",
			count > 0
				? `${count} script update${count === 1 ? "" : "s"} available`
				: "",
		);
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
			case "Format selection":
				this._renderFormatSelectionSection(containerEl);
				break;
			case "Advanced":
				this._renderAdvancedSection(containerEl);
				break;
		}
	}

	// -------------------------------------------------------------------------
	// General section
	// -------------------------------------------------------------------------

	/** Render the General section controls. The active tab labels the section. */
	private _renderGeneralSection(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(fixedSetting("resourcesName").name)
			.setDesc(fixedSetting("resourcesName").desc)
			.addText((text) => {
				text
					.setValue(this._plugin.settings.resourcesName)
					.setPlaceholder(RESOURCES_NAME_PLACEHOLDER)
					.onChange(async (value) => {
						this._plugin.settings.resourcesName = value;
						await this._plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(fixedSetting("showUpdateSplash").name)
			.setDesc(fixedSetting("showUpdateSplash").desc)
			.addToggle((toggle) => {
				toggle
					.setValue(this._plugin.settings.showUpdateSplash ?? true)
					.onChange(async (value) => {
						this._plugin.settings.showUpdateSplash = value;
						await this._plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(fixedSetting("numericOnly").name)
			.setDesc(fixedSetting("numericOnly").desc)
			.addToggle((toggle) => {
				toggle
					.setValue(this._plugin.settings.numericOnly ?? true)
					.onChange(async (value) => {
						this._plugin.settings.numericOnly = value;
						await this._plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(fixedSetting("pasteListContext").name)
			.setDesc(fixedSetting("pasteListContext").desc)
			.addToggle((toggle) => {
				toggle
					.setValue(this._plugin.settings.pasteListContext ?? true)
					.onChange(async (value) => {
						this._plugin.settings.pasteListContext = value;
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
	 * falls back to safe offline stubs (buildOfflineScriptItems) when absent.
	 * renderScriptsTab itself remains synchronous.
	 */
	private async _renderScriptsSection(containerEl: HTMLElement): Promise<void> {
		const scripts = await this._plugin.store.getScripts();
		let items: ScriptItem[];
		if (this._plugin.lifecycleResolver !== undefined) {
			// T6.1: live resolver — creates a fresh cache per render pass
			this._plugin.lifecycleResolver.clearCache();
			items = await this._plugin.lifecycleResolver.resolveItems(scripts);
		} else {
			items = buildOfflineScriptItems(scripts);
		}
		// Refresh the cached updatable count from the just-resolved items (zero extra
		// fetch) and patch the segment badge in place — so an in-tab update op that
		// clears a script's UpdateAvailable state immediately drops the badge count.
		this._plugin.updatableScriptCount = items.filter(
			(it) => it.state.kind === "UpdateAvailable",
		).length;
		this._renderScriptsBadge();
		renderScriptsTab(containerEl, items, this._buildLifecycleOps(containerEl));
	}

	/**
	 * Build the LifecycleOps action seam for the Scripts section (T6.2): the
	 * controller-backed ops, or the store-only fallback when no controller is
	 * wired. Every state change re-renders via the GUARDED _selectSegment path.
	 */
	private _buildLifecycleOps(containerEl: HTMLElement): LifecycleOps {
		return buildLifecycleOps(
			{
				app: this._plugin.app,
				store: this._plugin.store,
				controller: this._plugin.lifecycleController,
			},
			() => { void this._selectSegment(containerEl, "Scripts"); },
		);
	}

	// -------------------------------------------------------------------------
	// Commands section — T4.4
	// -------------------------------------------------------------------------

	/**
	 * Render the Commands section heading and the Commands tab.
	 *
	 * T6.1: when a live resolver is present, all script states are pre-resolved
	 * into a Map<id, LifecycleState> before rendering. A sync getState facade
	 * backed by that Map is passed to renderCommandsTab. Falls back to
	 * fail-closed Disabled when the resolver is absent.
	 *
	 * T6.3: resolveScriptFn loads the materialized module for Active scripts and
	 * returns its run function. Falls back to a safe no-op for non-Active ids
	 * (CommandManager._invokeScript re-checks state before invoking, so the no-op
	 * is never actually called for non-Active scripts).
	 */
	private async _renderCommandsSection(containerEl: HTMLElement): Promise<void> {
		// T6.1: pre-resolve all script states into a Map so getState can be sync.
		// resolveItems fetches the catalog index once and returns one entry per
		// script record; we key the map by id and fall back to Disabled for any
		// id not returned by the resolver. When resolver is absent, fail closed.
		const resolver = this._plugin.lifecycleResolver;
		let getState: StateResolver;

		if (resolver !== undefined) {
			resolver.clearCache();
			const scripts = await this._plugin.store.getScripts();
			const items = await resolver.resolveItems(scripts);
			const stateMap = new Map(items.map((item) => [item.id, item.state]));
			getState = (id: string) => stateMap.get(id) ?? { kind: "Disabled" };
			debug("[MarkdownMason] Commands tab: pre-resolved state map", stateMap.size, "entries");
		} else {
			getState = () => ({ kind: "Disabled" });
		}

		// T6.3: resolveScriptFn — loads the materialized module for Active scripts.
		// Uses getState (already backed by the pre-resolved Map) to gate the load.
		// ABSOLUTE path — require/createRequire need it (manifest.dir is vault-relative).
		const scriptsDir = resolveScriptsDir(this._plugin.app.vault.adapter, this._plugin.manifest.dir);
		const requireFn = buildRequireFn(scriptsDir);
		const resolveScriptFn: ScriptFnResolver = (id: string) => {
			if (getState(id).kind !== "Active") {
				return (): undefined => undefined;
			}
			return loadRunFnSafe(id, scriptsDir, requireFn);
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
	// Format selection section
	// -------------------------------------------------------------------------

	/**
	 * Render the Format selection section controls.
	 * Eleven toggles arranged under four setHeading() sub-groups:
	 *   Cleanup (4): dewrap, dehyphenate, decomposeLigatures, tidyWhitespace
	 *   Lists   (2): normalizeBullets, normalizeOrdered
	 *   Headings(2): cascade, normalize
	 *   Footnotes(3): fromCitations, identity, move
	 * All default to true (resolved via resolveFormatSelectionRecipe).
	 */
	private _renderFormatSelectionSection(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setDesc(FORMAT_SELECTION_INTRO.desc);

		const recipe = resolveFormatSelectionRecipe(this._plugin.settings);

		// --- Cleanup ---
		new Setting(containerEl).setName(SECTION_HEADINGS.cleanup).setHeading();

		new Setting(containerEl)
			.setName(fixedSetting("formatSelection.boxTable").name)
			.setDesc(fixedSetting("formatSelection.boxTable").desc)
			.addToggle((t) => {
				t.setValue(recipe.boxTable).onChange(async (v) => {
					if (!this._plugin.settings.formatSelection) {
						this._plugin.settings.formatSelection = {};
					}
					this._plugin.settings.formatSelection.boxTable = v;
					await this._plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(fixedSetting("formatSelection.reflow").name)
			.setDesc(fixedSetting("formatSelection.reflow").desc)
			.addToggle((t) => {
				t.setValue(recipe.reflow).onChange(async (v) => {
					if (!this._plugin.settings.formatSelection) {
						this._plugin.settings.formatSelection = {};
					}
					this._plugin.settings.formatSelection.reflow = v;
					await this._plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(fixedSetting("formatSelection.dewrap").name)
			.setDesc(fixedSetting("formatSelection.dewrap").desc)
			.addToggle((t) => {
				t.setValue(recipe.dewrap).onChange(async (v) => {
					if (!this._plugin.settings.formatSelection) {
						this._plugin.settings.formatSelection = {};
					}
					this._plugin.settings.formatSelection.dewrap = v;
					await this._plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(fixedSetting("formatSelection.dehyphenate").name)
			.setDesc(fixedSetting("formatSelection.dehyphenate").desc)
			.addToggle((t) => {
				t.setValue(recipe.dehyphenate).onChange(async (v) => {
					if (!this._plugin.settings.formatSelection) {
						this._plugin.settings.formatSelection = {};
					}
					this._plugin.settings.formatSelection.dehyphenate = v;
					await this._plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(fixedSetting("formatSelection.decomposeLigatures").name)
			.setDesc(fixedSetting("formatSelection.decomposeLigatures").desc)
			.addToggle((t) => {
				t.setValue(recipe.decomposeLigatures).onChange(async (v) => {
					if (!this._plugin.settings.formatSelection) {
						this._plugin.settings.formatSelection = {};
					}
					this._plugin.settings.formatSelection.decomposeLigatures = v;
					await this._plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(fixedSetting("formatSelection.tidyWhitespace").name)
			.setDesc(fixedSetting("formatSelection.tidyWhitespace").desc)
			.addToggle((t) => {
				t.setValue(recipe.tidyWhitespace).onChange(async (v) => {
					if (!this._plugin.settings.formatSelection) {
						this._plugin.settings.formatSelection = {};
					}
					this._plugin.settings.formatSelection.tidyWhitespace = v;
					await this._plugin.saveSettings();
				});
			});

		// --- Lists ---
		new Setting(containerEl).setName(SECTION_HEADINGS.lists).setHeading();

		new Setting(containerEl)
			.setName(fixedSetting("formatSelection.normalizeBullets").name)
			.setDesc(fixedSetting("formatSelection.normalizeBullets").desc)
			.addToggle((t) => {
				t.setValue(recipe.normalizeBullets).onChange(async (v) => {
					if (!this._plugin.settings.formatSelection) {
						this._plugin.settings.formatSelection = {};
					}
					this._plugin.settings.formatSelection.normalizeBullets = v;
					await this._plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(fixedSetting("formatSelection.normalizeOrdered").name)
			.setDesc(fixedSetting("formatSelection.normalizeOrdered").desc)
			.addToggle((t) => {
				t.setValue(recipe.normalizeOrdered).onChange(async (v) => {
					if (!this._plugin.settings.formatSelection) {
						this._plugin.settings.formatSelection = {};
					}
					this._plugin.settings.formatSelection.normalizeOrdered = v;
					await this._plugin.saveSettings();
				});
			});

		// --- Headings ---
		new Setting(containerEl).setName(SECTION_HEADINGS.headings).setHeading();

		new Setting(containerEl)
			.setName(fixedSetting("formatSelection.cascade").name)
			.setDesc(fixedSetting("formatSelection.cascade").desc)
			.addToggle((t) => {
				t.setValue(recipe.cascade).onChange(async (v) => {
					if (!this._plugin.settings.formatSelection) {
						this._plugin.settings.formatSelection = {};
					}
					this._plugin.settings.formatSelection.cascade = v;
					await this._plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(fixedSetting("formatSelection.normalize").name)
			.setDesc(fixedSetting("formatSelection.normalize").desc)
			.addToggle((t) => {
				t.setValue(recipe.normalize).onChange(async (v) => {
					if (!this._plugin.settings.formatSelection) {
						this._plugin.settings.formatSelection = {};
					}
					this._plugin.settings.formatSelection.normalize = v;
					await this._plugin.saveSettings();
				});
			});

		// --- Footnotes ---
		new Setting(containerEl).setName(SECTION_HEADINGS.footnotes).setHeading();

		new Setting(containerEl)
			.setName(fixedSetting("formatSelection.fromCitations").name)
			.setDesc(fixedSetting("formatSelection.fromCitations").desc)
			.addToggle((t) => {
				t.setValue(recipe.fromCitations).onChange(async (v) => {
					if (!this._plugin.settings.formatSelection) {
						this._plugin.settings.formatSelection = {};
					}
					this._plugin.settings.formatSelection.fromCitations = v;
					await this._plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(fixedSetting("formatSelection.identity").name)
			.setDesc(fixedSetting("formatSelection.identity").desc)
			.addToggle((t) => {
				t.setValue(recipe.identity).onChange(async (v) => {
					if (!this._plugin.settings.formatSelection) {
						this._plugin.settings.formatSelection = {};
					}
					this._plugin.settings.formatSelection.identity = v;
					await this._plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(fixedSetting("formatSelection.move").name)
			.setDesc(fixedSetting("formatSelection.move").desc)
			.addToggle((t) => {
				t.setValue(recipe.move).onChange(async (v) => {
					if (!this._plugin.settings.formatSelection) {
						this._plugin.settings.formatSelection = {};
					}
					this._plugin.settings.formatSelection.move = v;
					await this._plugin.saveSettings();
				});
			});
	}

	// -------------------------------------------------------------------------
	// Advanced section
	// -------------------------------------------------------------------------

	/** Render the Advanced section controls. The active tab labels the section. */
	private _renderAdvancedSection(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(fixedSetting("debugLogging").name)
			.setDesc(fixedSetting("debugLogging").desc)
			.addToggle((toggle) => {
				toggle
					.setValue(this._plugin.settings.debugLogging)
					.onChange(async (value) => {
						this._plugin.settings.debugLogging = value;
						// Apply live so traces start/stop without a reload.
						setDebugLogging(value);
						await this._plugin.saveSettings();
					});
			});
	}
}

