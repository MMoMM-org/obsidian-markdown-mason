import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { isDebugLogging } from "../../src/core/debug";
import {
	ScriptsCache,
	buildOfflineScriptItems,
	type ScriptsCacheDeps,
} from "../../src/ui/scriptsCache";
import type { ScriptRecord } from "../../src/scripts/store";
import type { ScriptItem } from "../../src/ui/scriptsPage";
import type { LifecycleState } from "../../src/scripts/lifecycle";

// ---------------------------------------------------------------------------
// Spec 010 T2.1 — ScriptsCache
//
// Holds the asynchronously resolved script state for the declarative settings
// tab. Refreshes are single flight and coalescing: a burst of requests during
// an in-flight refresh produces exactly one follow-up pass, so the last state
// always wins and no two resolves ever overlap.
//
// The fakes hand out deferred promises so each test decides when the store and
// the resolver answer.
// ---------------------------------------------------------------------------

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
	let resolve: (value: T) => void = () => undefined;
	let reject: (reason: unknown) => void = () => undefined;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Let every already-settled promise continuation run. */
const flush = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

const record = (overrides: Partial<ScriptRecord> = {}): ScriptRecord => ({
	provenance: "curated",
	enabled: true,
	okayed: { version: 1, checksum: "abc" },
	source: "catalog",
	command: false,
	...overrides,
});

const item = (id: string, state: LifecycleState, rec: ScriptRecord = record()): ScriptItem => ({
	id,
	displayName: id,
	description: `Description of ${id}`,
	record: rec,
	state,
	version: 1,
	provenance: rec.provenance,
	catalogVersion: undefined,
});

type Records = Record<string, ScriptRecord>;

interface Harness {
	cache: ScriptsCache;
	calls: string[];
	storeCalls: Deferred<Records>[];
	resolverCalls: Deferred<ScriptItem[]>[];
	resolvedWith: Records[];
	setUpdatableCount: ReturnType<typeof vi.fn>;
	onChange: ReturnType<typeof vi.fn>;
	maxConcurrentPasses: () => number;
}

function makeHarness(options: { withResolver?: boolean } = {}): Harness {
	const withResolver = options.withResolver ?? true;
	const calls: string[] = [];
	const storeCalls: Deferred<Records>[] = [];
	const resolverCalls: Deferred<ScriptItem[]>[] = [];
	const resolvedWith: Records[] = [];
	const setUpdatableCount = vi.fn();
	const onChange = vi.fn();

	// A pass is "open" from its getScripts() call until its last awaited
	// dependency settles; more than one open pass means overlapping refreshes.
	let openPasses = 0;
	let maxOpenPasses = 0;
	const closePass = (): void => { openPasses -= 1; };

	const deps: ScriptsCacheDeps = {
		store: {
			getScripts: () => {
				calls.push("getScripts");
				openPasses += 1;
				maxOpenPasses = Math.max(maxOpenPasses, openPasses);
				const call = deferred<Records>();
				storeCalls.push(call);
				if (withResolver) {
					call.promise.catch(closePass);
				} else {
					call.promise.then(closePass, closePass);
				}
				return call.promise;
			},
		},
		setUpdatableCount,
	};
	if (withResolver) {
		deps.resolver = {
			clearCache: () => { calls.push("clearCache"); },
			resolveItems: (records) => {
				calls.push("resolveItems");
				resolvedWith.push(records);
				const call = deferred<ScriptItem[]>();
				resolverCalls.push(call);
				call.promise.then(closePass, closePass);
				return call.promise;
			},
		};
	}

	const cache = new ScriptsCache(deps);
	cache.onChange = onChange;
	return {
		cache, calls, storeCalls, resolverCalls, resolvedWith, setUpdatableCount, onChange,
		maxConcurrentPasses: () => maxOpenPasses,
	};
}

/** Answer the running pass: its store read, then its resolve, then let it finish. */
async function completePass(h: Harness, records: Records, items: ScriptItem[]): Promise<void> {
	h.storeCalls.at(-1)?.resolve(records);
	await flush();
	h.resolverCalls.at(-1)?.resolve(items);
	await flush();
}

describe("ScriptsCache — initial state", () => {
	it("has no items before the first refresh", () => {
		const { cache } = makeHarness();

		expect(cache.items).toBeNull();
		expect(cache.records).toEqual({});
		expect(cache.updatableCount).toBe(0);
		expect(cache.stale).toBe(false);
		expect(cache.inFlight).toBe(false);
	});
});

describe("ScriptsCache — refresh", () => {
	it("calls clearCache, getScripts, resolveItems in that order", async () => {
		const h = makeHarness();
		const records = { alpha: record() };

		const done = h.cache.refresh();
		await completePass(h, records, [item("alpha", { kind: "Active" })]);
		await done;

		expect(h.calls).toEqual(["clearCache", "getScripts", "resolveItems"]);
		expect(h.resolvedWith[0]).toBe(records);
	});

	it("applies items, records and updatableCount, then notifies once", async () => {
		const h = makeHarness();
		const records = { alpha: record(), beta: record(), gamma: record() };
		const items = [
			item("alpha", { kind: "UpdateAvailable" }),
			item("beta", { kind: "Active" }),
			item("gamma", { kind: "UpdateAvailable" }),
		];

		const done = h.cache.refresh();
		await completePass(h, records, items);
		await done;

		expect(h.cache.items).toBe(items);
		expect(h.cache.records).toBe(records);
		expect(h.cache.updatableCount).toBe(2);
		expect(h.setUpdatableCount).toHaveBeenCalledTimes(1);
		expect(h.setUpdatableCount).toHaveBeenCalledWith(2);
		expect(h.onChange).toHaveBeenCalledTimes(1);
	});

	it("publishes the new state before notifying", async () => {
		const h = makeHarness();
		const items = [item("alpha", { kind: "UpdateAvailable" })];
		let seenByListener: ScriptItem[] | null = null;
		h.cache.onChange = () => { seenByListener = h.cache.items; };

		const done = h.cache.refresh();
		await completePass(h, { alpha: record() }, items);
		await done;

		expect(seenByListener).toBe(items);
	});

	it("is in flight only while a refresh is running", async () => {
		const h = makeHarness();

		const done = h.cache.refresh();
		expect(h.cache.inFlight).toBe(true);
		await completePass(h, {}, []);
		await done;

		expect(h.cache.inFlight).toBe(false);
	});
});

describe("ScriptsCache — coalescing", () => {
	it("folds two requests during an in-flight refresh into exactly one follow-up pass", async () => {
		const h = makeHarness();
		const firstItems = [item("alpha", { kind: "UpdateAvailable" })];
		const lastRecords = { alpha: record({ enabled: false }) };
		const lastItems = [item("alpha", { kind: "Disabled" })];

		h.cache.requestRefresh();
		h.cache.requestRefresh();
		h.cache.requestRefresh();
		await completePass(h, { alpha: record() }, firstItems);

		expect(h.onChange).toHaveBeenCalledTimes(1);
		expect(h.cache.items).toBe(firstItems);
		expect(h.storeCalls).toHaveLength(2);

		await completePass(h, lastRecords, lastItems);

		expect(h.onChange).toHaveBeenCalledTimes(2);
		expect(h.storeCalls).toHaveLength(2);
		expect(h.cache.items).toBe(lastItems);
		expect(h.cache.records).toBe(lastRecords);
		expect(h.cache.updatableCount).toBe(0);
		expect(h.setUpdatableCount).toHaveBeenLastCalledWith(0);
		expect(h.cache.inFlight).toBe(false);
	});

	it("never runs more than one refresh at a time", async () => {
		const h = makeHarness();

		void h.cache.refresh();
		void h.cache.refresh();
		h.cache.requestRefresh();
		await flush();
		expect(h.storeCalls).toHaveLength(1);

		await completePass(h, {}, []);
		h.cache.requestRefresh();
		h.cache.requestRefresh();
		await completePass(h, {}, []);
		await completePass(h, {}, []);
		await flush();

		expect(h.storeCalls).toHaveLength(3);
		expect(h.maxConcurrentPasses()).toBe(1);
		expect(h.cache.inFlight).toBe(false);
	});

	it("does not start a follow-up pass when nothing was requested meanwhile", async () => {
		const h = makeHarness();

		const done = h.cache.refresh();
		await completePass(h, {}, []);
		await done;
		await flush();

		expect(h.storeCalls).toHaveLength(1);
		expect(h.onChange).toHaveBeenCalledTimes(1);
	});
});

describe("ScriptsCache — offline fallback (no resolver)", () => {
	it("derives states without a resolver", async () => {
		const h = makeHarness({ withResolver: false });
		const records = {
			consented: record(),
			disabled: record({ enabled: false }),
			unconsented: record({ okayed: null }),
		};

		const done = h.cache.refresh();
		h.storeCalls[0]?.resolve(records);
		await done;

		expect(h.calls).toEqual(["getScripts"]);
		expect(h.cache.items?.map((it) => [it.id, it.state])).toEqual([
			["consented", { kind: "Blocked", reason: "offline" }],
			["disabled", { kind: "Disabled" }],
			["unconsented", { kind: "Available" }],
		]);
		expect(h.cache.records).toBe(records);
		expect(h.cache.updatableCount).toBe(0);
		expect(h.setUpdatableCount).toHaveBeenCalledWith(0);
		expect(h.onChange).toHaveBeenCalledTimes(1);
	});
});

describe("buildOfflineScriptItems", () => {
	it("builds one item per record from the persisted data alone", () => {
		const described = record({ description: "Tidies tables", okayed: { version: 3, checksum: "x" } });
		const imported = record({ provenance: "imported", source: "Scripts/mine.js", okayed: null });

		const items = buildOfflineScriptItems({ described, imported });

		expect(items).toEqual([
			{
				id: "described",
				displayName: "described",
				description: "Tidies tables",
				record: described,
				state: { kind: "Blocked", reason: "offline" },
				version: 3,
				provenance: "curated",
				catalogVersion: undefined,
			},
			{
				id: "imported",
				displayName: "imported",
				description: "Source: Scripts/mine.js",
				record: imported,
				state: { kind: "Absent" },
				version: 0,
				provenance: "imported",
				catalogVersion: undefined,
			},
		]);
	});

	it("falls back to the source line for an empty description", () => {
		const [built] = buildOfflineScriptItems({ blank: record({ description: "" }) });

		expect(built?.description).toBe("Source: catalog");
	});
});

describe("ScriptsCache — failures", () => {
	beforeEach(() => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("warns on the console about a failed refresh, with debug logging off", async () => {
		const h = makeHarness();
		const failure = new Error("disk gone");

		const done = h.cache.refresh();
		h.storeCalls[0]?.reject(failure);
		await done;

		expect(isDebugLogging()).toBe(false);
		expect(vi.mocked(console.warn).mock.calls.some((args) => args.includes(failure))).toBe(true);
	});

	it("stays unloaded when the first refresh fails", async () => {
		const h = makeHarness();

		const done = h.cache.refresh();
		h.storeCalls[0]?.reject(new Error("disk gone"));
		await done;

		expect(h.cache.items).toBeNull();
		expect(h.cache.inFlight).toBe(false);
		expect(h.onChange).not.toHaveBeenCalled();
		expect(h.setUpdatableCount).not.toHaveBeenCalled();
	});

	it("keeps the last good state when the store throws", async () => {
		const h = makeHarness();
		const records = { alpha: record() };
		const items = [item("alpha", { kind: "UpdateAvailable" })];
		const first = h.cache.refresh();
		await completePass(h, records, items);
		await first;

		const second = h.cache.refresh();
		h.storeCalls[1]?.reject(new Error("disk gone"));
		await second;

		expect(h.cache.items).toBe(items);
		expect(h.cache.records).toBe(records);
		expect(h.cache.updatableCount).toBe(1);
		expect(h.cache.inFlight).toBe(false);
		expect(h.onChange).toHaveBeenCalledTimes(1);
		expect(h.setUpdatableCount).toHaveBeenCalledTimes(1);
	});

	it("keeps the last good state when the resolver throws", async () => {
		const h = makeHarness();
		const records = { alpha: record() };
		const items = [item("alpha", { kind: "Active" })];
		const first = h.cache.refresh();
		await completePass(h, records, items);
		await first;

		const second = h.cache.refresh();
		h.storeCalls[1]?.resolve({ alpha: record(), beta: record() });
		await flush();
		h.resolverCalls[1]?.reject(new Error("catalog unreachable"));
		await second;

		expect(h.cache.items).toBe(items);
		expect(h.cache.records).toBe(records);
		expect(h.cache.inFlight).toBe(false);
		expect(h.onChange).toHaveBeenCalledTimes(1);
	});

	it("still runs the pending follow-up pass after a failed refresh", async () => {
		const h = makeHarness();
		const items = [item("alpha", { kind: "Active" })];

		h.cache.requestRefresh();
		h.cache.requestRefresh();
		h.storeCalls[0]?.reject(new Error("disk gone"));
		await flush();
		await completePass(h, { alpha: record() }, items);

		expect(h.cache.items).toBe(items);
		expect(h.onChange).toHaveBeenCalledTimes(1);
		expect(h.cache.inFlight).toBe(false);
	});

	it("can refresh again after a failure", async () => {
		const h = makeHarness();
		const failed = h.cache.refresh();
		h.storeCalls[0]?.reject(new Error("disk gone"));
		await failed;

		const items = [item("alpha", { kind: "Active" })];
		const retried = h.cache.refresh();
		await completePass(h, { alpha: record() }, items);
		await retried;

		expect(h.cache.items).toBe(items);
	});
});

describe("ScriptsCache — throwing collaborators", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	/**
	 * Tell whether the cache has warned about `failure`. Debug logging stays off:
	 * a genuine error must surface without it.
	 */
	function captureWarnings(): { has(failure: Error): boolean } {
		expect(isDebugLogging()).toBe(false);
		const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		return { has: (failure) => warned.mock.calls.some((args) => args.includes(failure)) };
	}

	it("still calls onChange when setUpdatableCount throws (and state is applied)", async () => {
		const h = makeHarness();
		const warned = captureWarnings();
		const failure = new Error("badge failed");
		h.setUpdatableCount.mockImplementation(() => { throw failure; });
		const records = { alpha: record() };
		const items = [item("alpha", { kind: "UpdateAvailable" })];

		const done = h.cache.refresh();
		await completePass(h, records, items);
		await done;

		expect(h.cache.items).toBe(items);
		expect(h.cache.records).toBe(records);
		expect(h.cache.updatableCount).toBe(1);
		expect(h.onChange).toHaveBeenCalledTimes(1);
		expect(warned.has(failure)).toBe(true);
	});

	it("a throwing onChange is warned about and does not wedge the cache (next refresh runs)", async () => {
		const h = makeHarness();
		const warned = captureWarnings();
		const failure = new Error("redraw failed");
		h.cache.onChange = () => { throw failure; };
		const firstItems = [item("alpha", { kind: "Active" })];

		const first = h.cache.refresh();
		await completePass(h, { alpha: record() }, firstItems);
		await expect(first).resolves.toBeUndefined();

		expect(h.cache.items).toBe(firstItems);
		expect(h.cache.inFlight).toBe(false);
		expect(warned.has(failure)).toBe(true);

		const recovered = vi.fn();
		h.cache.onChange = recovered;
		const nextItems = [item("alpha", { kind: "Disabled" })];
		const next = h.cache.refresh();
		await completePass(h, { alpha: record() }, nextItems);
		await next;

		expect(h.storeCalls).toHaveLength(2);
		expect(h.cache.items).toBe(nextItems);
		expect(recovered).toHaveBeenCalledTimes(1);
	});
});

describe("ScriptsCache — staleness", () => {
	it("is stale once marked", () => {
		const { cache } = makeHarness();

		cache.markStale();

		expect(cache.stale).toBe(true);
	});

	it("clears stale before awaiting the store", async () => {
		const h = makeHarness();
		h.cache.markStale();

		const done = h.cache.refresh();
		const staleWhileStoreIsPending = h.cache.stale;
		await completePass(h, {}, []);
		await done;

		expect(staleWhileStoreIsPending).toBe(false);
		expect(h.cache.stale).toBe(false);
	});

	it("stays stale when marked during an in-flight refresh", async () => {
		const h = makeHarness();

		const done = h.cache.refresh();
		h.cache.markStale();
		await completePass(h, {}, []);
		await done;

		expect(h.cache.stale).toBe(true);
	});
});
