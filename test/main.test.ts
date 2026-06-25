import { describe, it, expect, beforeEach } from "vitest";
import { App } from "obsidian";
import { lastOpenedModal, clearLastOpenedModal } from "./__mocks__/obsidian";
import { UpdateSplashModal } from "../src/ui/updateSplashModal";
import type { LifecycleResolver } from "../src/scripts/lifecycleResolver";
import type { ScriptItem } from "../src/ui/scriptsTab";
import type { LifecycleState } from "../src/scripts/lifecycle";

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

		it("preserves ScriptStore data (`scripts`) — does not clobber it when saving settings", async () => {
			// Regression: data.json is shared with ScriptStore. A naive
			// saveData(this.settings) would write a stale snapshot and wipe scripts
			// written earlier in the session. Read-modify-write must keep them.
			const plugin = makePlugin();
			await plugin.onload();

			// Simulate the user enabling a script: ScriptStore writes to data.json.
			await plugin.store.setRecord("perplexity-app", {
				provenance: "curated",
				enabled: true,
				okayed: { version: 1, checksum: "sha256:abc" },
				source: "official",
				command: false,
			});

			// Then an unrelated setting changes and is saved.
			plugin.settings.debugLogging = true;
			await plugin.saveSettings();

			const persisted = (await (plugin as unknown as PluginPersistence).loadData()) as {
				scripts?: Record<string, unknown>;
				debugLogging?: boolean;
			};
			// The script record survives AND the settings change persisted.
			expect(persisted.scripts?.["perplexity-app"]).toBeDefined();
			expect(persisted.debugLogging).toBe(true);
		});

		it("does not persist foreign keys onto the settings namespace", async () => {
			// Settings written back must contain only canonical fields — never a
			// `scripts` blob copied out of a polluted in-memory settings object.
			const plugin = makePlugin();
			await plugin.onload();
			// Force a stale foreign key onto the in-memory settings object.
			(plugin.settings as unknown as Record<string, unknown>).scripts = { ghost: true };

			await plugin.saveSettings();

			const persisted = (await (plugin as unknown as PluginPersistence).loadData()) as {
				scripts?: Record<string, unknown>;
			};
			// The ghost must NOT have been written through the settings path.
			expect(persisted.scripts).toBeUndefined();
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

	// -----------------------------------------------------------------------
	// Post-update splash (script-update awareness)
	// -----------------------------------------------------------------------

	describe("update splash detection", () => {
		beforeEach(() => {
			clearLastOpenedModal();
		});

		/** A fake resolver whose resolveItems yields the given lifecycle states. */
		function fakeResolver(states: Record<string, LifecycleState>): LifecycleResolver {
			return {
				resolveItems: (records: Record<string, unknown>): Promise<ScriptItem[]> =>
					Promise.resolve(
						Object.keys(records).map((id) => ({
							id,
							displayName: id,
							description: "",
							record: records[id] as never,
							state: states[id] ?? { kind: "Disabled" },
							version: 1,
							provenance: "curated",
							catalogVersion: undefined,
						})),
					),
				clearCache: (): void => undefined,
			} as unknown as LifecycleResolver;
		}

		/** onload, then set version + persisted last-seen, then run detection directly. */
		async function runDetection(opts: {
			version: string;
			lastSeen?: string;
			showSplash?: boolean;
			resolver?: LifecycleResolver;
		}): Promise<{ plugin: InstanceType<typeof MarkdownMasonPlugin> }> {
			const plugin = makePlugin();
			await plugin.onload();
			plugin.manifest.version = opts.version;
			plugin.settings.lastSeenVersion = opts.lastSeen ?? "";
			if (opts.showSplash !== undefined) plugin.settings.showUpdateSplash = opts.showSplash;
			if (opts.resolver !== undefined) plugin.lifecycleResolver = opts.resolver;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await (plugin as any)._maybeShowUpdateSplash();
			return { plugin };
		}

		it("shows the splash and advances lastSeenVersion on a genuine version bump", async () => {
			const { plugin } = await runDetection({ version: "0.3.0", lastSeen: "0.2.0" });

			expect(lastOpenedModal()).toBeInstanceOf(UpdateSplashModal);
			expect(plugin.settings.lastSeenVersion).toBe("0.3.0");
		});

		it("does NOT show the splash on a fresh install — records the version silently", async () => {
			const { plugin } = await runDetection({ version: "0.3.0", lastSeen: "" });

			expect(lastOpenedModal()).toBeUndefined();
			expect(plugin.settings.lastSeenVersion).toBe("0.3.0");
		});

		it("suppresses the splash when showUpdateSplash is false, but still advances the version", async () => {
			const { plugin } = await runDetection({
				version: "0.3.0",
				lastSeen: "0.2.0",
				showSplash: false,
			});

			expect(lastOpenedModal()).toBeUndefined();
			expect(plugin.settings.lastSeenVersion).toBe("0.3.0");
		});

		it("does nothing when the version is unchanged", async () => {
			const { plugin } = await runDetection({ version: "0.3.0", lastSeen: "0.3.0" });

			expect(lastOpenedModal()).toBeUndefined();
			expect(plugin.settings.lastSeenVersion).toBe("0.3.0");
		});

		it("seeds updatableScriptCount from the resolver's UpdateAvailable states", async () => {
			const plugin = makePlugin();
			await plugin.onload();
			// Seed two curated records so the resolver has ids to map over.
			const rec = {
				provenance: "curated" as const,
				enabled: true,
				okayed: { version: 1, checksum: "x" },
				source: "official",
				command: false,
			};
			await plugin.store.setRecord("perplexity-app", rec);
			await plugin.store.setRecord("perplexity-web", rec);

			// Unchanged-version path: refreshes updatableScriptCount WITHOUT calling
			// saveSettings (whose saveData(this.settings) would, in this isolated test
			// harness, overwrite the records just written via the store).
			plugin.manifest.version = "0.3.0";
			plugin.settings.lastSeenVersion = "0.3.0";
			plugin.lifecycleResolver = fakeResolver({
				"perplexity-app": { kind: "UpdateAvailable" },
				"perplexity-web": { kind: "Active" },
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await (plugin as any)._maybeShowUpdateSplash();

			// Two scripts resolved; only one is UpdateAvailable.
			expect(plugin.updatableScriptCount).toBe(1);
		});
	});
});
