import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { MasonSettings } from "../core/types";
import type { ScriptStore } from "../scripts/store";

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
	store: Pick<ScriptStore, "getManifest" | "getDevice" | "setEnabled">;
}

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
 * Renders three sections:
 *   1. General  — resourcesName text field, numericOnly toggle
 *   2. Scripts  — per-script enable toggle + import button
 *   3. Advanced — debugLogging toggle
 */
export class MasonSettingTab extends PluginSettingTab {
	private readonly _plugin: MasonPlugin;

	constructor(app: App, plugin: MasonPlugin) {
		super(app, plugin);
		this._plugin = plugin;
	}

	/**
	 * Build (or rebuild) the settings UI.
	 * Clears containerEl first so repeated calls do not duplicate controls.
	 * Async because the Scripts section reads from the store.
	 */
	override async display(): Promise<void> {
		const { containerEl } = this;
		containerEl.empty();

		this._renderGeneralSection(containerEl);
		await this._renderScriptsSection(containerEl);
		this._renderAdvancedSection(containerEl);
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
		new Setting(containerEl).setName("Scripts").setHeading();

		const [manifest, device] = await Promise.all([
			this._plugin.store.getManifest(),
			this._plugin.store.getDevice(),
		]);

		const ids = Object.keys(manifest);

		if (ids.length === 0) {
			// No scripts installed — show an informational row.
			new Setting(containerEl)
				.setName("No scripts installed")
				.setDesc("Import a .cjs script from your vault using the button below.");
			return;
		}

		for (const id of ids) {
			const entry = manifest[id];
			const isEnabled = device.enabled[id] ?? false;

			new Setting(containerEl)
				.setName(id)
				.setDesc(`Source: ${entry.source}  ·  v${entry.version}`)
				.addToggle((toggle) => {
					toggle
						.setValue(isEnabled)
						.onChange(async (value) => {
							await this._plugin.store.setEnabled(id, value);
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
