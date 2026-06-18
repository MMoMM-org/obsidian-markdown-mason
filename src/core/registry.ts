// No obsidian import — this module is pure domain; unit-testable without Obsidian.
// CON-2: zero obsidian imports permitted here.
//
// T3.1  Operation registry + versioned mason.* API
//
// DESIGN OVERVIEW
// ---------------
// A single RegistryEntry array drives BOTH (a) command descriptors and
// (b) the mason.* API surface — one definition, no logic duplication.
//
// RegistryEntry shape:
//   id         — dot-namespaced id, e.g. "headings.cascade"
//   apiName    — fully-qualified, e.g. "mason.headings.cascade"
//   command    — { name: "Mason: <Sentence case>" } for the command layer
//   run        — Operation-compatible (ctx: OperationContext) → EditPlan
//                (used by T3.4 command layer and the no-duplication test seam)
//   runRich?   — cascade only: (ctx) → CascadeResult, exposes noContextHeading
//                so T3.4 can surface the Obsidian Notice without importing headings.ts
//   identityFull? — footnotes.identity only: (ctx, parseResult) → { plan, newRefs }
//                   so T3.4/scripts can get newRefs to thread into footnotes.move
//
// Two-path split for fromCitations / identity:
//   entry.run(ctx) → [] (safe no-op stub; Phase-4 seam)
//   api.footnotes.fromCitations/identity(ctx, parseResult) → real EditPlan
//   This gap closes when Phase 4 plumbs ctx parsing so entry.run can obtain
//   a ParseResult from ctx.doc directly and produce a real result.
//
// SIGNATURE DECISIONS
// -------------------
//
// 1. mason.headings.cascade(ctx) → EditPlan
//    Core cascade() returns CascadeResult { plan, noContextHeading }.
//    The API returns .plan only (SDD contract).
//    The command layer reads runRich() off the RegistryEntry to get noContextHeading.
//
// 2. mason.footnotes.fromCitations(ctx, parseResult) → EditPlan
//    Core fromCitations(parseResult) takes only parseResult (ctx unused in core).
//    The API wraps it with (ctx, parseResult) to honour the SDD surface;
//    ctx is accepted but currently unused — reserved for future per-note settings.
//
// 3. mason.footnotes.identity(ctx, parseResult) → EditPlan
//    Composes: resolveFootnoteIdentity(parseResult.sources, []) + applyFootnoteInlineRename
//    Returns the inline-rename EditPlan.  newRefs (for move) are available via
//    entry.identityFull(ctx, parseResult) → { plan, newRefs }.
//    The existing-refs list defaults to [] because the registry does not parse the
//    doc — the script/command layer is responsible for supplying parsed existing refs
//    by extracting them from ctx.doc first (Phase 4 will add a parser seam).
//    TODO(Phase 4): plumb existingRefs from ctx.doc via parser.
//
// 4. mason.footnotes.move(ctx, defs?) → EditPlan
//    SDD: move(ctx) → EditPlan.  Core moveToResources(ctx, defs) requires defs.
//    The API adds an optional defs param: move(ctx, defs?: string[]) → EditPlan.
//    Default [] → empty plan (safe no-op).  Scripts thread defs from identity's
//    newRefs: const { newRefs } = entry.identityFull(ctx, pr); move(ctx, newRefDefs(newRefs)).
//    entry.run(ctx) uses the empty-defs default — safe for the command layer.
//
// 5. mason.util.normalizeUrl(raw) → string
//    Direct passthrough to core normalizeUrl.  run(ctx) is a no-op stub
//    (this op has no ctx-based EditPlan form; the command layer won't register it
//    as a standalone command, but it must appear in the registry per F11 AC).

import type { EditPlan, OperationContext, ParseResult } from "./types";
import { cascade } from "./headings";
import type { CascadeResult } from "./headings";
import { normalize } from "./headings";
import {
	resolveFootnoteIdentity,
	applyFootnoteInlineRename,
	fromCitations,
	moveToResources,
	scanExistingRefs,
} from "./footnotes";
import type { ResolvedRef } from "./footnotes";
import {
	wholeNoteFromCitations,
	wholeNoteIdentity,
	wholeNoteMove,
} from "./noteFootnotes";
import { normalizeUrl } from "./url";

// ---------------------------------------------------------------------------
// API version
// ---------------------------------------------------------------------------

export const API_VERSION = "1.0";

// ---------------------------------------------------------------------------
// Version gate
// ---------------------------------------------------------------------------

/**
 * Pure compatibility predicate: returns true iff `required` is satisfied by
 * `available` under the additive-minor model.
 *
 * Exported so tests can call it with arbitrary version pairs, exercising the
 * lower-minor and major-mismatch branches independently of API_VERSION.
 *
 * Returns false for any malformed input (fail-closed design).
 */
export function isApiCompatible(available: string, required: string): boolean {
	const VERSION_RE = /^\d+\.\d+$/;
	if (!VERSION_RE.test(available) || !VERSION_RE.test(required)) {
		return false;
	}
	const [aMaj, aMin] = parseVersion(available);
	const [rMaj, rMin] = parseVersion(required);
	if (isNaN(aMaj) || isNaN(aMin) || isNaN(rMaj) || isNaN(rMin)) {
		return false;
	}
	return rMaj === aMaj && rMin <= aMin;
}

/**
 * Check whether the available API satisfies a required version.
 *
 * Compatibility rule (additive-minor model):
 *   ok iff major matches AND required minor ≤ available minor.
 *   Any major mismatch is a breaking change → rejected.
 *   Malformed input fails CLOSED: returns { ok: false }.
 *
 * Returns { ok: true } on success, { ok: false, message } on failure.
 * The message is a plain string — surfacing a Notice is the command layer's job.
 */
export function checkRequiredApiVersion(
	required: string,
): { ok: boolean; message?: string } {
	if (!isApiCompatible(API_VERSION, required)) {
		return { ok: false, message: `requires API v${required}` };
	}
	return { ok: true };
}

function parseVersion(v: string): [number, number] {
	const [maj = "0", min = "0"] = v.split(".");
	return [parseInt(maj, 10), parseInt(min, 10)];
}

// ---------------------------------------------------------------------------
// RegistryEntry type
// ---------------------------------------------------------------------------

export interface RegistryEntry {
	/** Dot-namespaced id, e.g. "headings.cascade". */
	id: string;
	/** Fully-qualified API name, e.g. "mason.headings.cascade". */
	apiName: string;
	/** Obsidian command descriptor. */
	command: { name: string };
	/**
	 * Operation-compatible run signature: (ctx) → EditPlan.
	 * Used by the T3.4 command layer for ctx-only operations.
	 * For ops that take extra args (ParseResult, defs), this is a safe default
	 * (identity → empty plan with no parseResult; move → empty plan with no defs).
	 */
	run(ctx: OperationContext): EditPlan;
	/**
	 * headings.cascade only: returns CascadeResult so the command layer can read
	 * noContextHeading and surface an Obsidian Notice without importing headings.ts.
	 */
	runRich?(ctx: OperationContext): CascadeResult;
	/**
	 * footnotes.identity only: returns { plan, newRefs } so callers can obtain
	 * the newRefs list for threading into footnotes.move defs.
	 */
	identityFull?(ctx: OperationContext, parseResult: ParseResult): { plan: EditPlan; newRefs: ResolvedRef[] };
}

// ---------------------------------------------------------------------------
// MasonApi type
// ---------------------------------------------------------------------------

export interface MasonApi {
	headings: {
		cascade(ctx: OperationContext): EditPlan;
		normalize(ctx: OperationContext): EditPlan;
	};
	footnotes: {
		fromCitations(ctx: OperationContext, parseResult: ParseResult): EditPlan;
		identity(ctx: OperationContext, parseResult: ParseResult): EditPlan;
		move(ctx: OperationContext, defs?: string[]): EditPlan;
	};
	util: {
		normalizeUrl(raw: string): string;
	};
}

// ---------------------------------------------------------------------------
// Registry build
// ---------------------------------------------------------------------------

export interface Registry {
	entries: RegistryEntry[];
	api: MasonApi;
}

/**
 * Build the operation registry.
 *
 * All operations are registered here exactly once.  Both the command descriptors
 * (entries[].command) and the mason.* API methods (api.*) are derived from this
 * single definition — no duplicated logic.
 */
export function buildRegistry(): Registry {
	const entries: RegistryEntry[] = buildEntries();
	const api = buildApi(entries);
	return { entries, api };
}

// ---------------------------------------------------------------------------
// Entry definitions — ONE array, feeds both command layer and api
// ---------------------------------------------------------------------------

function buildEntries(): RegistryEntry[] {
	return [
		buildCascadeEntry(),
		buildNormalizeEntry(),
		buildFromCitationsEntry(),
		buildIdentityEntry(),
		buildMoveEntry(),
		buildNormalizeUrlEntry(),
	];
}

function buildCascadeEntry(): RegistryEntry {
	return {
		id: "headings.cascade",
		apiName: "mason.headings.cascade",
		command: { name: "Cascade headings" },
		run(ctx: OperationContext): EditPlan {
			return cascade(ctx).plan;
		},
		runRich(ctx: OperationContext): CascadeResult {
			return cascade(ctx);
		},
	};
}

function buildNormalizeEntry(): RegistryEntry {
	return {
		id: "headings.normalize",
		apiName: "mason.headings.normalize",
		command: { name: "Normalize headings" },
		run(ctx: OperationContext): EditPlan {
			return normalize(ctx);
		},
	};
}

function buildFromCitationsEntry(): RegistryEntry {
	return {
		id: "footnotes.fromCitations",
		apiName: "mason.footnotes.fromCitations",
		command: { name: "Convert citations to footnotes" },
		/**
		 * run(ctx) performs the whole-note C operation: converts bare [n] citation
		 * markers in ctx.doc to [^n] footnote refs.
		 *
		 * The two-argument api.footnotes.fromCitations(ctx, parseResult) path
		 * continues to support paste-flow scripts that supply a ParseResult directly.
		 */
		run(ctx: OperationContext): EditPlan {
			return wholeNoteFromCitations(ctx);
		},
	};
}

function buildIdentityEntry(): RegistryEntry {
	return {
		id: "footnotes.identity",
		apiName: "mason.footnotes.identity",
		command: { name: "Resolve footnote identity" },
		/**
		 * run(ctx) performs the whole-note O+D operation: renumbers numeric footnotes
		 * gap-free in first-reference order, deduplicates by URL, and collapses
		 * duplicate definitions.  Alpha footnotes are preserved unchanged.
		 *
		 * identityFull(ctx, parseResult) remains for paste-flow scripts that supply
		 * a ParseResult and need access to the newRefs list for threading into move.
		 */
		run(ctx: OperationContext): EditPlan {
			return wholeNoteIdentity(ctx);
		},
		identityFull(
			ctx: OperationContext,
			parseResult: ParseResult,
		): { plan: EditPlan; newRefs: ResolvedRef[] } {
			// Paste-flow: extract existingRefs from ctx.doc so new paste ids start
			// past maxExisting and never collide with pre-existing footnotes.
			// This replaces the TODO(Phase 4) stub with a real implementation.
			const existingRefs = scanExistingRefs(ctx.doc);
			const { idMap, newRefs } = resolveFootnoteIdentity(parseResult.sources, existingRefs);
			const plan = applyFootnoteInlineRename(parseResult.body, idMap);
			return { plan, newRefs };
		},
	};
}

function buildMoveEntry(): RegistryEntry {
	return {
		id: "footnotes.move",
		apiName: "mason.footnotes.move",
		command: { name: "Move footnotes to resources" },
		/**
		 * run(ctx) performs the whole-note M operation: moves all numeric footnote
		 * definition blocks that are not already in ## <resourcesName> into that
		 * section.  Orphaned lines in Resources are preserved; alpha defs are not
		 * moved.  Creates the section at note end if absent (only when defs exist).
		 *
		 * The api.footnotes.move(ctx, defs?) path continues to support paste-flow
		 * scripts that supply pre-formatted defs from moveToResources.
		 */
		run(ctx: OperationContext): EditPlan {
			return wholeNoteMove(ctx);
		},
	};
}

function buildNormalizeUrlEntry(): RegistryEntry {
	return {
		id: "util.normalizeUrl",
		apiName: "mason.util.normalizeUrl",
		command: { name: "Normalize url" },
		/**
		 * run(ctx) is a no-op stub — normalizeUrl takes a raw string, not a ctx.
		 * The api.util.normalizeUrl(raw) path is the canonical calling convention.
		 * This entry exists so scripts can discover normalizeUrl via the registry.
		 */
		run(ctx: OperationContext): EditPlan {
			void ctx;
			return [];
		},
	};
}

// ---------------------------------------------------------------------------
// API surface — derived from entries, no new logic
// ---------------------------------------------------------------------------

function buildApi(entries: RegistryEntry[]): MasonApi {
	const cascadeEntry = findEntry(entries, "headings.cascade");
	const normalizeEntry = findEntry(entries, "headings.normalize");
	const identityEntry = findEntry(entries, "footnotes.identity");

	return {
		headings: {
			cascade(ctx: OperationContext): EditPlan {
				return cascadeEntry.run(ctx);
			},
			normalize(ctx: OperationContext): EditPlan {
				return normalizeEntry.run(ctx);
			},
		},
		footnotes: {
			fromCitations(ctx: OperationContext, parseResult: ParseResult): EditPlan {
				// ctx accepted per SDD; currently unused (reserved for future per-note settings).
				void ctx;
				return fromCitations(parseResult);
			},
			identity(ctx: OperationContext, parseResult: ParseResult): EditPlan {
				return identityEntry.identityFull!(ctx, parseResult).plan;
			},
			move(ctx: OperationContext, defs: string[] = []): EditPlan {
				return moveToResources(ctx, defs);
			},
		},
		util: {
			normalizeUrl(raw: string): string {
				return normalizeUrl(raw);
			},
		},
	};
}

function findEntry(entries: RegistryEntry[], id: string): RegistryEntry {
	const entry = entries.find((e) => e.id === id);
	if (!entry) throw new Error(`Registry: missing entry for id="${id}"`);
	return entry;
}
