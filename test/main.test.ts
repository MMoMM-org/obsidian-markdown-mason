import { describe, it, expect, beforeEach, vi } from "vitest";
import { App } from "obsidian";
import { lastOpenedModal, clearLastOpenedModal } from "./__mocks__/obsidian";
import { UpdateSplashModal } from "../src/ui/updateSplashModal";
import type { LifecycleResolver } from "../src/scripts/lifecycleResolver";
import type { ScriptItem } from "../src/ui/scriptsPage";
import type { ScriptsCache } from "../src/ui/scriptsCache";
import type { ScriptRecord } from "../src/scripts/store";
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

		it("has resourcesName defaulting to the level-2 '## Resources' heading", () => {
			expect(DEFAULT_SETTINGS.resourcesName).toBe("## Resources");
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

		/** onload, then set version + persisted last-seen, then run detection directly. */
		async function runDetection(opts: {
			version: string;
			lastSeen?: string;
			showSplash?: boolean;
			/** What the scripts cache has published before detection runs. */
			updatableCount?: number;
		}): Promise<{ plugin: InstanceType<typeof MarkdownMasonPlugin> }> {
			const plugin = makePlugin();
			await plugin.onload();
			plugin.manifest.version = opts.version;
			plugin.settings.lastSeenVersion = opts.lastSeen ?? "";
			if (opts.showSplash !== undefined) plugin.settings.showUpdateSplash = opts.showSplash;
			if (opts.updatableCount !== undefined) plugin.updatableScriptCount = opts.updatableCount;
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

		it("passes the count the scripts cache published to the splash", async () => {
			const { plugin } = await runDetection({ version: "0.3.0", lastSeen: "0.2.0", updatableCount: 2 });

			const modal = lastOpenedModal() as unknown as { _opts: { updatableCount: number } };
			expect(modal._opts.updatableCount).toBe(2);
			expect(plugin.updatableScriptCount).toBe(2);
		});
	});

	// -----------------------------------------------------------------------
	// Scripts cache seed at layout-ready (spec 010 T3.2, SDD ADR-6)
	// -----------------------------------------------------------------------

	describe("scripts cache seed at layout-ready", () => {
		beforeEach(() => {
			clearLastOpenedModal();
		});

		const CURATED: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: 1, checksum: "x" },
			source: "official",
			command: false,
		};

		interface SeededPlugin {
			plugin: InstanceType<typeof MarkdownMasonPlugin>;
			cache: ScriptsCache;
			resolveItems: ReturnType<typeof vi.fn>;
			tab: { settingItems: unknown[] };
		}

		/**
		 * onload with a counting fake resolver in place of the live one, and two
		 * curated records in the store: one UpdateAvailable, one Active.
		 */
		async function loadSeedablePlugin(opts: { version: string; lastSeen: string }): Promise<SeededPlugin> {
			const plugin = makePlugin();
			const states: Record<string, LifecycleState> = {
				"perplexity-app": { kind: "UpdateAvailable" } as LifecycleState,
				"perplexity-web": { kind: "Active" } as LifecycleState,
			};
			const resolveItems = vi.fn((records: Record<string, ScriptRecord>): Promise<ScriptItem[]> =>
				Promise.resolve(
					Object.keys(records).map((id) => ({
						id,
						displayName: id,
						description: "",
						record: records[id],
						state: states[id] ?? ({ kind: "Disabled" } as LifecycleState),
						version: 1,
						provenance: "curated" as const,
						catalogVersion: undefined,
					})),
				),
			);
			// The tab's cache captures the resolver at construction, so the fake must
			// be in place before onload builds the tab.
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(plugin as any)._initLifecycleResolver = (): Promise<void> => {
				plugin.lifecycleResolver = { resolveItems, clearCache: (): void => undefined } as unknown as LifecycleResolver;
				return Promise.resolve();
			};
			await plugin.onload();
			await plugin.store.setRecord("perplexity-app", CURATED);
			await plugin.store.setRecord("perplexity-web", CURATED);
			plugin.manifest.version = opts.version;
			plugin.settings.lastSeenVersion = opts.lastSeen;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const tab = (plugin as any)._settingTab as { scripts: ScriptsCache; settingItems: unknown[] };
			return { plugin, cache: tab.scripts, resolveItems, tab };
		}

		function fireLayoutReady(plugin: InstanceType<typeof MarkdownMasonPlugin>): void {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(plugin.app as any).workspace._fireLayoutReady();
		}

		it("refreshes the tab's scripts cache exactly once at layout-ready", async () => {
			const { plugin, cache } = await loadSeedablePlugin({ version: "0.3.0", lastSeen: "0.3.0" });
			const refresh = vi.spyOn(cache, "refresh");

			fireLayoutReady(plugin);

			await vi.waitFor(() => expect(cache.items).not.toBeNull());
			expect(refresh).toHaveBeenCalledTimes(1);
		});

		it("takes updatableScriptCount from the cache", async () => {
			const { plugin, cache } = await loadSeedablePlugin({ version: "0.3.0", lastSeen: "0.3.0" });
			expect(plugin.updatableScriptCount).toBeUndefined();

			fireLayoutReady(plugin);

			await vi.waitFor(() => expect(plugin.updatableScriptCount).toBe(1));
			expect(cache.updatableCount).toBe(1);
		});

		it("resolves the scripts once per startup, also when the splash shows", async () => {
			const { plugin, resolveItems } = await loadSeedablePlugin({ version: "0.3.0", lastSeen: "0.2.0" });

			fireLayoutReady(plugin);

			await vi.waitFor(() => expect(lastOpenedModal()).toBeInstanceOf(UpdateSplashModal));
			expect(resolveItems).toHaveBeenCalledTimes(1);
			const modal = lastOpenedModal() as unknown as { _opts: { updatableCount: number } };
			expect(modal._opts.updatableCount).toBe(1);
		});

		it("makes the script rows part of settingItems after the seed (searchable after startup)", async () => {
			const { plugin, tab } = await loadSeedablePlugin({ version: "0.3.0", lastSeen: "0.3.0" });

			fireLayoutReady(plugin);

			await vi.waitFor(() => expect(JSON.stringify(tab.settingItems)).toContain("perplexity-app"));
			expect(JSON.stringify(tab.settingItems)).toContain("perplexity-web");
		});
	});

	// -----------------------------------------------------------------------
	// Splash deep link into the Scripts page (spec 010 T3.2, SDD ADR-4)
	// -----------------------------------------------------------------------

	describe("_openScriptsSettings()", () => {
		interface SettingApi {
			open?: () => void;
			openPagePath?: unknown;
			openTabById?: (id: string) => void;
		}

		async function pluginWithSetting(setting: SettingApi | undefined): Promise<{ open(): void }> {
			const plugin = makePlugin();
			await plugin.onload();
			if (setting !== undefined) {
				(plugin.app as unknown as { setting: SettingApi }).setting = setting;
			}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return { open: () => (plugin as any)._openScriptsSettings() };
		}

		it("opens the settings, then the Scripts page through openPagePath", async () => {
			const calls: string[] = [];
			const openPagePath = vi.fn(() => { calls.push("openPagePath"); });
			const openTabById = vi.fn();
			const plugin = await pluginWithSetting({
				open: () => { calls.push("open"); },
				openPagePath,
				openTabById,
			});

			plugin.open();

			expect(calls).toEqual(["open", "openPagePath"]);
			expect(openPagePath).toHaveBeenCalledWith("markdown-mason", ["Scripts"]);
			expect(openTabById).not.toHaveBeenCalled();
		});

		it("falls back to openTabById when openPagePath is absent", async () => {
			const open = vi.fn();
			const openTabById = vi.fn();
			const plugin = await pluginWithSetting({ open, openTabById });

			plugin.open();

			expect(open).toHaveBeenCalledTimes(1);
			expect(openTabById).toHaveBeenCalledWith("markdown-mason");
		});

		it("falls back to openTabById when openPagePath is not a function", async () => {
			const openTabById = vi.fn();
			const plugin = await pluginWithSetting({ open: vi.fn(), openPagePath: "renamed", openTabById });

			plugin.open();

			expect(openTabById).toHaveBeenCalledWith("markdown-mason");
		});

		it("does nothing and does not throw when app.setting is missing", async () => {
			const plugin = await pluginWithSetting(undefined);

			expect(() => plugin.open()).not.toThrow();
		});
	});
});
