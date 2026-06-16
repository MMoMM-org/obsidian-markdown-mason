import { describe, it, expect } from "vitest";
import { cascade, normalize } from "../../src/core/headings";
import type { OperationContext } from "../../src/core/types";

// ---------------------------------------------------------------------------
// T2.3  Heading cascade + normalize
//
// cascade() — relative cascade of ctx.input headings to fit below the nearest
//   heading ABOVE ctx.cursor in ctx.doc.
//   Returns: { plan: EditPlan; noContextHeading: boolean }
//   The plan is a single insert Edit at ctx.cursor (from=to=cursor) containing
//   the transformed input text. Offsets are against the ORIGINAL ctx.doc.
//
// normalize() — whole-note gap closing over ctx.doc headings.
//   Returns: EditPlan of per-heading-line replacement Edits (offsets vs doc).
//
// Signal mechanism decision: cascade returns a result object so the caller
//   (Phase 3 command layer) can surface an Obsidian Notice when there is no
//   heading above the cursor, without coupling this pure domain module to the
//   Obsidian API.
//
// Cascade edit model decision: emit ONE insert Edit (from=cursor, to=cursor,
//   insert=transformedInput). The whole pasted block lands atomically in one
//   CM6 transaction. This is cleaner than per-heading edits over input text
//   that does not yet exist in ctx.doc.
//
// Clamp rule: apply shift, then clamp to [1, 6] so we never emit H7+ or H0.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Test factory helpers
// ---------------------------------------------------------------------------

const makeSettings = () => ({
	debugLogging: false,
	resourcesName: "Resources",
});

const makeCtx = (overrides: Partial<OperationContext>): OperationContext => ({
	doc: "",
	cursor: 0,
	settings: makeSettings(),
	...overrides,
});

// ---------------------------------------------------------------------------
// cascade — happy path: shift = (ctxLevel+1) − minIn
// ---------------------------------------------------------------------------

describe("cascade — standard shift: ### context, min input heading is #", () => {
	// Doc has "### Section" above the cursor (ctxLevel=3).
	// Input has headings at # and ##.
	// shift = (3+1) − 1 = 3.
	// # → #### (1+3=4), ## → ##### (2+3=5).
	const doc = "### Section\n\nSome body text.\n";
	const cursor = doc.length; // paste at end
	const input = "# Intro\n\nParagraph.\n\n## Detail\n\nMore text.\n";
	const ctx = makeCtx({ doc, cursor, input });

	it("returns noContextHeading=false when a heading exists above cursor", () => {
		const result = cascade(ctx);
		expect(result.noContextHeading).toBe(false);
	});

	it("returns a plan with exactly one insert Edit at cursor", () => {
		const result = cascade(ctx);
		expect(result.plan).toHaveLength(1);
		const edit = result.plan[0];
		expect(edit.from).toBe(cursor);
		expect(edit.to).toBe(cursor);
	});

	it("shifts # to #### (level 1 + shift 3 = 4)", () => {
		const edit = cascade(ctx).plan[0];
		expect(edit.insert).toMatch(/^#### Intro/m);
	});

	it("shifts ## to ##### (level 2 + shift 3 = 5)", () => {
		const edit = cascade(ctx).plan[0];
		expect(edit.insert).toMatch(/^##### Detail/m);
	});

	it("preserves non-heading lines verbatim", () => {
		const edit = cascade(ctx).plan[0];
		expect(edit.insert).toContain("Paragraph.");
		expect(edit.insert).toContain("More text.");
	});
});

// ---------------------------------------------------------------------------
// cascade — H6 clamp: shift that would exceed level 6 clamps at ######
// ---------------------------------------------------------------------------

describe("cascade — H6 clamp", () => {
	// ctxLevel=5 → shift = (5+1)−1 = 5. # → ######. ## → #######? No: clamp to ######.
	const doc = "##### Deep\n\n";
	const cursor = doc.length;
	const input = "# Title\n\n## Sub\n";
	const ctx = makeCtx({ doc, cursor, input });

	it("clamps # (1+5=6) to ###### rather than emitting #######", () => {
		const edit = cascade(ctx).plan[0];
		expect(edit.insert).toMatch(/^###### Title/m);
		expect(edit.insert).not.toMatch(/^#######+\s/m);
	});

	it("clamps ## (2+5=7) also to ###### (max H6)", () => {
		const edit = cascade(ctx).plan[0];
		const subLines = edit.insert.split("\n").filter((l) => l.startsWith("#"));
		// Both heading lines should be at most ######
		for (const line of subLines) {
			const hashes = line.match(/^(#+)/)?.[1] ?? "";
			expect(hashes.length).toBeLessThanOrEqual(6);
		}
	});
});

// ---------------------------------------------------------------------------
// cascade — negative shift: clamp at H1 floor
// ---------------------------------------------------------------------------

describe("cascade — negative shift clamps at H1 floor", () => {
	// To get a negative shift, the input's shallowest heading must be DEEPER
	// than target base (ctxLevel + 1).
	// ctxLevel=1 (# TopLevel above cursor), target=2.
	// Input min heading = ### (minIn=3). shift = (1+1) − 3 = -1.
	// ### (3 + -1 = 2) → ##.
	// ##### (5 + -1 = 4) → ####.
	// ####### would be H7 but we only generate legal headings, so use ######
	//   (6 + -1 = 5) → #####.
	const doc = "# TopLevel\n\n";
	const cursor = doc.length;
	// All input headings are at ### or deeper — minIn = 3, shift = -1
	const input = "### Alpha\n\n##### Deep\n\n###### VeryDeep\n";
	const ctx = makeCtx({ doc, cursor, input });

	it("does not produce a heading below H1 (no level 0 or negative)", () => {
		const edit = cascade(ctx).plan[0];
		const headingLines = edit.insert
			.split("\n")
			.filter((l) => l.startsWith("#"));
		for (const line of headingLines) {
			const hashes = line.match(/^(#+)/)?.[1] ?? "";
			expect(hashes.length).toBeGreaterThanOrEqual(1);
		}
	});

	it("### (3 + shift -1 = 2) becomes ##", () => {
		const edit = cascade(ctx).plan[0];
		expect(edit.insert).toMatch(/^## Alpha/m);
	});

	it("##### (5 + shift -1 = 4) becomes ####", () => {
		const edit = cascade(ctx).plan[0];
		expect(edit.insert).toMatch(/^#### Deep/m);
	});

	it("###### (6 + shift -1 = 5) becomes #####", () => {
		const edit = cascade(ctx).plan[0];
		expect(edit.insert).toMatch(/^##### VeryDeep/m);
	});
});

// ---------------------------------------------------------------------------
// cascade — no heading ABOVE cursor: returns input unchanged + noContextHeading=true
// ---------------------------------------------------------------------------

describe("cascade — no heading above cursor", () => {
	// Doc has a heading but it is BELOW the cursor.
	const doc = "Plain paragraph.\n\n";
	const cursor = doc.length;
	const input = "# Title\n\nContent.\n";
	const ctx = makeCtx({ doc, cursor, input });

	it("returns noContextHeading=true", () => {
		const result = cascade(ctx);
		expect(result.noContextHeading).toBe(true);
	});

	it("returns an empty EditPlan (Phase 3 command layer will surface Notice)", () => {
		const result = cascade(ctx);
		expect(result.plan).toHaveLength(0);
	});
});

describe("cascade — heading exists BELOW but not above cursor (mid-doc cursor)", () => {
	// Cursor is between two headings: only the one ABOVE should count.
	const doc = "Preamble.\n\n## Below heading\n";
	const cursor = "Preamble.\n\n".length; // cursor before the ## heading
	const input = "# Title\n";
	const ctx = makeCtx({ doc, cursor, input });

	it("returns noContextHeading=true (heading is below, not above)", () => {
		const result = cascade(ctx);
		expect(result.noContextHeading).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// cascade — no headings in input: no-op
// ---------------------------------------------------------------------------

describe("cascade — no headings in input", () => {
	const doc = "## Section\n\n";
	const cursor = doc.length;
	const input = "Just plain text, no headings at all.\n";
	const ctx = makeCtx({ doc, cursor, input });

	it("returns an empty EditPlan", () => {
		const result = cascade(ctx);
		expect(result.plan).toHaveLength(0);
	});

	it("returns noContextHeading=false (context heading exists; input simply has none)", () => {
		const result = cascade(ctx);
		expect(result.noContextHeading).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// cascade — missing ctx.input: no-op
// ---------------------------------------------------------------------------

describe("cascade — undefined input", () => {
	const doc = "## Section\n\n";
	const ctx = makeCtx({ doc, cursor: doc.length }); // no input field

	it("returns an empty EditPlan", () => {
		const result = cascade(ctx);
		expect(result.plan).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// normalize — whole-note gap closing
// ---------------------------------------------------------------------------

describe("normalize — closes heading level gaps across the whole note", () => {
	// H1 then H3 then H2 — H3 skips a level, should become H2.
	// After normalize: H1, H2, H2 (no gap between H1→H2, H2→H2 is fine).
	const doc = "# Title\n\n### Skipped\n\n## Normal\n\nBody.\n";
	const ctx = makeCtx({ doc, cursor: 0 });

	it("returns a non-empty EditPlan (some headings need changing)", () => {
		const plan = normalize(ctx);
		expect(plan.length).toBeGreaterThan(0);
	});

	it("closes the H1→H3 gap: H3 becomes H2", () => {
		// Apply the plan to verify result
		const plan = normalize(ctx);
		const result = applyPlan(doc, plan);
		expect(result).toMatch(/^## Skipped/m);
	});

	it("leaves H1 unchanged", () => {
		const plan = normalize(ctx);
		const result = applyPlan(doc, plan);
		expect(result).toMatch(/^# Title/m);
	});

	it("leaves H2 that is already at a valid level unchanged", () => {
		const plan = normalize(ctx);
		const result = applyPlan(doc, plan);
		expect(result).toMatch(/^## Normal/m);
	});
});

describe("normalize — already-contiguous headings: no edits needed", () => {
	const doc = "# A\n\n## B\n\n### C\n\nText.\n";
	const ctx = makeCtx({ doc, cursor: 0 });

	it("returns an empty EditPlan for perfectly contiguous headings", () => {
		const plan = normalize(ctx);
		expect(plan).toHaveLength(0);
	});
});

describe("normalize — no headings in document: no-op", () => {
	const doc = "Just a paragraph.\n\nAnother paragraph.\n";
	const ctx = makeCtx({ doc, cursor: 0 });

	it("returns an empty EditPlan", () => {
		const plan = normalize(ctx);
		expect(plan).toHaveLength(0);
	});
});

describe("normalize is DISTINCT from cascade on the same input", () => {
	// Same doc + input fed to both operations.
	// cascade transforms ctx.input relative to the heading above cursor.
	// normalize transforms ctx.doc headings to close gaps.
	// They must produce different plans.
	const doc = "# Title\n\n### Gap\n\n";
	const cursor = doc.length;
	const input = "## Paste heading\n\nContent.\n";
	const ctx = makeCtx({ doc, cursor, input });

	it("cascade plan inserts at cursor; normalize plan targets doc headings", () => {
		const cascadeResult = cascade(ctx);
		const normalizePlan = normalize(ctx);

		// cascade: one insert at cursor (or empty if no headings in input needing shift)
		// normalize: edits to existing heading lines in doc
		// They cannot be identical plans
		const cascadePlan = cascadeResult.plan;

		// normalize targets offsets within the existing doc (< cursor)
		// cascade inserts at cursor
		const normOffsets = normalizePlan.map((e) => e.from);
		const cascadeOffsets = cascadePlan.map((e) => e.from);

		// At minimum, the two operation types address different parts of the document.
		// normalize fixes doc headings (offsets < doc.length); cascade inserts at cursor.
		if (normalizePlan.length > 0 && cascadePlan.length > 0) {
			expect(normOffsets).not.toEqual(cascadeOffsets);
		}

		// Structural: normalize does not produce insert-only edits at the cursor position
		const normHasInsertAtCursor = normalizePlan.some(
			(e) => e.from === cursor && e.to === cursor,
		);
		expect(normHasInsertAtCursor).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// normalize — multiple gaps in one document
// ---------------------------------------------------------------------------

describe("normalize — multiple gaps", () => {
	// H1 → H3 → H5: should become H1 → H2 → H3
	const doc = "# One\n\n### Three\n\n##### Five\n\nContent.\n";
	const ctx = makeCtx({ doc, cursor: 0 });

	it("closes H3→H2 and H5→H3", () => {
		const plan = normalize(ctx);
		const result = applyPlan(doc, plan);
		expect(result).toMatch(/^# One/m);
		expect(result).toMatch(/^## Three/m);
		expect(result).toMatch(/^### Five/m);
	});
});

// ---------------------------------------------------------------------------
// Utility: apply an EditPlan to a document string (for test assertions only)
// ---------------------------------------------------------------------------

function applyPlan(doc: string, plan: EditPlan): string {
	// Sort descending by `from` so we can splice from right to left without
	// offset drift.
	const sorted = [...plan].sort((a, b) => b.from - a.from);
	let result = doc;
	for (const edit of sorted) {
		result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
	}
	return result;
}

// Import EditPlan type for the helper above.
import type { EditPlan } from "../../src/core/types";
