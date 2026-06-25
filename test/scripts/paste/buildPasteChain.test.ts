// T3.2  buildPasteChain — ordering chokepoint tests (ADR-16, PRD F10)
//
// Tests verify that buildPasteChain correctly orders enabled scripts into a
// PasteHandler chain: curated before imported, then priority DESC, then id ASC.
// Command-only scripts (no paste block) must never appear in the chain.
// The input array must not be mutated.

import { describe, it, expect } from "vitest";
import { buildPasteChain } from "../../../src/scripts/paste/buildPasteChain";
import type { LoadedScript } from "../../../src/scripts/paste/buildPasteChain";
import type { ScriptFunction } from "../../../src/scripts/context";
import type { ScriptModule, PasteBlock } from "../../../src/scripts/loader";

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

/** Stable no-op run function — used to assert identity equality by reference */
function makeRun(): ScriptFunction {
	return () => undefined;
}

/** Stable canHandle function — used to assert identity equality by reference */
function makeCanHandle(result = true): PasteBlock["canHandle"] {
	return (_input: string) => result;
}

/**
 * mk(id, provenance, priority?) → LoadedScript
 *
 * When priority is omitted or null: NO paste block (command-only script).
 * When priority is a number: paste block with that priority is added.
 * canHandle defaults to always-true; override with canHandle param.
 */
function mk(
	id: string,
	provenance: "curated" | "imported",
	priority: number | null = null,
	canHandle?: PasteBlock["canHandle"],
): LoadedScript {
	const run = makeRun();

	if (priority === null) {
		// Command-only script: no paste block
		const module: ScriptModule = { run };
		return { id, record: { provenance }, module };
	}

	const ch = canHandle ?? makeCanHandle(true);
	const paste: PasteBlock = { canHandle: ch, priority };
	const module: ScriptModule = { run, paste };
	return { id, record: { provenance }, module };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildPasteChain", () => {
	describe("command-only scripts are excluded", () => {
		it("returns empty array when no scripts have a paste block", () => {
			const scripts = [
				mk("alpha", "curated"),         // no paste block
				mk("beta", "imported"),          // no paste block
			];
			expect(buildPasteChain(scripts)).toEqual([]);
		});

		it("excludes command-only scripts but includes paste scripts", () => {
			const pasteScript = mk("handler", "curated", 100);
			const commandOnly = mk("cmd-only", "curated");       // no paste block
			const result = buildPasteChain([pasteScript, commandOnly]);
			expect(result).toHaveLength(1);
			expect(result[0]!.id).toBe("handler");
		});

		it("excludes scripts whose module is null", () => {
			const nullModule: LoadedScript = {
				id: "not-loaded",
				record: { provenance: "curated" },
				module: null,
			};
			const validScript = mk("valid", "curated", 100);
			const result = buildPasteChain([nullModule, validScript]);
			expect(result).toHaveLength(1);
			expect(result[0]!.id).toBe("valid");
		});
	});

	describe("provenance ordering: curated before imported", () => {
		it("places curated before imported regardless of priority", () => {
			const importedHighPriority = mk("imported-high", "imported", 999);
			const curatedLowPriority = mk("curated-low", "curated", 1);
			const result = buildPasteChain([importedHighPriority, curatedLowPriority]);
			expect(result).toHaveLength(2);
			expect(result[0]!.id).toBe("curated-low");
			expect(result[1]!.id).toBe("imported-high");
		});

		it("provenance dominates priority: curated priority 1 before imported priority 999", () => {
			const scripts = [
				mk("imp-999", "imported", 999),
				mk("cur-1", "curated", 1),
				mk("imp-500", "imported", 500),
				mk("cur-50", "curated", 50),
			];
			const result = buildPasteChain(scripts);
			// All curated must come before all imported
			const curatedIds = result.filter(h => h.id.startsWith("cur-")).map(h => h.id);
			const importedIds = result.filter(h => h.id.startsWith("imp-")).map(h => h.id);
			const curatedIndices = curatedIds.map(id => result.findIndex(h => h.id === id));
			const importedIndices = importedIds.map(id => result.findIndex(h => h.id === id));
			expect(Math.max(...curatedIndices)).toBeLessThan(Math.min(...importedIndices));
		});
	});

	describe("priority DESC within same provenance", () => {
		it("orders curated scripts by priority descending", () => {
			const scripts = [
				mk("web", "curated", 100),
				mk("app", "curated", 300),
				mk("web-download", "curated", 200),
			];
			const result = buildPasteChain(scripts);
			expect(result.map(h => h.id)).toEqual(["app", "web-download", "web"]);
		});

		it("orders imported scripts by priority descending", () => {
			const scripts = [
				mk("imp-c", "imported", 10),
				mk("imp-a", "imported", 50),
				mk("imp-b", "imported", 30),
			];
			const result = buildPasteChain(scripts);
			expect(result.map(h => h.id)).toEqual(["imp-a", "imp-b", "imp-c"]);
		});
	});

	describe("id ASC tiebreak: same provenance + same priority", () => {
		it("sorts by id ascending when provenance and priority match", () => {
			const scripts = [
				mk("zebra", "curated", 100),
				mk("alpha", "curated", 100),
				mk("mango", "curated", 100),
			];
			const result = buildPasteChain(scripts);
			expect(result.map(h => h.id)).toEqual(["alpha", "mango", "zebra"]);
		});

		it("id tiebreak applies within imported provenance too", () => {
			const scripts = [
				mk("z-imp", "imported", 50),
				mk("a-imp", "imported", 50),
			];
			const result = buildPasteChain(scripts);
			expect(result.map(h => h.id)).toEqual(["a-imp", "z-imp"]);
		});

		it("ordinal id compare guards against locale-dependent collation (e.g. Turkish i/I)", () => {
			// This test would FAIL under bare localeCompare (which respects system locale)
			// but PASS under ordinal comparison (deterministic across all devices).
			// In ASCII ordinal order, uppercase letters sort before lowercase:
			// S (0x53) < s (0x73), so "Script-I" < "script-a"
			const scripts = [
				mk("script-a", "curated", 100),
				mk("Script-I", "curated", 100),
			];
			const result = buildPasteChain(scripts);
			// Assert exact ordinal ascending order: uppercase S before lowercase s
			expect(result.map(h => h.id)).toEqual(["Script-I", "script-a"]);
		});
	});

	describe("shadowing guarantee (PRD F10 key invariant)", () => {
		it("curated catch-all appears before every imported handler", () => {
			const curatedCatchAll = mk("curated-catch-all", "curated", 100, () => true);
			const importedHandlers = [
				mk("imp-a", "imported", 300),
				mk("imp-b", "imported", 200),
				mk("imp-c", "imported", 150),
			];
			const result = buildPasteChain([...importedHandlers, curatedCatchAll]);

			const catchAllIndex = result.findIndex(h => h.id === "curated-catch-all");
			expect(catchAllIndex).toBeGreaterThanOrEqual(0);

			for (const imp of importedHandlers) {
				const impIndex = result.findIndex(h => h.id === imp.id);
				expect(catchAllIndex).toBeLessThan(impIndex);
			}
		});

		it("imported catch-all cannot be tried before curated handlers", () => {
			const importedCatchAll = mk("imp-catch-all", "imported", 999, () => true);
			const curatedHandler = mk("cur-specific", "curated", 1);
			const result = buildPasteChain([importedCatchAll, curatedHandler]);

			const curatedIndex = result.findIndex(h => h.id === "cur-specific");
			const importedIndex = result.findIndex(h => h.id === "imp-catch-all");
			expect(curatedIndex).toBeLessThan(importedIndex);
		});
	});

	describe("PasteHandler shape: run and canHandle identity", () => {
		it("handler.run is the same reference as the script's module.run", () => {
			const script = mk("my-script", "curated", 100);
			const result = buildPasteChain([script]);
			expect(result).toHaveLength(1);
			// Identity check: same function reference
			expect(result[0]!.run).toBe(script.module!.run);
		});

		it("handler.canHandle is the same reference as module.paste.canHandle", () => {
			const script = mk("my-script", "curated", 100);
			const result = buildPasteChain([script]);
			expect(result[0]!.canHandle).toBe(script.module!.paste!.canHandle);
		});

		it("handler carries the correct id", () => {
			const script = mk("unique-id-42", "curated", 100);
			const result = buildPasteChain([script]);
			expect(result[0]!.id).toBe("unique-id-42");
		});
	});

	describe("input array not mutated", () => {
		it("does not reorder the original array", () => {
			const scripts = [
				mk("zebra", "curated", 100),
				mk("alpha", "curated", 100),
				mk("mango", "curated", 100),
			];
			const originalOrder = scripts.map(s => s.id);
			buildPasteChain(scripts);
			expect(scripts.map(s => s.id)).toEqual(originalOrder);
		});

		it("preserves original array length", () => {
			const scripts = [mk("a", "curated", 100), mk("b", "imported", 200)];
			const originalLength = scripts.length;
			buildPasteChain(scripts);
			expect(scripts).toHaveLength(originalLength);
		});
	});

	describe("Perplexity-priority sanity: app/web-download/web order", () => {
		it("three curated handlers at 300/200/100 return in priority-descending order", () => {
			const scripts = [
				mk("web", "curated", 100),
				mk("web-download", "curated", 200),
				mk("app", "curated", 300),
			];
			const result = buildPasteChain(scripts);
			expect(result.map(h => h.id)).toEqual(["app", "web-download", "web"]);
		});
	});

	describe("mixed curated and imported with multiple priorities", () => {
		it("full sort: curated DESC priority, then imported DESC priority", () => {
			const scripts = [
				mk("imp-low", "imported", 50),
				mk("cur-high", "curated", 300),
				mk("imp-high", "imported", 400),
				mk("cur-low", "curated", 100),
				mk("cmd-only", "curated"),       // excluded
			];
			const result = buildPasteChain(scripts);
			expect(result.map(h => h.id)).toEqual([
				"cur-high",   // curated, 300
				"cur-low",    // curated, 100
				"imp-high",   // imported, 400
				"imp-low",    // imported, 50
			]);
		});
	});
});
