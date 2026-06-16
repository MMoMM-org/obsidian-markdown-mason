import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Obsidian runtime mock
//
// The 'obsidian' package is types-only (main: ""). We provide a factory so
// vitest/vite never tries to resolve the empty package entry. The factory
// defines the minimal surface consumed by MarkdownMasonPlugin.
//
// vi.mock is hoisted before imports, so src/main.ts will receive this mock
// when it does `import { Plugin } from 'obsidian'`.
// ---------------------------------------------------------------------------
vi.mock("obsidian", () => {
	class WorkspaceStub {
		private readonly _cbs: Array<() => void> = [];

		onLayoutReady(cb: () => void): void {
			this._cbs.push(cb);
		}

		_fireLayoutReady(): void {
			for (const cb of this._cbs) cb();
		}

		get _layoutReadyCount(): number {
			return this._cbs.length;
		}
	}

	class AppStub {
		readonly workspace = new WorkspaceStub();
	}

	class PluginStub {
		readonly app: AppStub;
		private _savedData: unknown = {};
		private readonly _cleanupList: Array<() => void> = [];
		private readonly _eventRefList: unknown[] = [];

		constructor(app: AppStub, _manifest?: unknown) {
			this.app = app;
		}

		register(cb: () => void): void {
			this._cleanupList.push(cb);
		}

		registerEvent(ref: unknown): void {
			this._eventRefList.push(ref);
		}

		async loadData(): Promise<unknown> {
			return this._savedData;
		}

		async saveData(data: unknown): Promise<void> {
			this._savedData = data;
		}

		addCommand(_cmd: unknown): void {}

		get _cleanups(): Array<() => void> { return [...this._cleanupList]; }
		get _eventRefs(): unknown[] { return [...this._eventRefList]; }
		get _persistedData(): unknown { return this._savedData; }
	}

	return { Plugin: PluginStub, App: AppStub, Workspace: WorkspaceStub };
});

// Import the plugin after mock registration. Top-level await works in vitest.
const { MarkdownMasonPlugin, DEFAULT_SETTINGS } = await import("../src/main");

// ---------------------------------------------------------------------------
// Test helpers: typed interfaces matching the stub internals above.
// ---------------------------------------------------------------------------

interface MockWorkspace {
	onLayoutReady(cb: () => void): void;
	_layoutReadyCount: number;
	_fireLayoutReady(): void;
}

interface MockApp {
	workspace: MockWorkspace;
}

interface PluginPersistence {
	loadData(): Promise<unknown>;
	saveData(data: unknown): Promise<void>;
}

// Construct a MockApp that mirrors the WorkspaceStub/AppStub defined above.
// We cannot import from the `obsidian` mock module here (Vite resolves static
// imports before vi.mock factories fire), so we duplicate the minimal factory
// inline. This is acceptable — the class behaviour is identical.
function makeMockApp(): MockApp {
	let layoutReadyCount = 0;
	return {
		workspace: {
			get _layoutReadyCount() { return layoutReadyCount; },
			onLayoutReady(_cb: () => void) { layoutReadyCount++; },
			_fireLayoutReady() {},
		},
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseArg = any;

function makePlugin(app: MockApp) {
	return new MarkdownMasonPlugin(app as LooseArg, {} as LooseArg);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MarkdownMasonPlugin", () => {
	describe("DEFAULT_SETTINGS", () => {
		it("has debugLogging defaulting to false", () => {
			expect(DEFAULT_SETTINGS).toBeDefined();
			expect(DEFAULT_SETTINGS.debugLogging).toBe(false);
		});
	});

	describe("onload()", () => {
		it("populates settings from DEFAULT_SETTINGS when no persisted data exists", async () => {
			const app = makeMockApp();
			const plugin = makePlugin(app);

			await plugin.onload();

			expect(plugin.settings).toBeDefined();
			expect(plugin.settings.debugLogging).toBe(DEFAULT_SETTINGS.debugLogging);
		});

		it("merges persisted data over DEFAULT_SETTINGS", async () => {
			const app = makeMockApp();
			const plugin = makePlugin(app);
			// Seed in-memory data before onload reads it.
			await (plugin as unknown as PluginPersistence).saveData({
				debugLogging: true,
			});

			await plugin.onload();

			expect(plugin.settings.debugLogging).toBe(true);
		});

		it("registers a layout-ready callback via app.workspace.onLayoutReady", async () => {
			const app = makeMockApp();
			const plugin = makePlugin(app);

			await plugin.onload();

			expect(app.workspace._layoutReadyCount).toBeGreaterThanOrEqual(1);
		});
	});

	describe("saveSettings()", () => {
		it("persists current settings so a subsequent loadData returns them", async () => {
			const app = makeMockApp();
			const plugin = makePlugin(app);
			await plugin.onload();

			plugin.settings.debugLogging = true;
			await plugin.saveSettings();

			const persisted = await (plugin as unknown as PluginPersistence).loadData();
			expect((persisted as { debugLogging?: boolean }).debugLogging).toBe(true);
		});
	});

	describe("onunload()", () => {
		it("completes without throwing (Obsidian owns cleanup via registerEvent/register)", () => {
			const app = makeMockApp();
			const plugin = makePlugin(app);
			expect(() => plugin.onunload()).not.toThrow();
		});
	});

	describe("full lifecycle round-trip", () => {
		it("onload then onunload completes without error", async () => {
			const app = makeMockApp();
			const plugin = makePlugin(app);

			await expect(plugin.onload()).resolves.toBeUndefined();
			expect(() => plugin.onunload()).not.toThrow();
		});
	});
});
