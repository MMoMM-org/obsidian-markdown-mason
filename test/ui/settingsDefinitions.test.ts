/**
 * Spec 010 T1.4 — settingsDefinitions unit tests.
 *
 * FIXED_SETTINGS is the single source of truth for the 18 fixed settings;
 * buildMainPageItems() arranges them into the main settings page around the
 * injected Scripts page, Commands page and Documentation row (SDD ADR-2).
 *
 * The expected strings below are deliberately spelled out: they pin today's
 * wording, so a silent rewording of a setting fails here.
 *
 * HOUSE STYLE: tabs, double quotes, no default exports.
 */

import { describe, it, expect } from "vitest";
import type { PluginManifest, SettingDefinitionItem, SettingDefinitionPage } from "obsidian";
import {
	FIXED_SETTINGS,
	FORMAT_SELECTION_INTRO,
	FORMAT_SELECTION_ONLY,
	buildMainPageItems,
} from "../../src/ui/settingsDefinitions";
import { FIXED_KEYS, type FixedKey } from "../../src/ui/settingsControlStore";
import { buildDocumentationRow } from "../../src/ui/pluginIdentity";
import { controls, walk, type DefinitionNode } from "./helpers/definitionTree";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MANIFEST: PluginManifest = {
	id: "markdown-mason",
	name: "Markdown Mason",
	version: "1.2.3",
	minAppVersion: "1.13.1",
	description: "Test description.",
	author: "Marcus Breiden",
	isDesktopOnly: true,
};

const SCRIPTS_PAGE: SettingDefinitionPage = { type: "page", name: "Scripts", items: [] };
const COMMANDS_PAGE: SettingDefinitionPage = { type: "page", name: "Commands", items: [] };

function buildTree(): SettingDefinitionItem<FixedKey>[] {
	return buildMainPageItems({
		scriptsPage: SCRIPTS_PAGE,
		commandsPage: COMMANDS_PAGE,
		identityRow: buildDocumentationRow(MANIFEST, () => {}),
	});
}

function flatTree(): DefinitionNode[] {
	return walk(buildTree());
}

const SUFFIX = ' ℹ️ "Format selection" only — not applied by "Paste and format".';

const INTRO_DESC =
	'Choose which steps run. "Format selection" runs all of these; "Paste and format" runs the cleanup, lists, and the Normalize headings step only.';

interface ExpectedControl {
	key: FixedKey;
	group: string | undefined;
	name: string;
	desc: string;
}

/** Today's 18 fixed settings, in render order, worded exactly as the settings tab shows them. */
const EXPECTED_CONTROLS: ExpectedControl[] = [
	{
		key: "resourcesName",
		group: undefined,
		name: "Resources section heading",
		desc: "Heading where Tidy footnotes collects footnote definitions. Set the level with leading #'s — e.g. ### Resources for a level-3 section. An existing section with this name is reused at its current level.",
	},
	{
		key: "showUpdateSplash",
		group: undefined,
		name: "Show update notes",
		desc: "Show a summary of waiting script updates the first time you run a new version of Markdown Mason.",
	},
	{
		key: "numericOnly",
		group: undefined,
		name: "Numeric-only footnotes",
		desc: "Process only numeric footnote references (e.g. [^1]). Alpha markers such as [^A] are excluded. Note: disabling this is a planned feature — the setting persists but alpha-marker support is not yet wired into the core.",
	},
	{
		key: "pasteListContext",
		group: undefined,
		name: "Fit paste to list context",
		desc: "When pasting inside a list item, turn each pasted paragraph into its own item, drop the blank lines between them, and nest a pasted sub-list under the item that introduces it. Has no effect outside a list.",
	},
	{
		key: "formatSelection.boxTable",
		group: "Cleanup",
		name: "Convert box-drawing table",
		desc: "Turn terminal/CLI tables drawn with box characters (┌─┬─┐ … │ … or ASCII +--+) into proper Markdown tables. On by default; detection is unambiguous and runs before reflow and dewrap.",
	},
	{
		key: "formatSelection.reflow",
		group: "Cleanup",
		name: "Reflow wrapped text",
		desc: "Rebuild hard-wrapped OCR/slide captures (no blank lines between blocks) into paragraphs and bullet lists, keeping any sub-bullet nesting. Off by default; enable for screen-capture text. Runs before dehyphenate and dewrap.",
	},
	{
		key: "formatSelection.dewrap",
		group: "Cleanup",
		name: "Dewrap paragraphs",
		desc: "Re-join hard-wrapped lines into full paragraphs, skipping code, headings, lists, blockquotes, and tables.",
	},
	{
		key: "formatSelection.dehyphenate",
		group: "Cleanup",
		name: "Dehyphenate words",
		desc: "Remove end-of-line hyphens that split words across lines (OCR and PDF artifacts), for lowercase-to-lowercase splits only. Runs before dewrap.",
	},
	{
		key: "formatSelection.decomposeLigatures",
		group: "Cleanup",
		name: "Decompose ligatures and punctuation",
		desc: "Replace Unicode ligature glyphs (ﬁ, æ, œ…) and typographic punctuation (curly quotes, em dash, ellipsis) with plain ASCII equivalents.",
	},
	{
		key: "formatSelection.tidyWhitespace",
		group: "Cleanup",
		name: "Tidy whitespace",
		desc: "Collapse double spaces, remove trailing whitespace, and squeeze three or more blank lines to one.",
	},
	{
		key: "formatSelection.normalizeBullets",
		group: "Lists",
		name: "Normalize bullets",
		desc: "Replace all unordered bullet markers (*, +, •, –, ·) with a canonical dash (-), preserving nesting and checkbox syntax.",
	},
	{
		key: "formatSelection.normalizeOrdered",
		group: "Lists",
		name: "Normalize ordered list",
		desc: "Renumber ordered lists sequentially (1. 2. 3.) per nesting level.",
	},
	{
		key: "formatSelection.cascade",
		group: "Headings",
		name: "Cascade headings",
		desc: "Promote or demote headings to maintain a consistent hierarchy." + SUFFIX,
	},
	{
		key: "formatSelection.normalize",
		group: "Headings",
		name: "Normalize headings",
		desc: "Standardize heading levels throughout the selection.",
	},
	{
		key: "formatSelection.fromCitations",
		group: "Footnotes",
		name: "Convert citations to footnotes",
		desc: "Rewrite inline citation markers as numbered footnote references." + SUFFIX,
	},
	{
		key: "formatSelection.identity",
		group: "Footnotes",
		name: "Resolve footnote identity",
		desc: "Renumber footnote references to remove gaps and duplicates." + SUFFIX,
	},
	{
		key: "formatSelection.move",
		group: "Footnotes",
		name: "Move footnotes to resources",
		desc: "Move footnote definitions into your Resources section." + SUFFIX,
	},
	{
		key: "debugLogging",
		group: "Advanced",
		name: "Debug logging",
		desc: "Write verbose Mason traces to the developer console. Takes effect immediately.",
	},
];

// ---------------------------------------------------------------------------
// FIXED_SETTINGS — the single source of truth
// ---------------------------------------------------------------------------

describe("FIXED_SETTINGS", () => {
	it("holds exactly one spec per fixed key", () => {
		expect(FIXED_SETTINGS).toHaveLength(18);
		expect(FIXED_SETTINGS.map((spec) => spec.key).sort()).toEqual([...FIXED_KEYS].sort());
	});

	it("carries today's name and desc for every setting, in render order", () => {
		expect(FIXED_SETTINGS.map(({ key, name, desc }) => ({ key, name, desc }))).toEqual(
			EXPECTED_CONTROLS.map(({ key, name, desc }) => ({ key, name, desc })),
		);
	});

	it("exposes the 'Format selection only' suffix that the affected descs end with", () => {
		expect(FORMAT_SELECTION_ONLY).toBe(SUFFIX);
	});

	it("exposes the Format selection intro row", () => {
		expect(FORMAT_SELECTION_INTRO).toEqual({
			name: "Which steps run",
			desc: INTRO_DESC,
			aliases: ["paste", "paste and format"],
		});
	});
});

// ---------------------------------------------------------------------------
// buildMainPageItems — controls
// ---------------------------------------------------------------------------

describe("buildMainPageItems — controls", () => {
	it("is never empty", () => {
		expect(buildTree().length).toBeGreaterThan(0);
	});

	it("yields exactly 18 controls with today's names and descs, each bound to its key", () => {
		const rows = controls(flatTree());
		expect(rows.map(({ key, name, desc }) => ({ key, name, desc }))).toEqual(
			EXPECTED_CONTROLS.map(({ key, name, desc }) => ({ key, name, desc })),
		);
	});

	it("renders resourcesName as a text control with the '## Resources' placeholder", () => {
		const row = controls(flatTree()).find((entry) => entry.key === "resourcesName");
		expect(row?.definition).toMatchObject({
			control: { type: "text", key: "resourcesName", placeholder: "## Resources" },
		});
	});

	it("renders every other setting as a toggle", () => {
		const others = controls(flatTree()).filter((entry) => entry.key !== "resourcesName");
		expect(others).toHaveLength(17);
		for (const row of others) {
			expect(row.definition, `control "${row.name}"`).toMatchObject({
				control: { type: "toggle", key: row.key },
			});
		}
	});

	it("leaves defaults to the control store instead of repeating them", () => {
		for (const row of controls(flatTree())) {
			const control = (row.definition as { control: object }).control;
			expect(control, `control "${row.name}"`).not.toHaveProperty("defaultValue");
		}
	});

	it("marks exactly cascade, fromCitations, identity and move as 'Format selection' only", () => {
		const marked = controls(flatTree())
			.filter((row) => row.desc?.endsWith(SUFFIX))
			.map((row) => row.key);
		expect(marked).toEqual([
			"formatSelection.cascade",
			"formatSelection.fromCitations",
			"formatSelection.identity",
			"formatSelection.move",
		]);
		const mentioning = flatTree().filter((row) => row.desc?.includes("not applied by"));
		expect(mentioning).toHaveLength(4);
	});

	it("carries no id on any item (deviation D-1)", () => {
		for (const entry of flatTree()) {
			expect(entry.id, `item "${entry.name}"`).toBeUndefined();
		}
	});
});

// ---------------------------------------------------------------------------
// buildMainPageItems — layout (ADR-2)
// ---------------------------------------------------------------------------

describe("buildMainPageItems — main-page order", () => {
	it("lays out the top level as 4 bare controls, 2 pages, then 6 sibling groups", () => {
		const topLevel = flatTree().filter((entry) => entry.path.length === 0);
		expect(topLevel.map((entry) => `${entry.type}:${entry.name}`)).toEqual([
			"control:Resources section heading",
			"control:Show update notes",
			"control:Numeric-only footnotes",
			"control:Fit paste to list context",
			"page:Scripts",
			"page:Commands",
			"group:Format selection",
			"group:Cleanup",
			"group:Lists",
			"group:Headings",
			"group:Footnotes",
			"group:Advanced",
		]);
	});

	it("passes the injected pages through untouched", () => {
		const tree = buildTree();
		expect(tree[4]).toBe(SCRIPTS_PAGE);
		expect(tree[5]).toBe(COMMANDS_PAGE);
	});

	it("puts every control in the group today's settings tab shows it under", () => {
		const rows = controls(flatTree());
		expect(rows.map((row) => ({ key: row.key, group: row.path[0] }))).toEqual(
			EXPECTED_CONTROLS.map(({ key, group }) => ({ key, group })),
		);
	});

	it("never nests a group inside another group", () => {
		const nested = flatTree().filter((entry) => entry.type === "group" && entry.path.length > 0);
		expect(nested).toEqual([]);
	});

	it("gives the Format selection group only the intro row 'Which steps run'", () => {
		const inside = flatTree().filter((entry) => entry.path[0] === "Format selection");
		expect(inside).toHaveLength(1);
		expect(inside[0]).toMatchObject({ type: "empty", name: "Which steps run", desc: INTRO_DESC });
	});

	it("ends Advanced with Debug logging followed by the injected Documentation row", () => {
		const identityRow = buildDocumentationRow(MANIFEST, () => {});
		const flat = walk(
			buildMainPageItems({ scriptsPage: SCRIPTS_PAGE, commandsPage: COMMANDS_PAGE, identityRow }),
		);
		const advanced = flat.filter((entry) => entry.path[0] === "Advanced");
		expect(advanced.map((entry) => `${entry.type}:${entry.name}`)).toEqual([
			"control:Debug logging",
			"action:Documentation",
		]);
		expect(advanced[1].definition).toBe(identityRow);
		expect(flat[flat.length - 1]).toBe(advanced[1]);
	});

	it("keeps sibling names unique, since Obsidian keys rows by name", () => {
		const seen = new Set<string>();
		for (const entry of flatTree()) {
			const identity = `${entry.path.join("/")}/${entry.type === "group" ? "group:" : ""}${entry.name}`;
			expect(seen.has(identity), `duplicate sibling "${identity}"`).toBe(false);
			seen.add(identity);
		}
	});
});

// ---------------------------------------------------------------------------
// Search aliases (PRD F8)
// ---------------------------------------------------------------------------

describe("buildMainPageItems — search aliases", () => {
	function aliasesOf(name: string): string[] | undefined {
		return flatTree().find((entry) => entry.name === name)?.aliases;
	}

	it("finds reflow by OCR and TextSniper", () => {
		expect(aliasesOf("Reflow wrapped text")).toEqual(["OCR", "TextSniper"]);
	});

	it("finds the Format selection intro by paste and paste and format", () => {
		expect(aliasesOf("Which steps run")).toEqual(["paste", "paste and format"]);
	});

	it("finds Debug logging by console and debug", () => {
		expect(aliasesOf("Debug logging")).toEqual(["console", "debug"]);
	});

	it("gives no other fixed setting an alias", () => {
		const aliased = controls(flatTree())
			.filter((row) => row.aliases !== undefined)
			.map((row) => row.key);
		expect(aliased).toEqual(["formatSelection.reflow", "debugLogging"]);
	});

	it("never points one alias at two targets", () => {
		const targetByAlias = new Map<string, string | undefined>();
		for (const entry of flatTree()) {
			for (const alias of entry.aliases ?? []) {
				const normalized = alias.toLowerCase();
				expect(
					targetByAlias.has(normalized),
					`alias "${alias}" targets both "${targetByAlias.get(normalized)}" and "${entry.name}"`,
				).toBe(false);
				targetByAlias.set(normalized, entry.name);
			}
		}
		expect(targetByAlias.size).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// SENTENCE CASE — walked, because lint cannot see strings in object literals
// ---------------------------------------------------------------------------

/**
 * Same rule as the settings-tab tests: a capitalised word after the first
 * word means Title Case.
 */
const TITLE_CASE_PATTERN = /^.+\s+[A-Z][a-z]/;

/** Proper nouns, brand names and UI labels that keep their capital mid-sentence. */
const CAPITALISED_TERMS = [
	"Markdown Mason",
	"Markdown",
	"Mason",
	"TextSniper",
	"Unicode",
	"Tidy footnotes",
	"Normalize headings",
	"Resources",
];

/** Command names are quoted in running text, e.g. "Paste and format". */
const QUOTED_TEXT = /"[^"]*"/g;

/** A new sentence (or the clause after a colon) may start with a capital. */
const SENTENCE_BREAK = /[.:]\s+/;

function withoutCapitalisedTerms(text: string): string {
	return CAPITALISED_TERMS.reduce((rest, term) => rest.split(term).join("term"), text);
}

function isTitleCase(label: string): boolean {
	return TITLE_CASE_PATTERN.test(withoutCapitalisedTerms(label));
}

function titleCaseSentences(prose: string): string[] {
	return withoutCapitalisedTerms(prose.replace(QUOTED_TEXT, "quoted"))
		.split(SENTENCE_BREAK)
		.filter((sentence) => TITLE_CASE_PATTERN.test(sentence));
}

describe("sentence-case rule (self-check)", () => {
	it("flags Title Case labels and passes sentence case ones", () => {
		expect(isTitleCase("Debug Logging")).toBe(true);
		expect(isTitleCase("Debug logging")).toBe(false);
		expect(isTitleCase("paste and format")).toBe(false);
		expect(isTitleCase("Paste And Format")).toBe(true);
	});

	it("flags Title Case inside a description sentence", () => {
		expect(titleCaseSentences("Write verbose Traces to the console. Takes effect.")).toHaveLength(1);
		expect(titleCaseSentences("Write verbose traces. Takes effect immediately.")).toEqual([]);
	});
});

describe("buildMainPageItems — sentence case", () => {
	it("starts every name and heading with a capital and keeps the rest in sentence case", () => {
		for (const entry of flatTree()) {
			expect(entry.name, `${entry.type} without a name`).toBeDefined();
			const label = entry.name ?? "";
			expect(label, `"${label}" must start with a capital`).toMatch(/^[A-Z]/);
			expect(isTitleCase(label), `"${label}" appears to be Title Case — use sentence case`).toBe(false);
		}
	});

	it("keeps every description in sentence case", () => {
		// The Documentation row's desc is manifest data (plugin and author name), not UI wording.
		const worded = flatTree().filter((entry) => entry.type !== "action" && entry.desc !== undefined);
		expect(worded.length).toBeGreaterThanOrEqual(19);
		for (const entry of worded) {
			expect(titleCaseSentences(entry.desc ?? ""), `desc of "${entry.name}"`).toEqual([]);
		}
	});

	it("keeps every alias free of Title Case", () => {
		const aliases = flatTree().flatMap((entry) => entry.aliases ?? []);
		expect(aliases.length).toBeGreaterThan(0);
		for (const alias of aliases) {
			expect(isTitleCase(alias), `alias "${alias}" appears to be Title Case`).toBe(false);
		}
	});
});
