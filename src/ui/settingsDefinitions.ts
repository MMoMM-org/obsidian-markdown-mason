import type {
	SettingDefinition,
	SettingDefinitionAction,
	SettingDefinitionEmpty,
	SettingDefinitionGroup,
	SettingDefinitionItem,
	SettingDefinitionPage,
} from "obsidian";
import type { FixedKey } from "./settingsControlStore";

// ---------------------------------------------------------------------------
// settingsDefinitions — spec 010
//
// Single source of truth for the fixed settings (name, desc, search aliases,
// control, section) and the builder that arranges them into the main settings
// page. The Scripts page, the Commands page and the Documentation row are
// injected, so this module knows nothing about scripts.
//
// - No `id` on any item: Obsidian keys rows by control key or name, so names
//   must stay stable and unique among siblings (spec 010, deviation D-1).
// - Groups cannot nest (the runtime drops nested groups silently), so the
//   Format selection sub-sections are sibling groups (ADR-2).
// - No `defaultValue`: defaults are applied by readControl (settingsControlStore).
//
// COMMUNITY COMPLIANCE
// - All UI text follows SENTENCE CASE. Lint cannot see strings inside object
//   literals; test/ui/settingsDefinitions.test.ts walks the tree instead.
// ---------------------------------------------------------------------------

export type FixedSettingSection = "general" | "cleanup" | "lists" | "headings" | "footnotes" | "advanced";

export type FixedSettingControl = { type: "toggle" } | { type: "text"; placeholder: string };

export interface FixedSettingSpec {
	key: FixedKey;
	section: FixedSettingSection;
	name: string;
	desc: string;
	/** Extra search terms that appear in neither name nor desc. */
	aliases?: string[];
	control: FixedSettingControl;
}

/** Desc suffix of the steps that "Paste and format" skips. */
export const FORMAT_SELECTION_ONLY = ' ℹ️ "Format selection" only — not applied by "Paste and format".';

export const FORMAT_SELECTION_HEADING = "Format selection";

/** Group headings of the sections that have one; General controls sit bare on the page. */
export const SECTION_HEADINGS = {
	cleanup: "Cleanup",
	lists: "Lists",
	headings: "Headings",
	footnotes: "Footnotes",
	advanced: "Advanced",
} as const satisfies Partial<Record<FixedSettingSection, string>>;

interface IntroRowSpec {
	readonly name: string;
	readonly desc: string;
	readonly aliases: readonly string[];
}

/** Explains the Format selection toggles; a row without a control. */
export const FORMAT_SELECTION_INTRO: IntroRowSpec = {
	name: "Which steps run",
	desc: 'Choose which steps run. "Format selection" runs all of these; "Paste and format" runs the cleanup, lists, and the Normalize headings step only.',
	aliases: ["paste", "paste and format"],
};

export const RESOURCES_NAME_PLACEHOLDER = "## Resources";

const TOGGLE: FixedSettingControl = { type: "toggle" };

/** Every fixed setting, in render order within its section. */
export const FIXED_SETTINGS: readonly FixedSettingSpec[] = [
	{
		key: "resourcesName",
		section: "general",
		name: "Resources section heading",
		desc: "Heading where Tidy footnotes collects footnote definitions. Set the level with leading #'s — e.g. ### Resources for a level-3 section. An existing section with this name is reused at its current level.",
		control: { type: "text", placeholder: RESOURCES_NAME_PLACEHOLDER },
	},
	{
		key: "showUpdateSplash",
		section: "general",
		name: "Show update notes",
		desc: "Show a summary of waiting script updates the first time you run a new version of Markdown Mason.",
		control: TOGGLE,
	},
	{
		key: "numericOnly",
		section: "general",
		name: "Numeric-only footnotes",
		desc: "Process only numeric footnote references (e.g. [^1]). Alpha markers such as [^A] are excluded. Note: disabling this is a planned feature — the setting persists but alpha-marker support is not yet wired into the core.",
		control: TOGGLE,
	},
	{
		key: "pasteListContext",
		section: "general",
		name: "Fit paste to list context",
		desc: "When pasting inside a list item, turn each pasted paragraph into its own item, drop the blank lines between them, and nest a pasted sub-list under the item that introduces it. Has no effect outside a list.",
		control: TOGGLE,
	},
	{
		key: "formatSelection.boxTable",
		section: "cleanup",
		name: "Convert box-drawing table",
		desc: "Turn terminal/CLI tables drawn with box characters (┌─┬─┐ … │ … or ASCII +--+) into proper Markdown tables. On by default; detection is unambiguous and runs before reflow and dewrap.",
		control: TOGGLE,
	},
	{
		key: "formatSelection.reflow",
		section: "cleanup",
		name: "Reflow wrapped text",
		desc: "Rebuild hard-wrapped OCR/slide captures (no blank lines between blocks) into paragraphs and bullet lists, keeping any sub-bullet nesting. Off by default; enable for screen-capture text. Runs before dehyphenate and dewrap.",
		aliases: ["OCR", "TextSniper"],
		control: TOGGLE,
	},
	{
		key: "formatSelection.dewrap",
		section: "cleanup",
		name: "Dewrap paragraphs",
		desc: "Re-join hard-wrapped lines into full paragraphs, skipping code, headings, lists, blockquotes, and tables.",
		control: TOGGLE,
	},
	{
		key: "formatSelection.dehyphenate",
		section: "cleanup",
		name: "Dehyphenate words",
		desc: "Remove end-of-line hyphens that split words across lines (OCR and PDF artifacts), for lowercase-to-lowercase splits only. Runs before dewrap.",
		control: TOGGLE,
	},
	{
		key: "formatSelection.decomposeLigatures",
		section: "cleanup",
		name: "Decompose ligatures and punctuation",
		desc: "Replace Unicode ligature glyphs (ﬁ, æ, œ…) and typographic punctuation (curly quotes, em dash, ellipsis) with plain ASCII equivalents.",
		control: TOGGLE,
	},
	{
		key: "formatSelection.tidyWhitespace",
		section: "cleanup",
		name: "Tidy whitespace",
		desc: "Collapse double spaces, remove trailing whitespace, and squeeze three or more blank lines to one.",
		control: TOGGLE,
	},
	{
		key: "formatSelection.normalizeBullets",
		section: "lists",
		name: "Normalize bullets",
		desc: "Replace all unordered bullet markers (*, +, •, –, ·) with a canonical dash (-), preserving nesting and checkbox syntax.",
		control: TOGGLE,
	},
	{
		key: "formatSelection.normalizeOrdered",
		section: "lists",
		name: "Normalize ordered list",
		desc: "Renumber ordered lists sequentially (1. 2. 3.) per nesting level.",
		control: TOGGLE,
	},
	{
		key: "formatSelection.cascade",
		section: "headings",
		name: "Cascade headings",
		desc: "Promote or demote headings to maintain a consistent hierarchy." + FORMAT_SELECTION_ONLY,
		control: TOGGLE,
	},
	{
		key: "formatSelection.normalize",
		section: "headings",
		name: "Normalize headings",
		desc: "Standardize heading levels throughout the selection.",
		control: TOGGLE,
	},
	{
		key: "formatSelection.fromCitations",
		section: "footnotes",
		name: "Convert citations to footnotes",
		desc: "Rewrite inline citation markers as numbered footnote references." + FORMAT_SELECTION_ONLY,
		control: TOGGLE,
	},
	{
		key: "formatSelection.identity",
		section: "footnotes",
		name: "Resolve footnote identity",
		desc: "Renumber footnote references to remove gaps and duplicates." + FORMAT_SELECTION_ONLY,
		aliases: ["footnotes"],
		control: TOGGLE,
	},
	{
		key: "formatSelection.move",
		section: "footnotes",
		name: "Move footnotes to resources",
		desc: "Move footnote definitions into your Resources section." + FORMAT_SELECTION_ONLY,
		control: TOGGLE,
	},
	{
		key: "debugLogging",
		section: "advanced",
		name: "Debug logging",
		desc: "Write verbose Mason traces to the developer console. Takes effect immediately.",
		aliases: ["console", "debug"],
		control: TOGGLE,
	},
];

/** The spec of one fixed setting. Every FixedKey has one (asserted by the unit tests). */
export function fixedSetting(key: FixedKey): FixedSettingSpec {
	const spec = FIXED_SETTINGS.find((candidate) => candidate.key === key);
	if (spec === undefined) {
		throw new Error(`No fixed setting is defined for control key "${key}"`);
	}
	return spec;
}

function toControlRow(spec: FixedSettingSpec): SettingDefinition<FixedKey> {
	return {
		name: spec.name,
		desc: spec.desc,
		...(spec.aliases === undefined ? {} : { aliases: [...spec.aliases] }),
		control: { ...spec.control, key: spec.key },
	};
}

function controlRows(section: FixedSettingSection): SettingDefinition<FixedKey>[] {
	return FIXED_SETTINGS.filter((spec) => spec.section === section).map(toControlRow);
}

function introRow(): SettingDefinitionEmpty {
	return { ...FORMAT_SELECTION_INTRO, aliases: [...FORMAT_SELECTION_INTRO.aliases] };
}

/** What a group of the main page may hold: rows only, the pages sit on the page itself. */
export type FixedGroupRow = SettingDefinition<FixedKey>;

function group(heading: string, items: FixedGroupRow[]): SettingDefinitionGroup<FixedKey> {
	return { type: "group", heading, items };
}

export interface MainPageParts {
	scriptsPage: SettingDefinitionPage;
	commandsPage: SettingDefinitionPage;
	/** The "Documentation" action row that closes the Advanced group. */
	identityRow: SettingDefinitionAction;
}

/** The main settings page in render order. Never empty: the fixed settings are always there. */
export function buildMainPageItems(parts: MainPageParts): SettingDefinitionItem<FixedKey>[] {
	return [
		...controlRows("general"),
		parts.scriptsPage,
		parts.commandsPage,
		group(FORMAT_SELECTION_HEADING, [introRow()]),
		group(SECTION_HEADINGS.cleanup, controlRows("cleanup")),
		group(SECTION_HEADINGS.lists, controlRows("lists")),
		group(SECTION_HEADINGS.headings, controlRows("headings")),
		group(SECTION_HEADINGS.footnotes, controlRows("footnotes")),
		group(SECTION_HEADINGS.advanced, [...controlRows("advanced"), parts.identityRow]),
	];
}
