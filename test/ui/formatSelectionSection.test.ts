/**
 * Spec 010 T3.1 — the Format selection settings, as MasonSettingTab defines them.
 *
 * The thirteen step toggles are control rows keyed "formatSelection.<step>".
 * They sit in four sibling groups (Cleanup, Lists, Headings, Footnotes) behind
 * the "Format selection" group that holds the intro row. These tests read the
 * tab's definition tree and drive its getControlValue / setControlValue.
 *
 * HOUSE STYLE: tabs, double quotes, factory test data.
 */

import { describe, it, expect } from "vitest";
import { controls, walk } from "./helpers/definitionTree";
import type { DefinitionNode } from "./helpers/definitionTree";
import { makeTabPlugin } from "./helpers/settingsTabPlugin";
import type { FormatSelectionRecipe } from "../../src/core/formatSelection";
import type { MasonSettings } from "../../src/core/types";

const { MasonSettingTab } = await import("../../src/ui/settingsTab");

type Step = keyof FormatSelectionRecipe;

/** Every step, in the order the tab lists them, under the heading it is listed under. */
const STEPS_BY_GROUP: ReadonlyArray<readonly [string, readonly Step[]]> = [
	["Cleanup", ["boxTable", "reflow", "dewrap", "dehyphenate", "decomposeLigatures", "tidyWhitespace"]],
	["Lists", ["normalizeBullets", "normalizeOrdered"]],
	["Headings", ["cascade", "normalize"]],
	["Footnotes", ["fromCitations", "identity", "move"]],
];

const ALL_STEPS: readonly Step[] = STEPS_BY_GROUP.flatMap(([, steps]) => steps);

/** The steps "Paste and format" skips; their rows say so. */
const FORMAT_SELECTION_ONLY_STEPS: readonly Step[] = ["cascade", "fromCitations", "identity", "move"];

const MARKER = '"Format selection" only — not applied by "Paste and format"';

const keyOf = (step: Step): string => `formatSelection.${step}`;

function makeTab(formatSelection?: MasonSettings["formatSelection"]) {
	const { plugin } = makeTabPlugin({ settings: { formatSelection } });
	const tab = new MasonSettingTab(plugin.app as never, plugin as never);
	return { tab, plugin };
}

function stepRows(tab: InstanceType<typeof MasonSettingTab>): DefinitionNode[] {
	return controls(walk(tab.getSettingDefinitions())).filter((row) => row.key?.startsWith("formatSelection."));
}

function rowOf(tab: InstanceType<typeof MasonSettingTab>, step: Step): DefinitionNode {
	const row = stepRows(tab).find((candidate) => candidate.key === keyOf(step));
	if (row === undefined) throw new Error(`no control row for ${keyOf(step)}`);
	return row;
}

// ---------------------------------------------------------------------------
// LAYOUT
// ---------------------------------------------------------------------------

describe("Format selection — layout", () => {
	it("puts the Format selection groups after the Commands page and before Advanced", () => {
		const { tab } = makeTab();
		const topLevel = walk(tab.getSettingDefinitions())
			.filter((node) => node.path.length === 0 && (node.type === "page" || node.type === "group"))
			.map((node) => node.name);
		expect(topLevel).toEqual([
			"Scripts", "Commands", "Format selection", "Cleanup", "Lists", "Headings", "Footnotes", "Advanced",
		]);
	});

	it("has exactly 13 step controls, all toggles", () => {
		const { tab } = makeTab();
		const rows = stepRows(tab);
		expect(rows).toHaveLength(13);
		for (const row of rows) {
			expect("control" in row.definition && row.definition.control?.type).toBe("toggle");
		}
	});

	it("lists the steps under Cleanup, Lists, Headings and Footnotes, in order", () => {
		const { tab } = makeTab();
		const listed = stepRows(tab).map((row) => [row.path.join("/"), row.key]);
		const expected = STEPS_BY_GROUP.flatMap(([heading, steps]) => steps.map((step) => [heading, keyOf(step)]));
		expect(listed).toEqual(expected);
	});

	it("names every step row in sentence case", () => {
		const { tab } = makeTab();
		const titleCasePattern = /^.+\s+[A-Z][a-z]/;
		for (const row of stepRows(tab)) {
			expect(row.name ?? "", `"${row.name ?? ""}" looks like Title Case`).not.toMatch(titleCasePattern);
		}
	});

	it("introduces the section with a row naming both commands", () => {
		const { tab } = makeTab();
		const intro = walk(tab.getSettingDefinitions()).filter((node) => node.path.join("/") === "Format selection");
		expect(intro).toHaveLength(1);
		expect(intro[0]!.type).toBe("empty");
		expect(intro[0]!.desc).toContain("Format selection");
		expect(intro[0]!.desc).toContain("Paste and format");
	});
});

// ---------------------------------------------------------------------------
// "FORMAT SELECTION ONLY" MARKERS
// ---------------------------------------------------------------------------

describe("Format selection — Paste-and-format markers", () => {
	it.each(FORMAT_SELECTION_ONLY_STEPS)("marks %s as Format selection only, behind the info icon", (step) => {
		const { tab } = makeTab();
		expect(rowOf(tab, step).desc).toContain(`ℹ️ ${MARKER}`);
	});

	it("marks no other step", () => {
		const { tab } = makeTab();
		const marked = stepRows(tab).filter((row) => row.desc?.includes(MARKER)).map((row) => row.key);
		expect(marked).toEqual(FORMAT_SELECTION_ONLY_STEPS.map(keyOf));
	});
});

// ---------------------------------------------------------------------------
// VALUES
// ---------------------------------------------------------------------------

describe("Format selection — values", () => {
	it("defaults: reflow is off, the other 12 steps are on", () => {
		const { tab } = makeTab(undefined);
		for (const step of ALL_STEPS) {
			expect(tab.getControlValue(keyOf(step)), step).toBe(step !== "reflow");
		}
	});

	it("reflects a step explicitly switched off, leaving the others at their defaults", () => {
		const { tab } = makeTab({ dewrap: false });
		expect(tab.getControlValue(keyOf("dewrap"))).toBe(false);
		expect(tab.getControlValue(keyOf("dehyphenate"))).toBe(true);
		expect(tab.getControlValue(keyOf("reflow"))).toBe(false);
	});

	it("reflects stored values for all 13 steps", () => {
		const inverted = Object.fromEntries(ALL_STEPS.map((step) => [step, step === "reflow"])) as unknown as FormatSelectionRecipe;
		const { tab } = makeTab(inverted);
		for (const step of ALL_STEPS) {
			expect(tab.getControlValue(keyOf(step)), step).toBe(step === "reflow");
		}
	});
});

// ---------------------------------------------------------------------------
// WRITE-THROUGH
// ---------------------------------------------------------------------------

describe("Format selection — write-through", () => {
	it.each(ALL_STEPS)("toggling %s updates settings.formatSelection and saves once", async (step) => {
		const { tab, plugin } = makeTab({ normalize: false, tidyWhitespace: false });
		const flipped = tab.getControlValue(keyOf(step)) !== true;

		await tab.setControlValue(keyOf(step), flipped);

		expect(plugin.settings.formatSelection).toEqual({ normalize: false, tidyWhitespace: false, [step]: flipped });
		expect(tab.getControlValue(keyOf(step))).toBe(flipped);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it("creates settings.formatSelection on the first toggle when it is absent", async () => {
		const { tab, plugin } = makeTab(undefined);
		expect(plugin.settings.formatSelection).toBeUndefined();

		await tab.setControlValue(keyOf("dewrap"), false);

		expect(plugin.settings.formatSelection).toEqual({ dewrap: false });
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});
});
