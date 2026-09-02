// test/core/fitToList.test.ts — spec 008: fit pasted content to the cursor's list context.
//
// The `paste()` helper mirrors what the command layer does: split a note fixture
// at the "|" caret marker, fit the clipboard to that position, and splice the
// result back in — so every assertion reads as the note the user ends up with.

import { describe, it, expect } from "vitest";
import {
	detectListContext,
	resolveIndentUnit,
	fitToList,
	fitPasteToList,
} from "../../src/core/fitToList";

/** Split a fixture on the "|" caret marker into [doc, cursorOffset]. */
function caret(note: string): [string, number] {
	const cursor = note.indexOf("|");
	if (cursor === -1) throw new Error("fixture is missing the | caret marker");
	return [note.slice(0, cursor) + note.slice(cursor + 1), cursor];
}

/** Fit `clip` into `note` at its caret and return the resulting note. */
function paste(note: string, clip: string): string {
	const [doc, cursor] = caret(note);
	const fitted = fitPasteToList(clip, doc, cursor);
	return doc.slice(0, cursor) + fitted + doc.slice(cursor);
}

// ============================================================
// detectListContext — F1
// ============================================================

describe("detectListContext", () => {
	it("reads a bullet context", () => {
		const [doc, cursor] = caret("- |");
		const ctx = detectListContext(doc, cursor);
		expect(ctx).not.toBeNull();
		expect(ctx!.glyph).toBe("-");
		expect(ctx!.ordinal).toBeNull();
		expect(ctx!.task).toBe(false);
		expect(ctx!.beforeCursor).toBe("");
	});

	it("reads an ordered context with its ordinal and terminator", () => {
		const [doc, cursor] = caret("3) |");
		const ctx = detectListContext(doc, cursor)!;
		expect(ctx.ordinal).toBe(3);
		expect(ctx.terminator).toBe(")");
		expect(ctx.glyph).toBe("");
	});

	it("reads a task context", () => {
		const [doc, cursor] = caret("- [x] |");
		expect(detectListContext(doc, cursor)!.task).toBe(true);
	});

	it("reads the text already typed into the item", () => {
		const [doc, cursor] = caret("\t- Foo bar|");
		const ctx = detectListContext(doc, cursor)!;
		expect(ctx.indent).toBe("\t");
		expect(ctx.beforeCursor).toBe("Foo bar");
	});

	it("returns null for a plain paragraph", () => {
		const [doc, cursor] = caret("just prose|");
		expect(detectListContext(doc, cursor)).toBeNull();
	});

	it("returns null when the caret sits inside the marker", () => {
		const [doc, cursor] = caret("-| item");
		expect(detectListContext(doc, cursor)).toBeNull();
	});

	it("returns null inside a fenced code block", () => {
		const [doc, cursor] = caret("```\n- | not a list\n```\n");
		expect(detectListContext(doc, cursor)).toBeNull();
	});

	it("returns null in frontmatter", () => {
		const [doc, cursor] = caret("---\ntags:\n- | draft\n---\n");
		expect(detectListContext(doc, cursor)).toBeNull();
	});

	it("returns null for a blockquoted list (v1 boundary)", () => {
		const [doc, cursor] = caret("> - |");
		expect(detectListContext(doc, cursor)).toBeNull();
	});

	it("finds the context on a later line of a multi-line note", () => {
		const [doc, cursor] = caret("# Title\n\nprose\n\n- a\n- |");
		expect(detectListContext(doc, cursor)!.glyph).toBe("-");
	});
});

// ============================================================
// fitPasteToList — identity guarantees (F6)
// ============================================================

describe("fitPasteToList — identity when there is no list context", () => {
	const clip = "One paragraph.\n\nAnother paragraph.";

	it("leaves the text untouched in a paragraph", () => {
		const [doc, cursor] = caret("prose here|");
		expect(fitPasteToList(clip, doc, cursor)).toBe(clip);
	});

	it("leaves the text untouched in an empty document", () => {
		expect(fitPasteToList(clip, "", 0)).toBe(clip);
	});

	it("leaves the text untouched inside a code fence", () => {
		const [doc, cursor] = caret("```\n- |\n```\n");
		expect(fitPasteToList(clip, doc, cursor)).toBe(clip);
	});

	it("leaves an empty clipboard untouched", () => {
		const [doc, cursor] = caret("- |");
		expect(fitPasteToList("", doc, cursor)).toBe("");
	});
});

// ============================================================
// F2 — one item per paragraph, separators dropped
// ============================================================

describe("fitPasteToList — paragraphs become items", () => {
	it("turns three paragraphs into three bullets and drops the blank lines", () => {
		expect(paste("- |", "One.\n\nTwo.\n\nThree.")).toBe("- One.\n- Two.\n- Three.");
	});

	it("keeps the caret's own indent", () => {
		expect(paste("\t- |", "One.\n\nTwo.")).toBe("\t- One.\n\t- Two.");
	});

	it("preserves the caret's bullet glyph", () => {
		expect(paste("* |", "One.\n\nTwo.")).toBe("* One.\n* Two.");
	});

	it("continues an ordered list, keeping its terminator", () => {
		expect(paste("3. |", "One.\n\nTwo.\n\nThree.")).toBe("3. One.\n4. Two.\n5. Three.");
		expect(paste("1) |", "One.\n\nTwo.")).toBe("1) One.\n2) Two.");
	});

	it("keeps a task list a task list, always unchecked", () => {
		expect(paste("- [ ] |", "One.\n\nTwo.")).toBe("- [ ] One.\n- [ ] Two.");
	});

	it("never copies a checked box onto the new items", () => {
		expect(paste("- [x] |", "One.\n\nTwo.")).toBe("- [x] One.\n- [ ] Two.");
	});

	it("collapses an accidental double space after the caret's marker", () => {
		// The note's own "-  " is the user's text and stays; the items Mason
		// GENERATES use a single space rather than replicating the typo.
		expect(paste("-  |", "One.\n\nTwo.")).toBe("-  One.\n- Two.");
	});

	it("keeps a tab gap a tab", () => {
		expect(paste("-\t|", "One.\n\nTwo.")).toBe("-\tOne.\n-\tTwo.");
	});

	it("does not double a checkbox the clipboard already carries", () => {
		expect(paste("- [ ] |", "[ ] One.\n\n[ ] Two.")).toBe("- [ ] One.\n- [ ] Two.");
	});
});

// ============================================================
// F4 — continue the current line
// ============================================================

describe("fitPasteToList — first line continues the caret's item", () => {
	it("space-joins onto text already in the item", () => {
		expect(paste("- Foo|", "Bar baz")).toBe("- Foo Bar baz");
	});

	it("does not add a second space when the item already ends in one", () => {
		expect(paste("- Foo |", "Bar")).toBe("- Foo Bar");
	});

	it("adds no trailing newline", () => {
		expect(paste("- |", "One.\n\nTwo.").endsWith("Two.")).toBe(true);
	});

	it("keeps the note's following lines intact", () => {
		expect(paste("- |\n- tail", "One.\n\nTwo.")).toBe("- One.\n- Two.\n- tail");
	});
});

// ============================================================
// F3 — nesting
// ============================================================

describe("fitPasteToList — pasted lists", () => {
	it("nests a pasted list under the paragraph that introduces it", () => {
		expect(paste("- |", "Lead-in:\n\n- a\n- b")).toBe("- Lead-in:\n\t- a\n\t- b");
	});

	it("keeps items at the caret's level when the clipboard starts with a list", () => {
		expect(paste("- |", "- a\n- b\n- c")).toBe("- a\n- b\n- c");
	});

	it("preserves relative depth of a 2-space-indented pasted list", () => {
		expect(paste("- |", "- a\n  - a1\n- b")).toBe("- a\n  - a1\n- b");
	});

	it("preserves relative depth of a tab-indented pasted list", () => {
		expect(paste("- |", "- a\n\t- a1\n- b")).toBe("- a\n\t- a1\n- b");
	});

	it("preserves relative depth of a 4-space-indented pasted list", () => {
		expect(paste("- |", "- a\n    - a1\n- b")).toBe("- a\n    - a1\n- b");
	});

	it("nests below the caret's own depth", () => {
		expect(paste("- alpha\n\t- |", "Lead-in:\n\n- a")).toBe(
			"- alpha\n\t- Lead-in:\n\t\t- a",
		);
	});

	it("adopts the caret's marker for siblings of the caret's item", () => {
		// A pasted ORDERED list into a BULLET context: the top level adopts "-"
		// so the paste does not collide with the list the user is writing.
		expect(paste("- |", "1. a\n2. b")).toBe("- a\n- b");
	});

	it("keeps the author's own markers below the context level", () => {
		expect(paste("- |", "Lead-in:\n\n1. a\n2. b")).toBe("- Lead-in:\n\t1. a\n\t2. b");
	});

	it("returns to the caret's level for a paragraph after a pasted list", () => {
		expect(paste("- |", "Lead-in:\n\n- a\n\nClosing.")).toBe(
			"- Lead-in:\n\t- a\n- Closing.",
		);
	});

	it("treats an indented continuation line as item body, not a new item", () => {
		expect(paste("- |", "- a first line\n  wrapped tail\n- b")).toBe(
			"- a first line\n  wrapped tail\n- b",
		);
	});
});

// ============================================================
// F5 — indent unit
// ============================================================

describe("resolveIndentUnit", () => {
	const unitFor = (note: string, pasted = ""): string => {
		const [doc, cursor] = caret(note);
		return resolveIndentUnit(doc, detectListContext(doc, cursor)!, pasted);
	};

	it("takes the note's own habit when the list already nests", () => {
		expect(unitFor("- alpha\n  - beta\n- |")).toBe("  ");
		expect(unitFor("- alpha\n\t- beta\n- |")).toBe("\t");
	});

	it("reads the habit relative to the caret's own depth", () => {
		expect(unitFor("- alpha\n  - beta\n    - gamma\n  - |")).toBe("  ");
	});

	it("falls back to the clipboard's own nesting", () => {
		expect(unitFor("- |", "- a\n   - a1")).toBe("   ");
	});

	it("falls back to a tab when nothing else is available", () => {
		expect(unitFor("- |", "plain text")).toBe("\t");
	});

	it("uses the note's habit in preference to the clipboard's", () => {
		expect(unitFor("- alpha\n  - beta\n- |", "- a\n\t- a1")).toBe("  ");
	});
});

// ============================================================
// F6 — verbatim blocks, robustness, idempotency
// ============================================================

describe("fitPasteToList — robustness", () => {
	it("emits a fenced code block verbatim under the item", () => {
		expect(paste("- |", "Lead-in:\n\n```js\nconst a = 1;\n```")).toBe(
			"- Lead-in:\n  ```js\n  const a = 1;\n  ```",
		);
	});

	it("never re-marks a table row", () => {
		const out = paste("- |", "Lead-in:\n\n| a | b |\n| --- | --- |");
		expect(out).toBe("- Lead-in:\n  | a | b |\n  | --- | --- |");
	});

	it("is idempotent — re-pasting a fitted item block reproduces it", () => {
		// The fitted STRING is not a standalone document (its first line has no
		// marker — the note supplies it), so idempotency is asserted over the
		// resulting item block, which is what a user would copy again.
		const block = paste("- |", "One.\n\nTwo.\n\nThree.");
		expect(paste("- |", block)).toBe(block);
	});

	it("round-trips a task list pasted into a task context", () => {
		expect(paste("- [ ] |", "- [ ] One\n- [x] Two")).toBe("- [ ] One\n- [ ] Two");
	});

	it("fitToList alone is callable with an explicit context and unit", () => {
		const [doc, cursor] = caret("- |");
		const ctx = detectListContext(doc, cursor)!;
		expect(fitToList("One.\n\nTwo.", ctx, "    ")).toBe("One.\n- Two.");
	});
});

// ============================================================
// The reference captures from requirements.md
// ============================================================

describe("fitPasteToList — TOGAF reference captures", () => {
	// Both fixtures are the CLEANED text (post applyTextCleanup): paragraphs are
	// already dewrapped, bullet glyphs already normalised.
	const proseOnly = [
		"TOGAF is a framework for enterprise architecture that provides an approach for designing, planning, implementing, and governing an enterprise information technology architecture.",
		"",
		"TOGAF is a high-level approach to design that puts pieces together to draw a roadmap.",
		"",
		"TOGAF is typically modeled at four levels: Business, Data, Application, and Technology (BDAT). It relies heavily on modularization, standardization, and proven technologies and products.",
	].join("\n");

	const withList = [
		"The TOGAF standard is a proven enterprise architecture methodology and framework that is used by the world's leading organizations to improve business efficiency. TOGAF has the following key features:",
		"",
		"- It is a standard approach for helping with the acceptance, production, use, and maintenance of enterprise architectures.",
		"- It is based on an iterative process model that is supported by best practices and a reusable set of existing architectural assets.",
		"- The TOGAF standard can be used for developing a broad range of different enterprise architectures.",
		"- The TOGAF Architecture Development Method (ADM) is used for developing an enterprise architecture that addresses business needs.",
	].join("\n");

	it("capture 1: three paragraphs become three bullets, no blank lines left", () => {
		const out = paste("# Note\n\n- |", proseOnly);
		const lines = out.split("\n").slice(2);
		expect(lines).toHaveLength(3);
		expect(lines.every((l) => l.startsWith("- "))).toBe(true);
		expect(out).not.toContain("\n\n- TOGAF is a high-level");
	});

	it("capture 2: lead-in becomes the item, its four bullets nest one level", () => {
		const out = paste("# Note\n\n- |", withList);
		const lines = out.split("\n").slice(2);
		expect(lines[0]).toBe(
			"- The TOGAF standard is a proven enterprise architecture methodology and framework that is used by the world's leading organizations to improve business efficiency. TOGAF has the following key features:",
		);
		expect(lines.slice(1)).toHaveLength(4);
		expect(lines.slice(1).every((l) => l.startsWith("\t- "))).toBe(true);
	});
});
