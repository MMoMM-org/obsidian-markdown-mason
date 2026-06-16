import { Plugin } from "obsidian";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface MasonSettings {
	/** Enable verbose console.debug traces. Off by default. */
	debugLogging: boolean;
	/** Folder name used as a Resources section when building heading cascades. */
	resourcesName: string;
}

export const DEFAULT_SETTINGS: MasonSettings = {
	debugLogging: false,
	resourcesName: "Resources",
};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export class MarkdownMasonPlugin extends Plugin {
	declare settings: MasonSettings;

	override async onload(): Promise<void> {
		await this.loadSettings();
		this.app.workspace.onLayoutReady(() => this.onLayoutReady());
		console.debug("[MarkdownMason] loaded");
	}

	/**
	 * Called once the workspace layout is ready.
	 * Commands and paste bindings will attach here in later phases.
	 */
	onLayoutReady(): void {
		if (this.settings.debugLogging) {
			console.debug("[MarkdownMason] layout ready");
		}
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
}

export default MarkdownMasonPlugin;
