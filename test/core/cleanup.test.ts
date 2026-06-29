// test/core/cleanup.test.ts — Phase 2 cleanup transforms
// TDD: tests written before implementation.

import { describe, it, expect } from "vitest";
import type { OperationContext } from "../../src/core/types";
import { dehyphenate, dewrap, decomposeLigatures, GLYPH_MAP } from "../../src/core/cleanup";
import { applyToString } from "../../src/core/applyToString";

const makeSettings = () => ({ debugLogging: false as const, resourcesName: "Resources" });
const makeCtx = (doc: string): OperationContext => ({ doc, cursor: 0, settings: makeSettings() });

// ============================================================
// T2.1 — dehyphenate
// ============================================================

describe("dehyphenate — lowercase-to-lowercase end-of-line hyphenation", () => {
	it("joins exam-\\nple to example", () => {
		const doc = "exam-\nple\n";
		expect(applyToString(doc, dehyphenate(makeCtx(doc)))).toBe("example\n");
	});

	it("emits one edit with correct offsets: from=4, to=6, insert=''", () => {
		const doc = "exam-\nple\n";
		const plan = dehyphenate(makeCtx(doc));
		expect(plan).toHaveLength(1);
		expect(plan[0]).toEqual({ from: 4, to: 6, insert: "" });
	});

	it("leaves PDF-\\nconverter untouched (uppercase on left)", () => {
		const doc = "PDF-\nconverter\n";
		expect(dehyphenate(makeCtx(doc))).toHaveLength(0);
	});

	it("leaves base-\\n64 untouched (digit on right)", () => {
		const doc = "base-\n64\n";
		expect(dehyphenate(makeCtx(doc))).toHaveLength(0);
	});

	it("leaves well-known untouched (compound hyphen, no newline)", () => {
		const doc = "well-known\n";
		expect(dehyphenate(makeCtx(doc))).toHaveLength(0);
	});

	it("skips -\\n inside a fenced code block", () => {
		const doc = "```\nexam-\nple\n```\n";
		expect(dehyphenate(makeCtx(doc))).toHaveLength(0);
	});

	it("skips -\\n inside an inline code span spanning lines", () => {
		const doc = "before `co-\nde` after\n";
		expect(dehyphenate(makeCtx(doc))).toHaveLength(0);
	});

	it("joins all split words in a doc; edit count equals join count", () => {
		const doc = "dis-\ntance and frag-\nment\n";
		const plan = dehyphenate(makeCtx(doc));
		expect(applyToString(doc, plan)).toBe("distance and fragment\n");
		expect(plan).toHaveLength(2);
	});

	it("is idempotent: second pass returns []", () => {
		const doc = "exam-\nple\n";
		const first = applyToString(doc, dehyphenate(makeCtx(doc)));
		expect(dehyphenate(makeCtx(first))).toHaveLength(0);
	});
});

// ============================================================
// T2.2 — dewrap
// ============================================================

describe("dewrap — join soft-wrapped paragraph lines", () => {
	it("joins a two-line paragraph into one line", () => {
		const doc = "line one\nline two\n";
		expect(applyToString(doc, dewrap(makeCtx(doc)))).toBe("line one line two\n");
	});

	it("preserves a blank-line separator between paragraphs", () => {
		const doc = "line one\nline two\n\nnext para\n";
		const result = applyToString(doc, dewrap(makeCtx(doc)));
		expect(result).toBe("line one line two\n\nnext para\n");
	});

	it("joins each of three multi-line paragraphs independently, blanks intact", () => {
		const doc = "aa\nbb\n\ncc\ndd\n\nee\nff\n";
		const result = applyToString(doc, dewrap(makeCtx(doc)));
		expect(result).toBe("aa bb\n\ncc dd\n\nee ff\n");
	});

	it("leaves a fenced code block with internal line breaks untouched", () => {
		const doc = "```\nline one\nline two\n```\n";
		expect(dewrap(makeCtx(doc))).toHaveLength(0);
	});

	it("does not join an ATX heading to an adjacent paragraph", () => {
		const doc = "## Title\nparagraph line\n";
		const result = applyToString(doc, dewrap(makeCtx(doc)));
		// heading is atxHeading block (skipped), paragraph is single-line (no edit)
		expect(result).toBe("## Title\nparagraph line\n");
	});

	it("does not join setext heading lines to prose", () => {
		const doc = "Heading title\n=============\n\nOther prose\n";
		const result = applyToString(doc, dewrap(makeCtx(doc)));
		expect(result).toBe("Heading title\n=============\n\nOther prose\n");
	});

	it("does not join a list item to an adjacent paragraph", () => {
		const doc = "- item\nContinuation line\n";
		// listItem and paragraph are separate single-line blocks → no edit
		const result = applyToString(doc, dewrap(makeCtx(doc)));
		expect(result).toBe("- item\nContinuation line\n");
	});

	it("does not join blockquote lines to surrounding prose", () => {
		const doc = "> quote line one\n> quote line two\n\nprose\n";
		const result = applyToString(doc, dewrap(makeCtx(doc)));
		// blockquote block is not a paragraph — skipped; prose is single-line
		expect(result).toBe("> quote line one\n> quote line two\n\nprose\n");
	});

	it("does not join a table row to a paragraph", () => {
		const doc = "| col1 | col2 |\nparagraph after\n";
		const result = applyToString(doc, dewrap(makeCtx(doc)));
		// tableRow and paragraph are separate blocks; paragraph is single-line
		expect(result).toBe("| col1 | col2 |\nparagraph after\n");
	});

	it("does not merge two paragraphs separated by a blank line", () => {
		const doc = "para one\n\npara two\n";
		const result = applyToString(doc, dewrap(makeCtx(doc)));
		expect(result).toBe("para one\n\npara two\n");
	});

	it("emits no edit for a single-line paragraph", () => {
		const doc = "just one line\n";
		expect(dewrap(makeCtx(doc))).toHaveLength(0);
	});

	it("is idempotent: second pass returns []", () => {
		const doc = "line one\nline two\n\nother line\nanother line\n";
		const first = applyToString(doc, dewrap(makeCtx(doc)));
		expect(dewrap(makeCtx(first))).toHaveLength(0);
	});
});

// ============================================================
// T2.3 — decomposeLigatures
// ============================================================

describe("decomposeLigatures — canonical ligatures", () => {
	it.each([
		["ﬁ", "fi"],
		["ﬂ", "fl"],
		["ﬀ", "ff"],
		["ﬃ", "ffi"],
		["ﬄ", "ffl"],
		["æ", "ae"],
		["œ", "oe"],
	])("replaces %s with %s", (glyph, expected) => {
		const doc = `word${glyph}end\n`;
		const result = applyToString(doc, decomposeLigatures(makeCtx(doc)));
		expect(result).toBe(`word${expected}end\n`);
	});
});

describe("decomposeLigatures — punctuation", () => {
	it("replaces curly open double quote \\u201C with straight double quote", () => {
		const doc = "“hello”\n";
		expect(applyToString(doc, decomposeLigatures(makeCtx(doc)))).toBe('"hello"\n');
	});

	it("replaces curly close double quote \\u201D with straight double quote", () => {
		const doc = "word”\n";
		expect(applyToString(doc, decomposeLigatures(makeCtx(doc)))).toBe('word"\n');
	});

	it("replaces curly open single quote \\u2018 with straight single quote", () => {
		const doc = "‘word\n";
		expect(applyToString(doc, decomposeLigatures(makeCtx(doc)))).toBe("'word\n");
	});

	it("replaces curly close single quote \\u2019 with straight single quote", () => {
		const doc = "word’s\n";
		expect(applyToString(doc, decomposeLigatures(makeCtx(doc)))).toBe("word's\n");
	});

	it("replaces em dash \\u2014 with hyphen", () => {
		const doc = "word—word\n";
		expect(applyToString(doc, decomposeLigatures(makeCtx(doc)))).toBe("word-word\n");
	});

	it("replaces en dash \\u2013 with hyphen", () => {
		const doc = "pp.–10\n";
		expect(applyToString(doc, decomposeLigatures(makeCtx(doc)))).toBe("pp.-10\n");
	});

	it("replaces ellipsis \\u2026 with three dots", () => {
		const doc = "wait…\n";
		expect(applyToString(doc, decomposeLigatures(makeCtx(doc)))).toBe("wait...\n");
	});
});

describe("decomposeLigatures — safety constraints", () => {
	it("leaves ASCII W and w untouched (homoglyph guard)", () => {
		const doc = "Wide and wow\n";
		expect(decomposeLigatures(makeCtx(doc))).toHaveLength(0);
	});

	it("leaves ligatures inside a fenced code block untouched", () => {
		const doc = "```\nﬁle\n```\n";
		expect(decomposeLigatures(makeCtx(doc))).toHaveLength(0);
	});

	it("leaves a ligature inside an inline code span untouched", () => {
		const doc = "see `ﬁle` for details\n";
		const result = applyToString(doc, decomposeLigatures(makeCtx(doc)));
		expect(result).toBe("see `ﬁle` for details\n");
	});

	it("replaces only the non-code ligature in mixed content", () => {
		const doc = "ﬁrst `ﬂag` here\n";
		const result = applyToString(doc, decomposeLigatures(makeCtx(doc)));
		expect(result).toBe("first `ﬂag` here\n");
	});

	it("GLYPH_MAP values never contain W, w, VV, or vv", () => {
		for (const value of Object.values(GLYPH_MAP)) {
			expect(value).not.toMatch(/W|w|VV|vv/);
		}
	});

	it("is idempotent: second pass returns []", () => {
		const doc = "ﬁle…done\n";
		const first = applyToString(doc, decomposeLigatures(makeCtx(doc)));
		expect(decomposeLigatures(makeCtx(first))).toHaveLength(0);
	});
});
