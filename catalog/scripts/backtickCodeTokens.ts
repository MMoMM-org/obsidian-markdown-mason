// Catalog script — backtick code-ish tokens
//
// PURPOSE
// -------
// Wrap "code-ish" tokens in a selection with backticks so Obsidian renders them
// literally instead of linkifying / interpreting them:
//   render.py:102-110         (file:line refs)
//   detail.candidate_mocs     (dotted identifiers / member access)
//   up:: [[MOC]]              (dataview field + wikilink written as literal text)
//   [[MOC]]                    (standalone wikilink meant as text)
//   detail.candidate_mocs: [] (empty JSON-ish field value)
//
// WHY A SCRIPT, NOT A BUILT-IN
// ----------------------------
// Deciding "this token is code" is a HEURISTIC that misfires in natural prose
// ("e.g", "Mr. Smith", a domain name). Unacceptable as an always-on transform,
// fine as an OPT-IN, per-run, removable catalog script pointed at a selection you
// know is technical. Command-only: NO `paste` handler on the envelope, so it
// never fires automatically. Tune / delete PATTERNS entries to taste; the
// DOTTED_IDENT rule is the aggressive one most likely to overreach.

import type { ScriptContext, ScriptFunction } from "../../src/scripts/context";
import type { EditPlan, OperationContext } from "../../src/core/types";

interface Range {
	from: number;
	to: number;
}

// Patterns ordered by confidence (highest first). Each match not already inside
// code/links is wrapped in backticks; earlier matches claim their span so later
// (broader) patterns cannot re-wrap it.
const PATTERNS: { name: string; re: RegExp }[] = [
	// path/file with a line (or line-range): render.py:102-110, parser.py:432
	{ name: "path-line", re: /(?<![\w`])[\w./+-]*\.[A-Za-z]{1,8}:\d+(?:-\d+)?(?![\w`])/g },
	// dataview / wikilink field written literally: up:: [[MOC]]
	{ name: "field-wikilink", re: /(?<![\w`])\w+::\s*\[\[[^\]\n]+\]\](?![`])/g },
	// empty/JSON-ish field value: detail.candidate_mocs: []
	{ name: "json-empty", re: /(?<![\w`])\w+(?:\.\w+)+:\s*\[\](?![\w`])/g },
	// standalone wikilink meant as literal text: [[MOC]]
	{ name: "wikilink", re: /(?<![`[])\[\[[^\]\n]+\]\](?![`\]])/g },
	// RISKY — dotted identifier / member access: detail.candidate_mocs, foo.bar.
	// Also matches "e.g", domain-ish tokens. Disable if it overreaches.
	{ name: "dotted-ident", re: /(?<![\w`.])[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+(?![\w`(])/g },
];

// Never touch what is already code or a real link.
const PROTECT: RegExp[] = [
	/```[\s\S]*?```/g, // fenced code
	/`[^`\n]+`/g, // inline code
	/!?\[[^\]\n]*\]\([^)\n]*\)/g, // markdown links / images
];

function protectedRanges(text: string): Range[] {
	const ranges: Range[] = [];
	for (const re of PROTECT) {
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) {
			ranges.push({ from: m.index, to: m.index + m[0].length });
			if (m[0].length === 0) re.lastIndex++; // guard against zero-width loops
		}
	}
	return ranges;
}

function overlaps(from: number, to: number, ranges: Range[]): boolean {
	return ranges.some((r) => from < r.to && to > r.from);
}

// Fold inner wrap-edits into the string (reverse-sorted, non-overlapping).
function applyWraps(text: string, wraps: Range[]): string {
	wraps.sort((a, b) => b.from - a.from);
	let out = text;
	for (const w of wraps) {
		out = out.slice(0, w.from) + "`" + out.slice(w.from, w.to) + "`" + out.slice(w.to);
	}
	return out;
}

function bodyTarget(op: OperationContext): { from: number; to: number } {
	return op.replaceRange ?? { from: op.cursor, to: op.cursor };
}

export const backtickCodeTokensScript: ScriptFunction = (ctx: ScriptContext): EditPlan | undefined => {
	const text = ctx.input ?? "";
	if (text.length === 0) return undefined;

	const taken = protectedRanges(text); // grows as we claim spans
	const wraps: Range[] = [];

	for (const { re } of PATTERNS) {
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) {
			const from = m.index;
			const to = from + m[0].length;
			if (m[0].length === 0) {
				re.lastIndex++;
				continue;
			}
			if (overlaps(from, to, taken)) continue; // already code/link/claimed
			wraps.push({ from, to });
			taken.push({ from, to }); // later patterns must not re-wrap this span
		}
	}

	if (wraps.length === 0) return undefined;

	const transformed = applyWraps(text, wraps);
	if (transformed === text) return undefined;

	ctx.logger.info(`backtick-code-tokens: wrapped ${wraps.length} token(s)`);
	const t = bodyTarget(ctx.op);
	return [{ from: t.from, to: t.to, insert: transformed }];
};
