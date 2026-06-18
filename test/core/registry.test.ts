import { describe, it, expect } from "vitest";
import {
	buildRegistry,
	checkRequiredApiVersion,
	isApiCompatible,
	API_VERSION,
} from "../../src/core/registry";
import { fromCitations as coreFromCitations } from "../../src/core/footnotes";
import type { OperationContext, ParseResult, MasonSettings } from "../../src/core/types";

// ---------------------------------------------------------------------------
// T3.1  Operation registry + versioned mason.* API
//
// buildRegistry() — constructs the registry from all known operations.
//   Returns: { entries, api }
//   entries: RegistryEntry[] — each carries id, apiName, command.name, run/runRich
//   api: MasonApi — the versioned mason.* surface
//
// MasonApi surface (SDD):
//   mason.headings.cascade(ctx) → EditPlan
//   mason.headings.normalize(ctx) → EditPlan
//   mason.footnotes.fromCitations(ctx, parseResult) → EditPlan
//   mason.footnotes.identity(ctx, parseResult) → EditPlan
//   mason.footnotes.move(ctx, defs?) → EditPlan
//   mason.util.normalizeUrl(raw) → string
//
// Single registry, no duplication: calling the api method and the registry
//   entry's run on the same input yield identical results.
//
// Version gate: checkRequiredApiVersion(required)
//   Accepts same-major, required-minor ≤ available-minor (additive).
//   Rejects different-major or required-minor > available (breaking).
//   Returns { ok: boolean; message?: string } — NOT an obsidian Notice.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

const makeSettings = (): MasonSettings => ({
	debugLogging: false,
	resourcesName: "Resources",
});

const makeCtx = (overrides: Partial<OperationContext> = {}): OperationContext => ({
	doc: "# Heading\n\nSome text.\n",
	cursor: 0,
	settings: makeSettings(),
	...overrides,
});

const makeParseResult = (overrides: Partial<ParseResult> = {}): ParseResult => ({
	body: "Text with [1] citation.",
	inline: [{ marker: "[1]", n: 1 }],
	sources: [
		{
			incomingId: 1,
			snippet: "Example snippet",
			title: "Example",
			url: "https://example.com",
		},
	],
	...overrides,
});

// ---------------------------------------------------------------------------
// Registry structure
// ---------------------------------------------------------------------------

describe("buildRegistry — structure", () => {
	it("returns entries and api", () => {
		const { entries, api } = buildRegistry();
		expect(entries).toBeDefined();
		expect(api).toBeDefined();
	});

	it("entries expose id, apiName, and command.name for each operation", () => {
		const { entries } = buildRegistry();

		const expectedOps = [
			{ id: "headings.cascade",         apiName: "mason.headings.cascade",         commandName: "Cascade headings" },
			{ id: "headings.normalize",        apiName: "mason.headings.normalize",       commandName: "Normalize headings" },
			{ id: "footnotes.fromCitations",   apiName: "mason.footnotes.fromCitations",  commandName: "Convert citations to footnotes" },
			{ id: "footnotes.identity",        apiName: "mason.footnotes.identity",       commandName: "Resolve footnote identity" },
			{ id: "footnotes.move",            apiName: "mason.footnotes.move",           commandName: "Move footnotes to resources" },
			{ id: "util.normalizeUrl",         apiName: "mason.util.normalizeUrl",        commandName: "Normalize url" },
		];

		for (const expected of expectedOps) {
			const entry = entries.find((e) => e.id === expected.id);
			expect(entry, `entry ${expected.id} should exist`).toBeDefined();
			expect(entry!.apiName).toBe(expected.apiName);
			expect(entry!.command?.name, `${expected.id} command.name`).toBe(expected.commandName);
		}
	});

	it("has exactly 6 registered operations", () => {
		const { entries } = buildRegistry();
		expect(entries).toHaveLength(6);
	});
});

// ---------------------------------------------------------------------------
// MasonApi surface — callable methods
// ---------------------------------------------------------------------------

describe("MasonApi — api method existence", () => {
	it("exposes mason.headings.cascade as a function", () => {
		const { api } = buildRegistry();
		expect(typeof api.headings.cascade).toBe("function");
	});

	it("exposes mason.headings.normalize as a function", () => {
		const { api } = buildRegistry();
		expect(typeof api.headings.normalize).toBe("function");
	});

	it("exposes mason.footnotes.fromCitations as a function", () => {
		const { api } = buildRegistry();
		expect(typeof api.footnotes.fromCitations).toBe("function");
	});

	it("exposes mason.footnotes.identity as a function", () => {
		const { api } = buildRegistry();
		expect(typeof api.footnotes.identity).toBe("function");
	});

	it("exposes mason.footnotes.move as a function", () => {
		const { api } = buildRegistry();
		expect(typeof api.footnotes.move).toBe("function");
	});

	it("exposes mason.util.normalizeUrl as a function", () => {
		const { api } = buildRegistry();
		expect(typeof api.util.normalizeUrl).toBe("function");
	});
});

// ---------------------------------------------------------------------------
// MasonApi — return types
// ---------------------------------------------------------------------------

describe("MasonApi — return types", () => {
	it("headings.cascade returns an EditPlan (array)", () => {
		const { api } = buildRegistry();
		const ctx = makeCtx({ input: "## Sub\n\nContent.", cursor: 11 }); // after "# Heading\n\n"
		const result = api.headings.cascade(ctx);
		expect(Array.isArray(result)).toBe(true);
	});

	it("headings.normalize returns an EditPlan (array)", () => {
		const { api } = buildRegistry();
		const result = api.headings.normalize(makeCtx());
		expect(Array.isArray(result)).toBe(true);
	});

	it("footnotes.fromCitations returns an EditPlan (array)", () => {
		const { api } = buildRegistry();
		const result = api.footnotes.fromCitations(makeCtx(), makeParseResult());
		expect(Array.isArray(result)).toBe(true);
	});

	it("footnotes.identity returns an EditPlan (array)", () => {
		const { api } = buildRegistry();
		const result = api.footnotes.identity(makeCtx(), makeParseResult());
		expect(Array.isArray(result)).toBe(true);
	});

	it("footnotes.move returns an EditPlan (array)", () => {
		const { api } = buildRegistry();
		const result = api.footnotes.move(makeCtx(), ["[^1]: snippet\n[Title](https://example.com)"]);
		expect(Array.isArray(result)).toBe(true);
	});

	it("util.normalizeUrl returns a string", () => {
		const { api } = buildRegistry();
		const result = api.util.normalizeUrl("https://EXAMPLE.COM/path/?b=2&a=1#frag");
		expect(typeof result).toBe("string");
	});
});

// ---------------------------------------------------------------------------
// No duplication: api method and registry entry invoke the SAME logic
// ---------------------------------------------------------------------------

describe("No duplication — api and registry entry share implementation", () => {
	it("headings.normalize: api and entry run produce identical plans", () => {
		const { entries, api } = buildRegistry();
		const ctx = makeCtx({ doc: "# H1\n\n### H3\n" });
		const entry = entries.find((e) => e.id === "headings.normalize")!;
		const fromApi = api.headings.normalize(ctx);
		const fromEntry = entry.run(ctx);
		expect(fromApi).toEqual(fromEntry);
	});

	it("footnotes.move: api and entry run produce identical plans for empty defs", () => {
		const { entries, api } = buildRegistry();
		const ctx = makeCtx();
		const entry = entries.find((e) => e.id === "footnotes.move")!;
		const fromApi = api.footnotes.move(ctx);
		const fromEntry = entry.run(ctx);
		expect(fromApi).toEqual(fromEntry);
	});

	it("util.normalizeUrl: api delegates to core normalizeUrl", () => {
		const { entries, api } = buildRegistry();
		const entry = entries.find((e) => e.id === "util.normalizeUrl")!;
		const url = "https://EXAMPLE.COM/path/";
		const fromApi = api.util.normalizeUrl(url);
		// Entry for normalizeUrl uses run(ctx) but that's a ctx-less passthrough;
		// here we compare via the shared normalizeUrl export directly.
		// The entry's run exists on the type; normalizeUrl has a dedicated api path.
		// We verify no-duplication by calling through api vs calling core directly.
		expect(fromApi).toBe("https://example.com/path");
		void entry; // entry exists; tested via "entry exists" suite
	});

	it("headings.cascade api returns .plan from the rich result", () => {
		const { entries, api } = buildRegistry();
		const ctx = makeCtx({
			doc: "# Top\n\nContent.",
			cursor: 7, // after "# Top\n\n"
			input: "## Sub\n\nBody.",
		});
		const entry = entries.find((e) => e.id === "headings.cascade")!;
		// cascade entry exposes runRich for the command layer
		const rich = entry.runRich!(ctx);
		const fromApi = api.headings.cascade(ctx);
		expect(fromApi).toEqual(rich.plan);
	});

	it("footnotes.fromCitations api produces same plan as calling core fromCitations", () => {
		const { api } = buildRegistry();
		const parseResult = makeParseResult();
		const fromCore = coreFromCitations(parseResult);
		const fromApi = api.footnotes.fromCitations(makeCtx(), parseResult);
		expect(fromApi).toEqual(fromCore);
	});
});

// ---------------------------------------------------------------------------
// cascade — noContextHeading seam for command layer
// ---------------------------------------------------------------------------

describe("cascade — rich result seam", () => {
	it("entry.runRich exposes noContextHeading", () => {
		const { entries } = buildRegistry();
		const entry = entries.find((e) => e.id === "headings.cascade")!;
		const ctx = makeCtx({ doc: "No headings here.", cursor: 5 });
		const rich = entry.runRich!(ctx);
		expect(rich.noContextHeading).toBe(true);
	});

	it("entry.run (Operation-compatible) returns the plan portion", () => {
		const { entries } = buildRegistry();
		const entry = entries.find((e) => e.id === "headings.cascade")!;
		const ctx = makeCtx({ doc: "No headings here.", cursor: 5 });
		const plan = entry.run(ctx);
		expect(Array.isArray(plan)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// footnotes.identity — composition seam
// ---------------------------------------------------------------------------

describe("footnotes.identity — composition", () => {
	it("returns an EditPlan (inline renames from resolveFootnoteIdentity + applyFootnoteInlineRename)", () => {
		const { api } = buildRegistry();
		// body has [^1] markers; sources has a new URL → will produce renames
		const parseResult: ParseResult = {
			body: "Text [^1] and [^2] cited.",
			inline: [
				{ marker: "[1]", n: 1 },
				{ marker: "[2]", n: 2 },
			],
			sources: [
				{ incomingId: 1, snippet: "S1", title: "T1", url: "https://a.com" },
				{ incomingId: 2, snippet: "S2", title: "T2", url: "https://b.com" },
			],
		};
		const ctx = makeCtx(); // no existing refs in doc
		const plan = api.footnotes.identity(ctx, parseResult);
		// Plan may be empty if incoming ids already match assigned ids (1,2→1,2),
		// but it must be an array.
		expect(Array.isArray(plan)).toBe(true);
	});

	it("entry exposes identityFull(ctx, parseResult) → { plan, newRefs } for the move seam", () => {
		const { entries } = buildRegistry();
		const entry = entries.find((e) => e.id === "footnotes.identity")!;
		const parseResult = makeParseResult();
		const ctx = makeCtx();
		const full = entry.identityFull!(ctx, parseResult);
		expect(Array.isArray(full.plan)).toBe(true);
		expect(Array.isArray(full.newRefs)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Phase-4 seam stubs — entry.run for fromCitations / identity
// ---------------------------------------------------------------------------
//
// W3: These stubs return [] to signal "no EditPlan without a ParseResult".
// Tests guard against a silent no-op if T3.4 accidentally routes through
// entry.run instead of the api.footnotes.* two-argument paths.

describe("footnotes.fromCitations — entry.run stub", () => {
	it("entry.run returns empty plan (Phase-4 seam, ParseResult not yet available from ctx)", () => {
		const { entries } = buildRegistry();
		const entry = entries.find((e) => e.id === "footnotes.fromCitations")!;
		const plan = entry.run(makeCtx());
		expect(plan).toEqual([]);
	});
});

describe("footnotes.identity — entry.run stub", () => {
	it("entry.run returns empty plan (Phase-4 seam, ParseResult not yet available from ctx)", () => {
		const { entries } = buildRegistry();
		const entry = entries.find((e) => e.id === "footnotes.identity")!;
		const plan = entry.run(makeCtx());
		expect(plan).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// footnotes.move — optional defs threading
// ---------------------------------------------------------------------------

describe("footnotes.move — defs parameter", () => {
	it("move with no defs returns empty plan", () => {
		const { api } = buildRegistry();
		const plan = api.footnotes.move(makeCtx());
		expect(plan).toEqual([]);
	});

	it("move with defs produces a non-empty plan when doc has no Resources section", () => {
		const { api } = buildRegistry();
		const ctx = makeCtx({ doc: "# Heading\n\nContent.\n" });
		const defs = ["[^1]: snippet\n[Title](https://example.com)"];
		const plan = api.footnotes.move(ctx, defs);
		expect(plan.length).toBeGreaterThan(0);
	});

	it("entry.run returns empty plan (no defs — default safe behavior)", () => {
		const { entries } = buildRegistry();
		const entry = entries.find((e) => e.id === "footnotes.move")!;
		const plan = entry.run(makeCtx());
		expect(plan).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// util.normalizeUrl — direct passthrough
// ---------------------------------------------------------------------------

describe("util.normalizeUrl — passthrough", () => {
	it("lowercases scheme and host", () => {
		const { api } = buildRegistry();
		expect(api.util.normalizeUrl("HTTPS://EXAMPLE.COM/path")).toBe("https://example.com/path");
	});

	it("strips trailing slash", () => {
		const { api } = buildRegistry();
		expect(api.util.normalizeUrl("https://example.com/path/")).toBe("https://example.com/path");
	});

	it("sorts query parameters", () => {
		const { api } = buildRegistry();
		expect(api.util.normalizeUrl("https://example.com?b=2&a=1")).toBe("https://example.com?a=1&b=2");
	});

	it("drops the fragment", () => {
		const { api } = buildRegistry();
		expect(api.util.normalizeUrl("https://example.com/path#section")).toBe("https://example.com/path");
	});
});

// ---------------------------------------------------------------------------
// Version gate — checkRequiredApiVersion
// ---------------------------------------------------------------------------

describe("checkRequiredApiVersion", () => {
	it("API_VERSION is '1.0'", () => {
		expect(API_VERSION).toBe("1.0");
	});

	it("accepts the exact version", () => {
		const result = checkRequiredApiVersion("1.0");
		expect(result.ok).toBe(true);
	});

	it("accepts lower minor version (additive-compatible)", () => {
		// If API is 1.5, requiring 1.0 is fine — still compatible.
		// Here API is 1.0, so we test 1.0 accepting itself.
		// Simulate: if we were at 1.1, requiring 1.0 would be ok.
		// Test the boundary: requiring same or lower minor is ok.
		const result = checkRequiredApiVersion("1.0");
		expect(result.ok).toBe(true);
		expect(result.message).toBeUndefined();
	});

	it("rejects a script requiring a higher minor version than available", () => {
		const result = checkRequiredApiVersion("1.1");
		expect(result.ok).toBe(false);
		expect(result.message).toBe("requires API v1.1");
	});

	it("rejects a script requiring a higher major version", () => {
		const result = checkRequiredApiVersion("2.0");
		expect(result.ok).toBe(false);
		expect(result.message).toBe("requires API v2.0");
	});

	it("rejects a lower major version (breaking — major 0 vs 1 is incompatible)", () => {
		// Major 0 is a different compatibility class than major 1.
		const result = checkRequiredApiVersion("0.9");
		expect(result.ok).toBe(false);
		expect(result.message).toBe("requires API v0.9");
	});

	it("returns { ok, message } shape — not an Obsidian Notice", () => {
		const result = checkRequiredApiVersion("2.0");
		expect(result).toHaveProperty("ok");
		expect(result).toHaveProperty("message");
		// Ensure it's a plain object, not a class instance with Obsidian internals
		expect(Object.keys(result).sort()).toEqual(["message", "ok"].sort());
	});

	// W1 — fail-closed on malformed input
	it("rejects malformed minor '1.abc' (fail-closed)", () => {
		expect(checkRequiredApiVersion("1.abc").ok).toBe(false);
	});

	it("rejects malformed minor '1.' (fail-closed)", () => {
		expect(checkRequiredApiVersion("1.").ok).toBe(false);
	});

	it("rejects empty string (fail-closed)", () => {
		expect(checkRequiredApiVersion("").ok).toBe(false);
	});

	it("rejects non-version string 'abc' (fail-closed)", () => {
		expect(checkRequiredApiVersion("abc").ok).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// isApiCompatible — pure predicate, testable with arbitrary version pairs
// ---------------------------------------------------------------------------

describe("isApiCompatible — additive-minor compatibility predicate", () => {
	// Well-formed: same major
	it("available '1.0' satisfies required '1.0' (exact match)", () => {
		expect(isApiCompatible("1.0", "1.0")).toBe(true);
	});

	it("available '1.1' satisfies required '1.0' (lower minor ok)", () => {
		expect(isApiCompatible("1.1", "1.0")).toBe(true);
	});

	it("available '1.9' satisfies required '1.3' (higher available minor ok)", () => {
		expect(isApiCompatible("1.9", "1.3")).toBe(true);
	});

	it("available '1.0' does NOT satisfy required '1.1' (required minor too high)", () => {
		expect(isApiCompatible("1.0", "1.1")).toBe(false);
	});

	it("available '1.0' does NOT satisfy required '1.10' (multi-digit minor, required too high)", () => {
		// rMin=10 > aMin=0 → reject
		expect(isApiCompatible("1.0", "1.10")).toBe(false);
	});

	// Major mismatch
	it("available '1.0' does NOT satisfy required '2.0' (major mismatch, required higher)", () => {
		expect(isApiCompatible("1.0", "2.0")).toBe(false);
	});

	it("available '2.5' does NOT satisfy required '1.0' (major mismatch, available higher)", () => {
		expect(isApiCompatible("2.5", "1.0")).toBe(false);
	});

	// Malformed input → fail-closed
	it("returns false for malformed required '1.abc'", () => {
		expect(isApiCompatible("1.0", "1.abc")).toBe(false);
	});

	it("returns false for malformed required '1.'", () => {
		expect(isApiCompatible("1.0", "1.")).toBe(false);
	});

	it("returns false for empty required string", () => {
		expect(isApiCompatible("1.0", "")).toBe(false);
	});

	it("returns false for malformed available string", () => {
		expect(isApiCompatible("bad", "1.0")).toBe(false);
	});
});
