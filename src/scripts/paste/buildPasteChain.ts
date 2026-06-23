// buildPasteChain — single ordering chokepoint for paste autodetect (ADR-16, T3.2)
//
// PURPOSE
// -------
// This is the ONLY place in the codebase that determines the order in which
// paste-capable scripts are tried. All paste ordering must flow through here.
//
// PRECEDENCE (PRD F10)
// --------------------
// 1. Provenance: curated (rank 0) before imported (rank 1).
//    A curated canHandle:()=>true catch-all is tried before ANY imported handler —
//    an imported catch-all cannot hijack a curated-claimed format.
// 2. Priority DESC within the same provenance. Higher number = tried first.
//    Perplexity scripts preserve their detect.ts order: app=300, web-download=200, web=100.
// 3. Id ASC (localeCompare) as a stable tiebreak when provenance + priority match.
//
// EXCLUSIONS
// ----------
// Command-only scripts (those without a `paste` block in their ScriptModule)
// are never included in the chain. Scripts whose module has not been loaded
// (module === null) are also excluded.
//
// FUTURE EXTENSION (additive only)
// ---------------------------------
// The future `pasteOrder` user overlay (per ADR-16) will be an additional sort
// key inserted before or after priority — purely additive change to the
// comparator inside this function. No callers need to change.

import type { ScriptRecord } from "../store";
import type { ScriptModule, PasteBlock } from "../loader";
import type { ScriptFunction } from "../context";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The runtime per-device script object used by buildPasteChain.
 * Defines the minimal shape needed for ordering and mapping.
 *
 * module is null when the script has not yet been materialized/loaded.
 * Later phases may re-export or relocate this interface.
 */
export interface LoadedScript {
	id: string;
	/** Only provenance is used for ordering; widen to full ScriptRecord if cleaner. */
	record: Pick<ScriptRecord, "provenance">;
	/** null if the script module has not been loaded yet. */
	module: ScriptModule | null;
}

/**
 * One entry in the ordered paste handler chain returned by buildPasteChain.
 * The consumer (T3.3) iterates this chain and calls canHandle(input) in order.
 */
export interface PasteHandler {
	id: string;
	canHandle(input: string): boolean;
	run: ScriptFunction;
}

// ---------------------------------------------------------------------------
// rank — provenance → numeric sort key
// ---------------------------------------------------------------------------

function rank(provenance: "curated" | "imported"): number {
	return provenance === "curated" ? 0 : 1;
}

// ---------------------------------------------------------------------------
// buildPasteChain — the single ordering chokepoint
// ---------------------------------------------------------------------------

/**
 * Build an ordered list of PasteHandlers from the enabled loaded scripts.
 *
 * Only scripts whose module?.paste block is present are included.
 * The ordering follows PRD F10: curated first, then priority DESC, then id ASC.
 *
 * The input array is NOT mutated: filter() returns a new array, and sort()
 * operates on that new array — the caller's original array is untouched.
 */
export function buildPasteChain(enabled: LoadedScript[]): PasteHandler[] {
	return enabled
		.filter((s): s is LoadedScript & { module: ScriptModule & { paste: PasteBlock } } =>
			s.module?.paste != null,
		)
		.sort((a, b) =>
			rank(a.record.provenance) - rank(b.record.provenance)
			|| b.module.paste.priority - a.module.paste.priority
			|| a.id.localeCompare(b.id),
		)
		.map(s => ({
			id: s.id,
			canHandle: s.module.paste.canHandle,
			run: s.module.run,
		}));
}
