// Guards the user docs against drifting from the settings code (spec 010 T4.3).
//
// Everything asserted here is derived from the source: setting names and search
// words from the definition modules, step counts from the recipe, the minimum
// Obsidian version from manifest.json.
//
// Conventions the docs follow, so the checks can stay simple:
// - step counts are written in digits, directly before "step": "13 steps",
//   "9-step" (never "thirteen steps");
// - an Obsidian version is written as "Obsidian 1.13.1" (backticks allowed).

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { DEFAULT_SETTINGS } from "../../src/core/types";
import { resolveFormatSelectionRecipe } from "../../src/core/formatSelection";
import { FIXED_SETTINGS, FORMAT_SELECTION_INTRO, FORMAT_SELECTION_ONLY } from "../../src/ui/settingsDefinitions";
import { SCRIPTS_PAGE_NAME } from "../../src/ui/scriptsPage";
import { COMMANDS_INTRO, COMMANDS_PAGE_NAME } from "../../src/ui/commandsPage";

const REPO_ROOT = resolve(__dirname, "../..");
const DOCS_DIR = resolve(REPO_ROOT, "docs");

/** README.md plus the pages directly under docs/ (docs/XDD and docs/examples are not user docs). */
const DOC_PATHS: string[] = [
	resolve(REPO_ROOT, "README.md"),
	...readdirSync(DOCS_DIR)
		.filter((name) => name.endsWith(".md"))
		.sort()
		.map((name) => resolve(DOCS_DIR, name)),
];

const README = resolve(REPO_ROOT, "README.md");
const CONFIGURATION = resolve(DOCS_DIR, "configuration.md");
const INSTALLATION = resolve(DOCS_DIR, "installation.md");

function read(path: string): string {
	return readFileSync(path, "utf8");
}

function label(path: string): string {
	return relative(REPO_ROOT, path);
}

/** "file:line: text" for every line of the docs that matches `pattern`. */
function linesMatching(pattern: RegExp): string[] {
	const hits: string[] = [];
	for (const path of DOC_PATHS) {
		read(path)
			.split("\n")
			.forEach((line, index) => {
				if (pattern.test(line)) hits.push(`${label(path)}:${index + 1}: ${line.trim()}`);
			});
	}
	return hits;
}

// --- Step counts, from code -------------------------------------------------

const FORMAT_STEP_SETTINGS = FIXED_SETTINGS.filter((spec) => spec.key.startsWith("formatSelection."));
const FORMAT_SELECTION_ONLY_COUNT = FORMAT_STEP_SETTINGS.filter((spec) =>
	spec.desc.endsWith(FORMAT_SELECTION_ONLY),
).length;
const FORMAT_SELECTION_COUNT = Object.keys(resolveFormatSelectionRecipe(DEFAULT_SETTINGS)).length;
const PASTE_AND_FORMAT_COUNT = FORMAT_SELECTION_COUNT - FORMAT_SELECTION_ONLY_COUNT;

function statesStepCount(text: string, count: number): boolean {
	return new RegExp(`\\b${count}[- ]steps?\\b`).test(text);
}

describe("user docs match the settings code", () => {
	it("finds the docs", () => {
		expect(DOC_PATHS.map(label)).toEqual(
			expect.arrayContaining(["README.md", "docs/configuration.md", "docs/installation.md", "docs/usage.md"]),
		);
	});

	describe("docs/configuration.md", () => {
		const configuration = read(CONFIGURATION);

		it.each(FIXED_SETTINGS.map((spec) => spec.name))("names the setting %s", (name) => {
			expect(configuration).toContain(name);
		});

		it.each([SCRIPTS_PAGE_NAME, COMMANDS_PAGE_NAME, FORMAT_SELECTION_INTRO.name, COMMANDS_INTRO.name])(
			"names the page or row %s",
			(name) => {
				expect(configuration).toContain(name);
			},
		);

		const searchWords = [
			...FIXED_SETTINGS.flatMap((spec) => spec.aliases ?? []),
			...FORMAT_SELECTION_INTRO.aliases,
			...COMMANDS_INTRO.aliases,
		];

		it.each(searchWords)("gives the search word %s", (word) => {
			expect(configuration.toLowerCase()).toContain(word.toLowerCase());
		});
	});

	describe("minimum Obsidian version", () => {
		const manifest = JSON.parse(read(resolve(REPO_ROOT, "manifest.json"))) as { minAppVersion: string };
		const statedVersion = /Obsidian\s+`?(\d+\.\d+\.\d+)/g;

		it.each([README, INSTALLATION].map((path) => [label(path), path]))("%s states it", (_label, path) => {
			const stated = [...read(path).matchAll(statedVersion)].map((match) => match[1]);
			expect(stated).toContain(manifest.minAppVersion);
		});

		it("no doc states another Obsidian version", () => {
			const others = DOC_PATHS.flatMap((path) =>
				[...read(path).matchAll(statedVersion)]
					.filter((match) => match[1] !== manifest.minAppVersion)
					.map((match) => `${label(path)}: ${match[0]}`),
			);
			expect(others).toEqual([]);
		});
	});

	describe("layout wording", () => {
		it("no doc mentions segments", () => {
			expect(linesMatching(/segment/i)).toEqual([]);
		});

		it("no doc calls the Scripts or Commands page a tab", () => {
			expect(linesMatching(/\b(scripts|commands)\s+(settings\s+)?tab\b/i)).toEqual([]);
		});
	});

	describe("step counts", () => {
		it("the recipe has one toggle per step", () => {
			expect(FORMAT_STEP_SETTINGS).toHaveLength(FORMAT_SELECTION_COUNT);
			expect(FORMAT_SELECTION_ONLY_COUNT).toBeGreaterThan(0);
		});

		it.each([README, CONFIGURATION].map((path) => [label(path), path]))(
			"%s states the Format selection and the Paste and format count",
			(_label, path) => {
				const text = read(path);
				expect(statesStepCount(text, FORMAT_SELECTION_COUNT)).toBe(true);
				expect(statesStepCount(text, PASTE_AND_FORMAT_COUNT)).toBe(true);
			},
		);

		it("no doc states a step count the recipe does not have", () => {
			const allowed = new Set([FORMAT_SELECTION_COUNT, PASTE_AND_FORMAT_COUNT, FORMAT_SELECTION_ONLY_COUNT]);
			const stale = DOC_PATHS.flatMap((path) =>
				[...read(path).matchAll(/\b(\d+)[- ]steps?\b/g)]
					.filter((match) => !allowed.has(Number(match[1])))
					.map((match) => `${label(path)}: ${match[0]}`),
			);
			expect(stale).toEqual([]);
		});

		it("no doc spells a step or toggle count out", () => {
			const numberWord = "two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen";
			expect(linesMatching(new RegExp(`\\b(${numberWord})[- ](steps?|toggles?)\\b`, "i"))).toEqual([]);
		});
	});

	describe("relative links", () => {
		it("resolve to existing files", () => {
			const broken: string[] = [];
			for (const path of DOC_PATHS) {
				for (const match of read(path).matchAll(/\]\(([^)\s]+)\)/g)) {
					const target = match[1].split("#")[0];
					if (target === "" || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
					if (!existsSync(resolve(dirname(path), target))) broken.push(`${label(path)}: ${match[1]}`);
				}
			}
			expect(broken).toEqual([]);
		});
	});
});
