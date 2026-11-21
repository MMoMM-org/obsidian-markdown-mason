/**
 * Spec 010 T1.1 — self-tests for the declarative settings API test harness.
 *
 * The harness is what every later spec-010 test stands on, so its contracts are
 * pinned here:
 *   1. Mock PluginSettingTab mirrors the 1.13 lifecycle (update / refreshDomState /
 *      hide) and its base getControlValue / setControlValue THROW (SDD ADR-5), so a
 *      tab that forgets to override them fails loudly instead of silently taking
 *      the data-losing base path.
 *   2. Mock Setting exposes the row elements and the extra-button / disabled /
 *      tooltip builders that render rows use.
 *   3. A SettingGroup stub is constructible (second argument of a render callback).
 *   4. walk() flattens a definition tree in render order.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { SettingDefinitionItem } from "obsidian";
import {
	App,
	MockHTMLElement,
	PluginSettingTab,
	Setting,
	SettingGroup,
	capturedSettings,
	clearCapturedSettings,
} from "../__mocks__/obsidian";
import { controls, walk } from "./helpers/definitionTree";

const noop = (): void => {};

/**
 * The public 1.13.1 typings do not declare `id` on definitions, although the
 * runtime uses it as the first diff key. Attach it without tripping the
 * excess-property check.
 */
function withId<T extends SettingDefinitionItem>(id: string, item: T): T {
	return Object.assign(item, { id });
}

// ---------------------------------------------------------------------------
// PluginSettingTab
// ---------------------------------------------------------------------------

class DeclarativeTab extends PluginSettingTab {
	definitions: SettingDefinitionItem[] = [{ name: "First" }];

	override getSettingDefinitions(): SettingDefinitionItem[] {
		return this.definitions;
	}
}

describe("mock PluginSettingTab (declarative API)", () => {
	it("starts with no setting items and no recorded update", () => {
		const tab = new DeclarativeTab(new App(), {});
		expect(tab.settingItems).toEqual([]);
		expect(tab._updateCalls).toBe(0);
	});

	it("update() stores the result of getSettingDefinitions() and counts calls", () => {
		const tab = new DeclarativeTab(new App(), {});

		tab.update();
		expect(tab.settingItems).toBe(tab.definitions);
		expect(tab._updateCalls).toBe(1);

		tab.definitions = [{ name: "Second" }];
		tab.update();
		expect(tab.settingItems).toEqual([{ name: "Second" }]);
		expect(tab._updateCalls).toBe(2);
	});

	it("base getSettingDefinitions() returns an empty tree", () => {
		const tab = new PluginSettingTab(new App(), {});
		tab.update();
		expect(tab.settingItems).toEqual([]);
	});

	it("refreshDomState() exists and counts calls", () => {
		const tab = new DeclarativeTab(new App(), {});
		tab.refreshDomState();
		tab.refreshDomState();
		expect(tab._refreshDomStateCalls).toBe(2);
	});

	it("hide() exists and is callable", () => {
		const tab = new DeclarativeTab(new App(), {});
		expect(() => tab.hide()).not.toThrow();
	});

	it("base getControlValue() throws, naming the key", () => {
		const tab = new DeclarativeTab(new App(), {});
		expect(() => tab.getControlValue("numericOnly")).toThrow(/getControlValue.*numericOnly/);
	});

	it("base setControlValue() throws, naming the key", () => {
		const tab = new DeclarativeTab(new App(), {});
		expect(() => tab.setControlValue("numericOnly", true)).toThrow(/setControlValue.*numericOnly/);
	});

	it("an overriding tab does not hit the throwing base", async () => {
		const stored = new Map<string, unknown>();
		class StoringTab extends PluginSettingTab {
			override getControlValue(key: string): unknown {
				return stored.get(key);
			}
			override async setControlValue(key: string, value: unknown): Promise<void> {
				stored.set(key, value);
			}
		}
		const tab = new StoringTab(new App(), {});
		await tab.setControlValue("numericOnly", true);
		expect(tab.getControlValue("numericOnly")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Setting
// ---------------------------------------------------------------------------

describe("mock Setting (render-row surface)", () => {
	beforeEach(() => {
		clearCapturedSettings();
	});

	it("exposes settingEl, nameEl, descEl and controlEl as elements", () => {
		const setting = new Setting(new MockHTMLElement("div"));
		expect(setting.settingEl).toBeInstanceOf(MockHTMLElement);
		expect(setting.nameEl).toBeInstanceOf(MockHTMLElement);
		expect(setting.descEl).toBeInstanceOf(MockHTMLElement);
		expect(setting.controlEl).toBeInstanceOf(MockHTMLElement);
	});

	it("setName / setDesc write through to nameEl / descEl and keep the capture", () => {
		const setting = new Setting(new MockHTMLElement("div")).setName("Reflow").setDesc("Joins hard wraps.");
		expect(setting.nameEl._text).toBe("Reflow");
		expect(setting.descEl._text).toBe("Joins hard wraps.");
		expect(capturedSettings()[0]).toMatchObject({ name: "Reflow", desc: "Joins hard wraps." });
	});

	it("spans appended to nameEl are readable from the row", () => {
		const setting = new Setting(new MockHTMLElement("div")).setName("My script");
		setting.nameEl.createSpan({ cls: "mason-pill", text: "Active" });
		expect(setting.nameEl._collectText()).toBe("My script Active");
		expect(setting.settingEl._collectText()).toContain("Active");
	});

	it("addExtraButton() hands out a chainable button with icon, tooltip, click and element", async () => {
		let clicks = 0;
		const setting = new Setting(new MockHTMLElement("div"));

		const returned = setting.addExtraButton(button => {
			const chained = button
				.setIcon("more-horizontal")
				.setTooltip("More actions")
				.onClick(() => {
					clicks += 1;
				});
			expect(chained).toBe(button);
		});

		expect(returned).toBe(setting);
		const [button] = capturedSettings()[0]?.extraButtonControls ?? [];
		expect(button?._icon).toBe("more-horizontal");
		expect(button?._tooltip).toBe("More actions");
		expect(button?.extraSettingsEl).toBeInstanceOf(MockHTMLElement);
		expect(button?.extraSettingsEl.getBoundingClientRect()).toMatchObject({ left: 0, bottom: 0 });

		await button?._simulateClick();
		expect(clicks).toBe(1);
	});

	it("an extra button can be disabled", () => {
		const setting = new Setting(new MockHTMLElement("div"));
		setting.addExtraButton(button => button.setDisabled(true));
		expect(capturedSettings()[0]?.extraButtonControls[0]?._disabled).toBe(true);
	});

	it("setDisabled() and setTooltip() are chainable and captured", () => {
		const setting = new Setting(new MockHTMLElement("div"));
		expect(setting.setDisabled(true).setTooltip("Not available offline")).toBe(setting);
		expect(capturedSettings()[0]).toMatchObject({ disabled: true, tooltip: "Not available offline" });
	});

	it("a fresh Setting is enabled, has no tooltip and no extra buttons", () => {
		new Setting(new MockHTMLElement("div"));
		expect(capturedSettings()[0]).toMatchObject({ disabled: false, tooltip: "", extraButtonControls: [] });
	});
});

// ---------------------------------------------------------------------------
// SettingGroup
// ---------------------------------------------------------------------------

describe("mock SettingGroup stub", () => {
	beforeEach(() => {
		clearCapturedSettings();
	});

	it("is constructible and exposes listEl", () => {
		const group = new SettingGroup(new MockHTMLElement("div"));
		expect(group.listEl).toBeInstanceOf(MockHTMLElement);
	});

	it("builder methods are chainable; addSetting() yields a captured Setting", () => {
		const group = new SettingGroup(new MockHTMLElement("div"));
		const returned = group
			.setHeading("Cleanup")
			.addClass("mason-group")
			.addExtraButton(button => button.setIcon("store"))
			.addSetting(setting => setting.setName("Reflow"));

		expect(returned).toBe(group);
		expect(group._heading).toBe("Cleanup");
		expect(capturedSettings().map(s => s.name)).toEqual(["Reflow"]);
	});
});

// ---------------------------------------------------------------------------
// walk()
// ---------------------------------------------------------------------------

/** One tree that uses every definition kind in the SDD (Application Data Models). */
function sampleTree(): SettingDefinitionItem[] {
	return [
		{
			name: "Resources section heading",
			desc: "Heading text.",
			control: { type: "text", key: "resourcesName", placeholder: "Resources" },
		},
		{ name: "Numeric-only footnotes", control: { type: "toggle", key: "numericOnly" } },
		withId("scripts", {
			type: "page",
			name: "Scripts",
			desc: "Manage scripts.",
			items: [
				{
					type: "list",
					heading: "Installed",
					emptyState: "No scripts yet.",
					addItem: { name: "Import from vault", action: noop },
					items: [
						withId("script:alpha", {
							name: "Alpha",
							desc: "First script.",
							aliases: ["alpha"],
							render: noop,
						}),
					],
				},
				{
					type: "group",
					items: [{ name: "Browse official", aliases: ["catalog"], action: noop }],
				},
			],
		}),
		{
			type: "group",
			heading: "Format selection",
			items: [{ name: "Which steps run", aliases: ["paste"] }],
		},
		{
			type: "group",
			heading: "Advanced",
			items: [
				{ name: "Debug logging", control: { type: "toggle", key: "debugLogging" } },
				{ type: "page", name: "Nested", items: [{ name: "Deep" }] },
			],
		},
	];
}

describe("walk()", () => {
	it("returns an empty list for an empty tree", () => {
		expect(walk([])).toEqual([]);
	});

	it("flattens depth-first in render order, containers before their children", () => {
		expect(walk(sampleTree()).map(node => [node.type, node.name])).toEqual([
			["control", "Resources section heading"],
			["control", "Numeric-only footnotes"],
			["page", "Scripts"],
			["list", "Installed"],
			["render", "Alpha"],
			["group", undefined],
			["action", "Browse official"],
			["group", "Format selection"],
			["empty", "Which steps run"],
			["group", "Advanced"],
			["control", "Debug logging"],
			["page", "Nested"],
			["empty", "Deep"],
		]);
	});

	it("records ancestor page names and group/list headings as the path", () => {
		const pathOf = Object.fromEntries(walk(sampleTree()).map(node => [node.name ?? "(untitled group)", node.path]));
		expect(pathOf).toMatchObject({
			"Resources section heading": [],
			"Scripts": [],
			"Installed": ["Scripts"],
			"Alpha": ["Scripts", "Installed"],
			"(untitled group)": ["Scripts"],
			"Browse official": ["Scripts"],
			"Format selection": [],
			"Which steps run": ["Format selection"],
			"Nested": ["Advanced"],
			"Deep": ["Advanced", "Nested"],
		});
	});

	it("carries id, key, desc and aliases", () => {
		const flat = walk(sampleTree());
		const named = (name: string) => flat.find(node => node.name === name);

		expect(named("Resources section heading")).toMatchObject({ key: "resourcesName", desc: "Heading text." });
		expect(named("Scripts")).toMatchObject({ id: "scripts", desc: "Manage scripts." });
		expect(named("Alpha")).toMatchObject({ id: "script:alpha", desc: "First script.", aliases: ["alpha"] });
		expect(named("Which steps run")).toMatchObject({ aliases: ["paste"] });
	});

	it("omits fields a definition does not have", () => {
		const [node] = walk([{ name: "Plain" }]);
		expect(node).toEqual({ path: [], type: "empty", name: "Plain", definition: { name: "Plain" } });
	});

	it("exposes the source definition so a test can invoke its callbacks", () => {
		const tree = sampleTree();
		expect(walk(tree)[0]?.definition).toBe(tree[0]);
	});

	it("reads a DocumentFragment description as its text content", () => {
		const fragment = { textContent: "See the documentation." } as DocumentFragment;
		expect(walk([{ name: "Documentation", desc: fragment, action: noop }])[0]?.desc).toBe("See the documentation.");
	});

	it("tolerates containers without items", () => {
		expect(walk([{ type: "group", heading: "Empty" }, { type: "page", name: "Blank" }]).map(n => n.type)).toEqual([
			"group",
			"page",
		]);
	});

	it("reads naturally in the SDD's bare-items assertion", () => {
		const flat = walk(sampleTree());
		expect(flat.slice(0, 3).map(r => r.name)).toEqual([
			"Resources section heading",
			"Numeric-only footnotes",
			"Scripts",
		]);
		expect(flat.slice(0, 3).every(r => r.path.length === 0)).toBe(true);
	});

	it("controls() keeps only control rows, in order", () => {
		expect(controls(walk(sampleTree())).map(node => node.key)).toEqual([
			"resourcesName",
			"numericOnly",
			"debugLogging",
		]);
	});
});
