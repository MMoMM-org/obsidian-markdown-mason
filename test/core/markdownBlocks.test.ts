// test/core/markdownBlocks.test.ts
//
// TDD suite — RED phase. Written before src/core/markdownBlocks.ts exists.
//
// Covers:
//   - segmentBlocks: BlockKind classification (one fixture per kind)
//   - segmentBlocks: edge cases (nested fence, setext vs thematic, frontmatter
//     strict i===0, lazy list continuation, tilde fence close rules)
//   - segmentBlocks: Block offset arithmetic (startLine, endLine, startOffset, endOffset)
//   - maskInlineCode: single-backtick, double-backtick, multiple spans, no spans

import { describe, it, expect } from "vitest";
import { segmentBlocks, maskInlineCode } from "../../src/core/markdownBlocks";

// ---------------------------------------------------------------------------
// Helper: expand block array back to a per-line kind string array.
// Useful for concise per-line assertions.
// ---------------------------------------------------------------------------

function lineKinds(doc: string): string[] {
	const blocks = segmentBlocks(doc);
	const lines = doc.split("\n");
	const result = new Array<string>(lines.length);
	for (const b of blocks) {
		for (let i = b.startLine; i <= b.endLine; i++) {
			result[i] = b.kind;
		}
	}
	return result;
}

// ---------------------------------------------------------------------------
// segmentBlocks — BlockKind: paragraph
// ---------------------------------------------------------------------------

describe("segmentBlocks — paragraph", () => {
	it("classifies plain text as paragraph", () => {
		expect(lineKinds("Hello world")[0]).toBe("paragraph");
	});
});

// ---------------------------------------------------------------------------
// segmentBlocks — BlockKind: atxHeading (all six levels)
// ---------------------------------------------------------------------------

describe("segmentBlocks — atxHeading (all six levels)", () => {
	it.each([
		["# H1", "atxHeading"],
		["## H2", "atxHeading"],
		["### H3", "atxHeading"],
		["#### H4", "atxHeading"],
		["##### H5", "atxHeading"],
		["###### H6", "atxHeading"],
	])('classifies "%s" as atxHeading', (line, expected) => {
		expect(lineKinds(line)[0]).toBe(expected);
	});
});

// ---------------------------------------------------------------------------
// segmentBlocks — BlockKind: setextHeading (= and - underlines)
// ---------------------------------------------------------------------------

describe("segmentBlocks — setextHeading", () => {
	it("classifies title and === underline both as setextHeading", () => {
		const doc = "My Title\n===";
		const lk = lineKinds(doc);
		expect(lk[0]).toBe("setextHeading");
		expect(lk[1]).toBe("setextHeading");
	});

	it("classifies title and --- underline both as setextHeading (not thematicBreak)", () => {
		const doc = "My Title\n---";
		const lk = lineKinds(doc);
		expect(lk[0]).toBe("setextHeading");
		expect(lk[1]).toBe("setextHeading");
	});
});

// ---------------------------------------------------------------------------
// segmentBlocks — BlockKind: fencedCode (backtick and tilde)
// ---------------------------------------------------------------------------

describe("segmentBlocks — fencedCode", () => {
	it("classifies backtick fence open line, content, and close line all as fencedCode", () => {
		const doc = "```\ncode here\n```";
		const lk = lineKinds(doc);
		expect(lk[0]).toBe("fencedCode");
		expect(lk[1]).toBe("fencedCode");
		expect(lk[2]).toBe("fencedCode");
	});

	it("classifies tilde fence open line, content, and close line all as fencedCode", () => {
		const doc = "~~~\ncode here\n~~~";
		const lk = lineKinds(doc);
		expect(lk[0]).toBe("fencedCode");
		expect(lk[1]).toBe("fencedCode");
		expect(lk[2]).toBe("fencedCode");
	});
});

// ---------------------------------------------------------------------------
// segmentBlocks — BlockKind: indentedCode (four-space prefix)
// ---------------------------------------------------------------------------

describe("segmentBlocks — indentedCode", () => {
	it("classifies a four-space-indented line as indentedCode", () => {
		expect(lineKinds("    const x = 1;")[0]).toBe("indentedCode");
	});
});

// ---------------------------------------------------------------------------
// segmentBlocks — BlockKind: blockquote
// ---------------------------------------------------------------------------

describe("segmentBlocks — blockquote", () => {
	it("classifies a > line as blockquote", () => {
		expect(lineKinds("> quoted text")[0]).toBe("blockquote");
	});
});

// ---------------------------------------------------------------------------
// segmentBlocks — BlockKind: listItem (all specified markers)
// ---------------------------------------------------------------------------

describe("segmentBlocks — listItem (all markers)", () => {
	it.each([
		["- item", "listItem"],
		["* item", "listItem"],
		["+ item", "listItem"],
		["• item", "listItem"], // U+2022 BULLET (•)
		["– item", "listItem"], // U+2013 EN DASH (–)
		["1. item", "listItem"],
		["1) item", "listItem"],
	])('classifies "%s" as listItem', (line, expected) => {
		expect(lineKinds(line)[0]).toBe(expected);
	});
});

// ---------------------------------------------------------------------------
// segmentBlocks — BlockKind: tableRow
// ---------------------------------------------------------------------------

describe("segmentBlocks — tableRow", () => {
	it("classifies a | line as tableRow", () => {
		expect(lineKinds("| col1 | col2 |")[0]).toBe("tableRow");
	});
});

// ---------------------------------------------------------------------------
// segmentBlocks — BlockKind: thematicBreak
// ---------------------------------------------------------------------------

describe("segmentBlocks — thematicBreak", () => {
	it("classifies *** as thematicBreak", () => {
		expect(lineKinds("***")[0]).toBe("thematicBreak");
	});

	it("classifies ___ as thematicBreak", () => {
		expect(lineKinds("___")[0]).toBe("thematicBreak");
	});

	it("classifies --- after a blank line as thematicBreak (not after paragraph)", () => {
		const doc = "\n---";
		const lk = lineKinds(doc);
		expect(lk[0]).toBe("blank");
		expect(lk[1]).toBe("thematicBreak");
	});

	it("--- at line 0 is frontmatter (not thematicBreak) — frontmatter check takes priority", () => {
		// The implementation classifies any lone "---" at i===0 as frontmatter opener.
		expect(lineKinds("---")[0]).toBe("frontmatter");
	});
});

// ---------------------------------------------------------------------------
// segmentBlocks — BlockKind: frontmatter (must be at line 0)
// ---------------------------------------------------------------------------

describe("segmentBlocks — frontmatter", () => {
	it("classifies the --- delimiters and body lines as frontmatter", () => {
		const doc = "---\nkey: value\n---\nparagraph";
		const lk = lineKinds(doc);
		expect(lk[0]).toBe("frontmatter");
		expect(lk[1]).toBe("frontmatter");
		expect(lk[2]).toBe("frontmatter");
	});

	it("classifies the line after the closing --- as paragraph", () => {
		const doc = "---\nkey: value\n---\nparagraph";
		expect(lineKinds(doc)[3]).toBe("paragraph");
	});
});

// ---------------------------------------------------------------------------
// segmentBlocks — BlockKind: blank
// ---------------------------------------------------------------------------

describe("segmentBlocks — blank", () => {
	it("classifies an empty line between paragraphs as blank", () => {
		const doc = "text\n\nother";
		expect(lineKinds(doc)[1]).toBe("blank");
	});
});

// ---------------------------------------------------------------------------
// segmentBlocks — edge case: nested fence inside blockquote is blockquote
// ---------------------------------------------------------------------------

describe("segmentBlocks — nested fence inside blockquote is not fencedCode", () => {
	it("classifies '> ```' as blockquote (blockquote rule fires before fence regex)", () => {
		// The line starts with >, so the blockquote check fires first.
		// The fence regex needs backticks at position 0-3, but > is not whitespace.
		expect(lineKinds("> ```")[0]).toBe("blockquote");
	});
});

// ---------------------------------------------------------------------------
// segmentBlocks — edge case: setext vs thematicBreak disambiguation
// ---------------------------------------------------------------------------

describe("segmentBlocks — setext vs thematicBreak disambiguation", () => {
	it("--- following a paragraph → both lines setextHeading (not thematicBreak)", () => {
		const doc = "My Title\n---";
		const lk = lineKinds(doc);
		expect(lk[0]).toBe("setextHeading");
		expect(lk[1]).toBe("setextHeading");
		// Neither line is thematicBreak
		expect(lk[1]).not.toBe("thematicBreak");
	});

	it("--- following a blank line → thematicBreak", () => {
		const doc = "\n---";
		const lk = lineKinds(doc);
		expect(lk[1]).toBe("thematicBreak");
	});

	it("--- after blank (no preceding paragraph) → thematicBreak", () => {
		// Use a blank-prefixed fixture; a lone "---" at i=0 is frontmatter.
		expect(lineKinds("\n---")[1]).toBe("thematicBreak");
	});
});

// ---------------------------------------------------------------------------
// segmentBlocks — edge case: frontmatter requires i === 0 strictly
// ---------------------------------------------------------------------------

describe("segmentBlocks — frontmatter requires i === 0", () => {
	it("--- at line index 3 is not frontmatter (setext heading for line 2 instead)", () => {
		// Lines 0,1,2 are paragraphs; line 3 is "---" which becomes the setext
		// underline for line 2. None are frontmatter.
		const doc = "line0\nline1\nline2\n---";
		const lk = lineKinds(doc);
		expect(lk[0]).not.toBe("frontmatter");
		expect(lk[1]).not.toBe("frontmatter");
		expect(lk[2]).not.toBe("frontmatter");
		expect(lk[3]).not.toBe("frontmatter");
		// Line 3 is the setext underline → line 2 retroactively becomes setextHeading too
		expect(lk[2]).toBe("setextHeading");
		expect(lk[3]).toBe("setextHeading");
	});
});

// ---------------------------------------------------------------------------
// segmentBlocks — edge case: lazy list continuation is paragraph
// ---------------------------------------------------------------------------

describe("segmentBlocks — lazy list continuation line", () => {
	it("plain prose after a list item (no indent) is classified paragraph", () => {
		const doc = "- list item\ncontinuation prose";
		const lk = lineKinds(doc);
		expect(lk[0]).toBe("listItem");
		expect(lk[1]).toBe("paragraph");
	});
});

// ---------------------------------------------------------------------------
// segmentBlocks — edge case: tilde fence close requires matching char and >= length
// ---------------------------------------------------------------------------

describe("segmentBlocks — tilde fence close rules", () => {
	it("backtick fence inside a tilde fence does not close the tilde fence", () => {
		// ~~~ opens a tilde fence; ``` is a different char, so it stays inside.
		const doc = "~~~\n```\ncontent\n~~~";
		const lk = lineKinds(doc);
		expect(lk[0]).toBe("fencedCode"); // open tilde fence
		expect(lk[1]).toBe("fencedCode"); // ``` line: still inside tilde fence
		expect(lk[2]).toBe("fencedCode"); // content: inside tilde fence
		expect(lk[3]).toBe("fencedCode"); // ~~~: closes the tilde fence
	});

	it("tilde fence closes with a longer tilde fence (>= same length)", () => {
		const doc = "~~~\ncontent\n~~~~";
		const lk = lineKinds(doc);
		expect(lk[0]).toBe("fencedCode");
		expect(lk[1]).toBe("fencedCode");
		expect(lk[2]).toBe("fencedCode"); // ~~~~ closes the ~~~ fence
	});
});

// ---------------------------------------------------------------------------
// segmentBlocks — Block offset arithmetic
// ---------------------------------------------------------------------------

describe("segmentBlocks — Block offset arithmetic (two-paragraph doc with blank)", () => {
	// doc = "Hello.\n\nWorld.\n"
	// split → ["Hello.", "", "World.", ""]
	// lineStart: 0, 7, 8, 15
	// doc.length = 15
	const doc = "Hello.\n\nWorld.\n";

	it("first paragraph block: startLine=0, endLine=0, startOffset=0, endOffset=7", () => {
		const blocks = segmentBlocks(doc);
		const para0 = blocks.find((b) => b.kind === "paragraph" && b.startLine === 0)!;
		expect(para0.startLine).toBe(0);
		expect(para0.endLine).toBe(0);
		expect(para0.startOffset).toBe(0);
		expect(para0.endOffset).toBe(7);
	});

	it("blank block: startLine=1, endLine=1, startOffset=7, endOffset=8", () => {
		const blocks = segmentBlocks(doc);
		const blank = blocks.find((b) => b.kind === "blank" && b.startLine === 1)!;
		expect(blank.startLine).toBe(1);
		expect(blank.endLine).toBe(1);
		expect(blank.startOffset).toBe(7);
		expect(blank.endOffset).toBe(8);
	});

	it("second paragraph block: startLine=2, endLine=2, startOffset=8, endOffset=15", () => {
		const blocks = segmentBlocks(doc);
		const para2 = blocks.find((b) => b.kind === "paragraph" && b.startLine === 2)!;
		expect(para2.startLine).toBe(2);
		expect(para2.endLine).toBe(2);
		expect(para2.startOffset).toBe(8);
		expect(para2.endOffset).toBe(15); // clamped to doc.length
	});

	it("doc.slice(startOffset, endOffset) recovers the block's text including newline", () => {
		const blocks = segmentBlocks(doc);
		const para0 = blocks.find((b) => b.kind === "paragraph" && b.startLine === 0)!;
		expect(doc.slice(para0.startOffset, para0.endOffset)).toBe("Hello.\n");
		const para2 = blocks.find((b) => b.kind === "paragraph" && b.startLine === 2)!;
		expect(doc.slice(para2.startOffset, para2.endOffset)).toBe("World.\n");
	});
});

describe("segmentBlocks — multi-line paragraph grouped into one block", () => {
	it("two consecutive paragraph lines form one block spanning both lines", () => {
		// doc = "Line one.\nLine two.\n\nOther.\n"
		// split → ["Line one.", "Line two.", "", "Other.", ""]
		// lineStart: 0, 10, 20, 21, 28
		const doc = "Line one.\nLine two.\n\nOther.\n";
		const blocks = segmentBlocks(doc);
		const multiPara = blocks.find((b) => b.kind === "paragraph" && b.startLine === 0)!;
		expect(multiPara.startLine).toBe(0);
		expect(multiPara.endLine).toBe(1);
		expect(multiPara.startOffset).toBe(0);
		expect(multiPara.endOffset).toBe(20); // "Line one.\nLine two.\n"
	});
});

// ---------------------------------------------------------------------------
// maskInlineCode
// ---------------------------------------------------------------------------

describe("maskInlineCode — single-backtick code span", () => {
	it("replaces content of `code` with null chars of equal length", () => {
		const result = maskInlineCode("hello `world` done");
		// "world" is 5 chars → 5 null chars
		expect(result).toBe("hello `\0\0\0\0\0` done");
	});

	it("chars inside the span are replaced (not left as original letters)", () => {
		const result = maskInlineCode("`abc`");
		// "abc" → 3 null chars; backticks preserved
		expect(result).toBe("`\0\0\0`");
	});

	it("preserves surrounding backticks", () => {
		const result = maskInlineCode("`x`");
		expect(result[0]).toBe("`");
		expect(result[result.length - 1]).toBe("`");
	});
});

describe("maskInlineCode — line with no code spans returned unchanged", () => {
	it("returns plain text unchanged", () => {
		expect(maskInlineCode("plain text without backticks")).toBe("plain text without backticks");
	});

	it("returns empty string unchanged", () => {
		expect(maskInlineCode("")).toBe("");
	});
});

describe("maskInlineCode — double-backtick span content is masked", () => {
	it("content within a double-backtick span is masked (letters become null chars)", () => {
		// Input: "`` `code` ``"  (length 12)
		// The regex processes sub-spans: the inner `code` content gets masked.
		const input = "`` `code` ``";
		const result = maskInlineCode(input);
		// The original "code" letters must be gone
		expect(result).not.toContain("code");
		// Length is preserved (equal-length replacement)
		expect(result.length).toBe(input.length);
	});
});

describe("maskInlineCode — multiple code spans on one line", () => {
	it("masks all code spans independently", () => {
		const result = maskInlineCode("`foo` and `bar`");
		expect(result).toBe("`\0\0\0` and `\0\0\0`");
	});
});
