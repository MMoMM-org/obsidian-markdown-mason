// T5.1  Prod-bundle DCE test (ADR-15)
//
// Asserts that the production esbuild output physically omits the dev-adapter
// marker string (__MASON_DEV_DIR_ADAPTER__), proving that esbuild tree-shook
// the DevDirAdapter code path when __MASON_DEV__ is defined as "false".
//
// Also asserts that a dev build (define true) DOES contain the marker, proving
// the test would catch a regression if the define was removed.
//
// APPROACH
// --------
// We shell out to `node esbuild.config.mjs production` via execFileSync to
// build into a temp outfile, then read the bundle string and grep for the marker.
// The dev-build assertion runs a second esbuild invocation with a patched define
// (or we directly import esbuild and build with define: true).
//
// We use a temp output directory to avoid polluting main.js during the test run.

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import esbuild from "esbuild";
import { builtinModules } from "node:module";

// The unique marker string embedded in src/scripts/catalog/devDirAdapter.ts.
// If prod bundle contains this string, DCE failed — the dev path was NOT removed.
const DEV_ADAPTER_MARKER = "__MASON_DEV_DIR_ADAPTER__";

// Repo root (two levels up from test/build/)
const REPO_ROOT = join(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Temp output management
// ---------------------------------------------------------------------------

const tempOutputs: string[] = [];

afterAll(() => {
	for (const d of tempOutputs) {
		rmSync(d, { recursive: true, force: true });
	}
});

function makeTempOutfile(): string {
	const dir = mkdtempSync(join(tmpdir(), "mason-dce-test-"));
	tempOutputs.push(dir);
	return join(dir, "main.js");
}

// ---------------------------------------------------------------------------
// Helper: run a production-equivalent esbuild bundle
// ---------------------------------------------------------------------------

async function buildBundle(opts: {
	outfile: string;
	devFlag: boolean;
}): Promise<void> {
	const result = await esbuild.build({
		entryPoints: [join(REPO_ROOT, "src", "main.ts")],
		bundle: true,
		format: "cjs",
		platform: "node",
		target: "es2020",
		logLevel: "silent",
		sourcemap: false,
		treeShaking: true,
		minify: false, // keep readable for grepping; DCE still applies
		external: [
			"obsidian",
			"electron",
			"@codemirror/*",
			"@lezer/*",
			...builtinModules,
			...builtinModules.map((m) => `node:${m}`),
		],
		outfile: opts.outfile,
		define: {
			__MASON_DEV__: opts.devFlag ? "true" : "false",
		},
	});

	if (result.errors.length > 0) {
		throw new Error(
			`esbuild errors: ${result.errors.map((e) => e.text).join("; ")}`,
		);
	}
}

// ---------------------------------------------------------------------------
// Suite: prod bundle omits dev-adapter marker (DCE gate)
// ---------------------------------------------------------------------------

describe("Prod-bundle DCE: DevDirAdapter marker absent in prod (T5.1, ADR-15)", () => {
	it("prod bundle does NOT contain the dev-adapter marker string", async () => {
		const outfile = makeTempOutfile();
		await buildBundle({ outfile, devFlag: false });

		const bundle = readFileSync(outfile, "utf-8");
		expect(bundle).not.toContain(DEV_ADAPTER_MARKER);
	}, 60_000);

	it("dev build DOES contain the dev-adapter marker string (confirms test is meaningful)", async () => {
		const outfile = makeTempOutfile();
		await buildBundle({ outfile, devFlag: true });

		const bundle = readFileSync(outfile, "utf-8");
		expect(bundle).toContain(DEV_ADAPTER_MARKER);
	}, 60_000);
});

// ---------------------------------------------------------------------------
// Suite: no dynamic import of the 'obsidian' external in any bundle (ADR-15)
//
// A dynamic import("obsidian") emitted into the bundle crashes Obsidian's
// renderer because bare ESM specifiers cannot be resolved there at runtime
// (only static require("obsidian") works).  This suite asserts neither the
// prod nor the dev bundle contains such a dynamic import, catching the whole
// class of "dynamic import of an external breaks in the renderer" regressions.
// ---------------------------------------------------------------------------

const DYNAMIC_IMPORT_OBSIDIAN_RE = /import\s*\(\s*["']obsidian["']/;

describe("No dynamic import('obsidian') in either bundle (ADR-15)", () => {
	it("prod bundle does NOT contain a dynamic import of 'obsidian'", async () => {
		const outfile = makeTempOutfile();
		await buildBundle({ outfile, devFlag: false });

		const bundle = readFileSync(outfile, "utf-8");
		expect(bundle).not.toMatch(DYNAMIC_IMPORT_OBSIDIAN_RE);
	}, 60_000);

	it("dev bundle does NOT contain a dynamic import of 'obsidian'", async () => {
		const outfile = makeTempOutfile();
		await buildBundle({ outfile, devFlag: true });

		const bundle = readFileSync(outfile, "utf-8");
		expect(bundle).not.toMatch(DYNAMIC_IMPORT_OBSIDIAN_RE);
	}, 60_000);
});
