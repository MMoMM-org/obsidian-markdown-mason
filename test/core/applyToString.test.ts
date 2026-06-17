// applyToString unit tests — RED phase
//
// Tests cover: single edit, multiple non-overlapping edits (in any order),
// insert at end, and the empty-plan no-op.  Offsets are against the ORIGINAL
// document string (ADR-1); right-to-left application must ensure no offset
// drift between edits.

import { describe, it, expect } from "vitest";
import { applyToString } from "../../src/core/applyToString";
import type { EditPlan } from "../../src/core/types";

// ---------------------------------------------------------------------------
// empty plan
// ---------------------------------------------------------------------------

describe("applyToString — empty plan", () => {
	it("returns the doc unchanged when plan is []", () => {
		expect(applyToString("hello world", [])).toBe("hello world");
	});

	it("returns empty string unchanged with empty plan", () => {
		expect(applyToString("", [])).toBe("");
	});
});

// ---------------------------------------------------------------------------
// single edit
// ---------------------------------------------------------------------------

describe("applyToString — single edit", () => {
	it("replaces a range in the middle of the doc", () => {
		// "hello world" → "hello EARTH"
		const plan: EditPlan = [{ from: 6, to: 11, insert: "EARTH" }];
		expect(applyToString("hello world", plan)).toBe("hello EARTH");
	});

	it("inserts text at the start (from === to === 0)", () => {
		const plan: EditPlan = [{ from: 0, to: 0, insert: "START " }];
		expect(applyToString("world", plan)).toBe("START world");
	});

	it("inserts text at the end (from === to === doc.length)", () => {
		const plan: EditPlan = [{ from: 5, to: 5, insert: " end" }];
		expect(applyToString("hello", plan)).toBe("hello end");
	});

	it("deletes a range when insert is empty string", () => {
		// "abcde" → "ade" by deleting "bc" at [1,3)
		// [1,3) spans characters b(1) and c(2); slice(0,1)="a", slice(3)="de"
		const plan: EditPlan = [{ from: 1, to: 3, insert: "" }];
		expect(applyToString("abcde", plan)).toBe("ade");
	});
});

// ---------------------------------------------------------------------------
// multiple non-overlapping edits
// ---------------------------------------------------------------------------

describe("applyToString — multiple non-overlapping edits", () => {
	it("applies two edits supplied in ascending order correctly (no drift)", () => {
		// "aXbYc" → replace X→1 and Y→2
		// "aXbYc" offsets: X=[1,2), Y=[3,4)
		const plan: EditPlan = [
			{ from: 1, to: 2, insert: "1" },
			{ from: 3, to: 4, insert: "2" },
		];
		expect(applyToString("aXbYc", plan)).toBe("a1b2c");
	});

	it("applies two edits supplied in DESCENDING order correctly", () => {
		// Same edits reversed; result must be identical
		const plan: EditPlan = [
			{ from: 3, to: 4, insert: "2" },
			{ from: 1, to: 2, insert: "1" },
		];
		expect(applyToString("aXbYc", plan)).toBe("a1b2c");
	});

	it("applies three inserts at different offsets without drift", () => {
		// doc = "abc"; insert "!" after each char at 1, 2, 3
		const plan: EditPlan = [
			{ from: 1, to: 1, insert: "!" },
			{ from: 2, to: 2, insert: "!" },
			{ from: 3, to: 3, insert: "!" },
		];
		expect(applyToString("abc", plan)).toBe("a!b!c!");
	});
});

// ---------------------------------------------------------------------------
// insert at end
// ---------------------------------------------------------------------------

describe("applyToString — insert at end", () => {
	it("inserts a newline-terminated block at doc.length", () => {
		const doc = "# Note\n\nBody text.";
		const plan: EditPlan = [{ from: doc.length, to: doc.length, insert: "\n\n## Resources\n\n[^1]: snippet\n[Title](https://example.com)" }];
		const result = applyToString(doc, plan);
		expect(result).toContain("## Resources");
		expect(result).toContain("[^1]: snippet");
		expect(result.startsWith("# Note")).toBe(true);
	});
});
