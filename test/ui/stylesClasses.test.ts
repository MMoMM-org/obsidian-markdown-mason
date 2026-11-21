/**
 * Static guard: styles.css and src/ agree on the plugin's CSS classes.
 *
 * Every `.mason-*` selector in styles.css must be applied somewhere in src/
 * (no dead rules), and every `mason-*` class src/ applies must either have a
 * rule or be listed in UNSTYLED_CLASSES with the reason it needs none.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { LifecycleState } from "../../src/scripts/lifecycle";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ---------------------------------------------------------------------------
// Extractors
// ---------------------------------------------------------------------------

const CLASS_PREFIX = "mason-";
/** Stands in for a `${…}` expression while a class string is tokenised. */
const DYNAMIC_PART = "\u0000";

/** A call site that hands a class to the DOM: `cls:`, addClass(…), className = … */
const CLASS_SITE =
	/(?:\bcls\s*:|\.(?:addClass|addClasses|toggleClass|removeClass)\(|\.setAttr\(\s*["']class["']\s*,|\.className\s*=)\s*/g;
const STRING_LITERAL = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/y;
const STRING_LITERALS = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;
const ARRAY_LITERAL = /\[([^\]]*)\]/y;

export interface AppliedClasses {
	/** Complete class names, e.g. `mason-script-pill`. */
	literals: Set<string>;
	/** Static head of a templated class, e.g. `mason-pill-` for `mason-pill-${kind}`. */
	dynamicPrefixes: Set<string>;
	/** Call sites whose argument is not a string or array literal. */
	unrecognised: string[];
}

/** The `.mason-*` classes a stylesheet has selectors for. Comments are ignored. */
export function extractCssClasses(css: string): Set<string> {
	const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
	return new Set(Array.from(withoutComments.matchAll(/\.(mason-[a-z0-9-]+)/g), (m) => m[1]));
}

/** The `mason-*` classes a TypeScript source applies to elements. */
export function extractAppliedClasses(source: string): AppliedClasses {
	const applied: AppliedClasses = { literals: new Set(), dynamicPrefixes: new Set(), unrecognised: [] };

	for (const site of source.matchAll(CLASS_SITE)) {
		const argumentStart = site.index + site[0].length;
		const classStrings = classStringsAt(source, argumentStart);
		if (classStrings === null) {
			applied.unrecognised.push(source.slice(site.index, argumentStart + 40).split("\n")[0]);
			continue;
		}
		for (const classString of classStrings) {
			collectTokens(classString, applied);
		}
	}
	return applied;
}

/** The string literal(s) starting at `index`, or null when the argument is something else. */
function classStringsAt(source: string, index: number): string[] | null {
	STRING_LITERAL.lastIndex = index;
	const single = STRING_LITERAL.exec(source);
	if (single) {
		return [literalContent(single)];
	}
	ARRAY_LITERAL.lastIndex = index;
	const array = ARRAY_LITERAL.exec(source);
	if (array) {
		return Array.from(array[1].matchAll(STRING_LITERALS), literalContent);
	}
	return null;
}

function literalContent(match: RegExpMatchArray): string {
	return match[1] ?? match[2] ?? match[3] ?? "";
}

function collectTokens(classString: string, applied: AppliedClasses): void {
	const tokens = classString.replace(/\$\{[^}]*\}/g, DYNAMIC_PART).split(/\s+/);
	for (const token of tokens) {
		if (!token.startsWith(CLASS_PREFIX)) {
			continue;
		}
		const dynamicAt = token.indexOf(DYNAMIC_PART);
		if (dynamicAt === -1) {
			applied.literals.add(token);
		} else {
			applied.dynamicPrefixes.add(token.slice(0, dynamicAt));
		}
	}
}

// ---------------------------------------------------------------------------
// Repository facts
// ---------------------------------------------------------------------------

/**
 * Every value a templated class can take. `satisfies` ties the status pill's
 * list to LifecycleState, so a new state fails to compile until it is listed.
 */
const PILL_KINDS = {
	Available: true,
	Absent: true,
	Disabled: true,
	Materializing: true,
	Active: true,
	UpdateAvailable: true,
	Blocked: true,
} satisfies Record<LifecycleState["kind"], true>;

const DYNAMIC_CLASS_SUFFIXES: Record<string, string[]> = {
	// scriptsPage.ts: `mason-pill-${item.state.kind.toLowerCase()}`
	"mason-pill-": Object.keys(PILL_KINDS).map((kind) => kind.toLowerCase()),
};

/** Classes src/ applies on purpose without a rule, and why. */
const UNSTYLED_CLASSES: Record<string, string> = {
	"mason-pill-available": "neutral state: keeps the pill's default muted colour",
	"mason-pill-absent": "neutral state: keeps the pill's default muted colour",
	"mason-pill-disabled": "neutral state: keeps the pill's default muted colour",
	"mason-pill-materializing": "neutral state: keeps the pill's default muted colour",
	"mason-script-pill-icon": "structural hook: styled through its parent .mason-script-pill",
	"mason-script-pill-label": "structural hook: styled through its parent .mason-script-pill",
	"mason-script-disclosure": "modal root hook: Obsidian's modal styles suffice",
	"mason-script-meta": "structural hook: default block layout",
	"mason-script-disclosure-text": "structural hook: default paragraph styling",
	"mason-update-splash": "modal root hook: Obsidian's modal styles suffice",
	"mason-browse-official": "modal root hook: Obsidian's modal styles suffice",
};

/**
 * Class call sites the extractor cannot read, each checked by hand.
 * disclosure.ts `_makeButton` takes the class as a parameter; its callers pass
 * only Obsidian's "mod-cta" or "", never a mason class.
 */
const INDIRECT_CLASS_SITES = [
	"src/scripts/disclosure.ts: cls: string,",
	"src/scripts/disclosure.ts: .addClass(cls);",
];

function sourceFiles(dir: string): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			return sourceFiles(full);
		}
		return entry.name.endsWith(".ts") ? [full] : [];
	});
}

function readRepoClasses(): { css: Set<string>; applied: Set<string>; dynamicPrefixes: string[]; unrecognised: string[] } {
	const css = extractCssClasses(fs.readFileSync(path.join(REPO_ROOT, "styles.css"), "utf8"));
	const applied = new Set<string>();
	const dynamicPrefixes = new Set<string>();
	const unrecognised: string[] = [];

	for (const file of sourceFiles(path.join(REPO_ROOT, "src")).sort()) {
		const found = extractAppliedClasses(fs.readFileSync(file, "utf8"));
		found.literals.forEach((cls) => applied.add(cls));
		found.dynamicPrefixes.forEach((prefix) => dynamicPrefixes.add(prefix));
		unrecognised.push(...found.unrecognised.map((site) => `${path.relative(REPO_ROOT, file)}: ${site}`));
	}
	for (const prefix of dynamicPrefixes) {
		(DYNAMIC_CLASS_SUFFIXES[prefix] ?? []).forEach((suffix) => applied.add(prefix + suffix));
	}
	return { css, applied, dynamicPrefixes: [...dynamicPrefixes].sort(), unrecognised };
}

// ---------------------------------------------------------------------------
// Extractor unit tests
// ---------------------------------------------------------------------------

describe("extractCssClasses", () => {
	it("collects mason classes from simple, compound and descendant selectors", () => {
		const css = `
			.mason-a { color: red; }
			.mason-b button.mason-c:hover, .setting-item .mason-d-2:empty { color: blue; }
		`;
		expect([...extractCssClasses(css)].sort()).toEqual(["mason-a", "mason-b", "mason-c", "mason-d-2"]);
	});

	it("ignores classes of other prefixes and classes named only in comments", () => {
		const css = `/* .mason-gone was removed */ .setting-item-name { margin: 0; } .mason-kept { margin: 0; }`;
		expect([...extractCssClasses(css)]).toEqual(["mason-kept"]);
	});
});

describe("extractAppliedClasses", () => {
	it("collects classes from cls options, class methods, setAttr and className", () => {
		const source = `
			el.createDiv({ text: "x", cls: "mason-a" });
			el.addClass('mason-b');
			el.toggleClass("mason-c", on);
			el.setAttr("class", "mason-d");
			el.className = "mason-e";
		`;
		const found = extractAppliedClasses(source);
		expect([...found.literals].sort()).toEqual(["mason-a", "mason-b", "mason-c", "mason-d", "mason-e"]);
		expect(found.unrecognised).toEqual([]);
	});

	it("splits space-separated classes and reads cls arrays", () => {
		const source = `el.createDiv({ cls: "mason-a other mason-b" }); el.createDiv({ cls: ["mason-c", "mason-d"] });`;
		expect([...extractAppliedClasses(source).literals].sort()).toEqual(["mason-a", "mason-b", "mason-c", "mason-d"]);
	});

	it("reports a templated class as its static prefix", () => {
		const source = "pill.addClass(`mason-fixed mason-pill-${state.kind.toLowerCase()}`);";
		const found = extractAppliedClasses(source);
		expect([...found.literals]).toEqual(["mason-fixed"]);
		expect([...found.dynamicPrefixes]).toEqual(["mason-pill-"]);
	});

	it("ignores mason strings that are not classes", () => {
		const source = "const id = `mason-disclosure-${uuid}`; console.debug(\"mason-script\");";
		const found = extractAppliedClasses(source);
		expect(found.literals.size).toBe(0);
		expect(found.dynamicPrefixes.size).toBe(0);
	});

	it("flags a class argument it cannot read statically", () => {
		const found = extractAppliedClasses(`el.createDiv({ cls: active ? "mason-a" : "mason-b" });`);
		expect(found.unrecognised).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// styles.css <-> src/
// ---------------------------------------------------------------------------

describe("styles.css and src/ agree on mason classes", () => {
	const repo = readRepoClasses();

	it("finds classes on both sides (the scan is not vacuous)", () => {
		expect(repo.css.size).toBeGreaterThan(0);
		expect(repo.applied.size).toBeGreaterThan(0);
	});

	it("src/ only passes class arguments the extractor can read, bar the reviewed ones", () => {
		expect(repo.unrecognised).toEqual(INDIRECT_CLASS_SITES);
	});

	it("every templated class has its possible values listed", () => {
		expect(repo.dynamicPrefixes).toEqual(Object.keys(DYNAMIC_CLASS_SUFFIXES).sort());
	});

	it("every class in styles.css is applied in src/ (no dead rules)", () => {
		const dead = [...repo.css].filter((cls) => !repo.applied.has(cls)).sort();
		expect(dead).toEqual([]);
	});

	it("every class src/ applies has a rule or is listed as intentionally unstyled", () => {
		const missing = [...repo.applied]
			.filter((cls) => !repo.css.has(cls) && !(cls in UNSTYLED_CLASSES))
			.sort();
		expect(missing).toEqual([]);
	});

	it("the unstyled list holds only classes that are applied and have no rule", () => {
		const stale = Object.keys(UNSTYLED_CLASSES)
			.filter((cls) => !repo.applied.has(cls) || repo.css.has(cls))
			.sort();
		expect(stale).toEqual([]);
	});
});
