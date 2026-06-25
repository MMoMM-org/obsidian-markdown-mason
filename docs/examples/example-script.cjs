// description: Example — wrap the input in a note callout (teaching template)
//
// ───────────────────────────────────────────────────────────────────────────
// A MINIMAL MARKDOWN MASON SCRIPT
// ───────────────────────────────────────────────────────────────────────────
//
// Copy this file into your vault (anywhere), then in Obsidian:
//   Settings → Markdown Mason → Scripts → "Import from vault" → pick this file
//   → review the disclosure → Enable.
//
// It runs with FULL plugin privileges (vault, Node fs/network, shell). Only
// enable scripts you trust. See docs/SCRIPT_AUTHORING.md for the full guide.
//
// THE ENVELOPE
//   An imported script must export `module.exports = { run, paste? }`:
//     run    — required: (ctx) => EditPlan | undefined            (the transform)
//     paste  — optional: { canHandle(input), priority }           (paste handler)
//   A script with no `paste` block is command-only (still works via the
//   "Mason: Run script…" command and any command you create for it).
//
// WHAT YOU GET / WHAT YOU CAN USE
//   - `ctx` (the ScriptContext) — see run() below.
//   - `ctx.mason.*` — the ONLY supported helper API (headings/footnotes/util).
//   - You CANNOT import the plugin's internal `src/core/*` helpers from an
//     imported .cjs — they aren't resolvable at runtime. Use ctx.mason instead,
//     or write plain JS.
// ───────────────────────────────────────────────────────────────────────────

module.exports = {
	/**
	 * run is called for BOTH triggers:
	 *   - "Paste and format"        → ctx.source === "paste"
	 *   - a command / "Run script…" → ctx.source === "command"
	 *
	 * Return an EditPlan (array of edits) to apply, or `undefined` / `[]` for a
	 * no-op (nothing happens; on paste the raw text is pasted as-is).
	 */
	run(ctx) {
		// ── The ScriptContext ────────────────────────────────────────────────
		// ctx.input  : the text to transform — clipboard text on paste, or the
		//              selected text on a command run over a selection.
		// ctx.source : "paste" | "selection" | "command".
		// ctx.op     : the document context:
		//                .doc          full note text (offsets are against THIS)
		//                .cursor       caret offset (the paste insertion point)
		//                .selection?   { from, to } when text is selected
		//                .replaceRange?{ from, to } set when a command runs on a
		//                              selection → write here to replace in place
		//                .settings     plugin settings (resourcesName, …)
		// ctx.mason  : the public helper API (see the commented example below).
		// ctx.logger : ctx.logger.info/warn/error — shown in the dev console.

		const text = ctx.input.trim();
		if (text === "") return undefined; // nothing to transform → no-op

		ctx.logger.info(`example-script: wrapping ${text.length} chars (source=${ctx.source})`);

		// Build the replacement text: a Markdown note callout.
		const body = text.split("\n").map((line) => `> ${line}`).join("\n");
		const replacement = `> [!note]\n${body}`;

		// ── The EditPlan ─────────────────────────────────────────────────────
		// An EditPlan is an array of { from, to, insert } whose offsets are
		// against the ORIGINAL ctx.op.doc. `from === to` is an INSERT; `from < to`
		// REPLACES that range. Edits must not overlap; they're applied atomically.
		//
		// Choose where the result lands:
		//   - command on a selection → replace the selection (ctx.op.replaceRange)
		//   - paste / no selection   → insert at the cursor (from === to)
		const target = ctx.op.replaceRange ?? { from: ctx.op.cursor, to: ctx.op.cursor };

		return [{ from: target.from, to: target.to, insert: replacement }];

		// ── Using the mason API instead (optional) ───────────────────────────
		// The public API does the heavy lifting and already honours replaceRange:
		//
		//   const edits = ctx.mason.headings.cascade(ctx.op);   // re-level headings
		//   return edits;
		//
		// Available surface (all return an EditPlan unless noted):
		//   ctx.mason.headings.cascade(ctx.op)
		//   ctx.mason.headings.normalize(ctx.op)
		//   ctx.mason.footnotes.fromCitations(ctx.op, parseResult)
		//   ctx.mason.footnotes.identity(ctx.op, parseResult)
		//   ctx.mason.footnotes.move(ctx.op, defs?)
		//   ctx.mason.util.normalizeUrl(rawUrl) → string
	},

	/**
	 * OPTIONAL paste block — makes this script a "Paste and format" handler too.
	 *
	 *   canHandle(input) : sync predicate — return true to claim this clipboard
	 *                      text. Keep it cheap and side-effect-free.
	 *   priority         : higher numbers are tried first when several scripts
	 *                      claim the same paste (curated scripts use 100–300).
	 *
	 * Remove this whole block to make the script command-only.
	 */
	paste: {
		canHandle: (input) => input.trim().length > 0,
		priority: 50,
	},
};
