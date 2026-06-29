// test/core/formatPipeline.test.ts — TDD: RED before src/core/formatPipeline.ts exists
// Tests written before the implementation per spec 005 T1.1.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import type { FormatSelectionRecipe } from "../../src/core/formatSelection";
// Importing from the file that does not exist yet — tests fail until GREEN phase.
import { applyTextCleanup } from "../../src/core/formatPipeline";
import type { StepLogger } from "../../src/core/formatPipeline";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const allOff: FormatSelectionRecipe = {
	cascade:            false,
	normalize:          false,
	fromCitations:      false,
	identity:           false,
	move:               false,
	dewrap:             false,
	dehyphenate:        false,
	decomposeLigatures: false,
	tidyWhitespace:     false,
	normalizeBullets:   false,
	normalizeOrdered:   false,
};

const allOn: FormatSelectionRecipe = {
	cascade:            true,
	normalize:          true,
	fromCitations:      true,
	identity:           true,
	move:               true,
	dewrap:             true,
	dehyphenate:        true,
	decomposeLigatures: true,
	tidyWhitespace:     true,
	normalizeBullets:   true,
	normalizeOrdered:   true,
};

/**
 * A compound document that contains one artifact for each of the 7 cleanup
 * transforms. Applying allOn should produce COMPOUND_EXPECTED below.
 *
 * Artifacts:
 *   dehyphenate:        "dis-\ntance"      → "distance"
 *   dewrap:             "A para\nthat wraps." (separate paragraph) → one line
 *   tidyWhitespace:     "Multi  space.  "  → "Multi space."
 *   decomposeLigatures: "ﬁne"         → "fine"  (ﬁ = ﬁ ligature)
 *   normalizeBullets:   "+"/""*"            → "-"
 *   normalizeOrdered:   "2. First item"    → "1. First item" etc.
 *   normalize:          "### Skipped"      → "## Skipped" (H1→H3 gap)
 */
const COMPOUND_DOC = [
	"# Heading One",
	"",
	"### Skipped Level",
	"",
	"the dis-",
	"tance is ﬁne.",
	"",
	"A para",
	"that wraps.",
	"",
	"+ Bullet item",
	"* Bullet two",
	"",
	"2. First item",
	"1. Second item",
	"",
	"Multi  space.  ",
	"",
].join("\n");

const COMPOUND_EXPECTED = [
	"# Heading One",
	"",
	"## Skipped Level",
	"",
	"the distance is fine.",
	"",
	"A para that wraps.",
	"",
	"- Bullet item",
	"- Bullet two",
	"",
	"1. First item",
	"2. Second item",
	"",
	"Multi space.",
	"",
].join("\n");

// ---------------------------------------------------------------------------
// Suite 1 — all 7 steps run in order
// ---------------------------------------------------------------------------

describe("applyTextCleanup — all 7 steps applied in sequence", () => {
	it("transforms compound doc through all 7 cleanup steps", () => {
		expect(applyTextCleanup(COMPOUND_DOC, allOn)).toBe(COMPOUND_EXPECTED);
	});

	it("returns empty string unchanged", () => {
		expect(applyTextCleanup("", allOn)).toBe("");
	});

	it("returns already-clean document unchanged", () => {
		const clean = "# H1\n\n## H2\n\n- item\n\n1. first\n2. second\n";
		expect(applyTextCleanup(clean, allOn)).toBe(clean);
	});
});

// ---------------------------------------------------------------------------
// Suite 2 — per-toggle-off: each cleanup key controls its step independently
// ---------------------------------------------------------------------------

describe("applyTextCleanup — dehyphenate toggle", () => {
	it("dehyphenate: true joins end-of-line hyphenation", () => {
		const doc = "the dis-\ntance\n";
		expect(applyTextCleanup(doc, allOn)).toBe("the distance\n");
	});

	it("dehyphenate: false leaves end-of-line hyphen-newline intact", () => {
		const doc = "the dis-\ntance\n";
		const result = applyTextCleanup(doc, { ...allOn, dehyphenate: false });
		// dewrap joins lines with a space when dehyphenate is off, so the
		// hyphen is preserved even if the newline is removed by dewrap.
		expect(result).toContain("dis-");
	});
});

describe("applyTextCleanup — dewrap toggle", () => {
	it("dewrap: true joins soft-wrapped paragraph lines", () => {
		const doc = "soft wrap\nline two\n";
		expect(applyTextCleanup(doc, allOn)).toBe("soft wrap line two\n");
	});

	it("dewrap: false leaves wrapped lines unjoined", () => {
		const doc = "soft wrap\nline two\n";
		const result = applyTextCleanup(doc, { ...allOn, dewrap: false });
		expect(result).toContain("wrap\nline");
	});
});

describe("applyTextCleanup — tidyWhitespace toggle", () => {
	it("tidyWhitespace: true collapses double spaces and strips trailing spaces", () => {
		const doc = "multi  space.  \n";
		expect(applyTextCleanup(doc, allOn)).toBe("multi space.\n");
	});

	it("tidyWhitespace: false leaves double space and trailing spaces intact", () => {
		const doc = "multi  space.  \n";
		const result = applyTextCleanup(doc, { ...allOn, tidyWhitespace: false });
		expect(result).toContain("  ");
	});
});

describe("applyTextCleanup — decomposeLigatures toggle", () => {
	it("decomposeLigatures: true replaces fi ligature with fi", () => {
		const doc = "the ﬁne\n";
		expect(applyTextCleanup(doc, allOn)).toBe("the fine\n");
	});

	it("decomposeLigatures: false leaves ligature intact", () => {
		const doc = "the ﬁne\n";
		const result = applyTextCleanup(doc, { ...allOn, decomposeLigatures: false });
		expect(result).toContain("ﬁ");
	});
});

describe("applyTextCleanup — normalizeBullets toggle", () => {
	it("normalizeBullets: true replaces * bullet with -", () => {
		const doc = "* item\n";
		expect(applyTextCleanup(doc, allOn)).toBe("- item\n");
	});

	it("normalizeBullets: false leaves non-dash bullet intact", () => {
		const doc = "* item\n";
		const result = applyTextCleanup(doc, { ...allOn, normalizeBullets: false });
		expect(result).toContain("* ");
	});
});

describe("applyTextCleanup — normalizeOrdered toggle", () => {
	it("normalizeOrdered: true renumbers ordered list items sequentially", () => {
		const doc = "2. first\n";
		expect(applyTextCleanup(doc, allOn)).toBe("1. first\n");
	});

	it("normalizeOrdered: false leaves wrong ordinal intact", () => {
		const doc = "2. first\n";
		const result = applyTextCleanup(doc, { ...allOn, normalizeOrdered: false });
		expect(result).toContain("2.");
	});
});

describe("applyTextCleanup — normalize (headings) toggle", () => {
	it("normalize: true closes heading level gaps", () => {
		const doc = "# H1\n\n### H3\n";
		expect(applyTextCleanup(doc, allOn)).toBe("# H1\n\n## H3\n");
	});

	it("normalize: false leaves skipped heading level intact", () => {
		const doc = "# H1\n\n### H3\n";
		const result = applyTextCleanup(doc, { ...allOn, normalize: false });
		expect(result).toContain("### H3");
	});
});

// ---------------------------------------------------------------------------
// Suite 2b — all 7 cleanup toggles off: document is returned unchanged
// ---------------------------------------------------------------------------

describe("applyTextCleanup — all 7 cleanup toggles off", () => {
	it("returns compound doc unchanged when all 7 cleanup keys are false", () => {
		expect(applyTextCleanup(COMPOUND_DOC, allOff)).toBe(COMPOUND_DOC);
	});
});

// ---------------------------------------------------------------------------
// Suite 3 — non-cleanup keys have no effect on output
// ---------------------------------------------------------------------------

describe("applyTextCleanup — non-cleanup recipe keys do not affect output", () => {
	it("cascade: false produces same output as cascade: true", () => {
		expect(applyTextCleanup(COMPOUND_DOC, { ...allOn, cascade: false }))
			.toBe(applyTextCleanup(COMPOUND_DOC, allOn));
	});

	it("fromCitations: false produces same output as fromCitations: true", () => {
		expect(applyTextCleanup(COMPOUND_DOC, { ...allOn, fromCitations: false }))
			.toBe(applyTextCleanup(COMPOUND_DOC, allOn));
	});

	it("identity: false produces same output as identity: true", () => {
		expect(applyTextCleanup(COMPOUND_DOC, { ...allOn, identity: false }))
			.toBe(applyTextCleanup(COMPOUND_DOC, allOn));
	});

	it("move: false produces same output as move: true", () => {
		expect(applyTextCleanup(COMPOUND_DOC, { ...allOn, move: false }))
			.toBe(applyTextCleanup(COMPOUND_DOC, allOn));
	});

	it("all non-cleanup keys off together produces same output as all on", () => {
		const withNonCleanupOff = { ...allOn, cascade: false, fromCitations: false, identity: false, move: false };
		expect(applyTextCleanup(COMPOUND_DOC, withNonCleanupOff))
			.toBe(applyTextCleanup(COMPOUND_DOC, allOn));
	});
});

// ---------------------------------------------------------------------------
// Suite 4 — idempotency
// ---------------------------------------------------------------------------

describe("applyTextCleanup — idempotency", () => {
	it("applying twice to compound doc returns same string as applying once", () => {
		const first = applyTextCleanup(COMPOUND_DOC, allOn);
		const second = applyTextCleanup(first, allOn);
		expect(second).toBe(first);
	});

	it("applying twice to a heading-gap doc returns same string", () => {
		const doc = "# H1\n\n### H3\n";
		const first = applyTextCleanup(doc, allOn);
		expect(applyTextCleanup(first, allOn)).toBe(first);
	});
});

// ---------------------------------------------------------------------------
// Suite 5 — StepLogger
// ---------------------------------------------------------------------------

describe("applyTextCleanup — StepLogger", () => {
	it("emits exactly 7 log lines when all toggles are on", () => {
		const lines: string[] = [];
		const logger: StepLogger = (line) => lines.push(line);
		applyTextCleanup(COMPOUND_DOC, allOn, logger);
		expect(lines).toHaveLength(7);
	});

	it("each log line starts with 'format: '", () => {
		const lines: string[] = [];
		applyTextCleanup(COMPOUND_DOC, allOn, (line) => lines.push(line));
		expect(lines.every((l) => l.startsWith("format: "))).toBe(true);
	});

	it("log lines are emitted in step order: dehyphenate first, normalize last", () => {
		const lines: string[] = [];
		applyTextCleanup(COMPOUND_DOC, allOn, (line) => lines.push(line));
		expect(lines[0]).toMatch(/dehyphenate/);
		expect(lines[1]).toMatch(/dewrap/);
		expect(lines[2]).toMatch(/tidyWhitespace/);
		expect(lines[3]).toMatch(/decomposeLigatures/);
		expect(lines[4]).toMatch(/normalizeBullets/);
		expect(lines[5]).toMatch(/normalizeOrdered/);
		expect(lines[6]).toMatch(/^format: normalize \d/);
	});

	it("skipped step emits 'skipped (toggle off)' message", () => {
		const lines: string[] = [];
		applyTextCleanup(COMPOUND_DOC, { ...allOn, dehyphenate: false }, (line) => lines.push(line));
		expect(lines).toHaveLength(7);
		expect(lines[0]).toContain("skipped (toggle off)");
		expect(lines[0]).toContain("dehyphenate");
	});

	it("active step producing 1 edit logs a line ending in '1 edit' (singular)", () => {
		const lines: string[] = [];
		// normalize produces exactly 1 edit: H3 → H2 (closes a single level gap)
		const doc = "# H1\n\n### H3\n";
		applyTextCleanup(doc, { ...allOff, normalize: true }, (line) => lines.push(line));
		const normalizeLine = lines.find((l) => l.startsWith("format: normalize "));
		expect(normalizeLine).toMatch(/\b1 edit$/);
	});

	it("active step producing 2+ edits logs a line ending in 'edits' (plural)", () => {
		const lines: string[] = [];
		// normalizeBullets produces 2 edits: two `*` bullets → `-`
		const doc = "* item one\n* item two\n";
		applyTextCleanup(doc, { ...allOff, normalizeBullets: true }, (line) => lines.push(line));
		const bulletLine = lines.find((l) => l.startsWith("format: normalizeBullets "));
		expect(bulletLine).toMatch(/\b2 edits$/);
	});

	it("running without a logger does not throw", () => {
		expect(() => applyTextCleanup(COMPOUND_DOC, allOn)).not.toThrow();
	});

	it("output is identical whether or not a logger is supplied", () => {
		const withLog: string[] = [];
		const resultWithLog = applyTextCleanup(COMPOUND_DOC, allOn, (l) => withLog.push(l));
		const resultNoLog  = applyTextCleanup(COMPOUND_DOC, allOn);
		expect(resultWithLog).toBe(resultNoLog);
	});
});

// ---------------------------------------------------------------------------
// Suite 6 — CON-2: no obsidian import
// ---------------------------------------------------------------------------

describe("applyTextCleanup — CON-2: src/core/formatPipeline.ts has no obsidian import", () => {
	it("formatPipeline.ts contains no import from 'obsidian'", () => {
		const __dirname = path.dirname(fileURLToPath(import.meta.url));
		const filePath = path.resolve(__dirname, "../../src/core/formatPipeline.ts");
		const content = fs.readFileSync(filePath, "utf8");
		const OBSIDIAN_IMPORT =
			/(from\s+['"]obsidian['"])|(require\(\s*['"]obsidian['"]\s*\))|(import\s+['"]obsidian['"])/;
		const lines = content.split("\n");
		const violations = lines
			.filter((l) => !/^\s*\/\//.test(l) && !/^\s*\/?\*/.test(l))
			.filter((l) => OBSIDIAN_IMPORT.test(l));
		expect(violations).toHaveLength(0);
	});
});
