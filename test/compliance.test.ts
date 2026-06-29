/**
 * T6.3 — Compliance sweep for Obsidian community submission.
 *
 * These tests statically scan the repository to lock in community-submission
 * compliance rules. They fail loudly if a rule is violated so a CI gate
 * catches regressions before review.
 *
 * Policy summary
 * ──────────────
 * - console.log      BANNED   (noisy, leaks to DevTools in production)
 * - console.debug    ALLOWED  (debug traces, controlled by debugLogging flag)
 * - console.warn     ALLOWED  (genuine signals — escape guard, wrong file ext)
 * - console.error    ALLOWED  (genuine error signals in logger/loader)
 * - fetch / window.fetch / globalThis.fetch   BANNED (v0.1 has no network;
 *                              use Obsidian requestUrl if network is ever needed)
 * - .innerHTML = / .outerHTML = / .insertAdjacentHTML(   BANNED (XSS vector;
 *                              use Obsidian createEl/setText/setAttribute)
 * - sample-plugin boilerplate strings   BANNED (leftover from template)
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { checkManifest } from "../scripts/check-manifest.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const srcDir = path.join(repoRoot, "src");

// Shared manifest read — used by Suite 4 and Suite 4b so the file is parsed once.
const manifestPath = path.join(repoRoot, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;

/** Recursively collect all .ts files under a directory. */
function collectTsFiles(dir: string): string[] {
	const results: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...collectTsFiles(full));
		} else if (entry.isFile() && entry.name.endsWith(".ts")) {
			results.push(full);
		}
	}
	return results;
}

interface MatchLocation {
	file: string;
	line: number;
	text: string;
}

/**
 * Scan all .ts files under srcDir for lines matching the given pattern.
 * Returns an array of match locations.
 */
function scanSrc(pattern: RegExp): MatchLocation[] {
	const matches: MatchLocation[] = [];
	for (const file of collectTsFiles(srcDir)) {
		const lines = fs.readFileSync(file, "utf8").split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]!;
			if (pattern.test(line)) {
				matches.push({ file: path.relative(repoRoot, file), line: i + 1, text: line.trim() });
			}
		}
	}
	return matches;
}

/** Format match locations into a readable failure message. */
function formatMatches(matches: MatchLocation[]): string {
	return matches.map((m) => `  ${m.file}:${m.line}: ${m.text}`).join("\n");
}

// ---------------------------------------------------------------------------
// Suite 1 — console.log ban
// ---------------------------------------------------------------------------

describe("compliance — no console.log in src/", () => {
	/**
	 * Policy: console.log is banned in production source. It leaks to DevTools
	 * for every user. Use console.debug (filtered by debugLogging) or surface
	 * messages through the ScriptLogger / Obsidian Notice API instead.
	 *
	 * Allowed: console.debug, console.warn, console.error.
	 * Pattern matches actual calls, not comments (requires "console.log(").
	 */
	it("contains zero console.log( calls in src/", () => {
		// Match `console.log(` — actual call sites only.
		// Skip lines whose trimmed content starts with `//` (single-line comments).
		// Block comments (/* */) are not handled because none exist for this pattern.
		const matches = scanSrc(/^(?!\s*\/\/).*\bconsole\.log\s*\(/);
		expect(matches, `Found console.log calls:\n${formatMatches(matches)}`).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Suite 2 — no network fetch in src/
// ---------------------------------------------------------------------------

describe("compliance — no global fetch in src/", () => {
	/**
	 * Policy: v0.1 has no network access. Any future network call MUST use
	 * Obsidian's requestUrl() API rather than the global fetch / window.fetch /
	 * globalThis.fetch. This test locks that in so it cannot accidentally slip
	 * through as a bare fetch call.
	 *
	 * If network is added in a future version, update this test to document the
	 * approved usage, not remove the rule.
	 */
	it("contains zero bare fetch( calls in src/", () => {
		// Match standalone `fetch(` — not preceded by a dot (method call) or word char.
		// This catches: fetch(url), await fetch(url) — but not requestUrl() or .fetch().
		// Skip lines whose trimmed content starts with `//` (single-line comments).
		const matches = scanSrc(/^(?!\s*\/\/).*(?<![.\w])fetch\s*\(/);
		expect(matches, `Found bare fetch( calls:\n${formatMatches(matches)}`).toHaveLength(0);
	});

	it("contains zero window.fetch( calls in src/", () => {
		// Skip lines whose trimmed content starts with `//` (single-line comments).
		const matches = scanSrc(/^(?!\s*\/\/).*\bwindow\.fetch\s*\(/);
		expect(matches, `Found window.fetch calls:\n${formatMatches(matches)}`).toHaveLength(0);
	});

	it("contains zero globalThis.fetch( calls in src/", () => {
		// Skip lines whose trimmed content starts with `//` (single-line comments).
		const matches = scanSrc(/^(?!\s*\/\/).*\bglobalThis\.fetch\s*\(/);
		expect(matches, `Found globalThis.fetch calls:\n${formatMatches(matches)}`).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Suite 3 — no innerHTML / outerHTML / insertAdjacentHTML
// ---------------------------------------------------------------------------

describe("compliance — no dangerous HTML injection APIs in src/", () => {
	/**
	 * Policy (CON-3): All DOM construction in this plugin uses Obsidian's safe
	 * DOM helpers: createEl, createDiv, setText, setAttribute. Direct HTML string
	 * injection via innerHTML, outerHTML, or insertAdjacentHTML is banned because
	 * it is a primary XSS vector.
	 *
	 * The patterns below match actual usage (assignment or call), NOT comments.
	 * A comment in disclosure.ts documents this ban — that is the only expected
	 * occurrence of these strings in source, and it does not match the patterns.
	 */
	it("contains zero .innerHTML = assignments in src/", () => {
		// Matches `.innerHTML` followed by optional whitespace and `=` or `+=`
		// (both are write/XSS vectors). The `(?!=)` negative lookahead excludes
		// `==` and `===` comparisons. Read access (no `=` follows) is benign and
		// not matched.
		const matches = scanSrc(/\.innerHTML\s*\+?=(?!=)/);
		expect(matches, `Found .innerHTML= assignments:\n${formatMatches(matches)}`).toHaveLength(0);
	});

	it("contains zero .outerHTML = assignments in src/", () => {
		// Matches `=` or `+=` writes; excludes `==`/`===` comparisons.
		const matches = scanSrc(/\.outerHTML\s*\+?=(?!=)/);
		expect(matches, `Found .outerHTML= assignments:\n${formatMatches(matches)}`).toHaveLength(0);
	});

	it("contains zero .insertAdjacentHTML( calls in src/", () => {
		const matches = scanSrc(/\.insertAdjacentHTML\s*\(/);
		expect(
			matches,
			`Found .insertAdjacentHTML( calls:\n${formatMatches(matches)}`,
		).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Suite 4 — manifest.json lint (real file)
// ---------------------------------------------------------------------------

describe("compliance — manifest.json required fields and format", () => {
	/**
	 * Validates the actual manifest.json against community submission rules.
	 * Uses the same checkManifest() function as check-manifest.test.ts but applies
	 * it to the real file, and additionally asserts required keys and id format.
	 *
	 * Rules (community plugin directory requirements):
	 *   - id: matches /^[a-z0-9-]+$/ and does NOT contain "obsidian"
	 *   - author: must NOT contain an email address (bot rejects it)
	 *   - description: <= 250 chars, ends with ".", does NOT contain "Obsidian",
	 *                  does NOT start with "This is a plugin"
	 *   - required keys: id, name, version, minAppVersion, description, author, isDesktopOnly
	 *   - isDesktopOnly === true (DESKTOP plugin, not mobile)
	 *
	 * manifest and manifestPath are hoisted to module scope (shared with Suite 4b).
	 */

	it("passes all checkManifest() rules", () => {
		const failures = checkManifest(manifest);
		expect(
			failures,
			`manifest.json compliance failures:\n${failures.map((f) => `  - ${f}`).join("\n")}`,
		).toHaveLength(0);
	});

	it("id matches /^[a-z0-9-]+$/ (lowercase, digits, hyphens only)", () => {
		expect(typeof manifest.id).toBe("string");
		expect(manifest.id as string).toMatch(/^[a-z0-9-]+$/);
	});

	it("id does not contain the word 'obsidian'", () => {
		expect(typeof manifest.id).toBe("string");
		expect((manifest.id as string).toLowerCase()).not.toContain("obsidian");
	});

	it("author does not contain an email address", () => {
		// The submission bot rejects any author value that looks like an email.
		// Contact info belongs in authorUrl.
		expect(typeof manifest.author).toBe("string");
		expect(manifest.author as string).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
	});

	it("has all required keys: id, name, version, minAppVersion, description, author, isDesktopOnly", () => {
		const required = ["id", "name", "version", "minAppVersion", "description", "author", "isDesktopOnly"];
		const missing = required.filter((k) => !(k in manifest));
		expect(missing, `Missing required manifest keys: ${missing.join(", ")}`).toHaveLength(0);
	});

	it("isDesktopOnly is strictly true", () => {
		expect(manifest.isDesktopOnly).toBe(true);
	});

	it("description is 250 characters or fewer", () => {
		expect(typeof manifest.description).toBe("string");
		expect((manifest.description as string).length).toBeLessThanOrEqual(250);
	});

	it("description ends with '.'", () => {
		expect(typeof manifest.description).toBe("string");
		expect((manifest.description as string).endsWith(".")).toBe(true);
	});

	it("description does not contain the word 'Obsidian'", () => {
		expect(typeof manifest.description).toBe("string");
		expect((manifest.description as string)).not.toMatch(/\bobsidian\b/i);
	});

	it("description does not start with 'This is a plugin'", () => {
		expect(typeof manifest.description).toBe("string");
		expect((manifest.description as string).trim()).not.toMatch(/^this is a plugin/i);
	});
});

// ---------------------------------------------------------------------------
// Suite 4b — versions.json ↔ manifest.json consistency
// ---------------------------------------------------------------------------

describe("compliance — versions.json ↔ manifest.json consistency", () => {
	/**
	 * The Obsidian plugin directory requires versions.json to map every released
	 * version to the minimum Obsidian app version that supports it. The entry for
	 * manifest.version MUST equal manifest.minAppVersion so that the directory
	 * correctly gates installs.
	 *
	 * Rules:
	 *   - versions.json must contain an entry for manifest.version
	 *   - that entry must equal manifest.minAppVersion
	 *
	 * manifest and manifestPath are hoisted to module scope (shared with Suite 4).
	 */
	const versionsPath = path.join(repoRoot, "versions.json");
	const versions = JSON.parse(fs.readFileSync(versionsPath, "utf8")) as Record<string, unknown>;

	it("versions.json contains an entry for manifest.version", () => {
		const version = manifest.version as string;
		expect(
			version in versions,
			`versions.json has no entry for manifest version "${version}"`,
		).toBe(true);
	});

	it("versions.json[manifest.version] equals manifest.minAppVersion", () => {
		const version = manifest.version as string;
		const minAppVersion = manifest.minAppVersion as string;
		expect(
			versions[version],
			`versions.json["${version}"] should be "${minAppVersion}" (manifest.minAppVersion) but got "${versions[version]}"`,
		).toBe(minAppVersion);
	});
});

// ---------------------------------------------------------------------------
// Suite 5 — no sample-plugin boilerplate residue
// ---------------------------------------------------------------------------

describe("compliance — no obsidian sample-plugin boilerplate residue in src/", () => {
	/**
	 * Policy: The obsidian sample-plugin template ships with specific class names,
	 * command IDs, and strings. Any of these in production code signals that the
	 * file was never cleaned up from the initial scaffold. Lock in their absence.
	 *
	 * Checked strings (from the official obsidian-sample-plugin repo):
	 *   - "MyPlugin"               — default plugin class name
	 *   - "SampleSettingTab"       — default settings tab class name
	 *   - "SamplePluginSettingTab" — alternative sample tab name
	 *   - "Sample Plugin"          — literal name string in the template
	 *   - "sample-editor-command"  — hardcoded command ID in the template
	 *   - "SampleModal"            — default modal class name in the template
	 */
	const BOILERPLATE: Array<{ label: string; pattern: RegExp }> = [
		{ label: '"MyPlugin" class name', pattern: /\bMyPlugin\b/ },
		{ label: '"SampleSettingTab" class name', pattern: /\bSampleSettingTab\b/ },
		{ label: '"SamplePluginSettingTab" class name', pattern: /\bSamplePluginSettingTab\b/ },
		{ label: '"Sample Plugin" literal string', pattern: /["']Sample Plugin["']/ },
		{ label: '"sample-editor-command" command ID', pattern: /["']sample-editor-command["']/ },
		{ label: '"SampleModal" class name', pattern: /\bSampleModal\b/ },
	];

	for (const { label, pattern } of BOILERPLATE) {
		it(`contains no ${label}`, () => {
			const matches = scanSrc(pattern);
			expect(
				matches,
				`Found sample-plugin residue (${label}):\n${formatMatches(matches)}`,
			).toHaveLength(0);
		});
	}
});

// ---------------------------------------------------------------------------
// Suite 6 — GitHub FUNDING.yml presence
// ---------------------------------------------------------------------------

describe("compliance — .github/FUNDING.yml present", () => {
	/**
	 * Policy: the repo must ship a FUNDING.yml so GitHub surfaces the project's
	 * support channels on the repository page.
	 */
	it(".github/FUNDING.yml exists", () => {
		const fundingPath = path.join(repoRoot, ".github", "FUNDING.yml");
		expect(
			fs.existsSync(fundingPath),
			`.github/FUNDING.yml not found — create it at ${fundingPath}`,
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Suite 7 — CON-2: src/core/ is pure (no obsidian import)
// ---------------------------------------------------------------------------

describe("compliance — CON-2: src/core is pure (no obsidian import)", () => {
	/**
	 * Policy (CON-2): Modules under src/core/ must NOT import from the "obsidian"
	 * package. They must stay pure so they can be unit-tested without the Obsidian
	 * runtime environment.
	 *
	 * This sweep covers every .ts file under src/core/ (excluding .test.ts files),
	 * including the three spec-004 modules: markdownBlocks.ts, cleanup.ts, lists.ts.
	 *
	 * Matched patterns (actual import/require statements only):
	 *   from "obsidian" | from 'obsidian' | require("obsidian") | require('obsidian')
	 * Lines whose trimmed content starts with // are excluded to avoid false-positives
	 * from comments that reference the word "obsidian".
	 */
	const coreDir = path.join(srcDir, "core");

	// Matches real import/require statements; does not match single-line comments.
	const OBSIDIAN_IMPORT = /(from\s+['"]obsidian['"])|(require\(\s*['"]obsidian['"]\s*\))/;

	/** Scan a single file for CON-2 violations; returns offending line descriptions. */
	function scanCoreFile(filePath: string): string[] {
		const offending: string[] = [];
		const lines = fs.readFileSync(filePath, "utf8").split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]!;
			if (/^\s*\/\//.test(line)) continue; // skip single-line comments
			if (OBSIDIAN_IMPORT.test(line)) {
				offending.push(`    line ${i + 1}: ${line.trim()}`);
			}
		}
		return offending;
	}

	it("no src/core/*.ts file imports from 'obsidian' (full sweep)", () => {
		const coreFiles = collectTsFiles(coreDir).filter((f) => !f.endsWith(".test.ts"));
		const violations: string[] = [];
		for (const file of coreFiles) {
			const offending = scanCoreFile(file);
			if (offending.length > 0) {
				violations.push(`  ${path.relative(repoRoot, file)}:\n${offending.join("\n")}`);
			}
		}
		expect(
			violations,
			`CON-2 violation — src/core/ file(s) import from "obsidian":\n${violations.join("\n")}`,
		).toHaveLength(0);
	});

	// Focused checks for the three spec-004 modules — explicitly named so the
	// coverage intent is visible in the test report even before the dynamic sweep
	// would catch them.
	const SPEC_004_MODULES = ["markdownBlocks.ts", "cleanup.ts", "lists.ts"] as const;

	for (const moduleName of SPEC_004_MODULES) {
		it(`spec-004 module src/core/${moduleName} has no obsidian import (CON-2)`, () => {
			const filePath = path.join(coreDir, moduleName);
			expect(
				fs.existsSync(filePath),
				`Expected spec-004 module to exist: ${filePath}`,
			).toBe(true);
			const offending = scanCoreFile(filePath);
			expect(
				offending,
				`CON-2 violation in src/core/${moduleName}:\n${offending.join("\n")}`,
			).toHaveLength(0);
		});
	}
});
