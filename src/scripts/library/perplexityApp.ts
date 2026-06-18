// Phase 5 — Perplexity App script
//
// PURPOSE
// -------
// Converts a Perplexity *app* copy-paste (format: bare "Sources" block with
// [n] title url lines; multi-block with ## Question / ## Answer headings)
// into a structured note: headings cascaded under the note context, inline
// citations converted to [^n] footnotes with URL-deduped identity resolution,
// and footnote defs filed into the ## Resources section.
//
// PASTE DOC MODEL
// ---------------
// ctx.op.doc    = the current note text (e.g. "# Title\n\n")
// ctx.op.cursor = insertion point (typically doc.length — end of note)
// ctx.input     = raw Perplexity app copy-paste text
//
// COMPOSITION
// -----------
// 1. Parse ctx.input → ParseResult { body, inline, sources }
//    - body: prose with Sources blocks stripped; markers renumbered globally
//    - sources: 1..N globally-unique incomingIds, no dedup yet
// 2. citedSources = filter sources to those actually cited in pr.inline
//    (some Sources-block entries are never referenced in prose)
// 3. fromCitations(pr) → EditPlan against pr.body; apply → bodyFC ([^n] form)
// 4. resolveFootnoteIdentity(citedSources, []) → { idMap, newRefs }
// 5. applyFootnoteInlineRename(bodyFC, idMap) → edits against bodyFC; apply → finalBody
// 6. cascade with ctx.op.input = finalBody → one insert at cursor in doc
// 7. moveToResources(ctx.op, newRefDefinitions(newRefs)) → insert defs into Resources

import type { ScriptContext, ScriptFunction } from "../context";
import type { EditPlan } from "../../core/types";
import { perplexityApp } from "../../parsers/perplexityApp";
import {
	fromCitations,
	resolveFootnoteIdentity,
	applyFootnoteInlineRename,
	newRefDefinitions,
	moveToResources,
	scanExistingRefs,
} from "../../core/footnotes";
import { applyToString } from "../../core/applyToString";
import { cascade } from "../../core/headings";
import { filterCitedSources } from "./replaceMarkersInBody";

/**
 * Transform a Perplexity app copy-paste into a structured Obsidian note fragment.
 *
 * The script is a ScriptFunction — it receives a ScriptContext and returns an
 * EditPlan of offsets against ctx.op.doc (ADR-1).  Returning undefined signals
 * "nothing to do" (noop); the runner will NOT call rawFallback in that case.
 */
export const perplexityAppScript: ScriptFunction = (ctx: ScriptContext): EditPlan | undefined => {
	if (!perplexityApp.canParse(ctx.input)) return undefined;

	ctx.logger.info(`perplexity-app started (source=${ctx.source})`);

	const pr = perplexityApp.parse(ctx.input);

	// Step 1: Convert bare [n] citation markers to [^n] footnote references.
	const fromCitationsEdits = fromCitations(pr);
	const bodyFC = applyToString(pr.body, fromCitationsEdits);

	// Step 2: Filter to only sources actually cited in prose — avoids orphan defs.
	const citedSources = filterCitedSources(pr.sources, pr.inline);

	// Step 3: Resolve identity — dedup cited sources by URL, build idMap and new refs.
	// Scan the destination note for existing numeric footnote defs so new paste ids
	// start past maxExisting and never collide with pre-existing [^n] footnotes.
	const existing = scanExistingRefs(ctx.op.doc);
	const { idMap, newRefs } = resolveFootnoteIdentity(citedSources, existing);
	ctx.logger.info(`resolved ${newRefs.length + (citedSources.length - newRefs.length)} footnotes (${newRefs.length} new, ${citedSources.length - newRefs.length} reused)`);

	// Step 4: Rename [^n] → [^finalId] using the resolved idMap.
	const renameEdits = applyFootnoteInlineRename(bodyFC, idMap);
	const finalBody = applyToString(bodyFC, renameEdits);

	// Step 5: Cascade the final body under the note context heading.
	const cascadeOp = { ...ctx.op, input: finalBody };
	const { plan: cascadePlan } = cascade(cascadeOp);

	// Step 6: Build footnote definitions and move them to the Resources section.
	const defs = newRefDefinitions(newRefs);
	const resourcesPlan = moveToResources(ctx.op, defs);

	const plan = [...cascadePlan, ...resourcesPlan];
	ctx.logger.info(`plan: ${plan.length} edits`);
	return plan;
};
