/**
 * T4.4 — runScriptModal unit tests (RED → GREEN).
 *
 * RunScriptModal lists ONLY Active scripts; selecting one runs it via
 * commandManager.runScript(). Empty state when no Active scripts.
 *
 * Observable behaviour contracts:
 *   1. Opens without error
 *   2. Empty state message when no Active scripts exist
 *   3. Lists Active scripts only (not Disabled, Blocked, etc.)
 *   4. Each list item shows the script display name
 *   5. Clicking a script item invokes run logic (commandManager.runScript or equivalent)
 *   6. Modal title is sentence-case
 *   7. No innerHTML/outerHTML/insertAdjacentHTML
 */

import { describe, it, expect, vi } from "vitest";
import { App } from "obsidian";
import type { ScriptRecord } from "../../src/scripts/store";
import type { LifecycleState } from "../../src/scripts/lifecycle";
import { MockHTMLElement } from "../__mocks__/obsidian";

// ---------------------------------------------------------------------------
// Dynamic import — after mocks are resolved
// ---------------------------------------------------------------------------

const { RunScriptModal } = await import("../../src/ui/runScriptModal");

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

function makeApp(): App {
	return new App();
}

function makeCommandManager() {
	return {
		runScript: vi.fn().mockResolvedValue(undefined),
	};
}

/** Convenience: build a store double returning the given scripts. */
function makeStore(scripts: Record<string, ScriptRecord>) {
	return {
		getScripts: vi.fn().mockResolvedValue(scripts),
	};
}

/** State resolver that always returns Disabled */
function disabledState(_id: string): LifecycleState {
	return { kind: "Disabled" };
}

/** State resolver that maps specific ids to Active, rest to Disabled */
function makeStateResolver(activeIds: string[]): (_id: string) => LifecycleState {
	return (id: string): LifecycleState => {
		return activeIds.includes(id) ? { kind: "Active" } : { kind: "Disabled" };
	};
}

/** P5 fake script fn resolver */
function fakeFn() {
	return (): undefined => undefined;
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe("RunScriptModal — empty state", () => {
	it("opens without error when there are no scripts", async () => {
		const store = makeStore({});
		const cm = makeCommandManager();
		const editor = {};

		const modal = new RunScriptModal(
			makeApp() as never,
			store,
			cm,
			disabledState,
			fakeFn,
			editor as never,
		);

		// open() calls onOpen() synchronously in the mock
		modal.open();

		// Should not throw; contentEl should be populated
		expect(modal.contentEl).toBeDefined();
	});

	it("shows empty-state text when no scripts are Active", async () => {
		const store = makeStore({
			"perplexity-web": makeRecord({ enabled: false }),
		});
		const cm = makeCommandManager();

		const modal = new RunScriptModal(
			makeApp() as never,
			store,
			cm,
			disabledState,
			fakeFn,
			{} as never,
		);
		modal.open();

		// Resolve pending store call
		await Promise.resolve();
		await Promise.resolve();

		const text = (modal.contentEl as unknown as MockHTMLElement)._collectText();
		// Should contain some "no active" or similar message
		expect(text.toLowerCase()).toContain("no active");
	});

	it("shows empty-state text when store is empty", async () => {
		const store = makeStore({});
		const cm = makeCommandManager();

		const modal = new RunScriptModal(
			makeApp() as never,
			store,
			cm,
			disabledState,
			fakeFn,
			{} as never,
		);
		modal.open();
		await Promise.resolve();
		await Promise.resolve();

		const text = (modal.contentEl as unknown as MockHTMLElement)._collectText();
		expect(text.toLowerCase()).toContain("no active");
	});
});

// ---------------------------------------------------------------------------
// Active script listing
// ---------------------------------------------------------------------------

describe("RunScriptModal — Active script listing", () => {
	it("lists Active scripts by display name", async () => {
		const store = makeStore({
			"perplexity-app": makeRecord({ enabled: true }),
			"perplexity-web": makeRecord({ enabled: true }),
		});
		const cm = makeCommandManager();
		const getState = makeStateResolver(["perplexity-app"]);

		const modal = new RunScriptModal(
			makeApp() as never,
			store,
			cm,
			getState,
			fakeFn,
			{} as never,
		);
		modal.open();
		await Promise.resolve();
		await Promise.resolve();

		const text = (modal.contentEl as unknown as MockHTMLElement)._collectText();
		expect(text).toContain("perplexity-app");
	});

	it("does NOT list non-Active scripts", async () => {
		const store = makeStore({
			"perplexity-app": makeRecord({ enabled: true }),
			"perplexity-web": makeRecord({ enabled: false }),
		});
		const cm = makeCommandManager();
		// Only perplexity-app is Active
		const getState = makeStateResolver(["perplexity-app"]);

		const modal = new RunScriptModal(
			makeApp() as never,
			store,
			cm,
			getState,
			fakeFn,
			{} as never,
		);
		modal.open();
		await Promise.resolve();
		await Promise.resolve();

		const text = (modal.contentEl as unknown as MockHTMLElement)._collectText();
		expect(text).toContain("perplexity-app");
		expect(text).not.toContain("perplexity-web");
	});

	it("clicking a script item invokes runScript on the command manager", async () => {
		const store = makeStore({
			"perplexity-app": makeRecord({ enabled: true }),
		});
		const cm = makeCommandManager();
		const getState = makeStateResolver(["perplexity-app"]);
		const editor = { replaceSelection: vi.fn() };

		const modal = new RunScriptModal(
			makeApp() as never,
			store,
			cm,
			getState,
			fakeFn,
			editor as never,
		);
		modal.open();
		await Promise.resolve();
		await Promise.resolve();

		// Find the button for the script
		const btn = (modal.contentEl as unknown as MockHTMLElement)._findButtonByText("perplexity-app");
		expect(btn).toBeDefined();

		btn!._click();
		await Promise.resolve();

		expect(cm.runScript).toHaveBeenCalledOnce();
		const [id] = cm.runScript.mock.calls[0];
		expect(id).toBe("perplexity-app");
	});
});

// ---------------------------------------------------------------------------
// Modal title / sentence-case compliance
// ---------------------------------------------------------------------------

describe("RunScriptModal — sentence-case compliance", () => {
	it("modal title text uses sentence case", async () => {
		const store = makeStore({});
		const cm = makeCommandManager();

		const modal = new RunScriptModal(
			makeApp() as never,
			store,
			cm,
			disabledState,
			fakeFn,
			{} as never,
		);
		modal.open();

		// titleEl is a MockHTMLElement
		const titleText = (modal.titleEl as unknown as MockHTMLElement | undefined)?._text ?? "";
		const titleCasePattern = /^.+\s+[A-Z][a-z]/;
		expect(titleText).not.toMatch(titleCasePattern);
	});
});
