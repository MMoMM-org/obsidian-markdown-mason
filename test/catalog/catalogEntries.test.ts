// Catalog artifacts — built .cjs envelopes + index.json contract (T5.2, ADR-16)
//
// These tests run against the COMMITTED build artifacts in catalog/dist/:
//   - index.json  — a CatalogIndex { schemaVersion, ref, scripts }
//   - <id>.cjs    — one standalone envelope per entry
//
// Rebuild the artifacts with `npm run build:catalog` whenever a catalog script,
// parser, or entry wrapper changes. The committed bytes are the deterministic
// inputs verified here (byte-exact checksum + loadable envelope shape).

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as module from "node:module";
import { fileURLToPath } from "node:url";
import { sha256Bytes } from "../../src/scripts/checksum";
import { loadScriptModule } from "../../src/scripts/loader";
import type { RequireFn } from "../../src/scripts/loader";
import type { CatalogIndex, CatalogEntry } from "../../src/scripts/catalog/catalogSource";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, "../../catalog/dist");
const indexPath = path.join(distDir, "index.json");

function loadIndex(): CatalogIndex {
	const text = fs.readFileSync(indexPath, "utf-8");
	return JSON.parse(text) as CatalogIndex;
}

function makeRequireFn(): RequireFn {
	const sentinel = path.join(distDir, "_sentinel.cjs");
	return module.createRequire(sentinel) as unknown as RequireFn;
}

// Expected ids and the priority each entry's paste block must carry (PRD F10).
const EXPECTED_PRIORITY: Record<string, number> = {
	"perplexity-app": 300,
	"perplexity-web-download": 200,
	"perplexity-web": 100,
};

// ---------------------------------------------------------------------------
// index.json shape — CatalogIndex / CatalogEntry contract
// ---------------------------------------------------------------------------

describe("catalog/dist/index.json — CatalogIndex shape", () => {
	it("has a numeric schemaVersion and a string ref", () => {
		const index = loadIndex();
		expect(typeof index.schemaVersion).toBe("number");
		expect(typeof index.ref).toBe("string");
		expect(index.ref.length).toBeGreaterThan(0);
	});

	it("contains exactly the three curated perplexity entries", () => {
		const index = loadIndex();
		expect(Object.keys(index.scripts).sort()).toEqual(
			["perplexity-app", "perplexity-web", "perplexity-web-download"],
		);
	});

	it("each entry validates the CatalogEntry shape", () => {
		const index = loadIndex();
		for (const [id, entry] of Object.entries(index.scripts)) {
			const e = entry as CatalogEntry;
			expect(e.id, `entry "${id}" id must equal its key`).toBe(id);
			expect(typeof e.version).toBe("number");
			expect(e.checksum, `entry "${id}" checksum must be sha256:<hex>`).toMatch(/^sha256:[0-9a-f]{64}$/);
			expect(e.path).toBe(`${id}.cjs`);
			expect(typeof e.name).toBe("string");
			expect(e.name.length).toBeGreaterThan(0);
			expect(typeof e.description).toBe("string");
			expect(e.description.length).toBeGreaterThan(0);
		}
	});
});

// ---------------------------------------------------------------------------
// byte-exact checksum — sha256Bytes(.cjs bytes) === entry.checksum
// ---------------------------------------------------------------------------

describe("catalog/dist — byte-exact checksums", () => {
	it("sha256Bytes of each built .cjs matches its index checksum exactly", () => {
		const index = loadIndex();
		for (const [id, entry] of Object.entries(index.scripts)) {
			const bytes = fs.readFileSync(path.join(distDir, entry.path));
			expect(
				sha256Bytes(bytes),
				`checksum drift for "${id}" — rebuild with npm run build:catalog`,
			).toBe(entry.checksum);
		}
	});
});

// ---------------------------------------------------------------------------
// loadable envelope — loadScriptModule returns { run, paste{priority} }
// ---------------------------------------------------------------------------

describe("catalog/dist — each .cjs loads as an ADR-16 envelope", () => {
	it("loadScriptModule returns a callable run and a paste block with the correct priority", () => {
		const index = loadIndex();
		const requireFn = makeRequireFn();
		for (const [id, entry] of Object.entries(index.scripts)) {
			const abs = path.join(distDir, entry.path);
			const mod = loadScriptModule(abs, requireFn);
			expect(typeof mod.run, `"${id}" run must be callable`).toBe("function");
			expect(mod.paste, `"${id}" must expose a paste block`).toBeDefined();
			expect(typeof mod.paste!.canHandle).toBe("function");
			expect(mod.paste!.priority, `"${id}" priority must follow PRD F10`).toBe(EXPECTED_PRIORITY[id]);
		}
	});
});
