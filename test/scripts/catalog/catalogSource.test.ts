import { describe, it, expect } from "vitest";
import type { CatalogSource, CatalogIndex, CatalogEntry } from "../../../src/scripts/catalog/catalogSource";

// ---------------------------------------------------------------------------
// Compile fixture — verifies that CatalogSource / CatalogIndex / CatalogEntry
// in src/scripts/catalog/catalogSource.ts carry exactly the six-field
// CatalogEntry shape and that a network-free fake satisfies the CatalogSource
// port (ADR-13). The real compile assertion comes from tsc (noEmit); the
// runtime assertions below keep vitest from treating this as dead code.
// ---------------------------------------------------------------------------

// Fully-populated CatalogEntry literal — all six fields present.
// Any future field rename or removal will cause a compile error here.
const _entry: CatalogEntry = {
	id: "perplexity-app",
	version: 3,
	checksum: "sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
	path: "scripts/perplexity-app.cjs",
	name: "Perplexity App",
	description: "Search the web via Perplexity from Obsidian.",
};

// CatalogIndex literal — schemaVersion, ref (git SHA), scripts record.
const _index: CatalogIndex = {
	schemaVersion: 1,
	ref: "abc1234567890abc1234567890abc1234567890ab",
	scripts: {
		"perplexity-app": _entry,
	},
};

// Fake CatalogSource — proves a network-free implementation satisfies the port.
const fake: CatalogSource = {
	fetchIndex: async (): Promise<CatalogIndex> => _index,
	fetchScript: async (entry: CatalogEntry): Promise<Uint8Array> => {
		void entry;
		return new TextEncoder().encode("x");
	},
};

// Suppress unused-variable warnings (noUnusedLocals).
void _entry;
void _index;

describe("CatalogSource port — compile + shape fixture (T2.1, ADR-13)", () => {
	it("fake CatalogSource satisfies the port interface (compile-time proof)", () => {
		// The real assertion is that tsc accepted this file (noEmit).
		expect(typeof fake.fetchIndex).toBe("function");
		expect(typeof fake.fetchScript).toBe("function");
	});

	it("fetchIndex returns a CatalogIndex with all required fields", async () => {
		const idx = await fake.fetchIndex();
		expect(idx.schemaVersion).toBe(1);
		expect(idx.ref).toBe("abc1234567890abc1234567890abc1234567890ab");
		expect(typeof idx.scripts).toBe("object");
	});

	it("fetchIndex scripts record contains a fully-shaped CatalogEntry", async () => {
		const idx = await fake.fetchIndex();
		const entry = idx.scripts["perplexity-app"];
		expect(entry).toBeDefined();
		expect(entry.id).toBe("perplexity-app");
		expect(entry.version).toBe(3);
		expect(entry.checksum).toBe(
			"sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
		);
		expect(entry.path).toBe("scripts/perplexity-app.cjs");
		expect(entry.name).toBe("Perplexity App");
		expect(entry.description).toBe("Search the web via Perplexity from Obsidian.");
	});

	it("fetchScript returns a Uint8Array (raw bytes, ADR-14)", async () => {
		const bytes = await fake.fetchScript(_entry);
		expect(bytes).toBeInstanceOf(Uint8Array);
	});
});
