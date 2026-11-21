/**
 * Spec 010 T2.4 — the declarative Commands page.
 *
 * buildCommandsPage is asserted on the definition tree it returns (walk / search);
 * a command row is exercised by calling its `render` with a mock Setting, as the
 * settings runtime does.
 *
 * Contracts:
 *   1. The page is named "Commands" and carries no `id` (deviation D-1).
 *   2. It always starts with the intro row (hint text, aliases hotkey and
 *      command palette), also with no enabled script.
 *   3. One render row per `enabled === true` script, else the empty-state row.
 *      Before the cache loaded, a loading row stands in for both.
 *   4. A row's toggle reflects record.command; on registers under commandName or
 *      the id, off unregisters and keeps `enabled`.
 *   5. Renaming trims, persists and re-registers an active command; an empty
 *      name falls back to the id.
 *   6. Edits patch cache.records in place and never trigger the tab's update().
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SettingDefinitionItem, SettingDefinitionPage, Setting as ObsidianSetting, SettingGroup as ObsidianSettingGroup } from "obsidian";
import {
	App,
	PluginSettingTab,
	Setting,
	SettingGroup,
	capturedSettings,
	clearCapturedSettings,
} from "../__mocks__/obsidian";
import { search, walk } from "./helpers/definitionTree";
import type { DefinitionNode } from "./helpers/definitionTree";
import type { ScriptRecord } from "../../src/scripts/store";
import type { LifecycleState } from "../../src/scripts/lifecycle";
import type { ScriptFunction } from "../../src/scripts/context";
import { ScriptsCache, buildOfflineScriptItems } from "../../src/ui/scriptsCache";
import {
	COMMANDS_PAGE_NAME,
	buildCommandsPage,
	configureCommandRow,
} from "../../src/ui/commandsPage";

const HINT = "Name the command, toggle to create it, then bind keys in core hotkeys.";
const EMPTY_STATE = "Enable a script in the Scripts tab first, then return here to create a command for it.";

// ---------------------------------------------------------------------------
// Fixtures
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

/** A cache the way the plugin creates it: nothing loaded until the first refresh. */
function makeUnloadedCache(scripts: Record<string, ScriptRecord>): ScriptsCache {
	return new ScriptsCache({
		store: { getScripts: async () => ({ ...scripts }) },
		setUpdatableCount: () => undefined,
	});
}

const scriptFn: ScriptFunction = () => undefined;

function activeState(_id: string): LifecycleState {
	return { kind: "Active" };
}

/**
 * A page wired to fakes over a cache that has already loaded `scripts`. The
 * store hands out copies, so a test can tell a patched cache from a store read.
 */
function makePage(scripts: Record<string, ScriptRecord>) {
	const persisted: Record<string, ScriptRecord> = { ...scripts };
	const cache = { records: { ...scripts }, items: buildOfflineScriptItems(scripts) };
	const store = {
		getScripts: vi.fn(async () => ({ ...persisted })),
		setRecord: vi.fn(async (id: string, record: ScriptRecord) => {
			persisted[id] = record;
		}),
	};
	const commandManager = { register: vi.fn(), unregister: vi.fn() };
	const resolveScriptFn = vi.fn((_id: string) => scriptFn);
	const deps = { store, commandManager, resolveScriptFn, getState: activeState };
	return { cache, store, commandManager, resolveScriptFn, deps, page: buildCommandsPage(cache, deps) };
}

function rowsOf(page: SettingDefinitionPage): DefinitionNode[] {
	return walk([page]).filter(node => node.type !== "page");
}

/** Renders the row named `name` the way the settings runtime does and returns its captured Setting. */
function renderRow(page: SettingDefinitionPage, name: string) {
	const row = rowsOf(page).find(node => node.name === name);
	if (row === undefined || !("render" in row.definition) || row.definition.render === undefined) {
		throw new Error(`no render row named "${name}"`);
	}
	clearCapturedSettings();
	row.definition.render(
		new Setting(null) as unknown as ObsidianSetting,
		new SettingGroup(null) as unknown as ObsidianSettingGroup,
	);
	return capturedSettings()[0];
}

/** Lets the async handlers (store read, store write, re-register) settle. */
async function settle(): Promise<void> {
	for (let turn = 0; turn < 10; turn++) {
		await Promise.resolve();
	}
}

beforeEach(() => {
	clearCapturedSettings();
});

// ---------------------------------------------------------------------------
// Page shape
// ---------------------------------------------------------------------------

describe("buildCommandsPage — page", () => {
	it('returns a page named "Commands" without an id', () => {
		const { page } = makePage({});
		expect(COMMANDS_PAGE_NAME).toBe("Commands");
		expect(page.type).toBe("page");
		expect(page.name).toBe("Commands");
		expect("id" in page).toBe(false);
	});

	it("puts no id on any row", () => {
		const { page } = makePage({ "my-script": makeRecord() });
		for (const row of rowsOf(page)) {
			expect("id" in row.definition).toBe(false);
		}
	});

	it("reads no store while building", () => {
		const { store } = makePage({ "my-script": makeRecord() });
		expect(store.getScripts).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Intro row
// ---------------------------------------------------------------------------

describe("buildCommandsPage — intro row", () => {
	it("starts with the hint row when scripts are enabled", () => {
		const { page } = makePage({ "my-script": makeRecord() });
		const intro = rowsOf(page)[0];
		expect(intro.type).toBe("empty");
		expect(intro.desc).toBe(HINT);
		expect(intro.aliases).toEqual(["hotkey", "command palette"]);
	});

	it("starts with the hint row when no script is enabled", () => {
		const { page } = makePage({ "off-script": makeRecord({ enabled: false }) });
		const intro = rowsOf(page)[0];
		expect(intro.type).toBe("empty");
		expect(intro.desc).toBe(HINT);
		expect(intro.aliases).toEqual(["hotkey", "command palette"]);
	});

	it("starts with the hint row when there are no scripts at all", () => {
		const { page } = makePage({});
		expect(rowsOf(page)[0].desc).toBe(HINT);
	});

	it('is found by a search for "hotkey" and for "command palette"', () => {
		const { page } = makePage({ "my-script": makeRecord() });
		const introName = rowsOf(page)[0].name;
		expect(introName).toBeDefined();
		expect(search([page], "hotkey")).toEqual([introName]);
		expect(search([page], "command palette")).toEqual([introName]);
	});

	it("is found by those searches with no enabled script too", () => {
		const { page } = makePage({});
		const introName = rowsOf(page)[0].name;
		expect(search([page], "hotkey")).toEqual([introName]);
		expect(search([page], "command palette")).toEqual([introName]);
	});
});

// ---------------------------------------------------------------------------
// Script rows and empty state
// ---------------------------------------------------------------------------

describe("buildCommandsPage — rows", () => {
	it("has one render row per enabled script, in store order, named by the script id", () => {
		const { page } = makePage({
			"perplexity-app": makeRecord(),
			"disabled-script": makeRecord({ enabled: false }),
			"perplexity-web": makeRecord(),
		});
		const rows = rowsOf(page).slice(1);
		expect(rows.map(row => row.type)).toEqual(["render", "render"]);
		expect(rows.map(row => row.name)).toEqual(["perplexity-app", "perplexity-web"]);
	});

	it("does not repeat the hint on the script rows", () => {
		const { page } = makePage({ "my-script": makeRecord() });
		const [, row] = rowsOf(page);
		expect(row.desc).toBeUndefined();
		expect(renderRow(page, "my-script").desc).toBe("");
	});

	it("shows the empty-state row when no script is enabled", () => {
		const { page } = makePage({ "off-script": makeRecord({ enabled: false }) });
		const rows = rowsOf(page).slice(1);
		expect(rows).toHaveLength(1);
		expect(rows[0].type).toBe("empty");
		expect(rows[0].name).toBe("No enabled scripts");
		expect(rows[0].desc).toBe(EMPTY_STATE);
	});

	it("shows the empty-state row when the cache holds no scripts", () => {
		const { page } = makePage({});
		expect(rowsOf(page).slice(1).map(row => row.name)).toEqual(["No enabled scripts"]);
	});

	it("before the cache loads, shows the loading row and not the empty state", () => {
		const cache = makeUnloadedCache({ "off-script": makeRecord({ enabled: false }) });
		const { deps } = makePage({});

		const rows = rowsOf(buildCommandsPage(cache, deps));

		expect(rows[0].desc).toBe(HINT);
		expect(rows.slice(1).map(row => row.name)).toEqual(["Loading scripts…"]);
		expect(rows[1].type).toBe("empty");
		expect(rows.map(row => row.name)).not.toContain("No enabled scripts");
	});

	it("after a refresh with no enabled scripts, shows the empty state and not the loading row", async () => {
		const cache = makeUnloadedCache({ "off-script": makeRecord({ enabled: false }) });
		const { deps } = makePage({});
		await cache.refresh();

		const rows = rowsOf(buildCommandsPage(cache, deps));

		expect(rows[0].desc).toBe(HINT);
		expect(rows.slice(1).map(row => row.name)).toEqual(["No enabled scripts"]);
	});

	it("after a refresh with an enabled script, shows its row and not the loading row", async () => {
		const cache = makeUnloadedCache({ "my-script": makeRecord() });
		const { deps } = makePage({});
		await cache.refresh();

		const rows = rowsOf(buildCommandsPage(cache, deps));

		expect(rows.slice(1).map(row => row.name)).toEqual(["my-script"]);
	});

	it("leaves the empty-state row out once a script is enabled", () => {
		const { page } = makePage({ "my-script": makeRecord() });
		expect(rowsOf(page).map(row => row.name)).not.toContain("No enabled scripts");
	});

	it("gives all rows names that are unique among siblings and in sentence case", () => {
		const { page } = makePage({ "first-script": makeRecord(), "second-script": makeRecord() });
		const names = rowsOf(page).map(row => row.name ?? "");
		expect(new Set(names).size).toBe(names.length);
		for (const name of names) {
			expect(name).not.toMatch(/^.+\s+[A-Z][a-z]/);
		}
	});

	it("lets a script row be found by its id", () => {
		const { page } = makePage({ "tidy-headings": makeRecord() });
		expect(search([page], "tidy-head")).toEqual(["tidy-headings"]);
	});
});

// ---------------------------------------------------------------------------
// configureCommandRow — rendering
// ---------------------------------------------------------------------------

describe("configureCommandRow — rendering", () => {
	it("names the row by the script id and adds one text field and one toggle", () => {
		const { page } = makePage({ "my-script": makeRecord() });
		const row = renderRow(page, "my-script");
		expect(row.name).toBe("my-script");
		expect(row.textControls).toHaveLength(1);
		expect(row.toggleControls).toHaveLength(1);
	});

	it("can be called directly with a Setting", () => {
		const { cache, deps } = makePage({ "my-script": makeRecord({ command: true, commandName: "Tidy" }) });
		configureCommandRow(
			new Setting(null) as unknown as ObsidianSetting,
			"my-script",
			cache.records["my-script"],
			{ ...deps, cache },
		);
		const [row] = capturedSettings();
		expect(row.name).toBe("my-script");
		expect(row.textControls[0].getValue()).toBe("Tidy");
		expect(row.toggleControls[0].getValue()).toBe(true);
	});

	it("reflects record.command = false in the toggle", () => {
		const { page } = makePage({ "my-script": makeRecord({ command: false }) });
		expect(renderRow(page, "my-script").toggleControls[0].getValue()).toBe(false);
	});

	it("reflects record.command = true in the toggle", () => {
		const { page } = makePage({ "my-script": makeRecord({ command: true }) });
		expect(renderRow(page, "my-script").toggleControls[0].getValue()).toBe(true);
	});

	it("shows the saved command name, or an empty field without one", () => {
		const { page } = makePage({
			"named-script": makeRecord({ commandName: "Tidy headings" }),
			"plain-script": makeRecord(),
		});
		expect(renderRow(page, "named-script").textControls[0].getValue()).toBe("Tidy headings");
		expect(renderRow(page, "plain-script").textControls[0].getValue()).toBe("");
	});

	it("does not register, persist or resolve the script function while rendering", () => {
		const { page, store, commandManager, resolveScriptFn } = makePage({
			"my-script": makeRecord({ command: true, commandName: "Tidy" }),
		});
		renderRow(page, "my-script");
		expect(commandManager.register).not.toHaveBeenCalled();
		expect(commandManager.unregister).not.toHaveBeenCalled();
		expect(store.setRecord).not.toHaveBeenCalled();
		expect(resolveScriptFn).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// configureCommandRow — toggle
// ---------------------------------------------------------------------------

describe("configureCommandRow — toggle on", () => {
	it("registers the command under the script id when no name is set", async () => {
		const { page, commandManager, resolveScriptFn } = makePage({ "my-script": makeRecord() });
		renderRow(page, "my-script").toggleControls[0].setValue(true);
		await settle();

		expect(commandManager.register).toHaveBeenCalledOnce();
		expect(commandManager.register).toHaveBeenCalledWith("my-script", "my-script", scriptFn, activeState);
		expect(resolveScriptFn).toHaveBeenCalledWith("my-script");
	});

	it("registers the command under the custom name", async () => {
		const { page, commandManager } = makePage({
			"my-script": makeRecord({ commandName: "Tidy headings" }),
		});
		renderRow(page, "my-script").toggleControls[0].setValue(true);
		await settle();

		expect(commandManager.register).toHaveBeenCalledOnce();
		expect(commandManager.register.mock.calls[0].slice(0, 2)).toEqual(["my-script", "Tidy headings"]);
	});

	it("persists command = true and keeps the other fields", async () => {
		const { page, store } = makePage({
			"my-script": makeRecord({ source: "vault/script.cjs", commandName: "Tidy" }),
		});
		renderRow(page, "my-script").toggleControls[0].setValue(true);
		await settle();

		expect(store.setRecord).toHaveBeenCalledOnce();
		expect(store.setRecord).toHaveBeenCalledWith(
			"my-script",
			makeRecord({ source: "vault/script.cjs", commandName: "Tidy", command: true }),
		);
	});
});

describe("configureCommandRow — toggle off", () => {
	it("unregisters the command", async () => {
		const { page, commandManager } = makePage({ "my-script": makeRecord({ command: true }) });
		renderRow(page, "my-script").toggleControls[0].setValue(false);
		await settle();

		expect(commandManager.unregister).toHaveBeenCalledOnce();
		expect(commandManager.unregister).toHaveBeenCalledWith("my-script");
		expect(commandManager.register).not.toHaveBeenCalled();
	});

	it("persists command = false and keeps enabled", async () => {
		const { page, store } = makePage({ "my-script": makeRecord({ command: true }) });
		renderRow(page, "my-script").toggleControls[0].setValue(false);
		await settle();

		expect(store.setRecord).toHaveBeenCalledOnce();
		const [id, record] = store.setRecord.mock.calls[0];
		expect(id).toBe("my-script");
		expect(record.command).toBe(false);
		expect(record.enabled).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// configureCommandRow — rename
// ---------------------------------------------------------------------------

describe("configureCommandRow — rename", () => {
	it("persists the trimmed name as commandName", async () => {
		const { page, store } = makePage({ "my-script": makeRecord() });
		renderRow(page, "my-script").textControls[0].setValue("  Tidy headings  ");
		await settle();

		expect(store.setRecord).toHaveBeenCalledOnce();
		expect(store.setRecord).toHaveBeenCalledWith("my-script", makeRecord({ commandName: "Tidy headings" }));
	});

	it("removes commandName when the field is cleared", async () => {
		const { page, store } = makePage({ "my-script": makeRecord({ commandName: "Old name" }) });
		renderRow(page, "my-script").textControls[0].setValue("   ");
		await settle();

		const [, record] = store.setRecord.mock.calls[0];
		expect("commandName" in record).toBe(false);
	});

	it("does not register while the command is off", async () => {
		const { page, commandManager, resolveScriptFn } = makePage({ "my-script": makeRecord({ command: false }) });
		renderRow(page, "my-script").textControls[0].setValue("Tidy headings");
		await settle();

		expect(commandManager.register).not.toHaveBeenCalled();
		expect(resolveScriptFn).not.toHaveBeenCalled();
	});

	it("re-registers under the new name while the command is active", async () => {
		const { page, commandManager } = makePage({
			"my-script": makeRecord({ command: true, commandName: "First" }),
		});
		renderRow(page, "my-script").textControls[0].setValue(" Second ");
		await settle();

		expect(commandManager.register).toHaveBeenCalledOnce();
		expect(commandManager.register).toHaveBeenCalledWith("my-script", "Second", scriptFn, activeState);
	});

	it("re-registers under the script id when an active command's name is cleared", async () => {
		const { page, commandManager } = makePage({
			"my-script": makeRecord({ command: true, commandName: "First" }),
		});
		renderRow(page, "my-script").textControls[0].setValue("");
		await settle();

		expect(commandManager.register).toHaveBeenCalledOnce();
		expect(commandManager.register.mock.calls[0].slice(0, 2)).toEqual(["my-script", "my-script"]);
	});

	it("changes nothing for a script that is gone from the store", async () => {
		const { page, store, commandManager, cache } = makePage({ "my-script": makeRecord() });
		const row = renderRow(page, "my-script");
		store.getScripts.mockResolvedValue({});
		row.textControls[0].setValue("Tidy headings");
		await settle();

		expect(store.setRecord).not.toHaveBeenCalled();
		expect(commandManager.register).not.toHaveBeenCalled();
		expect(cache.records["my-script"].commandName).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Edits patch the cache and never re-render
// ---------------------------------------------------------------------------

describe("configureCommandRow — cache and re-rendering", () => {
	it("patches cache.records in place on a rename", async () => {
		const { page, cache } = makePage({ "my-script": makeRecord(), "other-script": makeRecord() });
		const recordsBefore = cache.records;
		renderRow(page, "my-script").textControls[0].setValue("Tidy headings");
		await settle();

		expect(cache.records).toBe(recordsBefore);
		expect(cache.records["my-script"].commandName).toBe("Tidy headings");
		expect(cache.records["other-script"]).toEqual(makeRecord());
	});

	it("patches cache.records in place on toggle on and off", async () => {
		const { page, cache } = makePage({ "my-script": makeRecord() });
		const recordsBefore = cache.records;
		const toggle = renderRow(page, "my-script").toggleControls[0];

		toggle.setValue(true);
		await settle();
		expect(cache.records["my-script"].command).toBe(true);

		toggle.setValue(false);
		await settle();
		expect(cache.records["my-script"].command).toBe(false);
		expect(cache.records["my-script"].enabled).toBe(true);
		expect(cache.records).toBe(recordsBefore);
	});

	it("makes a rebuilt page show the edited values", async () => {
		const { page, cache, deps } = makePage({ "my-script": makeRecord() });
		const row = renderRow(page, "my-script");
		row.textControls[0].setValue("Tidy headings");
		await settle();
		row.toggleControls[0].setValue(true);
		await settle();

		const rebuilt = renderRow(buildCommandsPage(cache, deps), "my-script");
		expect(rebuilt.textControls[0].getValue()).toBe("Tidy headings");
		expect(rebuilt.toggleControls[0].getValue()).toBe(true);
	});

	it("never calls the tab's update() on a rename or a toggle", async () => {
		const { cache, deps } = makePage({ "my-script": makeRecord() });

		class CommandsOnlyTab extends PluginSettingTab {
			override getSettingDefinitions(): SettingDefinitionItem[] {
				return [buildCommandsPage(cache, deps)];
			}
		}
		const tab = new CommandsOnlyTab(new App(), {});
		const update = vi.spyOn(tab, "update");
		tab.update();
		expect(update).toHaveBeenCalledOnce();

		const [page] = tab.settingItems as SettingDefinitionPage[];
		const row = renderRow(page, "my-script");
		row.textControls[0].setValue("T");
		row.textControls[0].setValue("Ti");
		row.textControls[0].setValue("Tidy");
		await settle();
		row.toggleControls[0].setValue(true);
		await settle();
		row.toggleControls[0].setValue(false);
		await settle();

		expect(update).toHaveBeenCalledOnce();
		expect(tab._updateCalls).toBe(1);
	});
});
