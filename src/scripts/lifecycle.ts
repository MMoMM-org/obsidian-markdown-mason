// T1.3  Lifecycle: derived state machine (ADR-11)
//
// This module is the TRUST CORE — all later phases render and gate from it.
// State is DERIVED, never persisted (ADR-11): evaluateState is a pure,
// synchronous function over injected inputs. No I/O, no Date, no navigator,
// no store instantiation; only the ScriptRecord TYPE is imported.
//
// Algorithm — evaluateState(input):
//   Step 1. no record         → inCatalog ? Available : Absent
//   Step 2. !enabled          → Disabled
//   Step 3. okayed === null   → curated ? Available : Absent
//   Step 4. local absent      → online ? Materializing : Blocked("offline")
//   Step 5. local.version ≠ okayed.version → Materializing   (stale; re-fetch)
//   Step 6. local.checksum ≠ okayed.checksum → Blocked("drift")  ← HARD-BLOCK
//   Step 7. curated & catalogVersion > okayed.version → UpdateAvailable
//   Step 8. else → Active
//
// Drift (step 6) is a HARD block — fail-closed (PRD/F6). Never a warning.
// catalogVersion may be undefined (offline/unknown): step 7 only fires when
// it is a number AND greater than okayed.version.

import type { ScriptRecord } from "./store";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Reasons a script can be hard-blocked.
 *
 * "drift" and "offline" are emitted by evaluateState.
 * "source-missing" and "checksum-mismatch" are reserved for the Materializer
 * (a later phase) and included here for completeness.
 */
export type BlockedReason =
	| "drift"
	| "offline"
	| "source-missing"
	| "checksum-mismatch";

/** Discriminated-union lifecycle state — never persisted (ADR-11). */
export type LifecycleState =
	| { kind: "Available" }
	| { kind: "Absent" }
	| { kind: "Disabled" }
	| { kind: "Materializing" }
	| { kind: "Active" }
	| { kind: "UpdateAvailable" }
	| { kind: "Blocked"; reason: BlockedReason };

/**
 * All inputs evaluateState needs, fully resolved before the call.
 * No async I/O inside evaluateState — callers resolve then inject.
 */
export interface EvaluateStateInput {
	/** The persisted record for this script, or undefined if absent from data.json. */
	record: ScriptRecord | undefined;
	/**
	 * Whether the curated catalog offers this script id.
	 * Used only for the no-record case (step 1): is this id offered by the curated catalog?
	 * Note: step 3 (okayed===null) keys off record.provenance, NOT inCatalog — they differ.
	 */
	inCatalog: boolean;
	/** Materialized code on THIS device: version+checksum, or null if absent. */
	local: { version: number; checksum: string } | null;
	/**
	 * Latest version offered by the curated catalog.
	 * undefined when offline or the catalog has not been fetched.
	 * Step 7 only fires when this is a number.
	 */
	catalogVersion: number | undefined;
	/** Whether the device currently has network access. */
	online: boolean;
}

// ---------------------------------------------------------------------------
// Core pure function
// ---------------------------------------------------------------------------

/** Convenience constructors (avoids repetitive object literals). */
const S = {
	Available: (): LifecycleState => ({ kind: "Available" }),
	Absent: (): LifecycleState => ({ kind: "Absent" }),
	Disabled: (): LifecycleState => ({ kind: "Disabled" }),
	Materializing: (): LifecycleState => ({ kind: "Materializing" }),
	Active: (): LifecycleState => ({ kind: "Active" }),
	UpdateAvailable: (): LifecycleState => ({ kind: "UpdateAvailable" }),
	Blocked: (reason: BlockedReason): LifecycleState => ({ kind: "Blocked", reason }),
};

/**
 * Derives the current lifecycle state for one script.
 *
 * Pure and synchronous. Callers resolve all async I/O (store read, local
 * checksum fetch, catalog query, network probe) before calling this function.
 *
 * See module header for the full 8-step algorithm.
 */
export function evaluateState(input: EvaluateStateInput): LifecycleState {
	const { record, inCatalog, local, catalogVersion, online } = input;

	// Step 1 — no persisted record: availability determined by catalog membership
	if (record === undefined) {
		return inCatalog ? S.Available() : S.Absent();
	}

	// Step 2 — user-disabled: short-circuits all trust checks
	if (!record.enabled) {
		return S.Disabled();
	}

	// Step 3 — never consented (okayed null): availability by provenance
	if (record.okayed === null) {
		return record.provenance === "curated" ? S.Available() : S.Absent();
	}

	// Steps 4–6 require local code presence; okayed is non-null from here on.
	const okayed = record.okayed;

	// Step 4 — code not yet on this device
	if (local === null) {
		return online ? S.Materializing() : S.Blocked("offline");
	}

	// Step 5 — local code is stale (version mismatch): re-fetch silently
	if (local.version !== okayed.version) {
		return S.Materializing();
	}

	// Step 6 — same version but wrong bytes: HARD-BLOCK (trust violation, ADR-11/PRD/F6)
	if (local.checksum !== okayed.checksum) {
		return S.Blocked("drift");
	}

	// Step 7 — curated and a newer catalog version exists: prompt user to update
	if (
		record.provenance === "curated" &&
		catalogVersion !== undefined &&
		catalogVersion > okayed.version
	) {
		return S.UpdateAvailable();
	}

	// Step 8 — all checks passed: script is ready to run
	return S.Active();
}
