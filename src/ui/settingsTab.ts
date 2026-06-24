import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { PluginManifest } from "obsidian";
import type { MasonSettings } from "../core/types";
import type { ScriptStore } from "../scripts/store";
import { HeaderSection } from "./HeaderSection";

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
 *   2. Scripts  — per-script enable toggle + import button (transitional)
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
				this._renderCommandsSection(containerEl);
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

	/** Render the Scripts section heading and per-script controls. */
	private async _renderScriptsSection(containerEl: HTMLElement): Promise<void> {
		// TRANSITIONAL (T1.4): minimal transcription onto the ScriptRecord store.
		// Full Scripts-tab rebuild (Command Management, import lifecycle) lands in T4.2.
		new Setting(containerEl).setName("Scripts").setHeading();

		const scripts = await this._plugin.store.getScripts();

		const ids = Object.keys(scripts);

		if (ids.length === 0) {
			// No scripts installed — show an informational row.
			new Setting(containerEl)
				.setName("No scripts installed")
				.setDesc("No scripts installed yet.");
			return;
		}

		for (const id of ids) {
			const rec = scripts[id];
			const version = rec.okayed?.version ?? "—";

			new Setting(containerEl)
				.setName(id)
				.setDesc(`Source: ${rec.source}  ·  v${version}`)
				.addToggle((toggle) => {
					toggle
						.setValue(rec.enabled)
						.onChange(async (value) => {
							await this._plugin.store.setRecord(id, { ...rec, enabled: value });
						});
				})
				.addButton((button) => {
					button
						.setButtonText("Import from vault…")
						.onClick(async () => {
							// v0.1 placeholder: a full file-picker is out of scope.
							// The control exists and is wired; a Notice informs the user.
							new Notice(
								`Mason: use the vault import command to import "${id}" ` +
								`from your vault. File-picker UI is planned for a future release.`,
							);
							console.debug(`[MarkdownMason] import button clicked for script: ${id}`);
						});
				});
		}
	}

	// -------------------------------------------------------------------------
	// Commands section — T4.4 seam
	// -------------------------------------------------------------------------

	/** Render the Commands section placeholder heading (T4.4 seam). */
	private _renderCommandsSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Commands").setHeading();
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
