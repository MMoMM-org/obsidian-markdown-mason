// Phase 5 — Script library E2E tests (RED → GREEN)
//
// Structural golden discipline: assertions target CORRECT EXPECTED behavior,
// not captured implementation output.  See task spec §CRITICAL for the full
// set of required assertions.
//
// PASTE DOC MODEL (consistent across all three concrete scripts):
//   ctx.op.doc    = "# Sakura Notes\n\n"  (a note with a H1 + blank line)
//   ctx.op.cursor = doc.length             (cursor at end — cascade works)
//   ctx.input     = fixture text           (the Perplexity copy)
//   ctx.op.settings.resourcesName = "Resources"
//
// This model ensures cascade can find a context heading (H1 at offset 0 → target
// H2), so the body headings land at the right level.  All three concrete scripts
// use an identical ctx so auto-delegation comparisons are valid.

import { describe, it, expect, vi } from "vitest";
import { buildRegistry } from "../../src/core/registry";
import { buildScriptContext } from "../../src/scripts/context";
import { applyToString } from "../../src/core/applyToString";
import { perplexityApp } from "../../catalog/parsers/perplexityApp";
import { normalizeUrl } from "../../src/core/url";
import { loadFixture } from "../fixtures";
import type { OperationContext, MasonSettings, EditPlan } from "../../src/core/types";
import type { ScriptContext } from "../../src/scripts/context";

// Import the four library scripts under test
import { perplexityAppScript } from "../../catalog/scripts/perplexityApp";
import { perplexityWebScript } from "../../catalog/scripts/perplexityWeb";
import { perplexityWebDownloadScript } from "../../catalog/scripts/perplexityWebDownload";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const appInput = loadFixture("app");
const webInput = loadFixture("web");
const webDownloadInput = loadFixture("webDownload");

// ---------------------------------------------------------------------------
// Context factory
// ---------------------------------------------------------------------------

const PASTE_DOC = "# Sakura Notes\n\n";

function makeSettings(): MasonSettings {
	return { debugLogging: false, resourcesName: "Resources" };
}

function makeOp(input: string): OperationContext {
	return {
		doc: PASTE_DOC,
		cursor: PASTE_DOC.length,
		settings: makeSettings(),
		input,
	};
}

function makeCtx(input: string): ScriptContext {
	const { api } = buildRegistry();
	return buildScriptContext({
		input,
		source: "paste",
		op: makeOp(input),
		mason: api,
		logger: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		},
	});
}

// ---------------------------------------------------------------------------
// Helpers for structural assertions
// ---------------------------------------------------------------------------

/** Apply plan to PASTE_DOC and return the result string. */
function applyPlan(plan: EditPlan): string {
	return applyToString(PASTE_DOC, plan);
}

/** Assert no Sources/Quellen/Citations scaffolding remains in the output. */
function assertNoScaffolding(output: string): void {
	expect(output).not.toMatch(/^Sources\s*$/m);
	expect(output).not.toMatch(/^Citations:\s*$/m);
	expect(output).not.toMatch(/^Quellen\s*$/m);
	// No bare [n] <title> <url> source-entry lines
	expect(output).not.toMatch(/^\[\d+\]\s+\S.*https?:\/\/\S+\s*$/m);
}

/** Assert inline citations use [^n] form, not bare [n] or [text](url). */
function assertFootnoteMarkerForm(bodySection: string): void {
	// The body section (before Resources) should not contain bare [n] patterns
	// that are citation markers (as opposed to genuine list bullets etc.)
	// We check no bare [n] remains as a citation (surrounded by ] not by whitespace at start of line)
	// Simplest: body should NOT contain ][n][ i.e. citation clusters of bare form
	// Check that [^n] form is present
	expect(bodySection).toMatch(/\[\^\d+\]/);
	// Check that bare [n] markers that look like citations are gone from body.
	// Use a negative lookahead to exclude markdown links [n](...) while catching
	// any remaining unconverted citation clusters like [1][2][3].
	expect(bodySection).not.toMatch(/\[\d+\](?!\()/);
}

/** Parse out the Resources section content from the output. */
function extractResourcesSection(output: string): string {
	const idx = output.indexOf("## Resources");
	if (idx === -1) return "";
	return output.slice(idx);
}

/** Parse out everything before the Resources section. */
function extractBodySection(output: string): string {
	const idx = output.indexOf("## Resources");
	if (idx === -1) return output;
	return output.slice(0, idx);
}

/**
 * Assert gap-free sequential footnote numbering and full bidirectional
 * consistency between [^n] markers in body and [^n]: defs in Resources.
 */
function assertFootnoteConsistency(output: string): { K: number } {
	const bodySection = extractBodySection(output);
	const resourcesSection = extractResourcesSection(output);

	// Collect all [^n] references in body
	const bodyMarkers = new Set<number>();
	for (const m of bodySection.matchAll(/\[\^(\d+)\]/g)) {
		bodyMarkers.add(Number(m[1]));
	}

	// Collect all [^n]: definition numbers in Resources
	const defMarkers = new Set<number>();
	for (const m of resourcesSection.matchAll(/^\[\^(\d+)\]:/gm)) {
		defMarkers.add(Number(m[1]));
	}

	// Every body marker must have a def, and vice versa
	for (const n of bodyMarkers) {
		expect(defMarkers.has(n), `body has [^${n}] but no def in Resources`).toBe(true);
	}
	for (const n of defMarkers) {
		expect(bodyMarkers.has(n), `Resources has [^${n}]: def but no marker in body`).toBe(true);
	}

	// Gap-free sequential: must be 1..K
	const K = defMarkers.size;
	expect(K).toBeGreaterThan(0);
	for (let i = 1; i <= K; i++) {
		expect(defMarkers.has(i), `Expected [^${i}] in Resources but not found (K=${K})`).toBe(true);
	}

	return { K };
}

/** Assert Resources section contains two-line F4 defs (app format). */
function assertF4Defs(resourcesSection: string): void {
	// F4 format: "[^n]: snippet" on one line, "[title](url)" on the next
	// Check that at least one def follows this pattern
	expect(resourcesSection).toMatch(/\[\^\d+\]: .+\n\[.+\]\(https?:\/\/.+\)/);
}

/**
 * Assert Resources section contains single-line compact defs (web/download format).
 *
 * Each def must be a single line matching [^n]: [title](url).
 * No bare URL or raw markdown link must appear as a second line duplicating the link.
 */
function assertCompactDefs(resourcesSection: string): void {
	// Every [^n]: line must be a single-line compact def: [^n]: [title](url)
	const defLines = resourcesSection
		.split("\n")
		.filter((line) => /^\[\^\d+\]:/.test(line));

	expect(defLines.length).toBeGreaterThan(0);

	for (const line of defLines) {
		// Must match single-line format: [^n]: [title](url)
		expect(line).toMatch(/^\[\^\d+\]: \[[^\]]+\]\([^)]+\)$/);
	}
}

/** Assert Resources section has NO bare second line duplicating a link below a [^n]: def. */
function assertNoOrphanLinkLine(resourcesSection: string): void {
	const lines = resourcesSection.split("\n");
	for (let i = 0; i < lines.length - 1; i++) {
		// If this line is a [^n]: def ...
		if (/^\[\^\d+\]:/.test(lines[i])) {
			const nextLine = lines[i + 1];
			// ... the next line must NOT be a bare markdown link (the old bug was a
			// second line with [title](url) that duplicated the def's own link content)
			const isDefLine = /^\[\^\d+\]:/.test(nextLine);
			const isBlank = nextLine.trim() === "";
			const isHeading = nextLine.startsWith("#");
			// A lone [title](url) line after a [^n]: line is the bug
			if (!isDefLine && !isBlank && !isHeading) {
				expect(nextLine).not.toMatch(/^\[[^\]]+\]\(https?:\/\//);
			}
		}
	}
}

// ---------------------------------------------------------------------------
// perplexityAppScript
// ---------------------------------------------------------------------------

describe("perplexityAppScript", () => {
	it("returns a non-empty EditPlan", async () => {
		const ctx = makeCtx(appInput);
		const plan = await perplexityAppScript(ctx);
		expect(plan).toBeDefined();
		expect(Array.isArray(plan)).toBe(true);
		expect((plan as EditPlan).length).toBeGreaterThan(0);
	});

	it("output has no Sources/Quellen/Citations scaffolding", async () => {
		const ctx = makeCtx(appInput);
		const plan = await perplexityAppScript(ctx) as EditPlan;
		const output = applyPlan(plan);
		assertNoScaffolding(output);
	});

	it("output has no bare source-entry lines (pattern: [n] title url)", async () => {
		const ctx = makeCtx(appInput);
		const plan = await perplexityAppScript(ctx) as EditPlan;
		const output = applyPlan(plan);
		// No lines matching [n] Some Title https://...
		expect(output).not.toMatch(/^\[\d+\]\s+\S.*https?:\/\//m);
	});

	it("inline citations in body are [^n] form, not bare [n]", async () => {
		const ctx = makeCtx(appInput);
		const plan = await perplexityAppScript(ctx) as EditPlan;
		const output = applyPlan(plan);
		const body = extractBodySection(output);
		assertFootnoteMarkerForm(body);
	});

	it("output contains a ## Resources section", async () => {
		const ctx = makeCtx(appInput);
		const plan = await perplexityAppScript(ctx) as EditPlan;
		const output = applyPlan(plan);
		expect(output).toContain("## Resources");
	});

	it("Resources section contains two-line F4 definitions", async () => {
		const ctx = makeCtx(appInput);
		const plan = await perplexityAppScript(ctx) as EditPlan;
		const output = applyPlan(plan);
		const resources = extractResourcesSection(output);
		assertF4Defs(resources);
	});

	it("footnote numbering is gap-free 1..K and body/Resources are consistent", async () => {
		const ctx = makeCtx(appInput);
		const plan = await perplexityAppScript(ctx) as EditPlan;
		const output = applyPlan(plan);
		assertFootnoteConsistency(output);
	});

	it("K equals count of distinct normalized URLs among CITED sources (dedup confirmed)", async () => {
		const ctx = makeCtx(appInput);
		const plan = await perplexityAppScript(ctx) as EditPlan;
		const output = applyPlan(plan);
		const { K } = assertFootnoteConsistency(output);

		// Compute expected K from the parser output.
		// Only sources actually cited in pr.inline are included (uncited sources
		// that appear only in the Sources block but not in prose are excluded to
		// avoid orphan Resource defs with no corresponding body marker).
		const pr = perplexityApp.parse(appInput);
		const citedIds = new Set(pr.inline.map((m) => m.n));
		const citedSources = pr.sources.filter((s) => citedIds.has(s.incomingId));
		const seen = new Set<string>();
		for (const s of citedSources) {
			seen.add(normalizeUrl(s.url));
		}
		const expectedK = seen.size;

		expect(K).toBe(expectedK);
		// Dedup DID happen (K < 26 sources total)
		expect(K).toBeLessThan(26);
		// The 26 sources include cross-block duplicates; cited dedup reflects this
		expect(citedSources.length).toBeLessThan(26);
	});

	it("output retains BOTH Question headings (Tokyo + Sapporo)", async () => {
		const ctx = makeCtx(appInput);
		const plan = await perplexityAppScript(ctx) as EditPlan;
		const output = applyPlan(plan);
		const body = extractBodySection(output);
		// Both ## Question headings must be present in body
		const questionMatches = (body.match(/^## Question$/gm) ?? []).length;
		expect(questionMatches).toBe(2);
	});

	it("output body contains the Sapporo question text", async () => {
		const ctx = makeCtx(appInput);
		const plan = await perplexityAppScript(ctx) as EditPlan;
		const output = applyPlan(plan);
		expect(extractBodySection(output)).toContain("When will it be in Sapporo?");
	});

	it("output body contains Tokyo sakura prose", async () => {
		const ctx = makeCtx(appInput);
		const plan = await perplexityAppScript(ctx) as EditPlan;
		const output = applyPlan(plan);
		expect(extractBodySection(output)).toContain("sakura are forecast to start blooming");
	});
});

// ---------------------------------------------------------------------------
// perplexityWebScript
// ---------------------------------------------------------------------------

describe("perplexityWebScript", () => {
	it("returns a non-empty EditPlan", async () => {
		const ctx = makeCtx(webInput);
		const plan = await perplexityWebScript(ctx);
		expect(plan).toBeDefined();
		expect(Array.isArray(plan)).toBe(true);
		expect((plan as EditPlan).length).toBeGreaterThan(0);
	});

	it("output has no Sources/Quellen/Citations scaffolding", async () => {
		const ctx = makeCtx(webInput);
		const plan = await perplexityWebScript(ctx) as EditPlan;
		const output = applyPlan(plan);
		assertNoScaffolding(output);
	});

	it("output body has no raw [text](url) citation links", async () => {
		const ctx = makeCtx(webInput);
		const plan = await perplexityWebScript(ctx) as EditPlan;
		const output = applyPlan(plan);
		const body = extractBodySection(output);
		// The web parser replaces [text](url) with [^n], so no such links should remain in body
		// (excluding the Resources section which has [title](url) as part of F4 defs)
		expect(body).not.toMatch(/\[[\w-]+\]\(https?:\/\//);
	});

	it("output contains a ## Resources section", async () => {
		const ctx = makeCtx(webInput);
		const plan = await perplexityWebScript(ctx) as EditPlan;
		const output = applyPlan(plan);
		expect(output).toContain("## Resources");
	});

	it("Resources section contains single-line compact defs (no second duplicate link line)", async () => {
		const ctx = makeCtx(webInput);
		const plan = await perplexityWebScript(ctx) as EditPlan;
		const output = applyPlan(plan);
		const resources = extractResourcesSection(output);
		assertCompactDefs(resources);
		assertNoOrphanLinkLine(resources);
	});

	it("footnote numbering is gap-free 1..K and body/Resources are consistent", async () => {
		const ctx = makeCtx(webInput);
		const plan = await perplexityWebScript(ctx) as EditPlan;
		const output = applyPlan(plan);
		assertFootnoteConsistency(output);
	});
});

// ---------------------------------------------------------------------------
// perplexityWebDownloadScript
// ---------------------------------------------------------------------------

describe("perplexityWebDownloadScript", () => {
	it("returns a non-empty EditPlan", async () => {
		const ctx = makeCtx(webDownloadInput);
		const plan = await perplexityWebDownloadScript(ctx);
		expect(plan).toBeDefined();
		expect(Array.isArray(plan)).toBe(true);
		expect((plan as EditPlan).length).toBeGreaterThan(0);
	});

	it("output has no Sources/Quellen/Citations scaffolding", async () => {
		const ctx = makeCtx(webDownloadInput);
		const plan = await perplexityWebDownloadScript(ctx) as EditPlan;
		const output = applyPlan(plan);
		assertNoScaffolding(output);
	});

	it("output body has no [^a_b] web-download markers", async () => {
		const ctx = makeCtx(webDownloadInput);
		const plan = await perplexityWebDownloadScript(ctx) as EditPlan;
		const output = applyPlan(plan);
		const body = extractBodySection(output);
		expect(body).not.toMatch(/\[\^\w+_\w+\]/);
	});

	it("output contains a ## Resources section", async () => {
		const ctx = makeCtx(webDownloadInput);
		const plan = await perplexityWebDownloadScript(ctx) as EditPlan;
		const output = applyPlan(plan);
		expect(output).toContain("## Resources");
	});

	it("Resources section contains single-line compact defs (no second duplicate link line)", async () => {
		const ctx = makeCtx(webDownloadInput);
		const plan = await perplexityWebDownloadScript(ctx) as EditPlan;
		const output = applyPlan(plan);
		const resources = extractResourcesSection(output);
		assertCompactDefs(resources);
		assertNoOrphanLinkLine(resources);
	});

	it("footnote numbering is gap-free 1..K and body/Resources are consistent", async () => {
		const ctx = makeCtx(webDownloadInput);
		const plan = await perplexityWebDownloadScript(ctx) as EditPlan;
		const output = applyPlan(plan);
		assertFootnoteConsistency(output);
	});
});

