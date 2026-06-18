// Phase 5 — Perplexity Web-Download script
//
// PURPOSE
// -------
// Converts a Perplexity *web-download* copy-paste (format: [^a_b]: url
// definition lines; inline [^a_b] markers; HTML noise stripped) into a
// structured note: headings cascaded under the note context, inline [^a_b]
// markers replaced by [^n] footnotes with URL-deduped identity resolution,
// and footnote defs filed into the ## Resources section.
//
// PASTE DOC MODEL
// ---------------
// ctx.op.doc    = the current note text (e.g. "# Title\n\n")
// ctx.op.cursor = insertion point (typically doc.length — end of note)
// ctx.input     = raw Perplexity web-download copy-paste text
//
// COMPOSITION
// -----------
// 1. Parse ctx.input → ParseResult { body, inline, sources }
//    - body: HTML-stripped, definition lines removed, prose only
//    - inline: one InlineMarker per [^a_b] occurrence in prose
//              marker = "[^a_b]" string; n = sequential incomingId
//    - sources: sequential incomingIds; snippet = url; title = host
// 2. citedSources = filter sources to those actually cited in pr.inline
//    (hidden-span markers are stripped from body by parser; their sources
//     are excluded to avoid orphan Resource defs)
// 3. replaceMarkersInBody(body, inline) → bodyFC
//    Replace each inline.marker string ([^a_b]) in body with its [^n] reference.
// 4. resolveFootnoteIdentity(citedSources, []) → { idMap, newRefs }
// 5. applyFootnoteInlineRename(bodyFC, idMap) → edits against bodyFC; apply → finalBody
// 6. cascade with ctx.op.input = finalBody → one insert at cursor in doc
// 7. moveToResources(ctx.op, compactRefDefinitions(newRefs)) → insert single-line defs into Resources

import type { ScriptContext, ScriptFunction } from "../context";
import type { EditPlan } from "../../core/types";
import { perplexityWebDownload } from "../../parsers/perplexityWebDownload";
import {
	resolveFootnoteIdentity,
	applyFootnoteInlineRename,
	compactRefDefinitions,
	moveToResources,
	scanExistingRefs,
} from "../../core/footnotes";
import { applyToString } from "../../core/applyToString";
import { cascade } from "../../core/headings";
import { replaceMarkersInBody, filterCitedSources } from "./replaceMarkersInBody";

/**
 * Transform a Perplexity web-download copy-paste into a structured Obsidian note fragment.
 *
 * The script is a ScriptFunction — it receives a ScriptContext and returns an
 * EditPlan of offsets against ctx.op.doc (ADR-1).  Returning undefined signals
 * "nothing to do" (noop); the runner will NOT call rawFallback in that case.
 */
export const perplexityWebDownloadScript: ScriptFunction = (ctx: ScriptContext): EditPlan | undefined => {
	if (!perplexityWebDownload.canParse(ctx.input)) return undefined;

	const pr = perplexityWebDownload.parse(ctx.input);

	// Step 1: Replace [^a_b] inline markers with sequential [^n] footnote references.
	// Web-download markers are full "[^a_b]" strings; replaceMarkersInBody locates
	// each occurrence in the body by direct string search and replaces it with [^n].
	const bodyFC = replaceMarkersInBody(pr.body, pr.inline);

	// Step 2: Filter to only sources actually cited in prose — avoids orphan defs.
	// Hidden-span markers are stripped by the parser; their sources are excluded.
	const citedSources = filterCitedSources(pr.sources, pr.inline);

	// Step 3: Resolve identity — dedup cited sources by URL, build idMap and new refs.
	// Scan the destination note for existing numeric footnote defs so new paste ids
	// start past maxExisting and never collide with pre-existing [^n] footnotes.
	const { idMap, newRefs } = resolveFootnoteIdentity(citedSources, scanExistingRefs(ctx.op.doc));

	// Step 4: Rename [^n] → [^finalId] using the resolved idMap.
	const renameEdits = applyFootnoteInlineRename(bodyFC, idMap);
	const finalBody = applyToString(bodyFC, renameEdits);

	// Step 5: Cascade the final body under the note context heading.
	const cascadeOp = { ...ctx.op, input: finalBody };
	const { plan: cascadePlan } = cascade(cascadeOp);

	// Step 6: Build single-line compact footnote definitions and move them to the Resources section.
	// Web-download format uses compact single-line defs ("[^n]: [title](url)") to avoid
	// duplicating the URL: the snippet was the raw URL, which would have appeared twice.
	const defs = compactRefDefinitions(newRefs);
	const resourcesPlan = moveToResources(ctx.op, defs);

	return [...cascadePlan, ...resourcesPlan];
};
