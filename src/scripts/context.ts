// T5.2  ScriptContext — the stable contract that user scripts depend on.
//
// DESIGN OVERVIEW
// ---------------
// ScriptContext is the single argument passed to every user script function.
// It bundles the document state (via OperationContext), the clipboard/selection
// payload, the versioned mason.* API, and a logger — everything a script needs
// to read the document and produce an EditPlan.
//
// PURITY CONSTRAINT (CON-2)
// -------------------------
// This module has ZERO obsidian imports.  It accepts a MasonApi from the
// caller (who supplies buildRegistry().api) so the context layer stays pure
// and unit-testable in Node/vitest without the Obsidian environment.
//
// LOGGER DEFAULT
// --------------
// When no logger is supplied, a console-backed default is used:
//   info  → console.debug  (always-on; use buildGatedLogger to gate on debugLogging)
//   warn  → console.warn
//   error → console.error
// The caller may inject a custom logger (e.g. a mock in tests, or an
// Obsidian-Notice-backed logger in the integration layer).
//
// ScriptFunction CONTRACT
// -----------------------
// A user script must export a function matching ScriptFunction:
//   (ctx: ScriptContext) => EditPlan | undefined | Promise<EditPlan | undefined>
// Returning undefined or [] signals "nothing to do" (noop).
// All offsets in the returned EditPlan are against ctx.op.doc (the original).

import type { OperationContext, EditPlan } from "../core/types";
import type { MasonApi } from "../core/registry";

// ---------------------------------------------------------------------------
// Public types — the stable script API contract
// ---------------------------------------------------------------------------

/** Logger interface injected into every ScriptContext. */
export interface ScriptLogger {
	info(s: string): void;
	warn(s: string): void;
	error(s: string): void;
}

/**
 * The single argument passed to every user script.
 *
 * Fields:
 *   input  — the text to transform: clipboard text (paste) or the selected text
 *            (selection / command on a selection). Empty string for a command run
 *            with no selection.
 *   source — how this script was triggered; lets scripts branch on trigger type
 *   op     — full OperationContext: doc, cursor, selection?, replaceRange?, input?, settings
 *   mason  — versioned mason.* API (headings, footnotes, util); version-gated
 *   logger — surface messages to the user; backed by console in default config
 */
export interface ScriptContext {
	input: string;
	source: "paste" | "selection" | "command";
	op: OperationContext;
	mason: MasonApi;
	logger: ScriptLogger;
}

/**
 * The function signature all user scripts must satisfy.
 *
 * Returning undefined or an empty EditPlan is valid (signals "nothing to do").
 * The runner treats both as a noop — rawFallback is NOT called.
 *
 * Throwing or returning a rejected Promise causes the runner to invoke
 * rawFallback and notify the user; applyPlan is never called on failure.
 */
export type ScriptFunction = (ctx: ScriptContext) => EditPlan | undefined | Promise<EditPlan | undefined>;

// ---------------------------------------------------------------------------
// buildScriptContext factory args
// ---------------------------------------------------------------------------

/** Arguments for buildScriptContext. */
export interface BuildScriptContextArgs {
	input: string;
	source: "paste" | "selection" | "command";
	op: OperationContext;
	mason: MasonApi;
	/** Optional logger override; defaults to a console-backed logger. */
	logger?: ScriptLogger;
}

// ---------------------------------------------------------------------------
// Default logger — console-backed (always-on info; used when no logger injected)
// ---------------------------------------------------------------------------

function buildDefaultLogger(): ScriptLogger {
	return {
		info: (s: string): void => { console.debug(`[mason-script] ${s}`); },
		warn: (s: string): void => { console.warn(`[mason-script] ${s}`); },
		error: (s: string): void => { console.error(`[mason-script] ${s}`); },
	};
}

// ---------------------------------------------------------------------------
// buildGatedLogger — debug-flag-gated logger for use in main.ts command layer
// ---------------------------------------------------------------------------

/**
 * Build a ScriptLogger whose info traces are gated on the debugLogging setting.
 *
 *   debug=true  → info writes to console.debug with a [mason] prefix
 *   debug=false → info is a no-op (traces are silent)
 *
 * warn and error are always-on regardless of the flag, so problems are always
 * surfaced even when debug tracing is off.
 */
export function buildGatedLogger(debug: boolean): ScriptLogger {
	return {
		info: debug
			? (s: string): void => { console.debug(`[mason] ${s}`); }
			: (): void => { /* no-op when debugLogging is off */ },
		warn: (s: string): void => { console.warn(`[mason] ${s}`); },
		error: (s: string): void => { console.error(`[mason] ${s}`); },
	};
}

// ---------------------------------------------------------------------------
// buildScriptContext — factory
// ---------------------------------------------------------------------------

/**
 * Assemble a ScriptContext from the provided arguments.
 *
 * The mason field is passed in directly (caller supplies buildRegistry().api)
 * so this module stays free of any registry or Obsidian dependency.
 */
export function buildScriptContext(args: BuildScriptContextArgs): ScriptContext {
	return {
		input: args.input,
		source: args.source,
		op: args.op,
		mason: args.mason,
		logger: args.logger ?? buildDefaultLogger(),
	};
}
