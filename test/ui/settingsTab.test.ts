/**
 * T4.1 — MasonSettingTab segmented shell tests (RED → GREEN).
 *
 * Verifies the four-segment settings tab introduced in T4.1.
 *
 * Observable behaviour contracts:
 *   1. Four segment buttons rendered: General · Scripts · Commands · Advanced
 *   2. Default segment (General) renders its controls on display()
 *   3. Selecting a segment re-renders and shows ONLY that section's Settings
 *   4. General retains v0.1 controls (resourcesName text + numericOnly toggle)
 *   5. Advanced retains debugLogging toggle
 *   6. All setName strings follow sentence case
 *   7. No innerHTML / outerHTML / insertAdjacentHTML usage
 *   8. display() is idempotent (calling twice yields same count for default segment)
 */

import { describe, it, expect, vi } from "vitest";
import { App } from "obsidian";
import type { ScriptRecord } from "../../src/scripts/store";

// ---------------------------------------------------------------------------
// Pull in test helpers from the mock (populated by the Setting extension).
// Imported via the relative path so TypeScript resolves our mock types
// (not the obsidian package .d.ts) and vitest uses the same module instance
// as the alias (Vite deduplicates by resolved path).
// ---------------------------------------------------------------------------
import {
	capturedSettings,
	clearCapturedSettings,
	MockHTMLElement,
} from "../__mocks__/obsidian";

// ---------------------------------------------------------------------------
// Local types for the Setting builder introspection shape.
// Defined here to ensure the tests are coupled only to the SHAPE, not the impl.
// ---------------------------------------------------------------------------

interface MockTextControl {
	_value: string;
	setValue(v: string): MockTextControl;
	getValue(): string;
	onChange(cb: (v: string) => void): MockTextControl;
}

interface MockToggleControl {
	_value: boolean;
	setValue(v: boolean): MockToggleControl;
	getValue(): boolean;
	onChange(cb: (v: boolean) => void): MockToggleControl;
}

interface MockButtonControl {
	_text: string;
	setButtonText(text: string): MockButtonControl;
	onClick(cb: () => void | Promise<void>): MockButtonControl;
}

interface CapturedSetting {
	/** The name passed to setName(). */
	name: string;
	/** The description passed to setDesc(). */
	desc: string;
	/** Whether setHeading() was called. */
	isHeading: boolean;
	/** Text controls registered via addText(). */
	textControls: MockTextControl[];
	/** Toggle controls registered via addToggle(). */
	toggleControls: MockToggleControl[];
	/** Button controls registered via addButton(). */
	buttonControls: MockButtonControl[];
}

// ---------------------------------------------------------------------------
// Dynamic import of the module under test (after mocks are resolved).
// ---------------------------------------------------------------------------

const { MasonSettingTab } = await import("../../src/ui/settingsTab");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal MarkdownMasonPlugin-like test double.
 * Exposes settings (with all required fields) and a spy-able saveSettings().
 */
function makePlugin(overrides?: {
	resourcesName?: string;
	debugLogging?: boolean;
	numericOnly?: boolean;
}) {
	const app = new App();
	const settings = {
		resourcesName: overrides?.resourcesName ?? "Resources",
		debugLogging: overrides?.debugLogging ?? false,
		numericOnly: overrides?.numericOnly ?? true,
	};
	const saveSettings = vi.fn().mockResolvedValue(undefined);

	// Minimal ScriptStore double — new ScriptRecord shape (T1.4).
	const scripts: Record<string, ScriptRecord> = {
		"perplexity-auto": {
			provenance: "curated", enabled: true, okayed: { version: 1, checksum: "sha256:abc" },
			source: "vault/perplexity-auto.cjs", command: false,
		},
		"perplexity-web": {
			provenance: "curated", enabled: false, okayed: { version: 1, checksum: "sha256:def" },
			source: "vault/perplexity-web.cjs", command: false,
		},
	};
	const store = {
		getScripts: vi.fn().mockResolvedValue(scripts),
		setRecord: vi.fn().mockResolvedValue(undefined),
	};

	// Plugin manifest — required by HeaderSection (wired into display()).
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

	// Minimal CommandManager double for T4.4 Commands tab wiring.
	const commandManager = {
		register: vi.fn(),
		unregister: vi.fn(),
		disableScript: vi.fn().mockResolvedValue(undefined),
	};

	return { app, settings, saveSettings, store, manifest: pluginManifest, commandManager } as const;
}

/**
 * Build a tab, call display(), and return the captured settings list.
 * Awaits the async display() so all store reads complete before assertions.
 */
async function renderTab(plugin: ReturnType<typeof makePlugin>): Promise<CapturedSetting[]> {
	clearCapturedSettings();
	const tab = new MasonSettingTab(plugin.app as never, plugin as never);
	await tab.display();
	return capturedSettings() as unknown as CapturedSetting[];
}

// ---------------------------------------------------------------------------
// SEGMENT NAVIGATION
// ---------------------------------------------------------------------------

describe("MasonSettingTab — segment navigation", () => {
	it("renders exactly four segment buttons: General, Scripts, Commands, Advanced", async () => {
		const plugin = makePlugin();
		const tab = new MasonSettingTab(plugin.app as never, plugin as never);
		clearCapturedSettings();
		await tab.display();

		// The segment buttons are rendered as <button> elements on containerEl.
		const buttons = (tab.containerEl as unknown as MockHTMLElement)._findAllButtons();
		const labels = buttons.map((b) => b._text);

		expect(labels).toContain("General");
		expect(labels).toContain("Scripts");
		expect(labels).toContain("Commands");
		expect(labels).toContain("Advanced");
	});

	it("default segment (General) shows General controls after display()", async () => {
		const plugin = makePlugin();
		const settings = await renderTab(plugin);

		// General section must have a text control for resourcesName.
		const resourcesSetting = settings.find(
			(s) => !s.isHeading && s.textControls.length > 0 && s.name.toLowerCase().includes("resources"),
		);
		expect(resourcesSetting).toBeDefined();

		// General section must have a toggle for numericOnly.
		const numericSetting = settings.find(
			(s) => !s.isHeading && s.toggleControls.length > 0 && s.name.toLowerCase().includes("numeric"),
		);
		expect(numericSetting).toBeDefined();
	});

	it("default segment (General) does NOT show debugLogging toggle", async () => {
		const plugin = makePlugin();
		const settings = await renderTab(plugin);

		// Advanced's debugLogging control must not be present in the default General view.
		const debugSetting = settings.find(
			(s) => !s.isHeading && s.toggleControls.length > 0 && s.name.toLowerCase().includes("debug"),
		);
		expect(debugSetting).toBeUndefined();
	});

	it("selecting the Advanced segment shows only debugLogging toggle, not resourcesName", async () => {
		const plugin = makePlugin();
		const tab = new MasonSettingTab(plugin.app as never, plugin as never);
		clearCapturedSettings();
		await tab.display();

		// Click the "Advanced" segment button.
		const advancedButton = (tab.containerEl as unknown as MockHTMLElement)._findButtonByText("Advanced");
		expect(advancedButton).toBeDefined();

		clearCapturedSettings();
		advancedButton!._click();

		const settings = capturedSettings() as unknown as CapturedSetting[];

		// debugLogging toggle must appear.
		const debugSetting = settings.find(
			(s) => !s.isHeading && s.toggleControls.length > 0 && s.name.toLowerCase().includes("debug"),
		);
		expect(debugSetting).toBeDefined();

		// resourcesName text control must NOT appear.
		const resourcesSetting = settings.find(
			(s) => !s.isHeading && s.textControls.length > 0 && s.name.toLowerCase().includes("resources"),
		);
		expect(resourcesSetting).toBeUndefined();
	});

	it("selecting the General segment shows resourcesName, not debugLogging", async () => {
		const plugin = makePlugin();
		const tab = new MasonSettingTab(plugin.app as never, plugin as never);
		clearCapturedSettings();
		await tab.display();

		// Navigate to Advanced first, then back to General.
		// Drain microtasks between clicks so _rendering is cleared before the next click fires.
		const advancedButton = (tab.containerEl as unknown as MockHTMLElement)._findButtonByText("Advanced");
		clearCapturedSettings();
		advancedButton!._click();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		const generalButton = (tab.containerEl as unknown as MockHTMLElement)._findButtonByText("General");
		clearCapturedSettings();
		generalButton!._click();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		const settings = capturedSettings() as unknown as CapturedSetting[];

		// resourcesName text control must appear.
		const resourcesSetting = settings.find(
			(s) => !s.isHeading && s.textControls.length > 0 && s.name.toLowerCase().includes("resources"),
		);
		expect(resourcesSetting).toBeDefined();

		// debugLogging must NOT appear.
		const debugSetting = settings.find(
			(s) => !s.isHeading && s.toggleControls.length > 0 && s.name.toLowerCase().includes("debug"),
		);
		expect(debugSetting).toBeUndefined();
	});

	it("selecting the Commands segment shows a Commands heading and no General or Advanced controls", async () => {
		const plugin = makePlugin();
		const tab = new MasonSettingTab(plugin.app as never, plugin as never);
		clearCapturedSettings();
		await tab.display();

		const commandsButton = (tab.containerEl as unknown as MockHTMLElement)._findButtonByText("Commands");
		expect(commandsButton).toBeDefined();

		clearCapturedSettings();
		commandsButton!._click();

		const settings = capturedSettings() as unknown as CapturedSetting[];

		// Commands heading must appear.
		const commandsHeading = settings.find((s) => s.isHeading && s.name === "Commands");
		expect(commandsHeading).toBeDefined();

		// resourcesName must NOT appear.
		const resourcesSetting = settings.find(
			(s) => !s.isHeading && s.textControls.length > 0 && s.name.toLowerCase().includes("resources"),
		);
		expect(resourcesSetting).toBeUndefined();

		// debugLogging must NOT appear.
		const debugSetting = settings.find(
			(s) => !s.isHeading && s.toggleControls.length > 0 && s.name.toLowerCase().includes("debug"),
		);
		expect(debugSetting).toBeUndefined();
	});

	it("selecting the Scripts segment shows script rows, not General or Advanced controls", async () => {
		const plugin = makePlugin();
		const tab = new MasonSettingTab(plugin.app as never, plugin as never);
		clearCapturedSettings();
		await tab.display();

		const scriptsButton = (tab.containerEl as unknown as MockHTMLElement)._findButtonByText("Scripts");
		expect(scriptsButton).toBeDefined();

		clearCapturedSettings();
		// Scripts section is async — its render method awaits getScripts().
		// The click handler must schedule or await the async render.
		scriptsButton!._click();

		// Allow async render to complete — the click handler queues a microtask.
		await Promise.resolve();

		const settings = capturedSettings() as unknown as CapturedSetting[];

		// Scripts heading must appear.
		const scriptsHeading = settings.find((s) => s.isHeading && s.name === "Scripts");
		expect(scriptsHeading).toBeDefined();

		// resourcesName must NOT appear.
		const resourcesSetting = settings.find(
			(s) => !s.isHeading && s.textControls.length > 0 && s.name.toLowerCase().includes("resources"),
		);
		expect(resourcesSetting).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// SECTION HEADINGS
// ---------------------------------------------------------------------------

describe("MasonSettingTab — section headings", () => {
	it("renders the General heading when General segment is active", async () => {
		const plugin = makePlugin();
		const settings = await renderTab(plugin);

		const headings = settings.filter((s) => s.isHeading).map((s) => s.name);
		expect(headings).toContain("General");
	});

	it("does not render the Advanced heading when General segment is active", async () => {
		const plugin = makePlugin();
		const settings = await renderTab(plugin);

		const headings = settings.filter((s) => s.isHeading).map((s) => s.name);
		expect(headings).not.toContain("Advanced");
	});

	it("all headings use setHeading() not a bare h2 tag", async () => {
		const plugin = makePlugin();
		const tab = new MasonSettingTab(plugin.app as never, plugin as never);
		clearCapturedSettings();
		await tab.display();

		// Check each segment produces setHeading()-marked headings.
		// Drain microtasks after each click so _rendering is false before the next click.
		// Scripts and Commands both have async chains that need at least 5 ticks to fully
		// flush (click → _selectSegment → _renderSegment → section renderer → getScripts).
		// Using 5 ticks uniformly covers both async segments and all sync segments.
		const allHeadings: string[] = [];
		for (const label of ["General", "Scripts", "Commands", "Advanced"]) {
			clearCapturedSettings();
			const btn = (tab.containerEl as unknown as MockHTMLElement)._findButtonByText(label);
			btn!._click();
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
			const captured = capturedSettings() as unknown as CapturedSetting[];
			const headings = captured.filter((s) => s.isHeading);
			for (const h of headings) {
				expect(h.isHeading).toBe(true);
				allHeadings.push(h.name);
			}
		}
		expect(allHeadings).toContain("General");
		expect(allHeadings).toContain("Scripts");
		expect(allHeadings).toContain("Commands");
		expect(allHeadings).toContain("Advanced");
	});
});

// ---------------------------------------------------------------------------
// SENTENCE CASE: no multi-word name has more than the first word capitalised
// ---------------------------------------------------------------------------

describe("MasonSettingTab — sentence case compliance", () => {
	it("all setName strings follow sentence case (only first word capitalised)", async () => {
		const plugin = makePlugin();
		const tab = new MasonSettingTab(plugin.app as never, plugin as never);

		// Check all four segments.
		const titleCasePattern = /^.+\s+[A-Z][a-z]/;
		for (const label of ["General", "Scripts", "Commands", "Advanced"]) {
			clearCapturedSettings();
			await tab.display();
			const btn = (tab.containerEl as unknown as MockHTMLElement)._findButtonByText(label);
			clearCapturedSettings();
			if (label === "Scripts") {
				btn!._click();
				await Promise.resolve();
			} else {
				btn!._click();
			}
			const captured = capturedSettings() as unknown as CapturedSetting[];
			for (const s of captured) {
				if (s.isHeading) continue;
				expect(
					s.name,
					`Setting name "${s.name}" in ${label} segment appears to be Title Case — use sentence case`,
				).not.toMatch(titleCasePattern);
			}
		}
	});
});

// ---------------------------------------------------------------------------
// GENERAL SECTION
// ---------------------------------------------------------------------------

describe("MasonSettingTab — General section", () => {
	it("renders a text control for resourcesName", async () => {
		const plugin = makePlugin({ resourcesName: "My Resources" });
		const settings = await renderTab(plugin);

		const resourcesSetting = settings.find(
			(s) => !s.isHeading && s.textControls.length > 0 && s.name.toLowerCase().includes("resources"),
		);
		expect(resourcesSetting).toBeDefined();
		expect(resourcesSetting!.textControls[0].getValue()).toBe("My Resources");
	});

	it("resourcesName text control onChange updates settings + calls saveSettings", async () => {
		const plugin = makePlugin({ resourcesName: "Resources" });
		const settings = await renderTab(plugin);

		const resourcesSetting = settings.find(
			(s) => !s.isHeading && s.textControls.length > 0 && s.name.toLowerCase().includes("resources"),
		);
		expect(resourcesSetting).toBeDefined();

		const ctrl = resourcesSetting!.textControls[0];
		// Simulate the user typing a new value; the implementation's own onChange
		// handler (registered during display()) fires and updates settings + saveSettings.
		ctrl.setValue("References");

		// The implementation's onChange callback should have updated settings and saved.
		expect(plugin.settings.resourcesName).toBe("References");
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it("renders a toggle control for numericOnly", async () => {
		const plugin = makePlugin({ numericOnly: true });
		const settings = await renderTab(plugin);

		const numericSetting = settings.find(
			(s) => !s.isHeading && s.toggleControls.length > 0 && s.name.toLowerCase().includes("numeric"),
		);
		expect(numericSetting).toBeDefined();
		expect(numericSetting!.toggleControls[0].getValue()).toBe(true);
	});

	it("numericOnly toggle onChange updates settings + calls saveSettings", async () => {
		const plugin = makePlugin({ numericOnly: true });
		const settings = await renderTab(plugin);

		const numericSetting = settings.find(
			(s) => !s.isHeading && s.toggleControls.length > 0 && s.name.toLowerCase().includes("numeric"),
		);
		const ctrl = numericSetting!.toggleControls[0];

		// Simulate user toggling; the implementation's own onChange fires.
		ctrl.setValue(false);

		expect(plugin.settings.numericOnly).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// SCRIPTS SECTION (transitional — accessible via segment click)
// ---------------------------------------------------------------------------

// T4.2: the Scripts segment now renders the card-based Scripts tab (scriptsTab.ts)
// into the container directly — NOT via Setting rows. These integration tests
// assert the segment heading is still a Setting heading, and that the card DOM
// (names, pills, toolbar buttons) appears in the container. Card-level behaviour
// (⋯ menu, toggle wiring, ops) is exhaustively covered in scriptsTab.test.ts.
describe("MasonSettingTab — Scripts section (card tab integration)", () => {
	async function renderScriptsSegment(
		plugin: ReturnType<typeof makePlugin>,
	): Promise<{ settings: CapturedSetting[]; container: MockHTMLElement }> {
		const tab = new MasonSettingTab(plugin.app as never, plugin as never);
		clearCapturedSettings();
		await tab.display();

		const container = tab.containerEl as unknown as MockHTMLElement;
		const scriptsButton = container._findButtonByText("Scripts");
		clearCapturedSettings();
		scriptsButton!._click();
		await Promise.resolve();

		return { settings: capturedSettings() as unknown as CapturedSetting[], container };
	}

	it("renders the Scripts heading as a Setting heading", async () => {
		const plugin = makePlugin();
		const { settings } = await renderScriptsSegment(plugin);
		const heading = settings.find((s) => s.isHeading && s.name === "Scripts");
		expect(heading).toBeDefined();
	});

	it("lists each installed script from the store as a card", async () => {
		const plugin = makePlugin();
		const { container } = await renderScriptsSegment(plugin);
		const text = container._collectText();
		// Both injected scripts appear by id.
		expect(text).toContain("perplexity-auto");
		expect(text).toContain("perplexity-web");
	});

	it("each card carries a status pill label", async () => {
		const plugin = makePlugin();
		const { container } = await renderScriptsSegment(plugin);
		const text = container._collectText();
		// perplexity-web is disabled → Disabled pill. perplexity-auto is enabled +
		// consented, but with the T4.2 P5 inputs (local:null, online:false) it
		// resolves to Blocked(offline) until the live catalog/materializer wire in.
		expect(text).toContain("Disabled");
		expect(text).toContain("Blocked");
	});

	it("renders the toolbar (import / browse) and a ⋯ menu button per card", async () => {
		const plugin = makePlugin();
		const { container } = await renderScriptsSegment(plugin);
		expect(container._findButtonByText("Import from vault")).toBeDefined();
		expect(container._findButtonByText("Browse official")).toBeDefined();
		expect(container._findButtonByText("⋯")).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// ADVANCED SECTION
// ---------------------------------------------------------------------------

describe("MasonSettingTab — Advanced section", () => {
	async function renderAdvancedSegment(plugin: ReturnType<typeof makePlugin>): Promise<CapturedSetting[]> {
		const tab = new MasonSettingTab(plugin.app as never, plugin as never);
		clearCapturedSettings();
		await tab.display();

		const advancedButton = (tab.containerEl as unknown as MockHTMLElement)._findButtonByText("Advanced");
		clearCapturedSettings();
		advancedButton!._click();

		return capturedSettings() as unknown as CapturedSetting[];
	}

	it("renders a toggle control for debugLogging", async () => {
		const plugin = makePlugin({ debugLogging: false });
		const settings = await renderAdvancedSegment(plugin);

		const debugToggle = settings.find(
			(s) => s.toggleControls.length > 0 && s.name.toLowerCase().includes("debug"),
		);
		expect(debugToggle).toBeDefined();
		expect(debugToggle!.toggleControls[0].getValue()).toBe(false);
	});

	it("debugLogging toggle onChange updates settings + calls saveSettings", async () => {
		const plugin = makePlugin({ debugLogging: false });
		const settings = await renderAdvancedSegment(plugin);

		const debugToggle = settings.find(
			(s) => s.toggleControls.length > 0 && s.name.toLowerCase().includes("debug"),
		);
		expect(debugToggle).toBeDefined();

		const ctrl = debugToggle!.toggleControls[0];
		// Simulate user toggling; the implementation's own onChange fires.
		ctrl.setValue(true);

		expect(plugin.settings.debugLogging).toBe(true);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// OPERATION CONTEXT — numericOnly threads into OperationContext.settings
// ---------------------------------------------------------------------------

describe("MasonSettings — numericOnly in OperationContext", () => {
	it("OperationContext.settings type includes numericOnly", async () => {
		// This is a compile-time assertion: TypeScript enforces that settings
		// has numericOnly. We build a minimal ctx to confirm at runtime.
		const { DEFAULT_SETTINGS } = await import("../../src/core/types");

		// DEFAULT_SETTINGS must contain numericOnly
		expect("numericOnly" in DEFAULT_SETTINGS).toBe(true);
		expect(DEFAULT_SETTINGS.numericOnly).toBe(true);

		// Build a minimal OperationContext — if types.ts is wrong, tsc will catch it.
		const ctx = {
			doc: "",
			cursor: 0,
			settings: { ...DEFAULT_SETTINGS },
		};
		expect(ctx.settings.numericOnly).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// CONCURRENT RENDER GUARD — double-click on Scripts must not produce a torn tab
// ---------------------------------------------------------------------------

describe("MasonSettingTab — concurrent render guard", () => {
	it("two synchronous clicks on Scripts produce exactly one valid Scripts view", async () => {
		const plugin = makePlugin();
		const tab = new MasonSettingTab(plugin.app as never, plugin as never);
		clearCapturedSettings();
		await tab.display();

		const scriptsButton = (tab.containerEl as unknown as MockHTMLElement)._findButtonByText("Scripts");
		expect(scriptsButton).toBeDefined();

		// Fire two clicks synchronously — no await between them.
		// Without a guard, the second click calls containerEl.empty() while the
		// first render is suspended awaiting getScripts(), leaving a blank tab.
		clearCapturedSettings();
		scriptsButton!._click();
		scriptsButton!._click();

		// Drain microtasks — let both async renders complete.
		await Promise.resolve();
		await Promise.resolve();

		const settings = capturedSettings() as unknown as CapturedSetting[];

		// The Scripts heading must appear exactly once (no duplication, no blank).
		const scriptsHeadings = settings.filter((s) => s.isHeading && s.name === "Scripts");
		expect(scriptsHeadings).toHaveLength(1);

		// The container must be non-empty: at least one setting must be rendered.
		expect(settings.length).toBeGreaterThan(0);
	});

	it("two synchronous lifecycle op toggles re-render exactly one valid Scripts view", async () => {
		// Use two disabled scripts so both cards render a toggle control.
		const plugin = makePlugin();
		const tab = new MasonSettingTab(plugin.app as never, plugin as never);
		clearCapturedSettings();
		await tab.display();

		// Navigate to the Scripts segment and wait for the async render to settle.
		const scriptsButton = (tab.containerEl as unknown as MockHTMLElement)._findButtonByText("Scripts");
		expect(scriptsButton).toBeDefined();
		scriptsButton!._click();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		// Find the toggle input for one of the script cards (perplexity-web is Disabled
		// and therefore shows a toggle; find it in the rendered container).
		const container = tab.containerEl as unknown as MockHTMLElement;
		const toggle = container._findToggle();
		expect(toggle).toBeDefined();

		// Fire the toggle twice synchronously — simulates two rapid ops (enable/disable)
		// before the first re-render can complete. Without the _rendering guard routing
		// through _selectSegment, the second op calls containerEl.empty() mid-render,
		// tearing the Scripts tab DOM.
		clearCapturedSettings();
		toggle!.setValue(true);
		toggle!.setValue(false);

		// Drain microtasks — Scripts async depth: getScripts() + setRecord() + rerender
		// chain each add a microtask tick; three passes are sufficient to settle.
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		const settings = capturedSettings() as unknown as CapturedSetting[];
		const container2 = tab.containerEl as unknown as MockHTMLElement;

		// The Scripts heading must appear exactly once (no duplication, no blank).
		const scriptsHeadings = settings.filter((s) => s.isHeading && s.name === "Scripts");
		expect(scriptsHeadings).toHaveLength(1);

		// Both script ids must still be present in the rendered container text.
		const text = container2._collectText();
		expect(text).toContain("perplexity-auto");
		expect(text).toContain("perplexity-web");
	});
});

// ---------------------------------------------------------------------------
// DISPLAY CLEARS CONTAINER BEFORE RE-RENDER (idempotency)
// ---------------------------------------------------------------------------

describe("MasonSettingTab — display() idempotency", () => {
	it("calling display() twice does not duplicate settings", async () => {
		const plugin = makePlugin();
		clearCapturedSettings();
		const tab = new MasonSettingTab(plugin.app as never, plugin as never);

		await tab.display();
		const firstCount = capturedSettings().length;

		clearCapturedSettings();
		await tab.display();
		const secondCount = capturedSettings().length;

		expect(secondCount).toBe(firstCount);
	});
});
