// Phase 5 — Perplexity Auto script
//
// PURPOSE
// -------
// Auto-detects the Perplexity copy-paste format and delegates to the
// matching concrete script.  Returns undefined for unrecognized input.
//
// ROUTING
// -------
// detect(ctx.input) returns the matching CitationParser (or null):
//   perplexityApp         → perplexityAppScript
//   perplexityWebDownload → perplexityWebDownloadScript
//   perplexityWeb         → perplexityWebScript
//   null                  → undefined (no-op)
//
// Delegation is done by calling the concrete ScriptFunction with the SAME ctx,
// so the output is guaranteed to match what the concrete script would produce
// directly.  No parsing is duplicated — detect() runs canParse(), and the
// delegated script runs parse() once internally.
//
// PASTE DOC MODEL
// ---------------
// Same as the three concrete scripts:
//   ctx.op.doc    = current note text (e.g. "# Title\n\n")
//   ctx.op.cursor = insertion point (typically doc.length)
//   ctx.input     = raw Perplexity copy-paste text (any format)

import type { ScriptContext, ScriptFunction } from "../context";
import type { EditPlan } from "../../core/types";
import { detect } from "../../parsers/detect";
import { perplexityApp } from "../../parsers/perplexityApp";
import { perplexityWebDownload } from "../../parsers/perplexityWebDownload";
import { perplexityWebScript } from "./perplexityWeb";
import { perplexityAppScript } from "./perplexityApp";
import { perplexityWebDownloadScript } from "./perplexityWebDownload";

/**
 * Auto-detect and delegate to the correct Perplexity script.
 *
 * Returns an EditPlan from the matched concrete script, or undefined when no
 * parser recognizes the input.  The returned EditPlan has offsets against
 * ctx.op.doc (ADR-1), identical to what the concrete script would produce.
 */
export const perplexityAutoScript: ScriptFunction = (
	ctx: ScriptContext,
): EditPlan | undefined => {
	const parser = detect(ctx.input);
	if (parser === null) return undefined;

	// Map the detected CitationParser to its concrete script.
	// Use identity checks against the parser singletons.
	// Cast: all three concrete scripts are synchronous (no await); the
	// ScriptFunction union type includes Promise but these implementations
	// never return one.
	if (parser === perplexityApp) {
		return perplexityAppScript(ctx) as EditPlan | undefined;
	}
	if (parser === perplexityWebDownload) {
		return perplexityWebDownloadScript(ctx) as EditPlan | undefined;
	}
	// Remaining case: perplexityWeb
	return perplexityWebScript(ctx) as EditPlan | undefined;
};
