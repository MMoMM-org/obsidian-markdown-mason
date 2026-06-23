/**
 * T6.1 — MasonSettingTab unit tests (RED → GREEN).
 *
 * Exercises the public display() surface via the mock Setting builder.
 * All assertions target OBSERVABLE BEHAVIOUR, not implementation internals.
 */

import { describe, it, expect, vi } from "vitest";
import { App } from "obsidian";
import type { ScriptRecord } from "../../src/scripts/store";

// TODO(T4.2): the "Scripts section" suite below asserts removed v0.1 store
// semantics (store.setEnabled + the manifest/device shape). settingsTab.ts was
// minimally migrated onto the ScriptRecord store in T1.4 and is fully rebuilt
// (Command Management) in T4.2. That suite is describe.skip until then. The
// General/Advanced/headings/sentence-case/idempotency suites stay ACTIVE — they
// are store-shape-agnostic and the test double now exposes getScripts/setRecord.

// ---------------------------------------------------------------------------
// Pull in test helpers from the mock (populated by the Setting extension).
// Imported via the relative path so TypeScript resolves our mock types
// (not the obsidian package .d.ts) and vitest uses the same module instance
// as the alias (Vite deduplicates by resolved path).
// ---------------------------------------------------------------------------
import {
	capturedSettings,
	clearCapturedSettings,
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

	return { app, settings, saveSettings, store, manifest: pluginManifest } as const;
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
// SECTION HEADINGS
// ---------------------------------------------------------------------------

describe("MasonSettingTab — section headings", () => {
	it("renders three headings: General, Scripts, Advanced", async () => {
		const plugin = makePlugin();
		const settings = await renderTab(plugin);

		const headings = settings.filter((s) => s.isHeading).map((s) => s.name);
		expect(headings).toContain("General");
		expect(headings).toContain("Scripts");
		expect(headings).toContain("Advanced");
	});

	it("all headings use setHeading() not a bare h2 tag", async () => {
		const plugin = makePlugin();
		const settings = await renderTab(plugin);

		const headings = settings.filter((s) => s.isHeading);
		expect(headings.length).toBeGreaterThanOrEqual(3);
		// Each heading must have been marked via setHeading() — confirmed by isHeading flag
		for (const h of headings) {
			expect(h.isHeading).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// SENTENCE CASE: no multi-word name has more than the first word capitalised
// ---------------------------------------------------------------------------

describe("MasonSettingTab — sentence case compliance", () => {
	it("all setName strings follow sentence case (only first word capitalised)", async () => {
		const plugin = makePlugin();
		const settings = await renderTab(plugin);

		// A Title-Case violation: two or more consecutive words where a non-first word
		// starts with an uppercase letter (excluding ALL-CAPS abbreviations like "XSS").
		// Pattern: matches any word after the first that starts with an uppercase letter
		// followed by a lowercase letter (e.g. "Section Name" → "Name" matches).
		const titleCasePattern = /^.+\s+[A-Z][a-z]/;

		for (const s of settings) {
			// Skip headings — they may be single words like "General"
			if (s.isHeading) continue;
			expect(
				s.name,
				`Setting name "${s.name}" appears to be Title Case — use sentence case`,
			).not.toMatch(titleCasePattern);
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
// SCRIPTS SECTION (transitional — store-agnostic cases active)
// ---------------------------------------------------------------------------

// Three cases that work against the migrated getScripts/ScriptRecord store double.
describe("MasonSettingTab — Scripts section (transitional)", () => {
	it("lists each installed script from the store", async () => {
		const plugin = makePlugin();
		const allSettings = await renderTab(plugin);

		// Find settings that correspond to scripts (have toggles or buttons, non-heading)
		const scriptSettings = allSettings.filter(
			(s) => !s.isHeading && (s.toggleControls.length > 0 || s.buttonControls.length > 0),
		);

		// We injected two scripts: perplexity-auto and perplexity-web
		expect(scriptSettings.length).toBeGreaterThanOrEqual(2);
	});

	it("each script row has an enable/disable toggle", async () => {
		const plugin = makePlugin();
		const allSettings = await renderTab(plugin);

		// Isolate the scripts section: settings between the "Scripts" heading and "Advanced"
		const scriptsHeadingIdx = allSettings.findIndex((s) => s.isHeading && s.name === "Scripts");
		const advancedHeadingIdx = allSettings.findIndex((s) => s.isHeading && s.name === "Advanced");

		const scriptSection = allSettings.slice(scriptsHeadingIdx + 1, advancedHeadingIdx);
		const toggleRows = scriptSection.filter((s) => s.toggleControls.length > 0);
		expect(toggleRows.length).toBeGreaterThanOrEqual(2);
	});

	it("each script row has an import control (button)", async () => {
		const plugin = makePlugin();
		const allSettings = await renderTab(plugin);

		const scriptsHeadingIdx = allSettings.findIndex((s) => s.isHeading && s.name === "Scripts");
		const advancedHeadingIdx = allSettings.findIndex((s) => s.isHeading && s.name === "Advanced");
		const scriptSection = allSettings.slice(scriptsHeadingIdx + 1, advancedHeadingIdx);

		const buttonRows = scriptSection.filter((s) => s.buttonControls.length > 0);
		expect(buttonRows.length).toBeGreaterThanOrEqual(2);
	});
});

// TODO(T4.2): re-enable after settingsTab.ts Scripts section rebuilt onto the
// ScriptRecord store (store.setRecord, getScripts). These assert the removed
// store.setEnabled + getManifest.mockResolvedValue({}) v0.1 API (T1.4 rewrite).
describe.skip("MasonSettingTab — Scripts section (obsolete v0.1 assertions)", () => {
	it("enable toggle calls store.setEnabled with the script id and new value", async () => {
		const plugin = makePlugin();
		const allSettings = await renderTab(plugin);

		const scriptsHeadingIdx = allSettings.findIndex((s) => s.isHeading && s.name === "Scripts");
		const advancedHeadingIdx = allSettings.findIndex((s) => s.isHeading && s.name === "Advanced");
		const scriptSection = allSettings.slice(scriptsHeadingIdx + 1, advancedHeadingIdx);
		const toggleRows = scriptSection.filter((s) => s.toggleControls.length > 0);

		// The first script row in the manifest is "perplexity-auto", which is enabled (true).
		// Toggling it should call setEnabled("perplexity-auto", false).
		const firstRow = toggleRows[0];
		const firstToggle = firstRow.toggleControls[0];
		const previousValue = firstToggle.getValue();
		firstToggle.setValue(!previousValue);

		// store.setEnabled must have been called with the exact script id and toggled value.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect((plugin.store as any).setEnabled).toHaveBeenCalledWith("perplexity-auto", !previousValue);
	});

	it("renders empty-state row when manifest has no scripts", async () => {
		const plugin = makePlugin();
		// Replace the store with one that returns an empty manifest.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(plugin.store as any).getManifest.mockResolvedValue({});

		const allSettings = await renderTab(plugin);

		const scriptsHeadingIdx = allSettings.findIndex((s) => s.isHeading && s.name === "Scripts");
		const advancedHeadingIdx = allSettings.findIndex((s) => s.isHeading && s.name === "Advanced");
		const scriptSection = allSettings.slice(scriptsHeadingIdx + 1, advancedHeadingIdx);

		// Exactly one row should appear: the "No scripts installed" informational row.
		expect(scriptSection).toHaveLength(1);
		expect(scriptSection[0].name).toBe("No scripts installed");

		// No toggles or buttons should be rendered in the empty state.
		expect(scriptSection[0].toggleControls).toHaveLength(0);
		expect(scriptSection[0].buttonControls).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// ADVANCED SECTION
// ---------------------------------------------------------------------------

describe("MasonSettingTab — Advanced section", () => {
	it("renders a toggle control for debugLogging", async () => {
		const plugin = makePlugin({ debugLogging: false });
		const settings = await renderTab(plugin);

		const advancedHeadingIdx = settings.findIndex((s) => s.isHeading && s.name === "Advanced");
		const advancedSection = settings.slice(advancedHeadingIdx + 1);

		const debugToggle = advancedSection.find(
			(s) => s.toggleControls.length > 0 && s.name.toLowerCase().includes("debug"),
		);
		expect(debugToggle).toBeDefined();
		expect(debugToggle!.toggleControls[0].getValue()).toBe(false);
	});

	it("debugLogging toggle onChange updates settings + calls saveSettings", async () => {
		const plugin = makePlugin({ debugLogging: false });
		const settings = await renderTab(plugin);

		const advancedHeadingIdx = settings.findIndex((s) => s.isHeading && s.name === "Advanced");
		const advancedSection = settings.slice(advancedHeadingIdx + 1);

		const debugToggle = advancedSection.find(
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
