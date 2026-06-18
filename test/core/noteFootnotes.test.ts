// T8.1  Whole-note footnote operations: C / O+D / M / Tidy
//
// Tests for parseNoteFootnotes (the whole-note parser) and the three whole-note
// registry ops (fromCitations, identity/OD, move) that wire into entry.run(ctx).
// Also covers the Tidy integration test: C → O+D → M composed on an accumulated note.
//
// PRD ACs:
//   Feature 2 (C): bare [n] → [^n]; alpha untouched; no renumber.
//   Feature 3 (O+D): gap-free renumber by first-ref order; URL dedup; alpha untouched;
//     dup-def collapse.
//   Feature 4 (M): file defs into ## Resources; create if absent; orphan preservation;
//     no empty section; single edit plan.
//   Feature 5 (Tidy): C → O+D → M as one undoable plan.

import { describe, it, expect } from "vitest";
import {
	parseNoteFootnotes,
	wholeNoteFromCitations,
	wholeNoteIdentity,
	wholeNoteMove,
	tidyFootnotes,
} from "../../src/core/noteFootnotes";
import { applyToString } from "../../src/core/applyToString";
import type { OperationContext, MasonSettings } from "../../src/core/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: MasonSettings = {
	debugLogging: false,
	resourcesName: "Resources",
};

function makeCtx(doc: string, overrides: Partial<MasonSettings> = {}): OperationContext {
	return {
		doc,
		cursor: 0,
		settings: { ...DEFAULT_SETTINGS, ...overrides },
	};
}

// ---------------------------------------------------------------------------
// parseNoteFootnotes
// ---------------------------------------------------------------------------

describe("parseNoteFootnotes — empty doc", () => {
	it("returns empty arrays for an empty doc", () => {
		const result = parseNoteFootnotes("");
		expect(result.inlineRefs).toHaveLength(0);
		expect(result.bareCitations).toHaveLength(0);
		expect(result.defs).toHaveLength(0);
		expect(result.resourcesSection).toBeNull();
	});
});

describe("parseNoteFootnotes — inline refs detection", () => {
	it("detects a numeric [^1] inline ref", () => {
		const doc = "Some text [^1] here.\n";
		const result = parseNoteFootnotes(doc);
		expect(result.inlineRefs).toHaveLength(1);
		expect(result.inlineRefs[0].id).toBe("1");
		expect(result.inlineRefs[0].isAlpha).toBe(false);
	});

	it("detects a multi-digit [^12] inline ref", () => {
		const doc = "Text [^12] here.\n";
		const result = parseNoteFootnotes(doc);
		expect(result.inlineRefs.some((r) => r.id === "12")).toBe(true);
	});

	it("detects alphabetic [^A] inline ref as alpha", () => {
		const doc = "Note[^A] and ref[^1].\n";
		const result = parseNoteFootnotes(doc);
		const alpha = result.inlineRefs.find((r) => r.id === "A");
		const numeric = result.inlineRefs.find((r) => r.id === "1");
		expect(alpha?.isAlpha).toBe(true);
		expect(numeric?.isAlpha).toBe(false);
	});

	it("detects alphabetic [^second] inline ref as alpha", () => {
		const doc = "Text [^second] here.\n";
		const result = parseNoteFootnotes(doc);
		expect(result.inlineRefs.some((r) => r.id === "second" && r.isAlpha)).toBe(true);
	});

	it("records from/to offsets for inline refs", () => {
		const doc = "ab[^3]cd";
		const result = parseNoteFootnotes(doc);
		const ref = result.inlineRefs[0];
		expect(doc.slice(ref.from, ref.to)).toBe("[^3]");
	});

	it("does NOT detect [^n] that is part of a definition line as an inline ref", () => {
		// "[^1]:" at line start is a definition, not an inline ref
		const doc = "[^1]: some snippet\n[Title](https://example.com)\n";
		const result = parseNoteFootnotes(doc);
		// The [^1] in "[^1]:" must NOT be counted as an inline ref
		expect(result.inlineRefs.filter((r) => !r.isAlpha)).toHaveLength(0);
	});
});

describe("parseNoteFootnotes — bare citation detection", () => {
	it("detects a bare [1] citation", () => {
		const doc = "Text [1] here.\n";
		const result = parseNoteFootnotes(doc);
		expect(result.bareCitations).toHaveLength(1);
		expect(result.bareCitations[0].n).toBe(1);
	});

	it("does NOT detect [1] inside a markdown link [1](url) as a bare citation", () => {
		const doc = "[1](https://example.com) and [2] standalone.\n";
		const result = parseNoteFootnotes(doc);
		// Only [2] should be detected as a bare citation
		expect(result.bareCitations).toHaveLength(1);
		expect(result.bareCitations[0].n).toBe(2);
	});

	it("does NOT detect alphabetic [A] as a bare citation", () => {
		const doc = "Note[A] and cite[1].\n";
		const result = parseNoteFootnotes(doc);
		expect(result.bareCitations).toHaveLength(1);
		expect(result.bareCitations[0].n).toBe(1);
	});

	it("records correct offsets for bare citations", () => {
		const doc = "ab[3]cd";
		const result = parseNoteFootnotes(doc);
		const cite = result.bareCitations[0];
		expect(doc.slice(cite.from, cite.to)).toBe("[3]");
	});
});

describe("parseNoteFootnotes — definition detection", () => {
	it("detects a numeric F4 two-line def", () => {
		const doc = "[^1]: some snippet\n[Title](https://example.com)\n";
		const result = parseNoteFootnotes(doc);
		expect(result.defs).toHaveLength(1);
		const def = result.defs[0];
		expect(def.id).toBe("1");
		expect(def.isAlpha).toBe(false);
		expect(def.snippet).toBe("some snippet");
		expect(def.url).toBe("https://example.com");
		expect(def.title).toBe("Title");
	});

	it("detects a plain text (single-line) numeric def", () => {
		const doc = "[^2]: just plain text\n";
		const result = parseNoteFootnotes(doc);
		expect(result.defs).toHaveLength(1);
		const def = result.defs[0];
		expect(def.id).toBe("2");
		expect(def.snippet).toBe("just plain text");
		expect(def.url).toBeUndefined();
	});

	it("detects an alpha def as isAlpha=true", () => {
		const doc = "[^A]: alpha note\n";
		const result = parseNoteFootnotes(doc);
		expect(result.defs).toHaveLength(1);
		expect(result.defs[0].isAlpha).toBe(true);
		expect(result.defs[0].id).toBe("A");
	});

	it("records from/to offsets spanning both lines of a two-line F4 def", () => {
		const doc = "[^1]: snippet\n[Title](https://example.com)\n";
		const result = parseNoteFootnotes(doc);
		const def = result.defs[0];
		// The full raw text of the def should include both lines
		const raw = doc.slice(def.from, def.to);
		expect(raw).toContain("[^1]: snippet");
		expect(raw).toContain("[Title](https://example.com)");
	});

	it("records from/to for a plain-text single-line def", () => {
		const doc = "body\n[^3]: text here\nnext line\n";
		const result = parseNoteFootnotes(doc);
		const def = result.defs[0];
		const raw = doc.slice(def.from, def.to);
		expect(raw).toContain("[^3]: text here");
	});
});

describe("parseNoteFootnotes — Resources section detection", () => {
	it("returns null resourcesSection when there is no ## Resources", () => {
		const doc = "# Title\n\nBody.\n";
		const result = parseNoteFootnotes(doc, "Resources");
		expect(result.resourcesSection).toBeNull();
	});

	it("detects a ## Resources section and records its start offset", () => {
		const doc = "# Title\n\nBody.\n\n## Resources\n\n[^1]: s\n[T](https://t.com)\n";
		const result = parseNoteFootnotes(doc, "Resources");
		expect(result.resourcesSection).not.toBeNull();
		expect(doc.slice(result.resourcesSection!.from)).toMatch(/^## Resources/);
	});

	it("respects a custom resourcesName", () => {
		const doc = "# Title\n\n## References\n\n[^1]: s\n[T](https://t.com)\n";
		const result = parseNoteFootnotes(doc, "References");
		expect(result.resourcesSection).not.toBeNull();
	});
});

// ---------------------------------------------------------------------------
// wholeNoteFromCitations — C operation
// ---------------------------------------------------------------------------

describe("wholeNoteFromCitations — converts bare [n] to [^n]", () => {
	it("converts a single bare [1] citation", () => {
		const doc = "Text [1] here.\n";
		const ctx = makeCtx(doc);
		const plan = wholeNoteFromCitations(ctx);
		const result = applyToString(doc, plan);
		expect(result).toBe("Text [^1] here.\n");
	});

	it("converts multiple distinct bare citations", () => {
		const doc = "First [1] and second [2].\n";
		const ctx = makeCtx(doc);
		const plan = wholeNoteFromCitations(ctx);
		const result = applyToString(doc, plan);
		expect(result).toBe("First [^1] and second [^2].\n");
	});

	it("leaves alpha markers [A] untouched", () => {
		const doc = "Note[A] and cite[1].\n";
		const ctx = makeCtx(doc);
		const plan = wholeNoteFromCitations(ctx);
		const result = applyToString(doc, plan);
		expect(result).toBe("Note[A] and cite[^1].\n");
	});

	it("does not alter [n] inside a markdown link", () => {
		const doc = "[1](https://example.com) and standalone [2].\n";
		const ctx = makeCtx(doc);
		const plan = wholeNoteFromCitations(ctx);
		const result = applyToString(doc, plan);
		expect(result).toBe("[1](https://example.com) and standalone [^2].\n");
	});

	it("does not alter existing [^n] footnote refs", () => {
		const doc = "Already [^1] done, and new [2] cite.\n";
		const ctx = makeCtx(doc);
		const plan = wholeNoteFromCitations(ctx);
		const result = applyToString(doc, plan);
		expect(result).toBe("Already [^1] done, and new [^2] cite.\n");
	});

	it("returns an empty plan when there are no bare citations", () => {
		const doc = "No citations here.\n";
		const ctx = makeCtx(doc);
		const plan = wholeNoteFromCitations(ctx);
		expect(plan).toHaveLength(0);
	});

	it("handles bare [n] on definition lines (should NOT convert those)", () => {
		// A bare [1] that is part of a footnote definition line must not be converted.
		// "[^1]: text [1] more" — the inline [1] in the snippet body may or may not exist;
		// but a definition line starting with [^n]: is not a bare citation.
		const doc = "[^1]: snippet text\n[Title](https://example.com)\nBody [2] cite.\n";
		const ctx = makeCtx(doc);
		const plan = wholeNoteFromCitations(ctx);
		const result = applyToString(doc, plan);
		expect(result).toContain("[^1]: snippet text");
		expect(result).toContain("[^2] cite");
	});
});

// ---------------------------------------------------------------------------
// wholeNoteIdentity — O+D operation (whole-note renumber + dedup)
// ---------------------------------------------------------------------------

describe("wholeNoteIdentity — gap-free renumber in first-ref order", () => {
	it("renumbers [^2] and [^5] to [^1] and [^2] when those are the only footnotes", () => {
		// Note has [^2] appearing first, then [^5]. Gap-free: first-ref gets 1, second gets 2.
		const doc = "Text [^2] first[^5] second.\n[^2]: snip2\n[T2](https://t2.com)\n[^5]: snip5\n[T5](https://t5.com)\n";
		const ctx = makeCtx(doc);
		const plan = wholeNoteIdentity(ctx);
		const result = applyToString(doc, plan);
		expect(result).toContain("[^1]");
		expect(result).toContain("[^2]");
		expect(result).not.toContain("[^5]");
		// The first ref [^2] should now be [^1] at first-reference position
		const firstRef = result.match(/\[\^(\d+)\]/);
		expect(firstRef?.[1]).toBe("1");
	});

	it("leaves already gap-free footnotes unchanged", () => {
		const doc = "Text [^1] and [^2].\n[^1]: s1\n[T1](https://t1.com)\n[^2]: s2\n[T2](https://t2.com)\n";
		const ctx = makeCtx(doc);
		const plan = wholeNoteIdentity(ctx);
		const result = applyToString(doc, plan);
		// Already gap-free: [^1] stays [^1], [^2] stays [^2]
		expect(result).toContain("[^1]");
		expect(result).toContain("[^2]");
		expect(result).not.toContain("[^3]");
	});

	it("preserves alpha [^A] footnotes unchanged", () => {
		const doc = "Note[^A] and cite[^2].\n[^A]: alpha note\n[^2]: snip\n[T](https://t.com)\n";
		const ctx = makeCtx(doc);
		const plan = wholeNoteIdentity(ctx);
		const result = applyToString(doc, plan);
		expect(result).toContain("[^A]");
		expect(result).toContain("[^A]: alpha note");
		// [^2] should become [^1] (first numeric ref)
		expect(result).toContain("[^1]");
	});

	it("alpha footnotes are not counted toward the numeric max", () => {
		// If note has [^A] and [^3], the only numeric footnote [^3] → [^1]
		const doc = "[^A] and [^3] in body.\n[^A]: alpha\n[^3]: snip\n[T](https://t.com)\n";
		const ctx = makeCtx(doc);
		const plan = wholeNoteIdentity(ctx);
		const result = applyToString(doc, plan);
		// [^3] should renumber to [^1] (no other numeric footnotes)
		const numericDefs = result.match(/^\[\^(\d+)\]:/gm);
		expect(numericDefs).toHaveLength(1);
		expect(numericDefs![0]).toBe("[^1]:");
	});

	it("dedups same URL — two defs with same URL → one def after O+D", () => {
		// Two numeric footnotes [^1] and [^2] both point to the same URL.
		// O+D dedup: both inline refs point to one number; one definition remains.
		const url = "https://shared.example.com";
		const doc = `Text [^1] and [^2].\n[^1]: snip1\n[T1](${url})\n[^2]: snip2\n[T2](${url})\n`;
		const ctx = makeCtx(doc);
		const plan = wholeNoteIdentity(ctx);
		const result = applyToString(doc, plan);
		// Both inline refs should point to the same number
		const matches = result.match(/\[\^(\d+)\]/g);
		expect(matches).not.toBeNull();
		const ids = new Set(matches!.map((m) => m));
		expect(ids.size).toBe(1);
		// Only one definition should exist for this URL
		const defCount = (result.match(/^\[\^\d+\]:/gm) ?? []).length;
		expect(defCount).toBe(1);
	});

	it("collapses duplicate definitions of the same id to one", () => {
		// Two [^1]: defs exist (shouldn't happen normally but must be handled)
		const doc = "Text [^1].\n[^1]: first def\n[T1](https://t1.com)\n[^1]: dup def\n[T1b](https://t1.com)\n";
		const ctx = makeCtx(doc);
		const plan = wholeNoteIdentity(ctx);
		const result = applyToString(doc, plan);
		const defCount = (result.match(/^\[\^\d+\]:/gm) ?? []).length;
		expect(defCount).toBe(1);
	});

	it("returns empty plan when no numeric footnotes exist", () => {
		const doc = "Note without footnotes.\n";
		const ctx = makeCtx(doc);
		const plan = wholeNoteIdentity(ctx);
		expect(plan).toHaveLength(0);
	});

	it("returns empty plan when only alpha footnotes exist", () => {
		const doc = "Note[^A].\n[^A]: alpha\n";
		const ctx = makeCtx(doc);
		const plan = wholeNoteIdentity(ctx);
		expect(plan).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// wholeNoteMove — M operation (move defs to Resources)
// ---------------------------------------------------------------------------

describe("wholeNoteMove — moves scattered defs into ## Resources", () => {
	it("moves a def from the body into ## Resources", () => {
		const doc = "Text [^1].\n[^1]: snippet\n[Title](https://example.com)\n";
		const ctx = makeCtx(doc);
		const plan = wholeNoteMove(ctx);
		const result = applyToString(doc, plan);
		expect(result).toContain("## Resources");
		expect(result).toContain("[^1]: snippet");
		// Original def location should be gone (moved to Resources)
		const resourcesIdx = result.indexOf("## Resources");
		const defsBeforeResources = result
			.slice(0, resourcesIdx)
			.match(/^\[\^\d+\]:/gm);
		expect(defsBeforeResources).toBeNull();
	});

	it("creates ## Resources at end when absent", () => {
		const doc = "Text [^1].\n[^1]: snip\n[T](https://t.com)\n";
		const ctx = makeCtx(doc);
		const plan = wholeNoteMove(ctx);
		const result = applyToString(doc, plan);
		expect(result).toContain("## Resources");
		// Resources section should be appended after the body (the def is moved there).
		// Verify the def appears inside the Resources section, not before it.
		const resourcesIdx = result.indexOf("## Resources");
		const defIdx = result.indexOf("[^1]: snip");
		expect(defIdx).toBeGreaterThan(resourcesIdx);
	});

	it("appends to existing ## Resources section", () => {
		const doc = "Text [^2].\n\n## Resources\n\n[^1]: existing\n[E](https://e.com)\n\n[^2]: new snippet\n[N](https://n.com)\n";
		const ctx = makeCtx(doc);
		const plan = wholeNoteMove(ctx);
		const result = applyToString(doc, plan);
		// Both defs should be in the Resources section
		const resourcesIdx = result.indexOf("## Resources");
		const after = result.slice(resourcesIdx);
		expect(after).toContain("[^1]: existing");
		expect(after).toContain("[^2]: new snippet");
	});

	it("does not create an empty ## Resources section when there are no defs to move", () => {
		const doc = "Text without footnotes.\n";
		const ctx = makeCtx(doc);
		const plan = wholeNoteMove(ctx);
		expect(plan).toHaveLength(0);
	});

	it("does not create an empty ## Resources section when all defs are already in Resources", () => {
		const doc = "Text [^1].\n\n## Resources\n\n[^1]: snip\n[T](https://t.com)\n";
		const ctx = makeCtx(doc);
		const plan = wholeNoteMove(ctx);
		const result = applyToString(doc, plan);
		// Should not add a second ## Resources
		const matches = result.match(/## Resources/g);
		expect(matches).toHaveLength(1);
	});

	it("preserves orphaned lines in Resources (lines without [^n]: prefix)", () => {
		const orphan = "This is an orphaned line in Resources";
		const doc = `Text [^1].\n\n## Resources\n\n${orphan}\n\n[^1]: snip\n[T](https://t.com)\n`;
		const ctx = makeCtx(doc);
		const plan = wholeNoteMove(ctx);
		const result = applyToString(doc, plan);
		expect(result).toContain(orphan);
	});

	it("uses settings.resourcesName for the section name", () => {
		const doc = "Text [^1].\n[^1]: snip\n[T](https://t.com)\n";
		const ctx = makeCtx(doc, { resourcesName: "References" });
		const plan = wholeNoteMove(ctx);
		const result = applyToString(doc, plan);
		expect(result).toContain("## References");
		expect(result).not.toContain("## Resources");
	});

	it("handles plain-text (non-URL) defs", () => {
		const doc = "Text [^1].\n[^1]: plain text note\n";
		const ctx = makeCtx(doc);
		const plan = wholeNoteMove(ctx);
		const result = applyToString(doc, plan);
		expect(result).toContain("## Resources");
		expect(result).toContain("[^1]: plain text note");
	});

	it("alpha defs are NOT moved (they stay in place)", () => {
		// Alpha footnotes like [^A]: should not be touched by M
		const doc = "Note[^A].\n[^A]: alpha note\n[^1]: numeric\n[T](https://t.com)\n";
		const ctx = makeCtx(doc);
		const plan = wholeNoteMove(ctx);
		const result = applyToString(doc, plan);
		// [^A]: should remain in body, not moved to Resources
		const resourcesSection = result.slice(result.indexOf("## Resources"));
		expect(resourcesSection).not.toContain("[^A]:");
		expect(result).toContain("[^A]: alpha note");
	});
});

// ---------------------------------------------------------------------------
// tidyFootnotes — C → O+D → M composed as one plan (Tidy Footnotes preset)
// ---------------------------------------------------------------------------

describe("tidyFootnotes — Tidy Footnotes (C → O+D → M) on accumulated note", () => {
	it("converts bare citations AND renumbers AND moves defs in one plan", () => {
		// A note with both bare citations and existing footnotes
		const doc = "Text [1] and [^3] more.\n[^3]: snip3\n[T3](https://t3.com)\n";
		const ctx = makeCtx(doc);
		const plan = tidyFootnotes(ctx);
		const result = applyToString(doc, plan);
		// [1] should become [^n] and be renumbered gap-free
		expect(result).not.toMatch(/(?<!\^)\[1\]/); // no bare [1] remaining
		expect(result).toContain("## Resources");
	});

	it("is atomic — plan offsets are all vs the original doc", () => {
		// All edits must be non-overlapping inserts/replacements vs original
		const doc = "Text [1] and [^3].\n[^3]: snip\n[T](https://t.com)\n";
		const ctx = makeCtx(doc);
		const plan = tidyFootnotes(ctx);
		// No edit should start after another edit's end on the same region
		// Verify by applying — must not throw or produce garbled output
		expect(() => applyToString(doc, plan)).not.toThrow();
	});

	it("preserves alpha footnotes through the full tidy pipeline", () => {
		const doc = "Note[^A] and cite[1].\n[^A]: alpha note\n";
		const ctx = makeCtx(doc);
		const plan = tidyFootnotes(ctx);
		const result = applyToString(doc, plan);
		expect(result).toContain("[^A]");
		expect(result).toContain("[^A]: alpha note");
	});

	it("returns an empty plan when there is nothing to do", () => {
		const doc = "# Clean Note\n\nNo footnotes at all.\n";
		const ctx = makeCtx(doc);
		const plan = tidyFootnotes(ctx);
		expect(plan).toHaveLength(0);
	});

	// ------------------------------------------------------------------
	// Integration / accumulated-note fixture
	//
	// A note with two stacked Perplexity-style footnote sets (numeric, with
	// [title](url) defs, colliding numbers, a duplicate URL, an alpha [^A],
	// and an orphan line in Resources).
	//
	// Before state:
	//   Body has [^1][^2] (from first paste) and [^1][^2] (from second paste
	//   — colliding) and [^A] (alpha annotation).
	//   Defs scattered in body: [^1]: snip1 / [U1], [^2]: snip2 / [U2],
	//   [^1]: snip3 / [U3] (collides with first [^1]), [^2]: snip1 / [U1] (dup URL)
	//   Existing ## Resources has an orphan line.
	//
	// After Tidy:
	//   Body: [^A] preserved; numeric refs renumbered gap-free from 1 by
	//   first-reference order; duplicate URL → same number; alpha untouched.
	//   Resources: all numeric defs filed; orphan preserved; no empty section.
	//   Plan: one batch of edits vs original doc (single undo).
	// ------------------------------------------------------------------

	it("accumulated-note integration: renumbers gap-free, deduplicates, files defs, preserves orphan and alpha", () => {
		// Scenario: three Perplexity pastes have been stacked into the same note,
		// each starting at [^1]. After stacking without Tidy, the note has:
		//   Body: [^1][^2] (paste 1), [^3][^4] (paste 2), [^1][^3] (paste 3)
		//   Defs:
		//     [^1]: u1 (paste 1)
		//     [^2]: u2 (paste 1)
		//     [^3]: u3 (paste 2)
		//     [^4]: u4 (paste 2)
		//     [^1]: u1 (paste 3 — same URL, duplicate def)
		//     [^3]: u3 (paste 3 — same URL, duplicate def)
		//   Alpha: [^A] user annotation
		//   Resources: already has orphan line
		//
		// After Tidy (C → O+D → M):
		//   - No bare citations (C is no-op here)
		//   - O+D: first-ref order for distinct URLs: u1 (from [^1] pos 1) → 1,
		//     u2 (from [^2] pos 2) → 2, u3 (from [^3] pos 3) → 3, u4 (from [^4] pos 4) → 4
		//     Dup refs [^1][^3] from paste 3 → already mapped to 1 and 3.
		//     Dup defs [^1]:u1 and [^3]:u3 are deleted (collapse to one each).
		//   - M: all 4 remaining defs filed into Resources.
		//   - Alpha [^A] and orphan untouched.
		const u1 = "https://source1.example.com";
		const u2 = "https://source2.example.com";
		const u3 = "https://source3.example.com";
		const u4 = "https://source4.example.com";
		const orphan = "Orphaned line in Resources";

		const doc = [
			"# Research Note",
			"",
			"Paste 1[^1][^2]. Paste 2[^3][^4]. Paste 3[^1][^3].",
			"My annotation[^A].",
			"",
			"[^1]: Source 1 snippet",
			`[Source 1](${u1})`,
			"[^2]: Source 2 snippet",
			`[Source 2](${u2})`,
			"[^3]: Source 3 snippet",
			`[Source 3](${u3})`,
			"[^4]: Source 4 snippet",
			`[Source 4](${u4})`,
			"[^1]: Source 1 dup",
			`[Source 1 Dup](${u1})`,
			"[^3]: Source 3 dup",
			`[Source 3 Dup](${u3})`,
			"[^A]: my alpha note",
			"",
			"## Resources",
			"",
			orphan,
			"",
		].join("\n");

		const ctx = makeCtx(doc);
		const plan = tidyFootnotes(ctx);
		const result = applyToString(doc, plan);

		// 1. Alpha preserved
		expect(result).toContain("[^A]");
		expect(result).toContain("[^A]: my alpha note");

		// 2. Orphan preserved in Resources
		const resourcesIdx = result.indexOf("## Resources");
		expect(resourcesIdx).toBeGreaterThan(-1);
		const resourcesSection = result.slice(resourcesIdx);
		expect(resourcesSection).toContain(orphan);

		// 3. All numeric defs are in Resources (none in body)
		const bodySection = result.slice(0, resourcesIdx);
		expect(bodySection.match(/^\[\^\d+\]:/gm)).toBeNull();

		// 4. Gap-free renumber: 4 distinct URLs → footnotes [^1]..[^4]
		const defsInResources = resourcesSection.match(/^\[\^(\d+)\]:/gm) ?? [];
		const numericIds = defsInResources.map((d) => parseInt(d.match(/\d+/)![0], 10)).sort((a, b) => a - b);
		expect(numericIds).toEqual([1, 2, 3, 4]);

		// 5. URL dedup: u1 appears once in defs (dup def collapsed)
		const u1DefCount = (resourcesSection.match(new RegExp(`\\[\\^\\d+\\]: .*\\n\\[.*\\]\\(${u1.replace(/\//g, "/")}\\)`, "gm")) ?? []).length;
		expect(u1DefCount).toBe(1);

		// 6. Single undo: plan is non-empty; single edit (diff of whole change)
		expect(plan.length).toBeGreaterThan(0);
		// The tidyFootnotes plan may be a single diff edit or multiple non-overlapping edits
		const sorted = [...plan].sort((a, b) => a.from - b.from);
		for (let i = 1; i < sorted.length; i++) {
			expect(sorted[i].from).toBeGreaterThanOrEqual(sorted[i - 1].to);
		}
	});
});

// ---------------------------------------------------------------------------
// Regression: no false positives from definition lines
// ---------------------------------------------------------------------------

describe("wholeNoteFromCitations — does not convert [n] inside definition lines", () => {
	it("a bare [1] that is the inline marker in a paragraph next to a [^1]: def is converted correctly", () => {
		// The def line [^1]: should not be confused with a bare [1] citation
		const doc = "[^1]: snippet\n[Title](https://example.com)\nBody [2] cite.\n";
		const ctx = makeCtx(doc);
		const plan = wholeNoteFromCitations(ctx);
		const result = applyToString(doc, plan);
		// [2] should become [^2]; the def line should be untouched
		expect(result).toContain("[^1]: snippet");
		expect(result).toContain("[^2] cite");
	});
});
