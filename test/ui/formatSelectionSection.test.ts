/**
 * T5.1 — Format selection settings section (11 toggles, 4 setHeading groups).
 *
 * Verifies the Format selection segment as rewritten in spec 004, Phase 5 (T5.1):
 *   1. "Format selection" appears as a nav button in the segment control.
 *   2. "Format selection" appears between Commands and Advanced in nav order.
 *   3. Selecting the segment renders exactly 11 toggle controls.
 *   4. Four setHeading() groups render in order: Cleanup, Lists, Headings, Footnotes.
 *   5. Each toggle's initial value reflects resolveFormatSelectionRecipe(settings).
 *   6. Toggling any key mutates settings.formatSelection.<key> and calls saveSettings.
 *   7. Initializing from undefined formatSelection creates the object on first toggle.
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
 * Covers all 11 FormatSelectionRecipe keys (5 original + 6 spec-004 additions).
 */
function makePlugin(formatSelection?: Partial<{
	cascade: boolean;
	normalize: boolean;
	fromCitations: boolean;
	identity: boolean;
	move: boolean;
	dewrap: boolean;
	dehyphenate: boolean;
	decomposeLigatures: boolean;
	tidyWhitespace: boolean;
	normalizeBullets: boolean;
	normalizeOrdered: boolean;
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
// SECTION RENDERING — 11 toggles, 4 setHeading groups, correct initial values
// ---------------------------------------------------------------------------

describe("MasonSettingTab — Format selection section rendering", () => {
	it("renders exactly 11 toggle controls", async () => {
		const plugin = makePlugin();
		const { settings } = await renderFormatSelectionSegment(plugin);
		const allToggles = settings.flatMap((s) => s.toggleControls);
		expect(allToggles).toHaveLength(11);
	});

	it("renders four setHeading() groups named Cleanup, Lists, Headings, Footnotes (in order)", async () => {
		const plugin = makePlugin();
		const { settings } = await renderFormatSelectionSegment(plugin);
		const headings = settings.filter((s) => s.isHeading);
		expect(headings).toHaveLength(4);
		expect(headings[0].name).toBe("Cleanup");
		expect(headings[1].name).toBe("Lists");
		expect(headings[2].name).toBe("Headings");
		expect(headings[3].name).toBe("Footnotes");
	});

	it("all 11 toggles are true when formatSelection is undefined (all-on default)", async () => {
		const plugin = makePlugin(undefined);
		const { settings } = await renderFormatSelectionSegment(plugin);
		const allToggles = settings.flatMap((s) => s.toggleControls);
		expect(allToggles).toHaveLength(11);
		for (const toggle of allToggles) {
			expect(toggle.getValue()).toBe(true);
		}
	});

	it("toggle value reflects a key explicitly set to false", async () => {
		const plugin = makePlugin({ dewrap: false });
		const { settings } = await renderFormatSelectionSegment(plugin);
		const dewrapSetting = settings.find(
			(s) => s.toggleControls.length > 0 && s.name.toLowerCase().includes("dewrap"),
		);
		expect(dewrapSetting).toBeDefined();
		expect(dewrapSetting!.toggleControls[0].getValue()).toBe(false);

		// All others should remain true
		const allToggles = settings.flatMap((s) => s.toggleControls);
		const others = allToggles.filter(
			(t) => t !== dewrapSetting!.toggleControls[0],
		);
		for (const toggle of others) {
			expect(toggle.getValue()).toBe(true);
		}
	});

	it("toggle values reflect custom formatSelection settings for all 11 keys", async () => {
		const plugin = makePlugin({
			dewrap: false,
			dehyphenate: true,
			decomposeLigatures: false,
			tidyWhitespace: true,
			normalizeBullets: false,
			normalizeOrdered: true,
			cascade: false,
			normalize: true,
			fromCitations: false,
			identity: true,
			move: false,
		});
		const { settings } = await renderFormatSelectionSegment(plugin);

		function getToggleByName(fragment: string): boolean {
			const s = settings.find(
				(r) => r.toggleControls.length > 0 && r.name.toLowerCase().includes(fragment),
			);
			expect(s).toBeDefined();
			return s!.toggleControls[0].getValue();
		}

		expect(getToggleByName("dewrap")).toBe(false);
		expect(getToggleByName("dehyphenate")).toBe(true);
		expect(getToggleByName("decompose")).toBe(false);
		expect(getToggleByName("tidy whitespace")).toBe(true);
		expect(getToggleByName("normalize bullets")).toBe(false);
		expect(getToggleByName("normalize ordered")).toBe(true);
		expect(getToggleByName("cascade")).toBe(false);
		expect(getToggleByName("normalize headings")).toBe(true);
		expect(getToggleByName("citation")).toBe(false);
		expect(getToggleByName("identity")).toBe(true);
		expect(getToggleByName("move footnotes")).toBe(false);
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
// PASTE-AND-FORMAT MARKERS — spec 005 T3.1
// ---------------------------------------------------------------------------

describe("MasonSettingTab — Format selection section — Paste-and-format markers", () => {
	it("'Cascade headings' desc contains the marker phrase", async () => {
		const plugin = makePlugin();
		const { settings } = await renderFormatSelectionSegment(plugin);
		const s = settings.find((r) => r.toggleControls.length > 0 && r.name === "Cascade headings");
		expect(s, "Cascade headings setting not found").toBeDefined();
		expect(s!.desc).toContain("not applied by Paste and format");
	});

	it("'Convert citations to footnotes' desc contains the marker phrase", async () => {
		const plugin = makePlugin();
		const { settings } = await renderFormatSelectionSegment(plugin);
		const s = settings.find((r) => r.toggleControls.length > 0 && r.name === "Convert citations to footnotes");
		expect(s, "Convert citations to footnotes setting not found").toBeDefined();
		expect(s!.desc).toContain("not applied by Paste and format");
	});

	it("'Resolve footnote identity' desc contains the marker phrase", async () => {
		const plugin = makePlugin();
		const { settings } = await renderFormatSelectionSegment(plugin);
		const s = settings.find((r) => r.toggleControls.length > 0 && r.name === "Resolve footnote identity");
		expect(s, "Resolve footnote identity setting not found").toBeDefined();
		expect(s!.desc).toContain("not applied by Paste and format");
	});

	it("'Move footnotes to resources' desc contains the marker phrase", async () => {
		const plugin = makePlugin();
		const { settings } = await renderFormatSelectionSegment(plugin);
		const s = settings.find((r) => r.toggleControls.length > 0 && r.name === "Move footnotes to resources");
		expect(s, "Move footnotes to resources setting not found").toBeDefined();
		expect(s!.desc).toContain("not applied by Paste and format");
	});

	it("the 7 applied toggles do NOT contain the marker phrase", async () => {
		const plugin = makePlugin();
		const { settings } = await renderFormatSelectionSegment(plugin);
		const appliedNames = [
			"Dewrap paragraphs",
			"Dehyphenate words",
			"Decompose ligatures and punctuation",
			"Tidy whitespace",
			"Normalize bullets",
			"Normalize ordered list",
			"Normalize headings",
		];
		for (const name of appliedNames) {
			const s = settings.find((r) => r.toggleControls.length > 0 && r.name === name);
			expect(s, `Setting "${name}" not found`).toBeDefined();
			expect(
				s!.desc,
				`"${name}" should NOT contain the marker phrase`,
			).not.toContain("not applied by Paste and format");
		}
	});

	it("the section intro desc names both 'Format selection' and 'Paste and format'", async () => {
		const plugin = makePlugin();
		const { settings } = await renderFormatSelectionSegment(plugin);
		const intro = settings.find((s) => !s.isHeading && s.toggleControls.length === 0 && s.desc.length > 0);
		expect(intro, "Section intro setting not found").toBeDefined();
		expect(intro!.desc).toContain("Format selection");
		expect(intro!.desc).toContain("Paste and format");
	});
});

// ---------------------------------------------------------------------------
// TOGGLE WRITE-THROUGH — onChange updates settings.<key> and calls saveSettings
// ---------------------------------------------------------------------------

describe("MasonSettingTab — Format selection toggle write-through", () => {
	// --- spec-004 new keys ---

	it("toggling 'dewrap' initializes formatSelection (when absent) and calls saveSettings", async () => {
		const plugin = makePlugin(undefined);
		expect(plugin.settings.formatSelection).toBeUndefined();

		const { settings } = await renderFormatSelectionSegment(plugin);
		const setting = settings.find(
			(s) => s.toggleControls.length > 0 && s.name.toLowerCase().includes("dewrap"),
		);
		expect(setting).toBeDefined();

		setting!.toggleControls[0].setValue(false);

		expect(plugin.settings.formatSelection).toBeDefined();
		expect(plugin.settings.formatSelection?.dewrap).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it("toggling 'dehyphenate' updates settings.formatSelection.dehyphenate and calls saveSettings", async () => {
		const plugin = makePlugin({ dehyphenate: true });
		const { settings } = await renderFormatSelectionSegment(plugin);

		const setting = settings.find(
			(s) => s.toggleControls.length > 0 && s.name.toLowerCase().includes("dehyphenate"),
		);
		expect(setting).toBeDefined();

		setting!.toggleControls[0].setValue(false);

		expect(plugin.settings.formatSelection?.dehyphenate).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it("toggling 'decomposeLigatures' updates settings.formatSelection.decomposeLigatures and calls saveSettings", async () => {
		const plugin = makePlugin({ decomposeLigatures: true });
		const { settings } = await renderFormatSelectionSegment(plugin);

		const setting = settings.find(
			(s) => s.toggleControls.length > 0 && s.name.toLowerCase().includes("decompose"),
		);
		expect(setting).toBeDefined();

		setting!.toggleControls[0].setValue(false);

		expect(plugin.settings.formatSelection?.decomposeLigatures).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it("toggling 'tidyWhitespace' updates settings.formatSelection.tidyWhitespace and calls saveSettings", async () => {
		const plugin = makePlugin({ tidyWhitespace: true });
		const { settings } = await renderFormatSelectionSegment(plugin);

		const setting = settings.find(
			(s) => s.toggleControls.length > 0 && s.name.toLowerCase().includes("tidy whitespace"),
		);
		expect(setting).toBeDefined();

		setting!.toggleControls[0].setValue(false);

		expect(plugin.settings.formatSelection?.tidyWhitespace).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it("toggling 'normalizeBullets' updates settings.formatSelection.normalizeBullets and calls saveSettings", async () => {
		const plugin = makePlugin({ normalizeBullets: true });
		const { settings } = await renderFormatSelectionSegment(plugin);

		const setting = settings.find(
			(s) => s.toggleControls.length > 0 && s.name.toLowerCase().includes("normalize bullets"),
		);
		expect(setting).toBeDefined();

		setting!.toggleControls[0].setValue(false);

		expect(plugin.settings.formatSelection?.normalizeBullets).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it("toggling 'normalizeOrdered' updates settings.formatSelection.normalizeOrdered and calls saveSettings", async () => {
		const plugin = makePlugin({ normalizeOrdered: true });
		const { settings } = await renderFormatSelectionSegment(plugin);

		const setting = settings.find(
			(s) => s.toggleControls.length > 0 && s.name.toLowerCase().includes("normalize ordered"),
		);
		expect(setting).toBeDefined();

		setting!.toggleControls[0].setValue(false);

		expect(plugin.settings.formatSelection?.normalizeOrdered).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	// --- original 5 keys (regression) ---

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

	it("toggling 'normalize' (headings) updates settings.formatSelection.normalize and calls saveSettings", async () => {
		const plugin = makePlugin({ normalize: true });
		const { settings } = await renderFormatSelectionSegment(plugin);

		const setting = settings.find(
			(s) => s.toggleControls.length > 0 && s.name.toLowerCase().includes("normalize headings"),
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
			(s) => s.toggleControls.length > 0 && s.name.toLowerCase().includes("move footnotes"),
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
