// ScriptsCache — asynchronously resolved script state for the settings tab.
//
// The declarative settings tab builds its definitions synchronously, but the
// script list needs async I/O (store read, catalog fetch, checksum of the
// materialized code). This cache owns that I/O: the tab reads the last resolved
// state synchronously and is told through onChange when a newer one landed.
//
// Refreshes are SINGLE FLIGHT and COALESCING. Lifecycle ops fire re-renders in
// bursts (enable → materialize → state change); every request that arrives
// while a refresh is running collapses into one follow-up pass that starts after
// the running one settled. So the last state always wins and two resolves never
// overlap.
//
// Failures are reported with console.warn, not debug(): they are genuine errors
// and must surface without the debug logging setting.

import { evaluateState } from "../scripts/lifecycle";
import type { LifecycleResolver } from "../scripts/lifecycleResolver";
import type { ScriptRecord, ScriptStore } from "../scripts/store";
import type { ScriptItem } from "./scriptsPage";

/** The narrow collaborators ScriptsCache needs. */
export interface ScriptsCacheDeps {
	store: Pick<ScriptStore, "getScripts">;
	/** Live resolver. Absent → states come from buildOfflineScriptItems. */
	resolver?: Pick<LifecycleResolver, "clearCache" | "resolveItems">;
	/** Publishes the number of scripts with an update waiting (the Scripts page indicator). */
	setUpdatableCount(count: number): void;
}

/**
 * Resolve persisted records into ScriptItems from the persisted data alone.
 *
 * Used when no live resolver is available. evaluateState fails closed with
 * these inputs (not online, no local code), so a script is never shown as
 * Active without proof.
 */
export function buildOfflineScriptItems(records: Record<string, ScriptRecord>): ScriptItem[] {
	return Object.entries(records).map(([id, record]) => ({
		id,
		displayName: id,
		description: record.description !== undefined && record.description.length > 0
			? record.description
			: `Source: ${record.source}`,
		record,
		state: evaluateState({
			record,
			inCatalog: record.provenance === "curated",
			local: null,
			catalogVersion: undefined,
			online: false,
		}),
		version: record.okayed?.version ?? 0,
		provenance: record.provenance,
		catalogVersion: undefined,
	}));
}

export class ScriptsCache {
	/** Resolved script rows; null until the first refresh succeeded. */
	items: ScriptItem[] | null = null;
	/** The persisted records `items` was resolved from. */
	records: Record<string, ScriptRecord> = {};
	/** How many of `items` have an update waiting. */
	updatableCount = 0;
	/** Called after a refresh applied new state. */
	onChange: () => void = () => undefined;

	private readonly _deps: ScriptsCacheDeps;
	private _inFlight = false;
	private _pending = false;
	private _stale = false;

	constructor(deps: ScriptsCacheDeps) {
		this._deps = deps;
	}

	/** True while a refresh is running. */
	get inFlight(): boolean {
		return this._inFlight;
	}

	/**
	 * True when the state may be outdated and no refresh has started since.
	 *
	 * A mark set while a refresh is running stays set: that pass may have read
	 * the store before the change. The tab treats `stale && !inFlight` as
	 * "needs refresh".
	 */
	get stale(): boolean {
		return this._stale;
	}

	/** Flag the state as possibly outdated; the next refresh clears the flag. */
	markStale(): void {
		this._stale = true;
	}

	/** Fire-and-forget refresh for callers that cannot await. */
	requestRefresh(): void {
		void this.refresh();
	}

	/**
	 * Re-read and re-resolve the scripts, then apply and announce the result.
	 *
	 * While a refresh is running, further calls only note that another pass is
	 * wanted and return at once. A failed pass keeps the last good state.
	 *
	 * Awaiting the returned promise waits for this pass only, not for a
	 * coalesced follow-up pass. Rely on onChange to learn about the final state.
	 */
	async refresh(): Promise<void> {
		if (this._inFlight) {
			this._pending = true;
			return;
		}
		this._inFlight = true;
		this._stale = false;
		try {
			this._deps.resolver?.clearCache();
			const records = await this._deps.store.getScripts();
			const items = await this._resolve(records);
			this._apply(records, items);
		} catch (err) {
			console.warn("[mason] scripts refresh failed", err);
		} finally {
			this._inFlight = false;
			if (this._pending) {
				this._pending = false;
				void this.refresh();
			}
		}
	}

	private _resolve(records: Record<string, ScriptRecord>): ScriptItem[] | Promise<ScriptItem[]> {
		const resolver = this._deps.resolver;
		return resolver !== undefined
			? resolver.resolveItems(records)
			: buildOfflineScriptItems(records);
	}

	private _apply(records: Record<string, ScriptRecord>, items: ScriptItem[]): void {
		this.records = records;
		this.items = items;
		this.updatableCount = items.filter((it) => it.state.kind === "UpdateAvailable").length;
		// The state above is already applied, so the listener must hear of it even
		// when publishing the count fails; a failing listener must not fail the pass.
		try {
			this._deps.setUpdatableCount(this.updatableCount);
		} catch (err) {
			console.warn("[mason] publishing the scripts update count failed", err);
		}
		try {
			this.onChange();
		} catch (err) {
			console.warn("[mason] scripts change listener failed", err);
		}
	}
}
