// test/core/cleanup.test.ts — Phase 2 cleanup transforms
// TDD: tests written before implementation.

import { describe, it, expect } from "vitest";
import type { OperationContext } from "../../src/core/types";
import { dehyphenate } from "../../src/core/cleanup";
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
