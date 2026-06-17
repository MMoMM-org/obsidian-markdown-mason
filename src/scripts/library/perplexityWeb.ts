// Phase 5 — Perplexity Web script
//
// PURPOSE
// -------
// Converts a Perplexity *web* copy-paste (format: inline [text](url) citation
// links; NO Sources block) into a structured note: headings cascaded under the
// note context, inline links replaced by [^n] footnotes with URL-deduped
// identity resolution, and footnote defs filed into the ## Resources section.
//
// PASTE DOC MODEL
// ---------------
// ctx.op.doc    = the current note text (e.g. "# Title\n\n")
// ctx.op.cursor = insertion point (typically doc.length — end of note)
// ctx.input     = raw Perplexity web copy-paste text
//
// COMPOSITION
// -----------
// 1. Parse ctx.input → ParseResult { body, inline, sources }
//    - body: input text verbatim (links unchanged)
//    - inline: one InlineMarker per [text](url) link;
//              marker = full "[text](url)" string; n = sequential 1..N
// 2. replaceMarkersInBody(body, inline) → bodyFC
//    Replace each inline.marker string in body with its [^n] reference.
//    (fromCitations is app-only; web/download markers are not bare [n] patterns.)
// 3. resolveFootnoteIdentity(pr.sources, []) → { idMap, newRefs }
// 4. applyFootnoteInlineRename(bodyFC, idMap) → edits against bodyFC; apply → finalBody
// 5. cascade with ctx.op.input = finalBody → one insert at cursor in doc
// 6. moveToResources(ctx.op, newRefDefinitions(newRefs)) → insert defs into Resources

import type { ScriptContext, ScriptFunction } from "../context";
import type { EditPlan } from "../../core/types";
import { perplexityWeb } from "../../parsers/perplexityWeb";
import {
	resolveFootnoteIdentity,
	applyFootnoteInlineRename,
	newRefDefinitions,
	moveToResources,
} from "../../core/footnotes";
import { applyToString } from "../../core/applyToString";
import { cascade } from "../../core/headings";
import { replaceMarkersInBody } from "./replaceMarkersInBody";

/**
 * Transform a Perplexity web copy-paste into a structured Obsidian note fragment.
 *
 * The script is a ScriptFunction — it receives a ScriptContext and returns an
 * EditPlan of offsets against ctx.op.doc (ADR-1).  Returning undefined signals
 * "nothing to do" (noop); the runner will NOT call rawFallback in that case.
 */
export const perplexityWebScript: ScriptFunction = (ctx: ScriptContext): EditPlan | undefined => {
	if (!perplexityWeb.canParse(ctx.input)) return undefined;

	const pr = perplexityWeb.parse(ctx.input);

	// Step 1: Replace [text](url) inline links with [^n] footnote references.
	// Web markers are full "[text](url)" strings, not bare [n] patterns,
	// so we use replaceMarkersInBody rather than fromCitations.
	const bodyFC = replaceMarkersInBody(pr.body, pr.inline);

	// Step 2: Resolve identity — dedup by URL, build idMap and new refs.
	const { idMap, newRefs } = resolveFootnoteIdentity(pr.sources, []);

	// Step 3: Rename [^n] → [^finalId] using the resolved idMap.
	const renameEdits = applyFootnoteInlineRename(bodyFC, idMap);
	const finalBody = applyToString(bodyFC, renameEdits);

	// Step 4: Cascade the final body under the note context heading.
	const cascadeOp = { ...ctx.op, input: finalBody };
	const { plan: cascadePlan } = cascade(cascadeOp);

	// Step 5: Build footnote definitions and move them to the Resources section.
	const defs = newRefDefinitions(newRefs);
	const resourcesPlan = moveToResources(ctx.op, defs);

	return [...cascadePlan, ...resourcesPlan];
};
