/**
 * Spec 010 T2.3 — the declarative Scripts page.
 *
 * Two seams are pinned here:
 *   1. buildScriptsPage(cache, ops) returns a definition tree: the page entry
 *      with its update indicator, the script list (one row per script, header
 *      buttons, empty state) and the search-only action rows.
 *   2. configureScriptRow(setting, item, ops) fills one row: provenance badge,
 *      status pill and version in the name, toggle, ⋯ menu, Blocked recovery.
 *      The per-state coverage is ported from scriptsTab.test.ts.
 *
 * HOUSE STYLE: tabs, double quotes, factory test data, no let/beforeEach.
 */

import { describe, it, expect, vi } from "vitest";
import type {
	Setting as ObsidianSetting,
	SettingDefinition,
	SettingDefinitionAction,
	SettingDefinitionGroup,
	SettingDefinitionList,
	SettingDefinitionRender,
	SettingGroup as ObsidianSettingGroup,
} from "obsidian";
import { MockHTMLElement, Menu, Setting, SettingGroup, capturedSettings } from "../__mocks__/obsidian";
import { search, walk } from "./helpers/definitionTree";
import type { ScriptRecord } from "../../src/scripts/store";
import type { LifecycleState } from "../../src/scripts/lifecycle";
import type { ScriptItem, LifecycleOps, ScriptsPageState } from "../../src/ui/scriptsPage";

const { SCRIPTS_PAGE_NAME, buildScriptsPage, configureScriptRow } = await import("../../src/ui/scriptsPage");

const EMPTY_TEXT = "No scripts yet. Import one from your vault, or browse the official catalog to get started.";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeRecord(overrides?: Partial<ScriptRecord>): ScriptRecord {
	return {
		provenance: "curated",
		enabled: true,
		okayed: { version: 1, checksum: "sha256:abc" },
		source: "scripts/perplexity-app.cjs",
		command: false,
		...overrides,
	};
}

function makeItem(overrides?: Partial<ScriptItem>): ScriptItem {
	return {
		id: "perplexity-app",
		displayName: "Perplexity app",
		description: "Formats Perplexity desktop-app copies into footnotes.",
		record: makeRecord(),
		state: { kind: "Active" },
		version: 1,
		provenance: "curated",
		catalogVersion: 1,
		...overrides,
	};
}

/** Fully-stubbed LifecycleOps — every method is a vi.fn so calls are observable. */
function makeOps(overrides?: Partial<LifecycleOps>): LifecycleOps {
	return {
		enable: vi.fn().mockResolvedValue(undefined),
		disable: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
		retry: vi.fn().mockResolvedValue(undefined),
		update: vi.fn().mockResolvedValue(undefined),
		reReview: vi.fn().mockResolvedValue(undefined),
		viewSource: vi.fn().mockResolvedValue(undefined),
		importFromVault: vi.fn().mockResolvedValue(undefined),
		browseOfficial: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

function makeCache(items: ScriptItem[] | null, updatableCount = 0): ScriptsPageState {
	return { items, updatableCount };
}

// ---------------------------------------------------------------------------
// Definition-tree helpers
// ---------------------------------------------------------------------------

function listOf(page: ReturnType<typeof buildScriptsPage>): SettingDefinitionList {
	const list = (page.items ?? []).find((item): item is SettingDefinitionList => "type" in item && item.type === "list");
	expect(list).toBeDefined();
	return list!;
}

function rowsOf(list: SettingDefinitionList): SettingDefinitionRender[] {
	return (list.items ?? []) as SettingDefinitionRender[];
}

/** The action rows of the group that follows the list. */
function actionRowsOf(page: ReturnType<typeof buildScriptsPage>): SettingDefinitionAction[] {
	const groups = (page.items ?? []).filter(
		(item): item is SettingDefinitionGroup => "type" in item && item.type === "group",
	);
	expect(groups).toHaveLength(1);
	return (groups[0]!.items ?? []) as SettingDefinitionAction[];
}

type HeaderButton = SettingGroup["_extraButtonControls"][number];

/** Wire the list's one header button the way Obsidian does when it creates the group. */
function wireHeaderButton(list: SettingDefinitionList): HeaderButton {
	expect(list.extraButtons).toHaveLength(1);
	const group = new SettingGroup(null);
	group.addExtraButton(list.extraButtons![0] as unknown as Parameters<SettingGroup["addExtraButton"]>[0]);
	return group._extraButtonControls[0]!;
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

type SettingRecord = ReturnType<typeof capturedSettings>[number];

interface BuiltRow {
	setting: Setting;
	record: SettingRecord;
	ops: LifecycleOps;
}

/** A mock Setting pre-filled the way Obsidian fills a render row, plus its capture record. */
function makeSetting(name: string, desc: string): { setting: Setting; record: SettingRecord } {
	const setting = new Setting(null).setName(name).setDesc(desc);
	return { setting, record: capturedSettings().at(-1)! };
}

function configureRow(item: ScriptItem, ops: LifecycleOps = makeOps()): BuiltRow {
	const { setting, record } = makeSetting(item.displayName, item.description);
	configureScriptRow(setting as unknown as ObsidianSetting, item, ops);
	return { setting, record, ops };
}

/** Direct children of a mock element (its child list is private). */
function childrenOf(el: MockHTMLElement): MockHTMLElement[] {
	return (el as unknown as { _children: MockHTMLElement[] })._children;
}

function childWithClass(el: MockHTMLElement, cls: string): MockHTMLElement | undefined {
	return childrenOf(el).find((child) => child._hasClass(cls));
}

/** The blocked-reason element a Blocked row appends below its description. */
function blockedReasonOf(setting: Setting): MockHTMLElement | undefined {
	return childWithClass(setting.descEl, "mason-script-blocked-reason");
}

// The row opens `new Menu()` from its ⋯ button and positions it with
// showAtPosition. Capture the last shown instance and where it was shown.
const shown: { menu?: Menu; position?: unknown } = {};
const originalShowAtPosition = Menu.prototype.showAtPosition;
Menu.prototype.showAtPosition = function (this: Menu, position: unknown): void {
	shown.menu = this;
	shown.position = position;
	originalShowAtPosition.call(this, position);
};

/** Click the row's ⋯ button and return the Menu that click produced. */
async function openRowMenu(row: BuiltRow): Promise<Menu> {
	expect(row.record.extraButtonControls).toHaveLength(1);
	await row.record.extraButtonControls[0]!._simulateClick();
	return shown.menu!;
}

// ---------------------------------------------------------------------------
// PAGE ENTRY — name and update indicator
// ---------------------------------------------------------------------------

describe("Scripts page — entry", () => {
	it("is a page named Scripts", () => {
		const page = buildScriptsPage(makeCache([]), makeOps());
		expect(SCRIPTS_PAGE_NAME).toBe("Scripts");
		expect(page.type).toBe("page");
		expect(page.name).toBe(SCRIPTS_PAGE_NAME);
	});

	it("carries no id on the page or on anything inside it (deviation D-1)", () => {
		const page = buildScriptsPage(makeCache([makeItem()]), makeOps());
		for (const entry of walk([page])) {
			expect(entry.definition, `${entry.type} "${entry.name ?? ""}"`).not.toHaveProperty("id");
		}
	});

	it("shows no indicator while no update is waiting", () => {
		const page = buildScriptsPage(makeCache([makeItem()], 0), makeOps());
		expect((page.displayValue as () => string)()).toBe("");
		expect((page.status as () => "warning" | null)()).toBeNull();
	});

	it("shows '1 update available' and a warning for one update", () => {
		const page = buildScriptsPage(makeCache([makeItem()], 1), makeOps());
		expect((page.displayValue as () => string)()).toBe("1 update available");
		expect((page.status as () => "warning" | null)()).toBe("warning");
	});

	it("shows 'N updates available' for several updates", () => {
		const page = buildScriptsPage(makeCache([makeItem()], 3), makeOps());
		expect((page.displayValue as () => string)()).toBe("3 updates available");
		expect((page.status as () => "warning" | null)()).toBe("warning");
	});

	it("reads the count when the indicator is evaluated, not when the page is built", () => {
		const cache = makeCache([makeItem()], 0);
		const page = buildScriptsPage(cache, makeOps());
		cache.updatableCount = 2;
		expect((page.displayValue as () => string)()).toBe("2 updates available");
		expect((page.status as () => "warning" | null)()).toBe("warning");
	});
});

// ---------------------------------------------------------------------------
// LIST — rows, empty state, header buttons
// ---------------------------------------------------------------------------

describe("Scripts page — list", () => {
	it("has one row per script in store order", () => {
		const items = [
			makeItem({ id: "b", displayName: "Script b" }),
			makeItem({ id: "a", displayName: "Script a" }),
			makeItem({ id: "c", displayName: "Script c" }),
		];
		const rows = rowsOf(listOf(buildScriptsPage(makeCache(items), makeOps())));
		expect(rows.map((row) => row.name)).toEqual(["Script b", "Script a", "Script c"]);
	});

	it("names a row after the display name, describes it, and makes the id an alias", () => {
		const [row] = rowsOf(listOf(buildScriptsPage(makeCache([makeItem()]), makeOps())));
		expect(row!.name).toBe("Perplexity app");
		expect(row!.desc).toBe("Formats Perplexity desktop-app copies into footnotes.");
		expect(row!.aliases).toContain("perplexity-app");
	});

	it("keeps row names unique when two scripts share a display name", () => {
		const items = [
			makeItem({ id: "first", displayName: "Twin" }),
			makeItem({ id: "second", displayName: "Twin" }),
			makeItem({ id: "other", displayName: "Other" }),
		];
		const names = rowsOf(listOf(buildScriptsPage(makeCache(items), makeOps()))).map((row) => row.name);
		expect(names).toEqual(["Twin (first)", "Twin (second)", "Other"]);
	});

	it("a row's render configures the setting for its script", async () => {
		const ops = makeOps();
		const item = makeItem({ id: "x", state: { kind: "Active" } });
		const [row] = rowsOf(listOf(buildScriptsPage(makeCache([item]), ops)));
		const { setting, record } = makeSetting(row!.name, row!.desc as string);

		row!.render(setting as unknown as ObsidianSetting, new SettingGroup(null) as unknown as ObsidianSettingGroup);

		expect(setting.nameEl._collectText()).toContain("Official");
		record.toggleControls[0]!.setValue(false);
		expect(ops.disable).toHaveBeenCalledWith("x");
	});

	it("shows 'Loading scripts…' while the scripts are not loaded yet", () => {
		const list = listOf(buildScriptsPage(makeCache(null), makeOps()));
		expect(list.emptyState).toBe("Loading scripts…");
		expect(list.items).toEqual([]);
	});

	it("shows the invite text when there are no scripts", () => {
		const list = listOf(buildScriptsPage(makeCache([]), makeOps()));
		expect(list.emptyState).toBe(EMPTY_TEXT);
		expect(list.items).toEqual([]);
	});

	it("adds an item through Import from vault", () => {
		const ops = makeOps();
		const list = listOf(buildScriptsPage(makeCache([]), ops));
		expect(list.addItem?.name).toBe("Import from vault");
		list.addItem!.action(new MockHTMLElement("div") as unknown as HTMLElement);
		expect(ops.importFromVault).toHaveBeenCalledTimes(1);
	});

	it("offers Browse official as the one header button", async () => {
		const ops = makeOps();
		const list = listOf(buildScriptsPage(makeCache([]), ops));
		const button = wireHeaderButton(list);
		expect(button._icon).toBe("store");
		expect(button._tooltip).toBe("Browse official");

		await button._simulateClick();
		expect(ops.browseOfficial).toHaveBeenCalledTimes(1);
	});

	it("header buttons read the ops when clicked, not when the page is built", async () => {
		const ops = makeOps();
		const list = listOf(buildScriptsPage(makeCache([]), ops));
		const browseButton = wireHeaderButton(list);

		const laterImport = vi.fn();
		const laterBrowse = vi.fn();
		ops.importFromVault = laterImport;
		ops.browseOfficial = laterBrowse;

		list.addItem!.action(new MockHTMLElement("div") as unknown as HTMLElement);
		await browseButton._simulateClick();
		expect(laterImport).toHaveBeenCalledTimes(1);
		expect(laterBrowse).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// SEARCH-ONLY ACTION ROWS + SEARCH
// ---------------------------------------------------------------------------

describe("Scripts page — action rows and search", () => {
	const SEARCH_ALIASES = ["catalog", "official scripts", "import"];

	it("has Import from vault and Browse official action rows after the list", () => {
		const page = buildScriptsPage(makeCache([makeItem()]), makeOps());
		const kinds = (page.items ?? []).map((item) => ("type" in item ? item.type : "row"));
		expect(kinds).toEqual(["list", "group"]);
		expect(actionRowsOf(page).map((row) => row.name)).toEqual(["Import from vault", "Browse official"]);
	});

	it("the action rows carry the aliases catalog, official scripts and import, each once", () => {
		const page = buildScriptsPage(makeCache([]), makeOps());
		const aliases = actionRowsOf(page).flatMap((row) => row.aliases ?? []);
		expect([...aliases].sort()).toEqual([...SEARCH_ALIASES].sort());
	});

	it("the action rows run their op, read at click time", () => {
		const ops = makeOps();
		const [importRow, browseRow] = actionRowsOf(buildScriptsPage(makeCache([]), ops));
		const laterImport = vi.fn();
		const laterBrowse = vi.fn();
		ops.importFromVault = laterImport;
		ops.browseOfficial = laterBrowse;

		const el = new MockHTMLElement("div") as unknown as HTMLElement;
		importRow!.action(el, 0);
		browseRow!.action(el, 1);
		expect(laterImport).toHaveBeenCalledTimes(1);
		expect(laterBrowse).toHaveBeenCalledTimes(1);
	});

	it("a script's display name finds its row", () => {
		const items = [makeItem(), makeItem({ id: "other", displayName: "Table tidy", description: "Tidies tables." })];
		const page = buildScriptsPage(makeCache(items), makeOps());
		expect(search([page], "perplexity app")).toEqual(["Perplexity app"]);
		expect(search([page], "table tidy")).toEqual(["Table tidy"]);
	});

	it("a script's id finds its row", () => {
		const page = buildScriptsPage(
			makeCache([makeItem({ id: "zq-reflow", displayName: "Slide text", description: "Joins lines." })]),
			makeOps(),
		);
		expect(search([page], "zq-reflow")).toEqual(["Slide text"]);
	});

	it("'catalog' and 'official scripts' find Browse official; 'import' finds Import from vault", () => {
		const page = buildScriptsPage(makeCache([]), makeOps());
		expect(search([page], "catalog")).toEqual(["Browse official"]);
		expect(search([page], "official scripts")).toEqual(["Browse official"]);
		expect(search([page], "import")).toEqual(["Import from vault"]);
	});

	it("uses sentence case for every name in the tree", () => {
		const page = buildScriptsPage(makeCache([]), makeOps());
		const titleCasePattern = /^.+\s+[A-Z][a-z]/;
		for (const entry of walk([page])) {
			expect(entry.name ?? "", `"${entry.name ?? ""}" looks like Title Case`).not.toMatch(titleCasePattern);
		}
	});
});

// ---------------------------------------------------------------------------
// ROW — name line: provenance badge, status pill, version
// ---------------------------------------------------------------------------

describe("Script row — name line", () => {
	it("keeps the name and description Obsidian set from the definition", () => {
		const { setting, record } = configureRow(makeItem());
		expect(record.name).toBe("Perplexity app");
		expect(record.desc).toBe("Formats Perplexity desktop-app copies into footnotes.");
		expect(setting.nameEl._text).toBe("Perplexity app");
	});

	it("shows the curated provenance badge as 'Official'", () => {
		const { setting } = configureRow(makeItem({ provenance: "curated" }));
		expect(childWithClass(setting.nameEl, "mason-script-badge")?._text).toBe("Official");
	});

	it("shows the imported provenance badge as 'Imported'", () => {
		const { setting } = configureRow(
			makeItem({ provenance: "imported", record: makeRecord({ provenance: "imported" }) }),
		);
		expect(childWithClass(setting.nameEl, "mason-script-badge")?._text).toBe("Imported");
	});

	it("shows the version", () => {
		const { setting } = configureRow(makeItem({ version: 3 }));
		expect(childWithClass(setting.nameEl, "mason-script-version")?._text).toBe("v3");
	});

	const pillCases: Array<{ state: LifecycleState; label: string; icon: string; cls: string }> = [
		{ state: { kind: "Active" }, label: "Active", icon: "●", cls: "mason-pill-active" },
		{ state: { kind: "Disabled" }, label: "Disabled", icon: "○", cls: "mason-pill-disabled" },
		{ state: { kind: "UpdateAvailable" }, label: "Update available", icon: "▲", cls: "mason-pill-updateavailable" },
		{ state: { kind: "Available" }, label: "Available", icon: "○", cls: "mason-pill-available" },
		{ state: { kind: "Materializing" }, label: "Materializing", icon: "◌", cls: "mason-pill-materializing" },
		{ state: { kind: "Blocked", reason: "drift" }, label: "Blocked", icon: "■", cls: "mason-pill-blocked" },
		{ state: { kind: "Absent" }, label: "Not installed", icon: "○", cls: "mason-pill-absent" },
	];

	for (const { state, label, icon, cls } of pillCases) {
		it(`shows the "${label}" pill with its icon for ${state.kind}`, () => {
			const { setting } = configureRow(makeItem({ state }));
			const pill = childWithClass(setting.nameEl, "mason-script-pill");
			expect(pill).toBeDefined();
			expect(pill!._hasClass(cls)).toBe(true);
			expect(childWithClass(pill!, "mason-script-pill-icon")?._text).toBe(icon);
			expect(childWithClass(pill!, "mason-script-pill-label")?._text).toBe(label);
		});
	}

	it("orders the name line as badge, pill, version", () => {
		const { setting } = configureRow(makeItem({ state: { kind: "UpdateAvailable" }, version: 2 }));
		expect(setting.nameEl._collectText()).toBe("Perplexity app Official ▲ Update available v2");
	});
});

// ---------------------------------------------------------------------------
// ROW — enable/disable toggle
// ---------------------------------------------------------------------------

describe("Script row — enable/disable toggle", () => {
	it("Active: the toggle is on and turning it off calls ops.disable", () => {
		const { record, ops } = configureRow(makeItem({ id: "x", state: { kind: "Active" } }));
		expect(record.toggleControls).toHaveLength(1);
		expect(record.toggleControls[0]!.getValue()).toBe(true);
		record.toggleControls[0]!.setValue(false);
		expect(ops.disable).toHaveBeenCalledWith("x");
		expect(ops.enable).not.toHaveBeenCalled();
	});

	it("Disabled: the toggle is off and turning it on calls ops.enable", () => {
		const { record, ops } = configureRow(
			makeItem({ id: "y", state: { kind: "Disabled" }, record: makeRecord({ enabled: false }) }),
		);
		expect(record.toggleControls[0]!.getValue()).toBe(false);
		record.toggleControls[0]!.setValue(true);
		expect(ops.enable).toHaveBeenCalledWith("y");
		expect(ops.disable).not.toHaveBeenCalled();
	});

	it("UpdateAvailable: the toggle is on", () => {
		const { record } = configureRow(makeItem({ state: { kind: "UpdateAvailable" } }));
		expect(record.toggleControls[0]!.getValue()).toBe(true);
	});

	it("Available: the toggle is off (offered, not yet enabled)", () => {
		const { record } = configureRow(makeItem({ state: { kind: "Available" } }));
		expect(record.toggleControls[0]!.getValue()).toBe(false);
	});

	it("names the toggle 'Enable {name}' for assistive technology", () => {
		const { record } = configureRow(makeItem({ displayName: "Perplexity app", state: { kind: "Disabled" } }));
		expect(record.toggleControls[0]!._tooltip).toBe("Enable Perplexity app");
	});

	it("same-name scripts get distinct toggle tooltips", () => {
		const items = [
			makeItem({ id: "first", displayName: "Twin", state: { kind: "Disabled" } }),
			makeItem({ id: "second", displayName: "Twin", state: { kind: "Disabled" } }),
			makeItem({ id: "other", displayName: "Other", state: { kind: "Disabled" } }),
		];
		const rows = rowsOf(listOf(buildScriptsPage(makeCache(items), makeOps())));

		const tooltips = rows.map((row) => {
			const { setting, record } = makeSetting(row.name, row.desc as string);
			row.render(setting as unknown as ObsidianSetting, new SettingGroup(null) as unknown as ObsidianSettingGroup);
			return record.toggleControls[0]!._tooltip;
		});

		expect(tooltips).toEqual(["Enable Twin (first)", "Enable Twin (second)", "Enable Other"]);
	});

	it("same-name scripts get distinct ⋯ button tooltips", () => {
		const items = [
			makeItem({ id: "first", displayName: "Twin" }),
			makeItem({ id: "second", displayName: "Twin" }),
			makeItem({ id: "other", displayName: "Other" }),
		];
		const rows = rowsOf(listOf(buildScriptsPage(makeCache(items), makeOps())));

		const tooltips = rows.map((row) => {
			const { setting, record } = makeSetting(row.name, row.desc as string);
			row.render(setting as unknown as ObsidianSetting, new SettingGroup(null) as unknown as ObsidianSettingGroup);
			return record.extraButtonControls[0]!._tooltip;
		});

		expect(tooltips).toEqual([
			"More actions for Twin (first)",
			"More actions for Twin (second)",
			"More actions for Other",
		]);
	});

	it("configuring a row calls no op", () => {
		const { ops } = configureRow(makeItem({ state: { kind: "Active" } }));
		expect(ops.enable).not.toHaveBeenCalled();
		expect(ops.disable).not.toHaveBeenCalled();
	});

	const noToggleStates: LifecycleState[] = [
		{ kind: "Materializing" },
		{ kind: "Blocked", reason: "offline" },
		{ kind: "Absent" },
	];

	for (const state of noToggleStates) {
		it(`${state.kind}: there is no toggle`, () => {
			const { record } = configureRow(makeItem({ state }));
			expect(record.toggleControls).toHaveLength(0);
		});
	}
});

// ---------------------------------------------------------------------------
// ROW — Blocked: human reason + single recovery button
// ---------------------------------------------------------------------------

describe("Script row — Blocked", () => {
	it("source-missing names the missing source and Re-import drives importFromVault", async () => {
		const { setting, record, ops } = configureRow(
			makeItem({
				id: "old",
				provenance: "imported",
				record: makeRecord({ provenance: "imported", source: "scripts/old.cjs" }),
				state: { kind: "Blocked", reason: "source-missing" },
			}),
		);
		expect(blockedReasonOf(setting)?._text).toBe("Vault source not found: scripts/old.cjs");
		expect(record.buttonControls.map((button) => button._text)).toEqual(["Re-import"]);
		await record.buttonControls[0]!._simulateClick();
		expect(ops.importFromVault).toHaveBeenCalledTimes(1);
		expect(ops.retry).not.toHaveBeenCalled();
	});

	const retryCases: Array<{ reason: "drift" | "offline" | "checksum-mismatch"; text: string }> = [
		{ reason: "drift", text: "Script bytes changed since you approved them" },
		{ reason: "offline", text: "Could not reach the catalog (offline)" },
		{ reason: "checksum-mismatch", text: "Fetched bytes did not match the expected checksum" },
	];

	for (const { reason, text } of retryCases) {
		it(`${reason} shows its reason and Retry fetch drives ops.retry`, async () => {
			const { setting, record, ops } = configureRow(makeItem({ id: "blocked", state: { kind: "Blocked", reason } }));
			expect(blockedReasonOf(setting)?._text).toBe(text);
			expect(record.buttonControls.map((button) => button._text)).toEqual(["Retry fetch"]);
			await record.buttonControls[0]!._simulateClick();
			expect(ops.retry).toHaveBeenCalledWith("blocked");
			expect(ops.importFromVault).not.toHaveBeenCalled();
		});
	}

	it("a Blocked row keeps the script description and shows the reason below it", () => {
		const { setting, record } = configureRow(makeItem({ state: { kind: "Blocked", reason: "drift" } }));
		expect(record.desc).toBe("Formats Perplexity desktop-app copies into footnotes.");
		expect(setting.descEl._text).toBe("Formats Perplexity desktop-app copies into footnotes.");
		expect(childrenOf(setting.descEl)).toHaveLength(1);
		expect(setting.descEl._collectText()).toBe(
			"Formats Perplexity desktop-app copies into footnotes. Script bytes changed since you approved them",
		);
	});

	it("a row that is not Blocked keeps its description and has no reason or recovery button", () => {
		const { setting, record } = configureRow(makeItem({ state: { kind: "Active" } }));
		expect(record.desc).toBe("Formats Perplexity desktop-app copies into footnotes.");
		expect(record.buttonControls).toHaveLength(0);
		expect(childrenOf(setting.descEl)).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// ROW — ⋯ menu: only the valid actions per state
// ---------------------------------------------------------------------------

describe("Script row — ⋯ menu", () => {
	async function menuTitlesFor(state: LifecycleState, item?: Partial<ScriptItem>): Promise<string[]> {
		const menu = await openRowMenu(configureRow(makeItem({ state, ...item })));
		return menu._titles();
	}

	it("every row has one ⋯ button with an icon and a tooltip naming the script", () => {
		const { record } = configureRow(makeItem());
		expect(record.extraButtonControls).toHaveLength(1);
		expect(record.extraButtonControls[0]!._icon).toBe("more-horizontal");
		expect(record.extraButtonControls[0]!._tooltip).toBe("More actions for Perplexity app");
	});

	it("opens the menu below the ⋯ button", async () => {
		const row = configureRow(makeItem());
		row.record.extraButtonControls[0]!.extraSettingsEl.getBoundingClientRect = () => ({
			x: 40, y: 70, left: 40, top: 70, right: 60, bottom: 90, width: 20, height: 20,
		});
		const menu = await openRowMenu(row);
		expect(menu._shown).toBe(true);
		expect(shown.position).toEqual({ x: 40, y: 90 });
	});

	it("Active: View source, Re-review consent, Remove", async () => {
		expect(await menuTitlesFor({ kind: "Active" })).toEqual(["View source", "Re-review consent", "Remove"]);
	});

	it("UpdateAvailable: adds 'Update to v{catalogVersion}', which drives ops.update", async () => {
		const row = configureRow(makeItem({ id: "u", state: { kind: "UpdateAvailable" }, catalogVersion: 3 }));
		const menu = await openRowMenu(row);
		expect(menu._titles()).toEqual(["View source", "Update to v3", "Re-review consent", "Remove"]);
		await menu._click("Update to v3");
		expect(row.ops.update).toHaveBeenCalledWith("u");
	});

	it("Blocked: View source, Retry fetch, Remove; Retry fetch drives ops.retry", async () => {
		const row = configureRow(makeItem({ id: "b", state: { kind: "Blocked", reason: "drift" } }));
		const menu = await openRowMenu(row);
		expect(menu._titles()).toEqual(["View source", "Retry fetch", "Remove"]);
		await menu._click("Retry fetch");
		expect(row.ops.retry).toHaveBeenCalledWith("b");
	});

	it("Disabled: Re-review consent only when there is a stored consent", async () => {
		const withConsent = await menuTitlesFor(
			{ kind: "Disabled" },
			{ record: makeRecord({ enabled: false, okayed: { version: 1, checksum: "x" } }) },
		);
		expect(withConsent).toEqual(["View source", "Re-review consent", "Remove"]);

		const withoutConsent = await menuTitlesFor(
			{ kind: "Disabled" },
			{ record: makeRecord({ enabled: false, okayed: null }) },
		);
		expect(withoutConsent).toEqual(["View source", "Remove"]);
	});

	const minimalStates: LifecycleState[] = [{ kind: "Available" }, { kind: "Materializing" }, { kind: "Absent" }];

	for (const state of minimalStates) {
		it(`${state.kind}: View source, Remove`, async () => {
			expect(await menuTitlesFor(state)).toEqual(["View source", "Remove"]);
		});
	}

	it("'View source' drives ops.viewSource and 'Remove' drives ops.remove", async () => {
		const row = configureRow(makeItem({ id: "m", state: { kind: "Active" } }));
		const menu = await openRowMenu(row);
		await menu._click("View source");
		expect(row.ops.viewSource).toHaveBeenCalledWith("m");
		await menu._click("Remove");
		expect(row.ops.remove).toHaveBeenCalledWith("m");
	});

	it("'Re-review consent' drives ops.reReview", async () => {
		const row = configureRow(makeItem({ id: "r", state: { kind: "Active" } }));
		const menu = await openRowMenu(row);
		await menu._click("Re-review consent");
		expect(row.ops.reReview).toHaveBeenCalledWith("r");
	});

	it("menu titles are sentence case", async () => {
		const titles = await menuTitlesFor({ kind: "UpdateAvailable" }, { catalogVersion: 2 });
		const titleCasePattern = /^.+\s+[A-Z][a-z]/;
		for (const title of titles) {
			expect(title, `menu title "${title}" looks like Title Case`).not.toMatch(titleCasePattern);
		}
	});
});

// ---------------------------------------------------------------------------
// HOSTILE DATA — rendered as literal text (business rule 6)
// ---------------------------------------------------------------------------

describe("Scripts page — hostile script data", () => {
	const HOSTILE_ID = "<img src=x onerror=alert(1)>";
	const HOSTILE_SOURCE = "<script>alert('source')</script>.cjs";
	const HOSTILE_DESC = "<b onmouseover=alert(2)>desc</b>";

	const hostileItem = (state: LifecycleState): ScriptItem =>
		makeItem({
			id: HOSTILE_ID,
			displayName: HOSTILE_ID,
			description: HOSTILE_DESC,
			record: makeRecord({ provenance: "imported", source: HOSTILE_SOURCE }),
			provenance: "imported",
			state,
		});

	it("the definition carries id and description as plain strings", () => {
		const [row] = rowsOf(listOf(buildScriptsPage(makeCache([hostileItem({ kind: "Active" })]), makeOps())));
		const definition: SettingDefinition = row!;
		expect(definition.name).toBe(HOSTILE_ID);
		expect(definition.desc).toBe(HOSTILE_DESC);
		expect(definition.aliases).toEqual([HOSTILE_ID]);
	});

	it("the row shows a hostile name, description and source as literal text, with no markup elements", () => {
		const { setting, record } = configureRow(hostileItem({ kind: "Blocked", reason: "source-missing" }));
		expect(setting.nameEl._text).toBe(HOSTILE_ID);
		expect(setting.descEl._text).toBe(HOSTILE_DESC);
		expect(blockedReasonOf(setting)?._text).toBe(`Vault source not found: ${HOSTILE_SOURCE}`);
		expect(record.extraButtonControls[0]!._tooltip).toBe(`More actions for ${HOSTILE_ID}`);

		const tags = (el: MockHTMLElement): string[] => childrenOf(el).flatMap((child) => [child.tagName, ...tags(child)]);
		expect(tags(setting.settingEl).every((tag) => tag === "div" || tag === "span")).toBe(true);
	});

	it("the toggle's accessible name carries a hostile name as literal text", () => {
		const { record } = configureRow(hostileItem({ kind: "Active" }));
		expect(record.toggleControls[0]!._tooltip).toBe(`Enable ${HOSTILE_ID}`);
	});
});
