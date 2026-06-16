import { describe, it, expect } from "vitest";
import { App } from "obsidian";

// ---------------------------------------------------------------------------
// The 'obsidian' module is aliased to test/__mocks__/obsidian.ts via the
// vitest resolve.alias in vitest.config.ts. No vi.mock() factory is needed —
// the alias is the single source of truth for all stub behaviour.
// ---------------------------------------------------------------------------

// Import the plugin after the alias mock is in place.
const { MarkdownMasonPlugin, DEFAULT_SETTINGS } = await import("../src/main");

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makePlugin() {
	const app = new App();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return new MarkdownMasonPlugin(app as any, {} as any);
}

interface PluginPersistence {
	loadData(): Promise<unknown>;
	saveData(data: unknown): Promise<void>;
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

		it("has resourcesName defaulting to 'Resources'", () => {
			expect(DEFAULT_SETTINGS.resourcesName).toBe("Resources");
		});
	});

	describe("onload()", () => {
		it("populates settings from DEFAULT_SETTINGS when no persisted data exists", async () => {
			const plugin = makePlugin();

			await plugin.onload();

			expect(plugin.settings).toBeDefined();
			expect(plugin.settings.debugLogging).toBe(DEFAULT_SETTINGS.debugLogging);
		});

		it("merges persisted data over DEFAULT_SETTINGS", async () => {
			const plugin = makePlugin();
			// Seed in-memory data before onload reads it.
			await (plugin as unknown as PluginPersistence).saveData({
				debugLogging: true,
			});

			await plugin.onload();

			expect(plugin.settings.debugLogging).toBe(true);
		});

		it("registers a layout-ready callback via app.workspace.onLayoutReady", async () => {
			const plugin = makePlugin();

			await plugin.onload();

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((plugin.app as any).workspace._layoutReadyCount).toBe(1);
		});

		it("registers zero manual listeners — no leaked register/registerEvent calls", async () => {
			const plugin = makePlugin();

			await plugin.onload();

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((plugin as any)._cleanups).toHaveLength(0);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((plugin as any)._eventRefs).toHaveLength(0);
		});
	});

	describe("saveSettings()", () => {
		it("persists current settings so a subsequent loadData returns them", async () => {
			const plugin = makePlugin();
			await plugin.onload();

			plugin.settings.debugLogging = true;
			await plugin.saveSettings();

			const persisted = await (plugin as unknown as PluginPersistence).loadData();
			expect((persisted as { debugLogging?: boolean }).debugLogging).toBe(true);
		});
	});

	describe("onunload()", () => {
		it("completes without throwing (Obsidian owns cleanup via registerEvent/register)", () => {
			const plugin = makePlugin();
			expect(() => plugin.onunload()).not.toThrow();
		});
	});

	describe("full lifecycle round-trip", () => {
		it("onload then onunload completes without error", async () => {
			const plugin = makePlugin();

			await expect(plugin.onload()).resolves.toBeUndefined();
			expect(() => plugin.onunload()).not.toThrow();
		});
	});
});
