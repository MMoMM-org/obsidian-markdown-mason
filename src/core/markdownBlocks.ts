// src/core/markdownBlocks.ts  (NEW — no obsidian import, CON-2)

export type BlockKind =
	| "paragraph"
	| "atxHeading"
	| "setextHeading"
	| "fencedCode"
	| "indentedCode"
	| "blockquote"
	| "listItem"
	| "tableRow"
	| "thematicBreak"
	| "frontmatter"
	| "blank";

export interface Block {
	kind: BlockKind;
	startLine: number; // 0-based, inclusive
	endLine: number; // 0-based, inclusive
	startOffset: number; // char offset of first char of startLine
	endOffset: number; // char offset just past trailing \n of endLine
}

export function segmentBlocks(doc: string): Block[] {
	const lines = doc.split("\n");

	// Pre-compute per-line start offsets
	const lineStart: number[] = [];
	let off = 0;
	for (const l of lines) {
		lineStart.push(off);
		off += l.length + 1;
	}

	// Phase 1: classify each line
	const kinds: BlockKind[] = new Array<BlockKind>(lines.length);
	let fenceChar: string | null = null;
	let fenceLen = 0;
	let inFrontmatter = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Frontmatter — only at document start
		if (i === 0 && line === "---") {
			inFrontmatter = true;
			kinds[i] = "frontmatter";
			continue;
		}
		if (inFrontmatter) {
			kinds[i] = "frontmatter";
			if (line === "---" && i > 0) inFrontmatter = false;
			continue;
		}

		// Fenced code — track open/close; overrides all other classification inside
		const fenceM = /^(\s{0,3})(`{3,}|~{3,})/.exec(line);
		if (fenceM) {
			const ch = fenceM[2][0];
			const len = fenceM[2].length;
			if (fenceChar === null) {
				fenceChar = ch;
				fenceLen = len;
				kinds[i] = "fencedCode";
			} else if (ch === fenceChar && len >= fenceLen) {
				kinds[i] = "fencedCode";
				fenceChar = null;
				fenceLen = 0;
			} else {
				kinds[i] = "fencedCode"; // different char/shorter — still inside outer fence
			}
			continue;
		}
		if (fenceChar !== null) {
			kinds[i] = "fencedCode";
			continue;
		}

		// Ordered classification (first match wins)
		if (/^#{1,6}(\s|$)/.test(line)) {
			kinds[i] = "atxHeading";
			continue;
		}
		if (/^\s*$/.test(line)) {
			kinds[i] = "blank";
			continue;
		}
		if (/^\s*>/.test(line)) {
			kinds[i] = "blockquote";
			continue;
		}
		if (/^\s*([-*+•–·]|\d+[.)]) /.test(line)) {
			kinds[i] = "listItem";
			continue;
		}
		if (/^\s*\|/.test(line)) {
			kinds[i] = "tableRow";
			continue;
		}

		// Setext underline: ={1,} or -{1,} following a paragraph line.
		// Checked BEFORE thematicBreak so that "---" after a paragraph becomes
		// setextHeading rather than thematicBreak (CommonMark precedence rule).
		if (/^=+\s*$/.test(line) && i > 0 && kinds[i - 1] === "paragraph") {
			kinds[i] = "setextHeading";
			kinds[i - 1] = "setextHeading";
			continue;
		}
		if (/^-+\s*$/.test(line) && i > 0 && kinds[i - 1] === "paragraph") {
			kinds[i] = "setextHeading";
			kinds[i - 1] = "setextHeading";
			continue;
		}

		if (/^\s*([-*_]\s*){3,}$/.test(line)) {
			kinds[i] = "thematicBreak";
			continue;
		}
		if (/^ {4}/.test(line)) {
			kinds[i] = "indentedCode";
			continue;
		}

		kinds[i] = "paragraph";
	}

	// Phase 2: group consecutive same-kind lines into Block objects
	// (blank lines are always single-line blocks)
	const blocks: Block[] = [];
	let i = 0;
	while (i < lines.length) {
		const kind = kinds[i];
		let j = i;
		if (kind !== "blank") {
			while (j + 1 < lines.length && kinds[j + 1] === kind) j++;
		}
		const startOffset = lineStart[i];
		const endLine = j;
		// endOffset: past trailing \n of last line (clamped to doc length)
		const rawEnd = lineStart[endLine] + lines[endLine].length + 1;
		const endOffset = Math.min(rawEnd, doc.length);
		blocks.push({ kind, startLine: i, endLine, startOffset, endOffset });
		i = j + 1;
	}
	return blocks;
}

/** Replace the content of inline `code` spans with U+0000 of equal length. */
export function maskInlineCode(line: string): string {
	return line.replace(/`[^`]*`/g, (m) => "`" + "\0".repeat(m.length - 2) + "`");
}
