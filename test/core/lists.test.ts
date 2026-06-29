// test/core/lists.test.ts — Phase 3 list transforms
// TDD: tests written BEFORE implementation (RED phase).
//
// Covers:
//   T3.1 — normalizeBullets: replace non-'-' leading bullet markers with '-'
//   T3.2 — normalizeOrdered: renumber ordered list items sequentially per indent level

import { describe, it, expect } from "vitest";
import type { OperationContext } from "../../src/core/types";
import { normalizeBullets, normalizeOrdered } from "../../src/core/lists";
import { applyToString } from "../../src/core/applyToString";

// ---------------------------------------------------------------------------
// Test factory
// ---------------------------------------------------------------------------

const makeSettings = () => ({ debugLogging: false as const, resourcesName: "Resources" });
const makeCtx = (doc: string): OperationContext => ({ doc, cursor: 0, settings: makeSettings() });

// ============================================================
// T3.1 — normalizeBullets
// ============================================================

describe("normalizeBullets — * bullet list → all markers -", () => {
	it("replaces * markers with -", () => {
		const doc = "* foo\n* bar\n* baz\n";
		expect(applyToString(doc, normalizeBullets(makeCtx(doc)))).toBe("- foo\n- bar\n- baz\n");
	});

	it("item text is unchanged", () => {
		const doc = "* hello world\n";
		expect(applyToString(doc, normalizeBullets(makeCtx(doc)))).toBe("- hello world\n");
	});
});

describe("normalizeBullets — + bullet list → all markers -", () => {
	it("replaces + markers with -", () => {
		const doc = "+ alpha\n+ beta\n";
		expect(applyToString(doc, normalizeBullets(makeCtx(doc)))).toBe("- alpha\n- beta\n");
	});
});

describe("normalizeBullets — • bullet list → all markers -", () => {
	it("replaces • markers with -", () => {
		const doc = "• one\n• two\n";
		expect(applyToString(doc, normalizeBullets(makeCtx(doc)))).toBe("- one\n- two\n");
	});
});

describe("normalizeBullets — – bullet list → all markers -", () => {
	it("replaces – (en dash U+2013) markers with -", () => {
		const doc = "– first\n– second\n";
		expect(applyToString(doc, normalizeBullets(makeCtx(doc)))).toBe("- first\n- second\n");
	});
});

describe("normalizeBullets — · bullet list → all markers -", () => {
	it("replaces · (U+00B7) markers with -", () => {
		const doc = "· item\n";
		expect(applyToString(doc, normalizeBullets(makeCtx(doc)))).toBe("- item\n");
	});
});

describe("normalizeBullets — nested mixed-marker list", () => {
	it("replaces markers at all levels; preserves indentation exactly", () => {
		const doc = "* top\n  + nested\n* top2\n";
		const out = applyToString(doc, normalizeBullets(makeCtx(doc)));
		expect(out).toBe("- top\n  - nested\n- top2\n");
	});

	it("does not change any character other than the marker glyph", () => {
		const doc = "* top\n  + nested\n";
		const out = applyToString(doc, normalizeBullets(makeCtx(doc)));
		// Leading spaces of nested line preserved
		expect(out.split("\n")[1]).toBe("  - nested");
	});
});

describe("normalizeBullets — checkbox/task-list items", () => {
	it("- [ ] task remains unchanged (marker already -)", () => {
		const doc = "- [ ] task\n";
		const plan = normalizeBullets(makeCtx(doc));
		expect(plan).toHaveLength(0);
	});

	it("* [x] done → - [x] done (checkbox preserved, only marker glyph changed)", () => {
		const doc = "* [x] done\n";
		expect(applyToString(doc, normalizeBullets(makeCtx(doc)))).toBe("- [x] done\n");
	});
});

describe("normalizeBullets — ordered list untouched", () => {
	it("ordered items 1. 2. 3. produce empty plan", () => {
		const doc = "1. first\n2. second\n3. third\n";
		expect(normalizeBullets(makeCtx(doc))).toHaveLength(0);
	});
});

describe("normalizeBullets — mixed doc (bullet + ordered + paragraph)", () => {
	it("only bullet markers are changed; ordered and paragraph lines untouched", () => {
		const doc = "Intro paragraph.\n\n* item a\n* item b\n\n1. one\n2. two\n\nTail.\n";
		const out = applyToString(doc, normalizeBullets(makeCtx(doc)));
		expect(out).toBe("Intro paragraph.\n\n- item a\n- item b\n\n1. one\n2. two\n\nTail.\n");
	});
});

describe("normalizeBullets — mid-sentence bullet character untouched", () => {
	it("item starting with - that contains • mid-text leaves • in place", () => {
		// The line starts with "- " so it's already a - marker (no replacement needed).
		// The • inside the item text must NOT be rewritten.
		const doc = "- buy milk • eggs\n";
		const plan = normalizeBullets(makeCtx(doc));
		// Marker is already -, so plan should be empty
		expect(plan).toHaveLength(0);
		expect(applyToString(doc, plan)).toBe("- buy milk • eggs\n");
	});

	it("item starting with * that contains • mid-text: only leading * replaced, • unchanged", () => {
		const doc = "* buy milk • eggs\n";
		const out = applyToString(doc, normalizeBullets(makeCtx(doc)));
		expect(out).toBe("- buy milk • eggs\n");
	});
});

describe("normalizeBullets — idempotency", () => {
	it("all-dash doc returns [] on second pass", () => {
		const doc = "- foo\n- bar\n  - nested\n";
		const first = applyToString(doc, normalizeBullets(makeCtx(doc)));
		expect(normalizeBullets(makeCtx(first))).toHaveLength(0);
	});

	it("applying twice produces same result as once", () => {
		const doc = "* a\n+ b\n• c\n";
		const once = applyToString(doc, normalizeBullets(makeCtx(doc)));
		const twice = applyToString(once, normalizeBullets(makeCtx(once)));
		expect(twice).toBe(once);
	});
});

// ============================================================
// T3.2 — normalizeOrdered
// ============================================================

describe("normalizeOrdered — flat list out-of-sequence → 1. 2. 3.", () => {
	it("renumbers 3. 1. 7. to 1. 2. 3.", () => {
		const doc = "3. foo\n1. bar\n7. baz\n";
		expect(applyToString(doc, normalizeOrdered(makeCtx(doc)))).toBe("1. foo\n2. bar\n3. baz\n");
	});

	it("emits one edit per wrong number", () => {
		const doc = "3. foo\n1. bar\n7. baz\n";
		// 3 should be 1, 1 should be 2, 7 should be 3 → 3 edits
		expect(normalizeOrdered(makeCtx(doc))).toHaveLength(3);
	});
});

describe("normalizeOrdered — already-sequential list → []", () => {
	it("1. 2. 3. returns empty plan (idempotent)", () => {
		const doc = "1. foo\n2. bar\n3. baz\n";
		expect(normalizeOrdered(makeCtx(doc))).toHaveLength(0);
	});
});

describe("normalizeOrdered — nested 2-level out-of-sequence", () => {
	it("each level renumbered independently from 1; indentation preserved", () => {
		// Top level: 3. → 1., 2. stays 2. (already ok after renumbering)
		// Nested level (indented): 5. → 1., 8. → 2.
		const doc = "3. top a\n   5. nested a\n   8. nested b\n2. top b\n";
		const out = applyToString(doc, normalizeOrdered(makeCtx(doc)));
		expect(out).toBe("1. top a\n   1. nested a\n   2. nested b\n2. top b\n");
	});
});

describe("normalizeOrdered — nested 3-level", () => {
	it("correct per-level counters at 3 levels", () => {
		const doc = [
			"5. L1a",
			"   3. L2a",
			"      7. L3a",
			"      2. L3b",
			"   1. L2b",
			"9. L1b",
		].join("\n") + "\n";
		const expected = [
			"1. L1a",
			"   1. L2a",
			"      1. L3a",
			"      2. L3b",
			"   2. L2b",
			"2. L1b",
		].join("\n") + "\n";
		expect(applyToString(doc, normalizeOrdered(makeCtx(doc)))).toBe(expected);
	});
});

describe("normalizeOrdered — loose list (blank lines between items)", () => {
	it("blank lines preserved; only numbers change", () => {
		const doc = "3. foo\n\n1. bar\n\n7. baz\n";
		const out = applyToString(doc, normalizeOrdered(makeCtx(doc)));
		expect(out).toBe("1. foo\n\n2. bar\n\n3. baz\n");
	});
});

describe("normalizeOrdered — alphabetic markers untouched", () => {
	it("a. b. c. returns empty plan", () => {
		const doc = "a. first\nb. second\nc. third\n";
		expect(normalizeOrdered(makeCtx(doc))).toHaveLength(0);
	});
});

describe("normalizeOrdered — roman-numeral markers untouched", () => {
	it("i. ii. iii. returns empty plan", () => {
		const doc = "i. one\nii. two\niii. three\n";
		expect(normalizeOrdered(makeCtx(doc))).toHaveLength(0);
	});
});

describe("normalizeOrdered — bullet list untouched", () => {
	it("bullet list returns empty plan", () => {
		const doc = "- alpha\n- beta\n* gamma\n";
		expect(normalizeOrdered(makeCtx(doc))).toHaveLength(0);
	});
});

describe("normalizeOrdered — mixed doc (ordered + bullet + paragraph)", () => {
	it("only ordered items are renumbered; bullet and paragraph untouched", () => {
		const doc = "Intro.\n\n3. first\n1. second\n\n- bullet\n- bullet2\n\nTail.\n";
		const out = applyToString(doc, normalizeOrdered(makeCtx(doc)));
		expect(out).toBe("Intro.\n\n1. first\n2. second\n\n- bullet\n- bullet2\n\nTail.\n");
	});
});

describe("normalizeOrdered — period and paren terminators", () => {
	it("period terminator 1. 2. 3. style preserved", () => {
		const doc = "3. a\n1. b\n";
		const out = applyToString(doc, normalizeOrdered(makeCtx(doc)));
		expect(out).toBe("1. a\n2. b\n");
		expect(out).toContain("1.");
		expect(out).toContain("2.");
	});

	it("paren terminator 2) 5) 1) → 1) 2) 3)", () => {
		const doc = "2) a\n5) b\n1) c\n";
		const out = applyToString(doc, normalizeOrdered(makeCtx(doc)));
		expect(out).toBe("1) a\n2) b\n3) c\n");
	});

	it("paren terminator style preserved (no period added)", () => {
		const doc = "2) item\n";
		const out = applyToString(doc, normalizeOrdered(makeCtx(doc)));
		expect(out).toBe("1) item\n");
	});
});

describe("normalizeOrdered — multi-digit numbers", () => {
	it("correctly replaces 10. with 1.", () => {
		const doc = "10. item\n";
		expect(applyToString(doc, normalizeOrdered(makeCtx(doc)))).toBe("1. item\n");
	});

	it("correctly replaces to a 2-digit number when items > 9", () => {
		const items = Array.from({ length: 10 }, (_, i) => `${i + 2}. item${i + 1}`).join("\n") + "\n";
		const out = applyToString(items, normalizeOrdered(makeCtx(items)));
		expect(out).toContain("10. item10");
	});
});

describe("normalizeOrdered — idempotency", () => {
	it("running on own output returns []", () => {
		const doc = "3. foo\n1. bar\n7. baz\n";
		const first = applyToString(doc, normalizeOrdered(makeCtx(doc)));
		expect(normalizeOrdered(makeCtx(first))).toHaveLength(0);
	});

	it("nested list idempotency", () => {
		const doc = "3. L1a\n   5. L2a\n   8. L2b\n2. L1b\n";
		const first = applyToString(doc, normalizeOrdered(makeCtx(doc)));
		expect(normalizeOrdered(makeCtx(first))).toHaveLength(0);
	});
});

describe("normalizeOrdered — counter reset between distinct lists (T3.2 bug fix)", () => {
	it("sequential second list after paragraph: no edits emitted (both lists already 1,2)", () => {
		// Two distinct lists separated by a paragraph — each should start from 1.
		// Both are already sequential so no edits expected.
		const doc = "1. a\n2. b\n\nSome paragraph.\n\n1. x\n2. y\n";
		expect(normalizeOrdered(makeCtx(doc))).toHaveLength(0);
	});

	it("out-of-order second list after paragraph: renumbered from 1 (not continuing prior count)", () => {
		// First list: 1. a, 2. b — already correct, no edits.
		// Paragraph separates them.
		// Second list: 5. x, 9. y — should be renumbered to 1. x, 2. y.
		const doc = "1. a\n2. b\n\npara\n\n5. x\n9. y\n";
		const out = applyToString(doc, normalizeOrdered(makeCtx(doc)));
		expect(out).toBe("1. a\n2. b\n\npara\n\n1. x\n2. y\n");
	});

	it("loose list (blank-separated items) still continues numbering across blanks", () => {
		// Items in one logical list separated only by blank lines — numbering continues.
		const doc = "1. a\n\n2. b\n\n3. c\n";
		expect(normalizeOrdered(makeCtx(doc))).toHaveLength(0);
	});

	it("out-of-order loose list still renumbered as one sequence", () => {
		// Blanks only (no structural separator) → single list, renumber as sequence.
		const doc = "3. foo\n\n1. bar\n\n7. baz\n";
		const out = applyToString(doc, normalizeOrdered(makeCtx(doc)));
		expect(out).toBe("1. foo\n\n2. bar\n\n3. baz\n");
	});
});
