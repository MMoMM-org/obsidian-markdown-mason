"use strict";

// description: Wrap code-ish tokens (file:line refs, dotted identifiers,
//              wikilinks, dataview fields) in backticks so Obsidian renders
//              them literally instead of as links / inline fields.
//
// DRAFT — companion to XDD spec 007. Destined for the vetted-repo script
// catalog (MMoMM-org/markdown-mason-scripts), NOT for plugin core.
//
// WHY A SCRIPT, NOT A BUILT-IN TRANSFORM
// --------------------------------------
// Deciding "this token is code" is a HEURISTIC. In natural prose it misfires
// ("e.g", "Mr. Smith", a domain name, a sentence like "see figure 2"). That is
// unacceptable as a default/automatic cleanup step, but perfectly fine as an
// OPT-IN, per-run, removable catalog script that you point at a specific
// selection when you know the text is technical. Aggressive by design; tune the
// PATTERNS list below to taste, or delete the risky ones.
//
// CONTRACT (ADR-16): export `{ run(ctx) }` returning an EditPlan — absolute
// { from, to, insert } edits against ctx.op.doc. Here we transform ctx.input
// (the selection / clipboard payload) and emit ONE edit over the target range,
// so no per-token absolute-offset bookkeeping leaks out.
//
// NO paste auto-handler is registered on purpose: this must never fire
// automatically. Run it via Settings → Commands → its command, on a selection.

// ---------------------------------------------------------------------------
// Tunable patterns — ordered by confidence (highest first). Each match that is
// NOT already inside code/links is wrapped in backticks. Comment out or edit
// freely; the DOTTED_IDENT rule is the aggressive one most likely to overreach.
// ---------------------------------------------------------------------------

const PATTERNS = [
	// path/file with a line (or line-range): render.py:102-110, parser.py:432
	{ name: "path-line", re: /(?<![\w`])[\w./+-]*\.[A-Za-z]{1,8}:\d+(?:-\d+)?(?![\w`])/g },

	// dataview / wikilink field written literally: up:: [[MOC]]
	{ name: "field-wikilink", re: /(?<![\w`])\w+::\s*\[\[[^\]\n]+\]\](?![`])/g },

	// empty/JSON-ish field value: detail.candidate_mocs: []
	{ name: "json-empty", re: /(?<![\w`])\w+(?:\.\w+)+:\s*\[\](?![\w`])/g },

	// standalone wikilink meant as literal text: [[MOC]]
	{ name: "wikilink", re: /(?<![`\[])\[\[[^\]\n]+\]\](?![`\]])/g },

	// RISKY — dotted identifier / member access: detail.candidate_mocs, foo.bar
	// Also matches "e.g", domain-ish tokens. Disable if it overreaches.
	{ name: "dotted-ident", re: /(?<![\w`.])[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+(?![\w`(])/g },
];

// ---------------------------------------------------------------------------
// Protected regions — never touch what is already code or a real link.
// ---------------------------------------------------------------------------

const PROTECT = [
	/```[\s\S]*?```/g,      // fenced code
	/`[^`\n]+`/g,           // inline code
	/!?\[[^\]\n]*\]\([^)\n]*\)/g, // markdown links / images
];

function protectedRanges(text) {
	const ranges = [];
	for (const re of PROTECT) {
		re.lastIndex = 0;
		let m;
		while ((m = re.exec(text)) !== null) {
			ranges.push({ from: m.index, to: m.index + m[0].length });
			if (m[0].length === 0) re.lastIndex++; // guard against zero-width loops
		}
	}
	return ranges;
}

function overlaps(from, to, ranges) {
	return ranges.some((r) => from < r.to && to > r.from);
}

// Fold inner wrap-edits into the input string (reverse-sorted, non-overlapping).
function applyWraps(text, wraps) {
	wraps.sort((a, b) => b.from - a.from);
	let out = text;
	for (const w of wraps) {
		out = out.slice(0, w.from) + "`" + out.slice(w.from, w.to) + "`" + out.slice(w.to);
	}
	return out;
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

function bodyTarget(op) {
	return op.replaceRange ?? { from: op.cursor, to: op.cursor };
}

function run(ctx) {
	const text = ctx.input ?? "";
	if (text.length === 0) return undefined;

	const taken = protectedRanges(text); // grows as we claim spans
	const wraps = [];

	for (const { re } of PATTERNS) {
		re.lastIndex = 0;
		let m;
		while ((m = re.exec(text)) !== null) {
			const from = m.index;
			const to = from + m[0].length;
			if (m[0].length === 0) { re.lastIndex++; continue; }
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
}

module.exports = { run };
