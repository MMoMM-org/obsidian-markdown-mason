// src/core/cleanup.ts — Phase 2 cleanup transforms (CON-2 compliant: no plugin imports)
import type { EditPlan, OperationContext } from "./types";
import { segmentBlocks, maskInlineCode } from "./markdownBlocks";
import type { BlockKind } from "./markdownBlocks";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function isSkippedForCode(kind: BlockKind): boolean {
	return kind === "fencedCode" || kind === "indentedCode";
}

// ---------------------------------------------------------------------------
// T2.1 — dehyphenate
// ---------------------------------------------------------------------------

/**
 * Join end-of-line hyphenation: `lowercase-\nlowercase` → `lowercaselowercase`.
 * Pattern restricted strictly to [a-z] on BOTH sides.
 * Skips fencedCode, indentedCode, frontmatter blocks.
 * Skips inline code spans via maskInlineCode applied to the full block text.
 */
export function dehyphenate(ctx: OperationContext): EditPlan {
	const blocks = segmentBlocks(ctx.doc);
	const plan: EditPlan = [];

	for (const block of blocks) {
		if (isSkippedForCode(block.kind) || block.kind === "frontmatter") continue;

		const text = ctx.doc.slice(block.startOffset, block.endOffset);
		// maskInlineCode on the full block text handles cross-line code spans:
		// the \n inside `co-\nde` becomes \0, suppressing pattern detection.
		const masked = maskInlineCode(text);
		const rx = /([a-z])-\n([a-z])/g;
		let m: RegExpExecArray | null;
		while ((m = rx.exec(masked)) !== null) {
			// m.index = position of first [a-z]; +1 = '-'; +2 = '\n'
			plan.push({
				from: block.startOffset + m.index + 1,
				to: block.startOffset + m.index + 3,
				insert: "",
			});
		}
	}

	return plan;
}

// ---------------------------------------------------------------------------
// T2.2 — dewrap
// ---------------------------------------------------------------------------

/**
 * Join soft-wrapped paragraph lines back into a single line per paragraph.
 * Only "paragraph" blocks are processed; all other block kinds are skipped.
 */
export function dewrap(ctx: OperationContext): EditPlan {
	const blocks = segmentBlocks(ctx.doc);
	const plan: EditPlan = [];
	for (const block of blocks) {
		if (block.kind !== "paragraph") continue;
		const text = ctx.doc.slice(block.startOffset, block.endOffset);
		const hasTrailing = text.endsWith("\n");
		const raw = hasTrailing ? text.slice(0, -1) : text;
		const lineArr = raw.split("\n");
		if (lineArr.length <= 1) continue;
		const joined = lineArr.join(" ");
		const insert = hasTrailing ? joined + "\n" : joined;
		plan.push({ from: block.startOffset, to: block.endOffset, insert });
	}
	return plan;
}
