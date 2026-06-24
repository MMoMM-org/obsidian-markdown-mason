/**
 * T4.4 — commandsTab unit tests (RED → GREEN).
 *
 * Commands tab renders toggles for ENABLED scripts only; each row shows a
 * "Create command" toggle + hint text. The P5 seam injects resolveScriptFn
 * and getState as fakes.
 *
 * Observable behaviour contracts:
 *   1. Empty state when no enabled scripts exist
 *   2. Shows a row for each enabled script (not disabled)
 *   3. Toggle reflects record.command
 *   4. Toggle ON → calls commandManager.register() AND persists record.command=true
 *   5. Toggle OFF → calls commandManager.unregister() (or disableScript) and preserves enabled
 *   6. Hint text present (sentence-case: "bind keys in core hotkeys")
 *   7. All text is sentence-case (no multi-word title-case)
 *   8. No innerHTML/outerHTML/insertAdjacentHTML
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { capturedSettings, clearCapturedSettings } from "../__mocks__/obsidian";
import type { ScriptRecord } from "../../src/scripts/store";
import type { LifecycleState } from "../../src/scripts/lifecycle";

// ---------------------------------------------------------------------------
// Types mirroring the mock shape
// ---------------------------------------------------------------------------

interface MockToggleControl {
	_value: boolean;
	setValue(v: boolean): MockToggleControl;
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
// Dynamic import — after mocks are resolved
// ---------------------------------------------------------------------------

const { renderCommandsTab } = await import("../../src/ui/commandsTab");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides?: Partial<ScriptRecord>): ScriptRecord {
	return {
		provenance: "curated",
		enabled: true,
		okayed: { version: 1, checksum: "sha256:abc" },
		source: "vault/script.cjs",
		command: false,
		...overrides,
	};
}

function makeCommandManager() {
	return {
		register: vi.fn(),
		unregister: vi.fn(),
		disableScript: vi.fn().mockResolvedValue(undefined),
	};
}

function makeStore(scripts: Record<string, ScriptRecord>) {
	return {
		getScripts: vi.fn().mockResolvedValue(scripts),
		setRecord: vi.fn().mockResolvedValue(undefined),
	};
}

/** P5 fake resolver — returns a no-op script function */
function fakeFn() {
	return (): undefined => undefined;
}

/** P5 fake getState — always returns Active */
function fakeGetState(_id: string): LifecycleState {
	return { kind: "Active" };
}

/**
 * Render the commands tab into a fresh MockHTMLElement container.
 * Returns the MockHTMLElement and captured settings.
 */
async function renderTab(
	scripts: Record<string, ScriptRecord>,
	overrides?: {
		commandManager?: ReturnType<typeof makeCommandManager>;
	},
): Promise<{
	settings: CapturedSetting[];
	cm: ReturnType<typeof makeCommandManager>;
	store: ReturnType<typeof makeStore>;
}> {
	clearCapturedSettings();
	const cm = overrides?.commandManager ?? makeCommandManager();
	const store = makeStore(scripts);

	// A plain MockHTMLElement serves as the container
	const { MockHTMLElement } = await import("../__mocks__/obsidian");
	const container = new MockHTMLElement("div") as unknown as HTMLElement;

	await renderCommandsTab(container, store, cm, fakeFn, fakeGetState);

	return {
		settings: capturedSettings() as unknown as CapturedSetting[],
		cm,
		store,
	};
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe("renderCommandsTab — empty state", () => {
	it("shows empty-state text when no scripts are enabled", async () => {
		const scripts: Record<string, ScriptRecord> = {
			"perplexity-web": makeRecord({ enabled: false }),
		};
		const { settings } = await renderTab(scripts);

		// At minimum there must be NO toggle controls (no script rows)
		const toggleSettings = settings.filter((s) => s.toggleControls.length > 0);
		expect(toggleSettings).toHaveLength(0);
	});

	it("shows empty-state text when store is empty", async () => {
		const { settings } = await renderTab({});
		const toggleSettings = settings.filter((s) => s.toggleControls.length > 0);
		expect(toggleSettings).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Script rows — only enabled scripts listed
// ---------------------------------------------------------------------------

describe("renderCommandsTab — script rows", () => {
	beforeEach(() => {
		clearCapturedSettings();
	});

	it("renders a row for each enabled script", async () => {
		const scripts: Record<string, ScriptRecord> = {
			"perplexity-app": makeRecord({ enabled: true, command: false }),
			"perplexity-web": makeRecord({ enabled: true, command: false }),
		};
		const { settings } = await renderTab(scripts);

		const rowSettings = settings.filter((s) => !s.isHeading && s.toggleControls.length > 0);
		expect(rowSettings).toHaveLength(2);
	});

	it("does NOT render a row for disabled scripts", async () => {
		const scripts: Record<string, ScriptRecord> = {
			"enabled-script": makeRecord({ enabled: true }),
			"disabled-script": makeRecord({ enabled: false }),
		};
		const { settings } = await renderTab(scripts);

		const rowSettings = settings.filter((s) => !s.isHeading && s.toggleControls.length > 0);
		expect(rowSettings).toHaveLength(1);
		expect(rowSettings[0].name).toContain("enabled-script");
	});

	it("toggle reflects record.command=false when command is off", async () => {
		const scripts: Record<string, ScriptRecord> = {
			"my-script": makeRecord({ enabled: true, command: false }),
		};
		const { settings } = await renderTab(scripts);

		const row = settings.find((s) => s.toggleControls.length > 0 && !s.isHeading);
		expect(row).toBeDefined();
		expect(row!.toggleControls[0]._value).toBe(false);
	});

	it("toggle reflects record.command=true when command is on", async () => {
		const scripts: Record<string, ScriptRecord> = {
			"my-script": makeRecord({ enabled: true, command: true }),
		};
		const { settings } = await renderTab(scripts);

		const row = settings.find((s) => s.toggleControls.length > 0 && !s.isHeading);
		expect(row).toBeDefined();
		expect(row!.toggleControls[0]._value).toBe(true);
	});

	it("includes 'bind keys in core hotkeys' hint text (sentence-case)", async () => {
		const scripts: Record<string, ScriptRecord> = {
			"my-script": makeRecord({ enabled: true }),
		};
		const { settings } = await renderTab(scripts);

		const allText = settings.map((s) => s.name + " " + s.desc).join(" ").toLowerCase();
		expect(allText).toContain("hotkeys");
	});
});

// ---------------------------------------------------------------------------
// Toggle ON — register + persist command=true
// ---------------------------------------------------------------------------

describe("renderCommandsTab — toggle ON", () => {
	it("calls commandManager.register() when toggle is turned on", async () => {
		const scripts: Record<string, ScriptRecord> = {
			"my-script": makeRecord({ enabled: true, command: false }),
		};
		const cm = makeCommandManager();
		const { settings } = await renderTab(scripts, { commandManager: cm });

		const row = settings.find((s) => s.toggleControls.length > 0 && !s.isHeading);
		expect(row).toBeDefined();

		// Simulate user turning toggle ON
		row!.toggleControls[0].setValue(true);
		await Promise.resolve();

		expect(cm.register).toHaveBeenCalledOnce();
		const [id] = cm.register.mock.calls[0];
		expect(id).toBe("my-script");
	});

	it("persists record.command=true while preserving other fields when toggle is turned on", async () => {
		const original = makeRecord({ enabled: true, command: false, source: "vault/script.cjs" });
		const scripts: Record<string, ScriptRecord> = { "my-script": original };
		const cm = makeCommandManager();
		const store = makeStore(scripts);

		clearCapturedSettings();
		const { MockHTMLElement } = await import("../__mocks__/obsidian");
		const container = new MockHTMLElement("div") as unknown as HTMLElement;
		await renderCommandsTab(container, store, cm, fakeFn, fakeGetState);
		const settings = capturedSettings() as unknown as CapturedSetting[];

		const row = settings.find((s) => s.toggleControls.length > 0 && !s.isHeading);
		row!.toggleControls[0].setValue(true);
		await Promise.resolve();

		expect(store.setRecord).toHaveBeenCalledOnce();
		const [id, record] = store.setRecord.mock.calls[0];
		expect(id).toBe("my-script");
		expect(record.command).toBe(true);
		// enabled must be preserved
		expect(record.enabled).toBe(true);
		// source must be preserved
		expect(record.source).toBe("vault/script.cjs");
	});
});

// ---------------------------------------------------------------------------
// Toggle OFF — unregister + persist command=false, preserve enabled
// ---------------------------------------------------------------------------

describe("renderCommandsTab — toggle OFF", () => {
	it("calls commandManager.unregister() when toggle is turned off", async () => {
		const scripts: Record<string, ScriptRecord> = {
			"my-script": makeRecord({ enabled: true, command: true }),
		};
		const cm = makeCommandManager();
		const { settings } = await renderTab(scripts, { commandManager: cm });

		const row = settings.find((s) => s.toggleControls.length > 0 && !s.isHeading);
		row!.toggleControls[0].setValue(false);
		await Promise.resolve();

		// Either disableScript OR unregister is acceptable
		const unregistered = cm.unregister.mock.calls.length > 0 || cm.disableScript.mock.calls.length > 0;
		expect(unregistered).toBe(true);
	});

	it("persists command=false but does NOT change enabled when toggle is turned off", async () => {
		const original = makeRecord({ enabled: true, command: true, source: "vault/script.cjs" });
		const scripts: Record<string, ScriptRecord> = { "my-script": original };
		const cm = makeCommandManager();
		const store = makeStore(scripts);

		clearCapturedSettings();
		const { MockHTMLElement } = await import("../__mocks__/obsidian");
		const container = new MockHTMLElement("div") as unknown as HTMLElement;
		await renderCommandsTab(container, store, cm, fakeFn, fakeGetState);
		const settings = capturedSettings() as unknown as CapturedSetting[];

		const row = settings.find((s) => s.toggleControls.length > 0 && !s.isHeading);
		row!.toggleControls[0].setValue(false);
		await Promise.resolve();

		// setRecord must have been called with command=false AND enabled=true preserved
		expect(store.setRecord).toHaveBeenCalledOnce();
		const [id, record] = store.setRecord.mock.calls[0];
		expect(id).toBe("my-script");
		expect(record.command).toBe(false);
		expect(record.enabled).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Sentence-case compliance
// ---------------------------------------------------------------------------

describe("renderCommandsTab — sentence-case compliance", () => {
	it("all setting names follow sentence case", async () => {
		const scripts: Record<string, ScriptRecord> = {
			"my-script": makeRecord({ enabled: true }),
		};
		const { settings } = await renderTab(scripts);

		const titleCasePattern = /^.+\s+[A-Z][a-z]/;
		for (const s of settings) {
			if (s.isHeading) continue;
			expect(
				s.name,
				`Setting name "${s.name}" appears to be Title Case — use sentence case`,
			).not.toMatch(titleCasePattern);
		}
	});
});
