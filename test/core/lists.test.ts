// test/core/lists.test.ts — Phase 3 list transforms
// TDD: tests written BEFORE implementation (RED phase).
//
// Covers:
//   T3.1 — normalizeBullets: replace non-'-' leading bullet markers with '-'

import { describe, it, expect } from "vitest";
import type { OperationContext } from "../../src/core/types";
import { normalizeBullets } from "../../src/core/lists";
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
