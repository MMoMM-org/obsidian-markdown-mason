/**
 * Spec 010 T3.1 — the declarative MasonSettingTab.
 *
 * The tab is thin: it assembles the main page from the builders, maps control
 * keys onto the settings, and connects the ScriptsCache to `update()`. These
 * tests pin that wiring on the definition tree the tab returns; a render row
 * is exercised by calling its `render` with a mock Setting, as Obsidian does.
 *
 * Contracts:
 *   1. getSettingDefinitions() is buildMainPageItems over the real Scripts
 *      page, Commands page and Documentation row; never empty; no I/O.
 *   2. getControlValue reads through readControl (defaults applied).
 *   3. setControlValue writes in memory, then persists through saveSettings
 *      exactly once. The mock base class throws, so a missing override fails.
 *   4. hide() marks the cache stale; the next build refreshes it once.
 *   5. A cache change redraws through update().
 *   6. The lifecycle ops, and with them the controller's re-render callback,
 *      are built once, in the constructor.
 *
 * HOUSE STYLE: tabs, double quotes, factory test data.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type {
	Setting as ObsidianSetting,
	SettingDefinitionItem,
	SettingDefinitionList,
	SettingDefinitionPage,
	SettingGroup as ObsidianSettingGroup,
} from "obsidian";
import {
	App,
	MockHTMLElement,
	Setting,
	SettingGroup,
	capturedSettings,
	clearCapturedSettings,
	clearNoticeLog,
	noticeLog,
} from "../__mocks__/obsidian";
import { controls, search, walk } from "./helpers/definitionTree";
import type { DefinitionNode } from "./helpers/definitionTree";
import {
	TEST_MANIFEST,
	makeFakeController,
	makeFakeResolver,
	makeScriptRecord,
	makeTabPlugin,
	settle,
} from "./helpers/settingsTabPlugin";
import type { TabPluginOptions } from "./helpers/settingsTabPlugin";
import { isDebugLogging, setDebugLogging } from "../../src/core/debug";
import { DEFAULT_SETTINGS } from "../../src/core/types";
import type { MasonSettings } from "../../src/core/types";
import type { LifecycleState } from "../../src/scripts/lifecycle";
import { buildCommandsPage } from "../../src/ui/commandsPage";
import { buildDocumentationRow, REPO_URL } from "../../src/ui/pluginIdentity";
import { buildScriptsPage } from "../../src/ui/scriptsPage";
import { FIXED_KEYS, readControl } from "../../src/ui/settingsControlStore";
import { buildMainPageItems } from "../../src/ui/settingsDefinitions";

const { MasonSettingTab } = await import("../../src/ui/settingsTab");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The tab as the mock base class extends it: with the update() call counter. */
type TestTab = InstanceType<typeof MasonSettingTab> & { _updateCalls: number };

function makeTab(options: TabPluginOptions = {}) {
	const { plugin, scripts } = makeTabPlugin(options);
	const tab = new MasonSettingTab(plugin.app as never, plugin as never) as TestTab;
	return { tab, plugin, scripts };
}

/** What the tree looks like, without the callbacks two builds never share. */
function outline(items: readonly SettingDefinitionItem[]): unknown[] {
	return walk(items).map(({ path, type, name, key, desc, aliases }) => ({ path, type, name, key, desc, aliases }));
}

function pageNamed(items: readonly SettingDefinitionItem[], name: string): SettingDefinitionPage {
	const page = items.find((item): item is SettingDefinitionPage => "type" in item && item.type === "page" && item.name === name);
	if (page === undefined) throw new Error(`no page named "${name}"`);
	return page;
}

function rowNamed(items: readonly SettingDefinitionItem[], pageName: string, name: string): DefinitionNode {
	const row = walk([pageNamed(items, pageName)]).find((node) => node.name === name && node.type !== "page");
	if (row === undefined) throw new Error(`no row named "${name}" on the ${pageName} page`);
	return row;
}

/** Renders a `render` row the way Obsidian does and returns its captured Setting. */
function renderRow(row: DefinitionNode) {
	if (!("render" in row.definition) || row.definition.render === undefined) {
		throw new Error(`"${row.name ?? ""}" is not a render row`);
	}
	clearCapturedSettings();
	row.definition.render(
		new Setting(null) as unknown as ObsidianSetting,
		new SettingGroup(null) as unknown as ObsidianSettingGroup,
	);
	return capturedSettings()[0]!;
}

/** Runs an `action` row the way a click does. */
function runAction(row: DefinitionNode): void {
	if (!("action" in row.definition) || row.definition.action === undefined) {
		throw new Error(`"${row.name ?? ""}" is not an action row`);
	}
	row.definition.action(new MockHTMLElement("div") as unknown as HTMLElement, 0);
}

const TWO_SCRIPTS = {
	"perplexity-auto": makeScriptRecord(),
	"perplexity-web": makeScriptRecord({ enabled: false }),
};

afterEach(() => {
	setDebugLogging(false);
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// DEFINITIONS
// ---------------------------------------------------------------------------

describe("MasonSettingTab — getSettingDefinitions", () => {
	it("is never empty, also before any script state has loaded", () => {
		const { tab } = makeTab();
		expect(tab.getSettingDefinitions().length).toBeGreaterThan(0);
		expect(controls(walk(tab.getSettingDefinitions()))).toHaveLength(18);
	});

	it("assembles buildMainPageItems from the real Scripts page, Commands page and Documentation row", async () => {
		const { tab, plugin } = makeTab({ scripts: TWO_SCRIPTS });
		await tab.scripts.refresh();
		const unusedOps = {} as Parameters<typeof buildScriptsPage>[1];
		const unusedDeps = {} as Parameters<typeof buildCommandsPage>[1];

		const expected = buildMainPageItems({
			scriptsPage: buildScriptsPage(tab.scripts, unusedOps),
			commandsPage: buildCommandsPage(tab.scripts, unusedDeps),
			identityRow: buildDocumentationRow(plugin.manifest),
		});

		expect(outline(tab.getSettingDefinitions())).toEqual(outline(expected));
	});

	it("lists every script on the Scripts page and every enabled one on the Commands page", async () => {
		const { tab } = makeTab({ scripts: TWO_SCRIPTS });
		await tab.scripts.refresh();
		const items = tab.getSettingDefinitions();

		const scriptRows = walk([pageNamed(items, "Scripts")]).filter((node) => node.type === "render");
		expect(scriptRows.map((node) => node.name)).toEqual(["perplexity-auto", "perplexity-web"]);
		const commandRows = walk([pageNamed(items, "Commands")]).filter((node) => node.type === "render");
		expect(commandRows.map((node) => node.name)).toEqual(["perplexity-auto"]);
	});

	it("shows the loading state on both pages until the cache has loaded", () => {
		const { tab } = makeTab({ scripts: TWO_SCRIPTS });
		const items = tab.getSettingDefinitions();

		const list = (pageNamed(items, "Scripts").items ?? []).find(
			(item): item is SettingDefinitionList => "type" in item && item.type === "list",
		);
		expect(list?.emptyState).toBe("Loading scripts…");
		expect(walk([pageNamed(items, "Commands")]).map((node) => node.name)).toContain("Loading scripts…");
	});

	it("ends with the Documentation row, which names the manifest version and opens the repository", () => {
		const { tab } = makeTab();
		const opened = vi.fn();
		vi.stubGlobal("window", { open: opened });

		const last = walk(tab.getSettingDefinitions()).at(-1)!;
		expect(last.name).toBe("Documentation");
		expect(last.path).toEqual(["Advanced"]);
		expect(last.desc).toContain(`v${TEST_MANIFEST.version}`);
		runAction(last);
		expect(opened).toHaveBeenCalledWith(REPO_URL, "_blank", "noopener,noreferrer");
	});

	it("performs no I/O while building", async () => {
		const resolver = makeFakeResolver({});
		const { tab, plugin } = makeTab({ scripts: TWO_SCRIPTS, lifecycleResolver: resolver });

		tab.getSettingDefinitions();
		tab.getSettingDefinitions();
		await settle();

		expect(plugin.store.getScripts).not.toHaveBeenCalled();
		expect(resolver.resolveItems).not.toHaveBeenCalled();
		expect(plugin.saveSettings).not.toHaveBeenCalled();
	});

	it("is declarative only: no display() override and no segment selection", () => {
		const own = Object.getOwnPropertyNames(MasonSettingTab.prototype);
		expect(own).not.toContain("display");
		expect(own).not.toContain("selectScriptsSegment");
		expect(own.filter((name) => name.startsWith("_render") || name === "_selectSegment")).toEqual([]);
	});

	it("a setting is found by a search for its name; an unrelated term finds nothing", () => {
		const { tab } = makeTab();
		const items = tab.getSettingDefinitions();
		expect(search(items, "reflow wrapped")).toEqual(["Reflow wrapped text"]);
		expect(search(items, "zebra crossing")).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// READING CONTROL VALUES
// ---------------------------------------------------------------------------

describe("MasonSettingTab — getControlValue", () => {
	const stored: Partial<MasonSettings> = {
		resourcesName: "### Sources",
		debugLogging: true,
		numericOnly: false,
		formatSelection: { reflow: true, dewrap: false },
	};

	it.each([...FIXED_KEYS])("reads %s through readControl", (key) => {
		const { tab, plugin } = makeTab({ settings: stored });
		expect(tab.getControlValue(key)).toBe(readControl(plugin.settings, key));
	});

	it("returns stored values", () => {
		const { tab } = makeTab({ settings: stored });
		expect(tab.getControlValue("resourcesName")).toBe("### Sources");
		expect(tab.getControlValue("numericOnly")).toBe(false);
		expect(tab.getControlValue("formatSelection.reflow")).toBe(true);
		expect(tab.getControlValue("formatSelection.dewrap")).toBe(false);
	});

	it("returns the default for a value that is not stored", () => {
		const { tab } = makeTab();
		expect(tab.getControlValue("numericOnly")).toBe(DEFAULT_SETTINGS.numericOnly);
		expect(tab.getControlValue("showUpdateSplash")).toBe(true);
		expect(tab.getControlValue("formatSelection.reflow")).toBe(false);
		expect(tab.getControlValue("formatSelection.dewrap")).toBe(true);
	});

	it("reads the live settings object, not a snapshot", () => {
		const { tab, plugin } = makeTab();
		plugin.settings.resourcesName = "## Later";
		expect(tab.getControlValue("resourcesName")).toBe("## Later");
	});

	it("returns undefined for a key that is not a fixed setting", () => {
		const { tab } = makeTab();
		expect(tab.getControlValue("scripts")).toBeUndefined();
		expect(tab.getControlValue("bogus")).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// WRITING CONTROL VALUES
// ---------------------------------------------------------------------------

describe("MasonSettingTab — setControlValue", () => {
	beforeEach(() => {
		clearNoticeLog();
	});

	it("writes a flat value, then saves once", async () => {
		const { tab, plugin } = makeTab();
		const savedWith: string[] = [];
		plugin.saveSettings.mockImplementation(async () => {
			savedWith.push(plugin.settings.resourcesName);
		});

		await tab.setControlValue("resourcesName", "### Sources");

		expect(plugin.settings.resourcesName).toBe("### Sources");
		expect(savedWith).toEqual(["### Sources"]);
	});

	it("writes a nested Format selection value, then saves once", async () => {
		const { tab, plugin } = makeTab({ settings: { formatSelection: { dewrap: false } } });

		await tab.setControlValue("formatSelection.reflow", true);

		expect(plugin.settings.formatSelection).toEqual({ dewrap: false, reflow: true });
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it.each(["showUpdateSplash", "numericOnly", "pasteListContext"] as const)(
		"persists the %s toggle",
		async (key) => {
			const { tab, plugin } = makeTab();

			await tab.setControlValue(key, false);

			expect(plugin.settings[key]).toBe(false);
			expect(tab.getControlValue(key)).toBe(false);
			expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
		},
	);

	it("switches debug logging on before saving", async () => {
		const { tab, plugin } = makeTab();
		const loggingWhileSaving: boolean[] = [];
		plugin.saveSettings.mockImplementation(async () => {
			loggingWhileSaving.push(isDebugLogging());
		});

		await tab.setControlValue("debugLogging", true);

		expect(plugin.settings.debugLogging).toBe(true);
		expect(loggingWhileSaving).toEqual([true]);
	});

	it("switches debug logging off again, live", async () => {
		const { tab, plugin } = makeTab({ settings: { debugLogging: true } });
		setDebugLogging(true);

		await tab.setControlValue("debugLogging", false);

		expect(isDebugLogging()).toBe(false);
		expect(plugin.settings.debugLogging).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it("leaves debug logging alone when another setting changes", async () => {
		const { tab } = makeTab();
		await tab.setControlValue("numericOnly", true);
		expect(isDebugLogging()).toBe(false);
	});

	it.each(["bogus", "scripts", "lastSeenVersion", "formatSelection.bogus", "__proto__"])(
		"ignores the unknown key %s: no write, no save",
		async (key) => {
			const { tab, plugin } = makeTab();
			const before = JSON.stringify(plugin.settings);

			await tab.setControlValue(key, "hostile");

			expect(JSON.stringify(plugin.settings)).toBe(before);
			expect(plugin.saveSettings).not.toHaveBeenCalled();
		},
	);

	it("shows a notice and does not throw when saving fails; the value stays set", async () => {
		const { tab, plugin } = makeTab();
		plugin.saveSettings.mockRejectedValue(new Error("disk full"));

		await expect(tab.setControlValue("resourcesName", "### Sources")).resolves.toBeUndefined();

		expect(noticeLog()).toEqual(["Mason: could not save settings."]);
		expect(plugin.settings.resourcesName).toBe("### Sources");
	});

	it("shows no notice when saving succeeds", async () => {
		const { tab } = makeTab();
		await tab.setControlValue("resourcesName", "### Sources");
		expect(noticeLog()).toEqual([]);
	});

	it("never redraws the tab for a control change", async () => {
		const { tab } = makeTab();
		await tab.setControlValue("formatSelection.reflow", true);
		expect(tab._updateCalls).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// UPGRADE — a data.json written by 0.9.4, through the real plugin
// ---------------------------------------------------------------------------

describe("MasonSettingTab — 0.9.4 data.json", () => {
	/** What a 0.9.4 install could have persisted: settings and the scripts namespace share the file. */
	const blob094 = () => ({
		resourcesName: "## Sources",
		debugLogging: false,
		numericOnly: false,
		showUpdateSplash: false,
		lastSeenVersion: "0.9.4",
		formatSelection: { reflow: true, cascade: false },
		scripts: {
			"perplexity-auto": makeScriptRecord({ command: true, commandName: "Tidy Perplexity" }),
			"my-import": makeScriptRecord({ provenance: "imported", enabled: false, okayed: null }),
		},
	});

	async function loadPlugin() {
		const { MarkdownMasonPlugin } = await import("../../src/main");
		const plugin = new MarkdownMasonPlugin(new App() as never, { ...TEST_MANIFEST, version: "0.9.4" } as never);
		await plugin.saveData(blob094());
		await plugin.onload();
		const tab = new MasonSettingTab(plugin.app, plugin);
		return { plugin, tab };
	}

	it("reports every stored value unchanged", async () => {
		const { tab } = await loadPlugin();

		expect(tab.getControlValue("resourcesName")).toBe("## Sources");
		expect(tab.getControlValue("numericOnly")).toBe(false);
		expect(tab.getControlValue("showUpdateSplash")).toBe(false);
		expect(tab.getControlValue("debugLogging")).toBe(false);
		expect(tab.getControlValue("formatSelection.reflow")).toBe(true);
		expect(tab.getControlValue("formatSelection.cascade")).toBe(false);
		// Not stored by 0.9.4 → defaults.
		expect(tab.getControlValue("pasteListContext")).toBe(true);
		expect(tab.getControlValue("formatSelection.dewrap")).toBe(true);
	});

	it("keeps the scripts namespace and the other settings after a write", async () => {
		const { plugin, tab } = await loadPlugin();

		await tab.setControlValue("formatSelection.dewrap", false);
		await tab.setControlValue("resourcesName", "### Notes");

		const persisted = (await plugin.loadData()) as ReturnType<typeof blob094>;
		expect(persisted.scripts).toEqual(blob094().scripts);
		expect(persisted.formatSelection).toEqual({ reflow: true, cascade: false, dewrap: false });
		expect(persisted.resourcesName).toBe("### Notes");
		expect(persisted.numericOnly).toBe(false);
		expect(persisted.showUpdateSplash).toBe(false);
		expect(persisted.lastSeenVersion).toBe("0.9.4");
	});
});

// ---------------------------------------------------------------------------
// CACHE WIRING — stale on hide, one refresh, redraw through update()
// ---------------------------------------------------------------------------

describe("MasonSettingTab — scripts cache", () => {
	it("exposes the cache, unloaded and not stale at first", () => {
		const { tab } = makeTab();
		expect(tab.scripts.items).toBeNull();
		expect(tab.scripts.stale).toBe(false);
	});

	it("hide() marks the cache stale without refreshing it", async () => {
		const { tab, plugin } = makeTab({ scripts: TWO_SCRIPTS });

		tab.hide();
		await settle();

		expect(tab.scripts.stale).toBe(true);
		expect(plugin.store.getScripts).not.toHaveBeenCalled();
	});

	it("after hide(), the next build triggers exactly one refresh and no loop", async () => {
		const { tab, plugin } = makeTab({ scripts: TWO_SCRIPTS });
		tab.hide();

		tab.getSettingDefinitions();
		// More builds while that refresh is running must not start another one.
		tab.getSettingDefinitions();
		tab.getSettingDefinitions();
		await settle();

		// The refresh redrew through update(), which built the tree once more.
		expect(tab._updateCalls).toBe(1);
		expect(plugin.store.getScripts).toHaveBeenCalledTimes(1);
		expect(tab.scripts.stale).toBe(false);

		tab.getSettingDefinitions();
		await settle();
		expect(plugin.store.getScripts).toHaveBeenCalledTimes(1);
		expect(tab._updateCalls).toBe(1);
	});

	it("a build does not refresh a cache that is not stale", async () => {
		const { tab, plugin } = makeTab({ scripts: TWO_SCRIPTS });
		await tab.scripts.refresh();
		plugin.store.getScripts.mockClear();

		tab.getSettingDefinitions();
		await settle();

		expect(plugin.store.getScripts).not.toHaveBeenCalled();
	});

	it("a stale mark set during a running refresh is served by the next build after it", async () => {
		const { tab, plugin } = makeTab({ scripts: TWO_SCRIPTS });
		const running = tab.scripts.refresh();
		tab.hide();

		tab.getSettingDefinitions();
		await running;
		await settle();
		// That pass may have read the store before the mark, so the mark outlives it.
		expect(plugin.store.getScripts).toHaveBeenCalledTimes(1);
		expect(tab.scripts.stale).toBe(true);

		tab.getSettingDefinitions();
		await settle();
		expect(plugin.store.getScripts).toHaveBeenCalledTimes(2);
		expect(tab.scripts.stale).toBe(false);
	});

	it("a cache change calls update(), which shows the new script rows", async () => {
		const { tab, scripts } = makeTab({ scripts: { "perplexity-auto": makeScriptRecord() } });

		await tab.scripts.refresh();
		expect(tab._updateCalls).toBe(1);
		expect(search(tab.settingItems, "perplexity-auto")).toContain("perplexity-auto");

		scripts["second-script"] = makeScriptRecord();
		await tab.scripts.refresh();
		expect(tab._updateCalls).toBe(2);
		expect(search(tab.settingItems, "second-script")).toContain("second-script");
	});

	it("resolves through the live resolver and publishes the update count to the plugin", async () => {
		const resolver = makeFakeResolver({
			"perplexity-auto": { kind: "UpdateAvailable" },
			"perplexity-web": { kind: "Active" },
		});
		const { tab, plugin } = makeTab({ scripts: TWO_SCRIPTS, lifecycleResolver: resolver });

		await tab.scripts.refresh();

		expect(resolver.resolveItems).toHaveBeenCalledTimes(1);
		expect(plugin.updatableScriptCount).toBe(1);
		const page = pageNamed(tab.getSettingDefinitions(), "Scripts");
		expect((page.displayValue as () => string)()).toBe("1 update available");
		expect((page.status as () => string | null)()).toBe("warning");
	});

	it("shows no update indicator while nothing is waiting", async () => {
		const { tab, plugin } = makeTab({ scripts: TWO_SCRIPTS });
		await tab.scripts.refresh();

		expect(plugin.updatableScriptCount).toBe(0);
		const page = pageNamed(tab.getSettingDefinitions(), "Scripts");
		expect((page.displayValue as () => string)()).toBe("");
		expect((page.status as () => string | null)()).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// LIFECYCLE OPS — built once; the controller refreshes through the cache
// ---------------------------------------------------------------------------

describe("MasonSettingTab — lifecycle ops", () => {
	it("wires the controller's rerender exactly once, in the constructor", async () => {
		const controller = makeFakeController();
		const { tab } = makeTab({ scripts: TWO_SCRIPTS, lifecycleController: controller });
		expect(controller.setRerender).toHaveBeenCalledTimes(1);

		tab.getSettingDefinitions();
		await tab.scripts.refresh();
		tab.hide();
		tab.getSettingDefinitions();
		await settle();

		expect(controller.setRerender).toHaveBeenCalledTimes(1);
	});

	it("the controller's rerender refreshes the cache, which redraws the tab", async () => {
		const controller = makeFakeController();
		const { tab, plugin } = makeTab({ scripts: TWO_SCRIPTS, lifecycleController: controller });
		const rerender = controller.setRerender.mock.calls[0]![0] as () => void;

		rerender();
		await settle();

		expect(plugin.store.getScripts).toHaveBeenCalledTimes(1);
		expect(tab._updateCalls).toBe(1);
	});

	it("a burst of rerenders redraws once per settled state", async () => {
		const controller = makeFakeController();
		const { tab, plugin } = makeTab({ scripts: TWO_SCRIPTS, lifecycleController: controller });
		const rerender = controller.setRerender.mock.calls[0]![0] as () => void;

		rerender();
		rerender();
		rerender();
		await settle();
		await settle();

		// One running pass plus one coalesced follow-up pass.
		expect(plugin.store.getScripts).toHaveBeenCalledTimes(2);
		expect(tab._updateCalls).toBe(2);
	});

	it("a script row's toggle drives controller.enable", async () => {
		const controller = makeFakeController();
		const { tab } = makeTab({ scripts: TWO_SCRIPTS, lifecycleController: controller });
		await tab.scripts.refresh();

		const record = renderRow(rowNamed(tab.getSettingDefinitions(), "Scripts", "perplexity-web"));
		record.toggleControls[0]!.setValue(true);
		await settle();

		expect(controller.enable).toHaveBeenCalledWith("perplexity-web");
	});

	it("the Import from vault row drives controller.importFromVault", async () => {
		const controller = makeFakeController();
		const { tab } = makeTab({ lifecycleController: controller });

		runAction(rowNamed(tab.getSettingDefinitions(), "Scripts", "Import from vault"));
		await settle();

		expect(controller.importFromVault).toHaveBeenCalledTimes(1);
	});

	it("the Browse official row fetches the catalog list through controller.listOfficial", async () => {
		const controller = makeFakeController();
		const { tab } = makeTab({ lifecycleController: controller });

		runAction(rowNamed(tab.getSettingDefinitions(), "Scripts", "Browse official"));
		await settle();

		expect(controller.listOfficial).toHaveBeenCalledTimes(1);
	});

	it("without a controller, a toggle writes the store and the tab redraws with the new state", async () => {
		const { tab, plugin, scripts } = makeTab({ scripts: TWO_SCRIPTS });
		await tab.scripts.refresh();

		const record = renderRow(rowNamed(tab.getSettingDefinitions(), "Scripts", "perplexity-web"));
		record.toggleControls[0]!.setValue(true);
		await settle();
		await settle();

		expect(plugin.store.setRecord).toHaveBeenCalledWith("perplexity-web", expect.objectContaining({ enabled: true }));
		expect(scripts["perplexity-web"]!.enabled).toBe(true);
		expect(tab._updateCalls).toBe(2);
		expect(tab.scripts.records["perplexity-web"]!.enabled).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// COMMANDS — rows register against the live script state
// ---------------------------------------------------------------------------

describe("MasonSettingTab — command rows", () => {
	type RegisterCall = [string, string, () => unknown, (id: string) => LifecycleState];

	async function toggleCommandOn(states: Record<string, LifecycleState>) {
		const resolver = makeFakeResolver(states);
		const made = makeTab({ scripts: TWO_SCRIPTS, lifecycleResolver: resolver });
		await made.tab.scripts.refresh();

		const record = renderRow(rowNamed(made.tab.getSettingDefinitions(), "Commands", "perplexity-auto"));
		record.toggleControls[0]!.setValue(true);
		await settle();

		expect(made.plugin.commandManager.register).toHaveBeenCalledTimes(1);
		const call = made.plugin.commandManager.register.mock.calls[0] as RegisterCall;
		return { ...made, call };
	}

	it("registers the command and persists command = true", async () => {
		const { call, plugin } = await toggleCommandOn({ "perplexity-auto": { kind: "Active" } });

		expect(call[0]).toBe("perplexity-auto");
		expect(call[1]).toBe("perplexity-auto");
		expect(plugin.store.setRecord).toHaveBeenCalledWith("perplexity-auto", expect.objectContaining({ command: true }));
	});

	it("hands the command a getState that reports the resolver's state", async () => {
		const { call } = await toggleCommandOn({ "perplexity-auto": { kind: "Active" } });
		const getState = call[3];

		expect(getState("perplexity-auto")).toEqual({ kind: "Active" });
		expect(getState("perplexity-web")).toEqual({ kind: "Disabled" });
	});

	it("getState fails closed to Disabled for a script the cache does not know", async () => {
		const { call } = await toggleCommandOn({ "perplexity-auto": { kind: "Active" } });
		expect(call[3]("unknown-script")).toEqual({ kind: "Disabled" });
	});

	it("getState follows a later refresh instead of a snapshot", async () => {
		const { call, tab, plugin } = await toggleCommandOn({ "perplexity-auto": { kind: "Active" } });
		plugin.lifecycleResolver!.resolveItems.mockImplementation(async () => []);

		await tab.scripts.refresh();

		expect(call[3]("perplexity-auto")).toEqual({ kind: "Disabled" });
	});

	it("registers a no-op function for a script that is not Active", async () => {
		const { call } = await toggleCommandOn({ "perplexity-auto": { kind: "Blocked", reason: "offline" } });
		expect(call[2]()).toBeUndefined();
	});

	it("an edit on a command row does not redraw the tab", async () => {
		const { tab } = await toggleCommandOn({ "perplexity-auto": { kind: "Active" } });
		// One update() from the refresh that loaded the scripts, none from the toggle.
		expect(tab._updateCalls).toBe(1);
	});
});
