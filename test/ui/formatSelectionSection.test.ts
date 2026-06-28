/**
 * T3.1 — Format selection settings section (RED → GREEN).
 *
 * Verifies the Format selection segment introduced in spec 003, Phase 3:
 *   1. "Format selection" appears as a nav button in the segment control.
 *   2. "Format selection" appears between Commands and Advanced in nav order.
 *   3. Selecting the segment renders exactly FIVE toggle controls.
 *   4. Each toggle's initial value reflects resolveFormatSelectionRecipe(settings).
 *   5. Toggling a key mutates settings.formatSelection.<key> and calls saveSettings.
 *   6. Initializing from undefined formatSelection creates the object on first toggle.
 *   7. No setHeading() in the Format selection segment.
 */

import { describe, it, expect, vi } from "vitest";
import { App } from "obsidian";
import {
	capturedSettings,
	clearCapturedSettings,
	MockHTMLElement,
} from "../__mocks__/obsidian";

// ---------------------------------------------------------------------------
// Local types for the Setting builder introspection shape.
// Mirrored from settingsTab.test.ts — coupled only to the shape, not the impl.
// ---------------------------------------------------------------------------

interface MockToggleControl {
	_value: boolean;
	setValue(v: boolean): MockToggleControl;
	getValue(): boolean;
	onChange(cb: (v: boolean) => void): MockToggleControl;
}

interface CapturedSetting {
	name: string;
	desc: string;
	isHeading: boolean;
	textControls: unknown[];
	toggleControls: MockToggleControl[];
	buttonControls: unknown[];
}

// ---------------------------------------------------------------------------
// Dynamic import of the module under test (after mocks are resolved).
// ---------------------------------------------------------------------------

const { MasonSettingTab } = await import("../../src/ui/settingsTab");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal plugin double for Format selection tests.
 * Only includes the settings fields exercised by this section.
 */
function makePlugin(formatSelection?: Partial<{
	cascade: boolean;
	normalize: boolean;
	fromCitations: boolean;
	identity: boolean;
	move: boolean;
}>) {
	const app = new App();
	const settings: {
		resourcesName: string;
		debugLogging: boolean;
		numericOnly: boolean;
		formatSelection?: typeof formatSelection;
	} = {
		resourcesName: "Resources",
		debugLogging: false,
		numericOnly: true,
		formatSelection,
	};
	const saveSettings = vi.fn().mockResolvedValue(undefined);

	const store = {
		getScripts: vi.fn().mockResolvedValue({}),
		setRecord: vi.fn().mockResolvedValue(undefined),
	};

	const pluginManifest = {
		id: "markdown-mason",
		name: "Markdown Mason",
		version: "0.0.1",
		minAppVersion: "1.6.6",
		description: "Test description.",
		author: "Marcus Breiden",
		authorUrl: "https://www.mmomm.org",
		isDesktopOnly: true,
	};

	const commandManager = {
		register: vi.fn(),
		unregister: vi.fn(),
		disableScript: vi.fn().mockResolvedValue(undefined),
	};

	return { app, settings, saveSettings, store, manifest: pluginManifest, commandManager } as const;
}

/**
 * Render the Format selection segment and return captured settings and container.
 * Clicks the "Format selection" nav button after initial display().
 */
async function renderFormatSelectionSegment(plugin: ReturnType<typeof makePlugin>): Promise<{
	settings: CapturedSetting[];
	container: MockHTMLElement;
}> {
	const tab = new MasonSettingTab(plugin.app as never, plugin as never);
	clearCapturedSettings();
	await tab.display();

	const container = tab.containerEl as unknown as MockHTMLElement;
	const btn = container._findButtonByText("Format selection");
	clearCapturedSettings();
	btn!._click();

	return {
		settings: capturedSettings() as unknown as CapturedSetting[],
		container,
	};
}

// ---------------------------------------------------------------------------
// NAV — "Format selection" segment button presence and position
// ---------------------------------------------------------------------------

describe("MasonSettingTab — Format selection nav", () => {
	it("renders a 'Format selection' button in the segment nav", async () => {
		const plugin = makePlugin();
		const tab = new MasonSettingTab(plugin.app as never, plugin as never);
		clearCapturedSettings();
		await tab.display();

		const buttons = (tab.containerEl as unknown as MockHTMLElement)._findAllButtons();
		const labels = buttons.map((b) => b._text);
		expect(labels).toContain("Format selection");
	});

	it("'Format selection' appears after Commands and before Advanced", async () => {
		const plugin = makePlugin();
		const tab = new MasonSettingTab(plugin.app as never, plugin as never);
		clearCapturedSettings();
		await tab.display();

		const buttons = (tab.containerEl as unknown as MockHTMLElement)._findAllButtons();
		const labels = buttons.map((b) => b._text);
		const commandsIdx = labels.indexOf("Commands");
		const formatIdx = labels.indexOf("Format selection");
		const advancedIdx = labels.indexOf("Advanced");

		expect(commandsIdx).toBeGreaterThanOrEqual(0);
		expect(formatIdx).toBeGreaterThan(commandsIdx);
		expect(advancedIdx).toBeGreaterThan(formatIdx);
	});
});

// ---------------------------------------------------------------------------
// SECTION RENDERING — five toggles, no heading, correct initial values
// ---------------------------------------------------------------------------

describe("MasonSettingTab — Format selection section rendering", () => {
	it("renders exactly five toggle controls", async () => {
		const plugin = makePlugin();
		const { settings } = await renderFormatSelectionSegment(plugin);
		const allToggles = settings.flatMap((s) => s.toggleControls);
		expect(allToggles).toHaveLength(5);
	});

	it("all five toggles are true when formatSelection is undefined (all-on default)", async () => {
		const plugin = makePlugin(undefined);
		const { settings } = await renderFormatSelectionSegment(plugin);
		const allToggles = settings.flatMap((s) => s.toggleControls);
		expect(allToggles).toHaveLength(5);
		for (const toggle of allToggles) {
			expect(toggle.getValue()).toBe(true);
		}
	});

	it("toggle values reflect custom formatSelection settings", async () => {
		const plugin = makePlugin({ cascade: false, normalize: true, fromCitations: false, identity: true, move: false });
		const { settings } = await renderFormatSelectionSegment(plugin);
		const allToggles = settings.flatMap((s) => s.toggleControls);
		expect(allToggles).toHaveLength(5);
		// Order: cascade, normalize, fromCitations, identity, move
		expect(allToggles[0].getValue()).toBe(false); // cascade
		expect(allToggles[1].getValue()).toBe(true);  // normalize
		expect(allToggles[2].getValue()).toBe(false); // fromCitations
		expect(allToggles[3].getValue()).toBe(true);  // identity
		expect(allToggles[4].getValue()).toBe(false); // move
	});

	it("renders no setHeading() in the Format selection segment", async () => {
		const plugin = makePlugin();
		const { settings } = await renderFormatSelectionSegment(plugin);
		expect(settings.filter((s) => s.isHeading)).toHaveLength(0);
	});

	it("each toggle row follows sentence case (no multi-word Title Case names)", async () => {
		const plugin = makePlugin();
		const { settings } = await renderFormatSelectionSegment(plugin);
		const titleCasePattern = /^.+\s+[A-Z][a-z]/;
		for (const s of settings) {
			if (s.isHeading || s.toggleControls.length === 0) continue;
			expect(
				s.name,
				`Setting name "${s.name}" appears to be Title Case — use sentence case`,
			).not.toMatch(titleCasePattern);
		}
	});
});

// ---------------------------------------------------------------------------
// TOGGLE WRITE-THROUGH — onChange updates settings.<key> and calls saveSettings
// ---------------------------------------------------------------------------

describe("MasonSettingTab — Format selection toggle write-through", () => {
	it("toggling 'cascade' updates settings.formatSelection.cascade and calls saveSettings", async () => {
		const plugin = makePlugin({ cascade: true });
		const { settings } = await renderFormatSelectionSegment(plugin);

		const cascadeSetting = settings.find(
			(s) => s.toggleControls.length > 0 && s.name.toLowerCase().includes("cascade"),
		);
		expect(cascadeSetting).toBeDefined();

		cascadeSetting!.toggleControls[0].setValue(false);

		expect(plugin.settings.formatSelection?.cascade).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it("toggling 'normalize' updates settings.formatSelection.normalize and calls saveSettings", async () => {
		const plugin = makePlugin({ normalize: true });
		const { settings } = await renderFormatSelectionSegment(plugin);

		const setting = settings.find(
			(s) => s.toggleControls.length > 0 && s.name.toLowerCase().includes("normalize"),
		);
		expect(setting).toBeDefined();

		setting!.toggleControls[0].setValue(false);

		expect(plugin.settings.formatSelection?.normalize).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it("toggling 'fromCitations' updates settings.formatSelection.fromCitations and calls saveSettings", async () => {
		const plugin = makePlugin({ fromCitations: true });
		const { settings } = await renderFormatSelectionSegment(plugin);

		const setting = settings.find(
			(s) => s.toggleControls.length > 0 && s.name.toLowerCase().includes("citation"),
		);
		expect(setting).toBeDefined();

		setting!.toggleControls[0].setValue(false);

		expect(plugin.settings.formatSelection?.fromCitations).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it("toggling 'identity' updates settings.formatSelection.identity and calls saveSettings", async () => {
		const plugin = makePlugin({ identity: true });
		const { settings } = await renderFormatSelectionSegment(plugin);

		const setting = settings.find(
			(s) => s.toggleControls.length > 0 && s.name.toLowerCase().includes("identity"),
		);
		expect(setting).toBeDefined();

		setting!.toggleControls[0].setValue(false);

		expect(plugin.settings.formatSelection?.identity).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it("toggling 'move' updates settings.formatSelection.move and calls saveSettings", async () => {
		const plugin = makePlugin({ move: true });
		const { settings } = await renderFormatSelectionSegment(plugin);

		const setting = settings.find(
			(s) => s.toggleControls.length > 0 && s.name.toLowerCase().includes("move"),
		);
		expect(setting).toBeDefined();

		setting!.toggleControls[0].setValue(false);

		expect(plugin.settings.formatSelection?.move).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it("initializes formatSelection object when settings.formatSelection is undefined on first toggle", async () => {
		const plugin = makePlugin(undefined);
		expect(plugin.settings.formatSelection).toBeUndefined();

		const { settings } = await renderFormatSelectionSegment(plugin);
		const cascadeSetting = settings.find(
			(s) => s.toggleControls.length > 0 && s.name.toLowerCase().includes("cascade"),
		);
		expect(cascadeSetting).toBeDefined();

		cascadeSetting!.toggleControls[0].setValue(false);

		expect(plugin.settings.formatSelection).toBeDefined();
		expect(plugin.settings.formatSelection?.cascade).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});
});
