// T5.2  ScriptRunner — single-script execution with policy gate, timeout, and fallback.
//
// DESIGN OVERVIEW
// ---------------
// The ScriptRunner adapts the hashi HookRunner execution core to mason's model:
// one resolved script × one ScriptContext → RunOutcome.  It does NOT loop over
// before/after action kinds.
//
// All side-effects are injected via RunnerEffects so the runner is fully unit-
// testable without Obsidian.  Integration wires:
//   effects.applyPlan → applyEditPlan(editor, plan)  (T5.5)
//   effects.rawFallback → leave input intact (e.g. paste raw text)
//   effects.notify → new Notice(message)
//
// POLICY GATE (WHY: hashi kill-switch pattern)
// ─────────────────────────────────────────────
// "disabled" is an explicit kill-switch: the script is not invoked and
// neither applyPlan nor rawFallback is called — this is a deliberate no-op,
// not a failure.  The distinction matters for paste flows: rawFallback would
// paste raw text, but "disabled" means "don't run anything at all".
//
// "ask" delegates the consent decision to the askCallback.  The runner calls
// askCallback once per run() invocation; session-level memory of the decision
// is the store/disclosure layer's job (T5.3).
//
// TIMEOUT (WHY: hashi async-hang guard)
// ──────────────────────────────────────
// The script call is wrapped in Promise.race against a timer.  The timer uses
// globalThis.setTimeout (NOT window.setTimeout) so the runner works correctly
// under Node/vitest as well as Electron.  The timer is cleared in a finally
// block so the losing timer does not linger after the race is decided.
//
// NOTE: this timeout only guards ASYNC hangs.  A synchronous infinite loop
// cannot be killed in single-threaded JS — it would block the entire event loop.
//
// ATOMICITY (WHY: never a partial edit)
// ──────────────────────────────────────
// On any failure (throw or timeout) the runner calls rawFallback and notify,
// but NEVER calls applyPlan.  An EditPlan is applied atomically or not at all.
//
// EMPTY PLAN (choice: noop, no notify)
// ──────────────────────────────────────
// A script returning undefined or [] signals "nothing to do".  The runner
// returns { kind: "noop" } without notifying the user.  Rationale: a script
// that intentionally produces no output (e.g. because conditions aren't met)
// should not spam the user with "nothing to do" notices.

import type { EditPlan } from "../core/types";
import type { ScriptFunction, ScriptContext } from "./context";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Trust policy for a single script invocation. */
export type ScriptPolicy = "enabled" | "disabled" | "ask";

/** The decision returned by the ask-callback (realised by T5.3 disclosure modal). */
export type AskDecision = "enable-session" | "enable-once" | "disable";

/**
 * Callback invoked when policy is "ask".
 * The runner calls this once per run() invocation.  Session persistence is
 * managed by the store/disclosure layer (T5.3), not here.
 */
export type AskCallback = () => Promise<AskDecision>;

/**
 * Injected side-effects that the runner drives.
 *
 * All three methods are called at most once per run() invocation.
 * The mutual-exclusion contract:
 *   - On success: applyPlan called; rawFallback NOT called.
 *   - On noop: neither called.
 *   - On blocked: neither called.
 *   - On failure: rawFallback + notify called; applyPlan NOT called.
 */
export interface RunnerEffects {
	/** Apply the EditPlan returned by the script to the document. */
	applyPlan(plan: EditPlan): void;
	/** Leave the input intact — no edit applied (paste raw, etc.). */
	rawFallback(): void;
	/** Surface a message to the user (e.g. via Obsidian Notice). */
	notify(message: string): void;
}

/** Options controlling runner behaviour for this invocation. */
export interface RunOptions {
	policy: ScriptPolicy;
	/**
	 * Maximum milliseconds to wait for an async script to resolve.
	 * Default: 30_000 (30 seconds).
	 */
	timeoutMs?: number;
	/**
	 * Required when policy is "ask".
	 * Must return the user's trust decision (realised by T5.3).
	 */
	askCallback?: AskCallback;
}

// ---------------------------------------------------------------------------
// RunOutcome — discriminated union
// ---------------------------------------------------------------------------

/**
 * Outcome variants:
 *   applied — script returned a non-empty EditPlan; applyPlan was called.
 *   noop    — script returned undefined or []; nothing applied, no notify.
 *   blocked — policy was "disabled" or ask returned "disable"; nothing ran.
 *   failed  — script threw or timed out; rawFallback + notify were called.
 */
export type RunOutcome =
	| { kind: "applied"; count: number }
	| { kind: "noop" }
	| { kind: "blocked" }
	| { kind: "failed"; reason: string };

// ---------------------------------------------------------------------------
// Default timeout
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// ScriptRunner
// ---------------------------------------------------------------------------

/**
 * Executes a single user script against a single ScriptContext and drives
 * the injected effects based on the outcome.
 *
 * Construct once; call run() for each invocation (the options are fixed at
 * construction time — build a new runner for a different policy/timeout).
 */
export class ScriptRunner {
	private readonly _effects: RunnerEffects;
	private readonly _options: RunOptions;

	constructor(effects: RunnerEffects, options: RunOptions) {
		this._effects = effects;
		this._options = options;
	}

	/**
	 * Run the script against ctx, honouring the policy and timeout.
	 *
	 * Returns a RunOutcome describing what happened.  The integration layer
	 * (T5.5) can inspect the outcome to log telemetry or branch further.
	 */
	async run(script: ScriptFunction, ctx: ScriptContext): Promise<RunOutcome> {
		// ------------------------------------------------------------------
		// 1. Policy gate — check before any script code runs
		// ------------------------------------------------------------------
		const policyDecision = await this._applyPolicy();
		if (policyDecision === "blocked") {
			// "disabled" is an explicit no-op: script not invoked, nothing applied.
			return { kind: "blocked" };
		}

		// ------------------------------------------------------------------
		// 2. Execute with timeout + error guard
		// ------------------------------------------------------------------
		const timeoutMs = this._options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

		let timerId: ReturnType<typeof globalThis.setTimeout> | undefined;

		const timeoutPromise = new Promise<never>((_, reject) => {
			timerId = globalThis.setTimeout(
				() => reject(new Error(`script timed out after ${timeoutMs}ms`)),
				timeoutMs,
			);
		});

		let plan: EditPlan | undefined;
		try {
			// Wrap in Promise.resolve so sync scripts run in the same .race.
			const result = await Promise.race([
				Promise.resolve(script(ctx)),
				timeoutPromise,
			]);
			plan = result ?? undefined;
		} catch (err: unknown) {
			// ------------------------------------------------------------------
			// 3. Failure: script threw or timed out.
			//    rawFallback + notify, NEVER applyPlan (atomicity).
			// ------------------------------------------------------------------
			const reason = err instanceof Error ? err.message : String(err);
			this._effects.rawFallback();
			this._effects.notify(`Mason script failed: ${reason}`);
			return { kind: "failed", reason };
		} finally {
			// Always clear the losing timer so it doesn't linger.
			if (timerId !== undefined) {
				globalThis.clearTimeout(timerId);
			}
		}

		// ------------------------------------------------------------------
		// 4. Classify result
		// ------------------------------------------------------------------
		if (plan === undefined || plan.length === 0) {
			// Empty/undefined plan: noop — no notify (intentional silence).
			return { kind: "noop" };
		}

		// Non-empty plan: apply atomically.
		this._effects.applyPlan(plan);
		return { kind: "applied", count: plan.length };
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	/**
	 * Resolve the policy to a go/no-go decision.
	 * Returns "blocked" when the script should NOT run,
	 * "proceed" when execution should continue.
	 */
	private async _applyPolicy(): Promise<"proceed" | "blocked"> {
		const { policy, askCallback } = this._options;

		if (policy === "disabled") {
			return "blocked";
		}

		if (policy === "ask") {
			if (askCallback === undefined) {
				// Defensive: if no callback was wired, treat as blocked.
				return "blocked";
			}
			const decision = await askCallback();
			if (decision === "disable") {
				return "blocked";
			}
			// "enable-session" or "enable-once" both proceed here.
			// Session persistence is the store layer's responsibility (T5.3).
			return "proceed";
		}

		// policy === "enabled"
		return "proceed";
	}
}
