// T5.1 Script loader — real-fs integration tests
//
// Tests run against a temp directory created per-suite via fs.mkdtempSync.
// All tests use real fs; no mocking. afterEach removes temp dirs.
//
// Behaviour under test:
//   FsScriptLoader.resolve(id)
//     (a) returns absolutePath + fingerprint for a matching <id>.cjs file
//     (b) returns null when the scripts dir is absent
//     (c) returns null + console.warn when <id>.js exists but no <id>.cjs
//     (d) returns null + console.warn when scriptsDir escapes the vault base
//         (realpath escape guard)
//   loadScriptFresh(absolutePath, requireFn)
//     (e) evicts the whole directory prefix from requireFn.cache on each load
//         so an edited ./_helper.cjs is re-evaluated, not served stale

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as module from "node:module";
import { describe, it, expect, afterEach, vi } from "vitest";
import { FsScriptLoader, loadScriptFresh } from "../../src/scripts/loader";
import type { RequireFn } from "../../src/scripts/loader";

// ---------------------------------------------------------------------------
// Temp-dir lifecycle
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const d of tempDirs.splice(0)) {
		try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
	}
});

// ---------------------------------------------------------------------------
// Helper: build a require function anchored to a temp dir
// ---------------------------------------------------------------------------

function makeRequireFn(baseDir: string): RequireFn {
	// createRequire needs a file path (the "module's own path") so the returned
	// require resolves paths relative to that file. We use a dummy sentinel path
	// inside the temp dir so resolution stays inside the temp dir.
	const sentinel = path.join(baseDir, "_sentinel.cjs");
	const req = module.createRequire(sentinel);
	return req as unknown as RequireFn;
}

// ---------------------------------------------------------------------------
// (a) resolve finds <id>.cjs and returns absolutePath + fingerprint
// ---------------------------------------------------------------------------

describe("FsScriptLoader.resolve — happy path", () => {
	it("returns absolutePath pointing to <id>.cjs", () => {
		const vaultBase = makeTempDir("mason-vault-");
		const scriptsDir = path.join(vaultBase, "scripts");
		fs.mkdirSync(scriptsDir);
		fs.writeFileSync(path.join(scriptsDir, "perplexity-app.cjs"), "module.exports = () => {};");

		const loader = new FsScriptLoader(vaultBase, () => scriptsDir);
		const result = loader.resolve("perplexity-app");

		expect(result).not.toBeNull();
		expect(result!.absolutePath).toBe(path.join(scriptsDir, "perplexity-app.cjs"));
	});

	it("returns fingerprint with size and mtimeMs", () => {
		const vaultBase = makeTempDir("mason-vault-");
		const scriptsDir = path.join(vaultBase, "scripts");
		fs.mkdirSync(scriptsDir);
		const content = "module.exports = () => {};";
		const filePath = path.join(scriptsDir, "my-script.cjs");
		fs.writeFileSync(filePath, content);
		const stat = fs.statSync(filePath);

		const loader = new FsScriptLoader(vaultBase, () => scriptsDir);
		const result = loader.resolve("my-script");

		expect(result!.fingerprint).toBeDefined();
		expect(result!.fingerprint!.size).toBe(stat.size);
		expect(result!.fingerprint!.mtimeMs).toBe(stat.mtimeMs);
	});
});

// ---------------------------------------------------------------------------
// (b) absent dir → null (debug-trace only, no warning)
// ---------------------------------------------------------------------------

describe("FsScriptLoader.resolve — absent scripts dir", () => {
	it("returns null when the scripts directory does not exist", () => {
		const vaultBase = makeTempDir("mason-vault-");
		const missingDir = path.join(vaultBase, "does-not-exist");

		const loader = new FsScriptLoader(vaultBase, () => missingDir);
		const result = loader.resolve("any-id");

		expect(result).toBeNull();
	});

	it("calls debug (not warn) when scripts dir is absent", () => {
		const vaultBase = makeTempDir("mason-vault-");
		const missingDir = path.join(vaultBase, "does-not-exist");
		const debugSpy = vi.fn();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		const loader = new FsScriptLoader(vaultBase, () => missingDir, debugSpy);
		loader.resolve("any-id");

		// debug MUST be called for absent dir trace; warn must NOT be called
		expect(debugSpy).toHaveBeenCalled();
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// (c) <id>.js exists but no <id>.cjs → null + console.warn
// ---------------------------------------------------------------------------

describe("FsScriptLoader.resolve — .js only (Electron incompatible)", () => {
	it("returns null when only <id>.js exists", () => {
		const vaultBase = makeTempDir("mason-vault-");
		const scriptsDir = path.join(vaultBase, "scripts");
		fs.mkdirSync(scriptsDir);
		fs.writeFileSync(path.join(scriptsDir, "my-script.js"), "module.exports = () => {};");

		const loader = new FsScriptLoader(vaultBase, () => scriptsDir);
		const result = loader.resolve("my-script");

		expect(result).toBeNull();
	});

	it("emits console.warn mentioning Electron requires .cjs when only .js exists", () => {
		const vaultBase = makeTempDir("mason-vault-");
		const scriptsDir = path.join(vaultBase, "scripts");
		fs.mkdirSync(scriptsDir);
		fs.writeFileSync(path.join(scriptsDir, "my-script.js"), "module.exports = () => {};");
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		const loader = new FsScriptLoader(vaultBase, () => scriptsDir);
		loader.resolve("my-script");

		expect(warnSpy).toHaveBeenCalled();
		const callArg = warnSpy.mock.calls[0]?.join(" ") ?? "";
		expect(callArg).toMatch(/\.cjs/);
		warnSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// (d) escape guard — scriptsDir outside vault base → null + console.warn
// ---------------------------------------------------------------------------

describe("FsScriptLoader.resolve — escape guard (path traversal)", () => {
	it("returns null when scriptsDir resolves outside the vault base", () => {
		const rootTmp = makeTempDir("mason-root-");
		const vaultBase = path.join(rootTmp, "vault");
		const outside = path.join(rootTmp, "outside");
		fs.mkdirSync(vaultBase);
		fs.mkdirSync(outside);
		// Write a .cjs into the outside dir so discovery would succeed if guard fails
		fs.writeFileSync(path.join(outside, "evil.cjs"), "module.exports = () => {};");

		// scriptsDir is set to the outside dir directly (simulates tampered config)
		const loader = new FsScriptLoader(vaultBase, () => outside);
		const result = loader.resolve("evil");

		expect(result).toBeNull();
	});

	it("emits console.warn when scriptsDir escapes the vault base", () => {
		const rootTmp = makeTempDir("mason-root-");
		const vaultBase = path.join(rootTmp, "vault");
		const outside = path.join(rootTmp, "outside");
		fs.mkdirSync(vaultBase);
		fs.mkdirSync(outside);
		fs.writeFileSync(path.join(outside, "evil.cjs"), "module.exports = () => {};");
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		const loader = new FsScriptLoader(vaultBase, () => outside);
		loader.resolve("evil");

		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it("does NOT block scriptsDir that IS the vault base (edge: equal paths)", () => {
		// scriptsDir === vaultBase is unusual but should not be blocked by the guard
		// (equal IS allowed; the guard rejects when dir is NOT a child and NOT equal)
		const vaultBase = makeTempDir("mason-vault-");
		fs.writeFileSync(path.join(vaultBase, "inline.cjs"), "module.exports = () => {};");

		const loader = new FsScriptLoader(vaultBase, () => vaultBase);
		const result = loader.resolve("inline");

		expect(result).not.toBeNull();
	});

	it("returns null when scriptsDir is a symlink pointing outside the vault (symlink-chain escape)", () => {
		// This test exercises the realpathSync resolution path — the primary security
		// purpose of the escape guard.  A plain real directory outside the vault (as in
		// the tests above) bypasses the symlink-specific branch; this test uses an actual
		// symlink so the guard must dereference it to detect the escape.
		const vaultBase = makeTempDir("mason-vault-");
		const outsideDir = makeTempDir("mason-outside-");
		const symlinkScripts = path.join(vaultBase, "scripts");

		try {
			fs.symlinkSync(outsideDir, symlinkScripts, "dir");
		} catch (err: unknown) {
			// EPERM on platforms that disallow unprivileged dir symlinks (unlikely on Linux).
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "EPERM" || code === "ENOTSUP") {
				console.warn(`[mason-test] symlink creation not permitted (${code}) — skipping symlink-escape test`);
				return;
			}
			throw err;
		}

		// Place a script in the outside dir — if the guard fails, resolve() would return it.
		fs.writeFileSync(path.join(outsideDir, "evil.cjs"), "module.exports = () => {};");

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const loader = new FsScriptLoader(vaultBase, () => symlinkScripts);
		const result = loader.resolve("evil");

		// realpathSync resolves the symlink → outsideDir, which is outside vaultBase.
		expect(result).toBeNull();
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// (e) loadScriptFresh — cache-eviction by directory prefix
// ---------------------------------------------------------------------------
//
// Write a .cjs that re-exports a helper (require("./_helper.cjs")).
// Load → see v1. Overwrite helper → load again → see v2 (cache evicted).
//
// We use a real require obtained from module.createRequire; cast to RequireFn.

describe("loadScriptFresh — cache-evict prefix and re-evaluate on change", () => {
	it("picks up a changed helper after re-load (cache evicted by prefix)", () => {
		const scriptsDir = makeTempDir("mason-scripts-");

		// Write helper v1 — exports the string "v1"
		const helperPath = path.join(scriptsDir, "_helper.cjs");
		fs.writeFileSync(helperPath, "module.exports = \"v1\";");

		// Write the main script that requires the helper
		const mainPath = path.join(scriptsDir, "main.cjs");
		fs.writeFileSync(
			mainPath,
			"const h = require(\"./_helper.cjs\"); module.exports = () => h;",
		);

		const requireFn = makeRequireFn(scriptsDir);

		// Load v1
		const fn1 = loadScriptFresh(mainPath, requireFn) as () => string;
		expect(fn1()).toBe("v1");

		// Overwrite helper to v2
		fs.writeFileSync(helperPath, "module.exports = \"v2\";");

		// Load fresh — the cache eviction MUST cause helper v2 to be picked up
		const fn2 = loadScriptFresh(mainPath, requireFn) as () => string;
		expect(fn2()).toBe("v2");
	});

	it("returns the exported function directly when module.exports is a function", () => {
		const scriptsDir = makeTempDir("mason-scripts-");
		const mainPath = path.join(scriptsDir, "fn.cjs");
		fs.writeFileSync(mainPath, "module.exports = (x) => x * 2;");

		const requireFn = makeRequireFn(scriptsDir);
		const fn = loadScriptFresh(mainPath, requireFn) as (x: number) => number;
		expect(fn(3)).toBe(6);
	});

	it("returns the .default export when module.exports.default is a function", () => {
		const scriptsDir = makeTempDir("mason-scripts-");
		const mainPath = path.join(scriptsDir, "esm-compat.cjs");
		// Simulate an ESM-to-CJS transpiled default export
		fs.writeFileSync(
			mainPath,
			"module.exports = { default: (x) => x + 1 };",
		);

		const requireFn = makeRequireFn(scriptsDir);
		const fn = loadScriptFresh(mainPath, requireFn) as (x: number) => number;
		expect(fn(10)).toBe(11);
	});

	it("falls back gracefully (returns noop) when script exports no function — emits console.warn", () => {
		const scriptsDir = makeTempDir("mason-scripts-");
		const mainPath = path.join(scriptsDir, "no-fn.cjs");
		fs.writeFileSync(mainPath, "module.exports = { someValue: 42 };");
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		const requireFn = makeRequireFn(scriptsDir);
		const result = loadScriptFresh(mainPath, requireFn);

		// Should still return a callable (the noop), not throw
		expect(typeof result).toBe("function");
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});
