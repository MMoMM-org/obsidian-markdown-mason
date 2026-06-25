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
// COMMAND / SELECTION (OperationContext.replaceRange)
// ---------------------------------------------------
// Run as a command on a non-empty selection, ctx.op.replaceRange is set to the
// selection span (and ctx.op.cursor to its start), so cascadeOrInsert REPLACES the
// selected raw text in place (format-in-place) instead of inserting at the cursor.
// All "insert at cursor" steps below become a replace-over-selection in that mode.
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
// 6. cascade with ctx.op.input = finalBody → one placement in doc
//    (insert at cursor, or replace-over-selection in command mode — see header)
// 7. moveToResources(ctx.op, newRefDefinitions(newRefs)) → insert defs into Resources

import type { ScriptContext, ScriptFunction } from "../../src/scripts/context";
import type { EditPlan } from "../../src/core/types";
import { perplexityApp } from "../parsers/perplexityApp";
import {
	fromCitations,
	resolveFootnoteIdentity,
	applyFootnoteInlineRename,
	newRefDefinitions,
	moveToResources,
	scanExistingRefs,
} from "../../src/core/footnotes";
import { applyToString } from "../../src/core/applyToString";
import { cascadeOrInsert } from "../../src/core/headings";
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

	// Step 1: Filter to only sources actually cited in prose — avoids orphan defs.
	const citedSources = filterCitedSources(pr.sources, pr.inline);

	// Step 2: Resolve identity FIRST — dedup cited sources by URL, build idMap and
	// new refs. Scan the destination note for existing numeric footnote defs so new
	// paste ids start past maxExisting and never collide with pre-existing [^n].
	// Resolving before converting tells us which [n] markers actually have a source.
	const existing = scanExistingRefs(ctx.op.doc);
	const { idMap, newRefs } = resolveFootnoteIdentity(citedSources, existing);
	ctx.logger.info(`resolved ${citedSources.length} footnotes (${newRefs.length} new, ${citedSources.length - newRefs.length} reused)`);

	// Step 3: Convert ONLY resolvable [n] markers to [^n]. A marker whose source line
	// was malformed/missing has no idMap entry and stays a plain [n] — never a
	// dangling [^n] footnote with no definition (F-1).
	const resolvableIds = new Set(Object.keys(idMap).map(Number));
	const fromCitationsEdits = fromCitations(pr, resolvableIds);
	const bodyFC = applyToString(pr.body, fromCitationsEdits);

	// Step 4: Rename [^n] → [^finalId] using the resolved idMap.
	const renameEdits = applyFootnoteInlineRename(bodyFC, idMap);
	const finalBody = applyToString(bodyFC, renameEdits);

	// Step 5: Cascade the final body under the note context heading. cascadeOrInsert
	// never drops the body — if there's no heading above the cursor (blank note) it
	// inserts the body verbatim at the cursor instead of returning an empty plan.
	const cascadeOp = { ...ctx.op, input: finalBody };
	const bodyPlan = cascadeOrInsert(cascadeOp);

	// Step 6: Build footnote definitions and move them to the Resources section.
	const defs = newRefDefinitions(newRefs);
	const resourcesPlan = moveToResources(ctx.op, defs);

	const plan = [...bodyPlan, ...resourcesPlan];
	ctx.logger.info(`plan: ${plan.length} edits`);
	return plan;
};
