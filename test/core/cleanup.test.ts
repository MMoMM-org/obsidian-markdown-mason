// test/core/cleanup.test.ts — Phase 2 cleanup transforms
// TDD: tests written before implementation.

import { describe, it, expect } from "vitest";
import type { OperationContext } from "../../src/core/types";
import { dehyphenate, dewrap } from "../../src/core/cleanup";
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
