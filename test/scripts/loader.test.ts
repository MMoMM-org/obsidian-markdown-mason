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
import { FsScriptLoader, loadScriptFresh, loadScriptModule, resolveScriptsDir, extractScriptDescription } from "../../src/scripts/loader";
import type { RequireFn, ScriptModule, PasteBlock } from "../../src/scripts/loader";

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

// ---------------------------------------------------------------------------
// loadScriptModule — ADR-16 envelope loader
// ---------------------------------------------------------------------------
//
// loadScriptModule requires and validates a { run, paste? } envelope.
// A module without a callable run is a LOAD ERROR (throws).
// No bare-function fallback (that is loadScriptFresh behaviour).

describe("loadScriptModule — valid { run, paste } envelope", () => {
	it("returns run and paste when both are present and valid", () => {
		const scriptsDir = makeTempDir("mason-env-");
		const mainPath = path.join(scriptsDir, "with-paste.cjs");
		fs.writeFileSync(
			mainPath,
			`module.exports = {
  run: function(ctx) { return undefined; },
  paste: { canHandle: function(input) { return input.length > 0; }, priority: 10 }
};`,
		);

		const requireFn = makeRequireFn(scriptsDir);
		const result: ScriptModule = loadScriptModule(mainPath, requireFn);

		expect(typeof result.run).toBe("function");
		expect(result.paste).toBeDefined();
		const paste = result.paste as PasteBlock;
		expect(typeof paste.canHandle).toBe("function");
		expect(paste.priority).toBe(10);
		expect(paste.canHandle("hello")).toBe(true);
	});
});

describe("loadScriptModule — valid { run } only (command-only)", () => {
	it("returns { run } with paste undefined when no paste block", () => {
		const scriptsDir = makeTempDir("mason-env-");
		const mainPath = path.join(scriptsDir, "cmd-only.cjs");
		fs.writeFileSync(
			mainPath,
			"module.exports = { run: function(ctx) { return undefined; } };",
		);

		const requireFn = makeRequireFn(scriptsDir);
		const result: ScriptModule = loadScriptModule(mainPath, requireFn);

		expect(typeof result.run).toBe("function");
		expect(result.paste).toBeUndefined();
	});
});

describe("loadScriptModule — LOAD ERROR: missing run", () => {
	it("throws when module exports empty object (no run)", () => {
		const scriptsDir = makeTempDir("mason-env-");
		const mainPath = path.join(scriptsDir, "no-run.cjs");
		fs.writeFileSync(mainPath, "module.exports = {};");

		const requireFn = makeRequireFn(scriptsDir);
		expect(() => loadScriptModule(mainPath, requireFn)).toThrow(/run/);
	});

	it("throws when module exports only a paste block (no run)", () => {
		const scriptsDir = makeTempDir("mason-env-");
		const mainPath = path.join(scriptsDir, "paste-only.cjs");
		fs.writeFileSync(
			mainPath,
			`module.exports = { paste: { canHandle: function() { return true; }, priority: 1 } };`,
		);

		const requireFn = makeRequireFn(scriptsDir);
		expect(() => loadScriptModule(mainPath, requireFn)).toThrow(/run|envelope/i);
	});

	it("throws a descriptive error (no crash) when module.exports is null (C2)", () => {
		const scriptsDir = makeTempDir("mason-env-");
		const mainPath = path.join(scriptsDir, "null-exports.cjs");
		fs.writeFileSync(mainPath, "module.exports = null;");

		const requireFn = makeRequireFn(scriptsDir);
		expect(() => loadScriptModule(mainPath, requireFn)).toThrow(/run|envelope/i);
	});
});

describe("loadScriptModule — LOAD ERROR: non-callable run", () => {
	it("throws when run is a number, not a function", () => {
		const scriptsDir = makeTempDir("mason-env-");
		const mainPath = path.join(scriptsDir, "bad-run.cjs");
		fs.writeFileSync(mainPath, "module.exports = { run: 42 };");

		const requireFn = makeRequireFn(scriptsDir);
		expect(() => loadScriptModule(mainPath, requireFn)).toThrow(/run/);
	});
});

describe("loadScriptModule — null/undefined paste = command-only (C1)", () => {
	it("returns { run } with paste undefined when paste is null (null treated as absent)", () => {
		const scriptsDir = makeTempDir("mason-env-");
		const mainPath = path.join(scriptsDir, "null-paste.cjs");
		fs.writeFileSync(
			mainPath,
			"module.exports = { run: function() {}, paste: null };",
		);

		const requireFn = makeRequireFn(scriptsDir);
		const result: ScriptModule = loadScriptModule(mainPath, requireFn);

		expect(typeof result.run).toBe("function");
		expect(result.paste).toBeUndefined();
	});

	it("returns { run } with paste undefined when paste is undefined (paste key absent)", () => {
		const scriptsDir = makeTempDir("mason-env-");
		const mainPath = path.join(scriptsDir, "undef-paste.cjs");
		fs.writeFileSync(
			mainPath,
			"module.exports = { run: function() {}, paste: undefined };",
		);

		const requireFn = makeRequireFn(scriptsDir);
		const result: ScriptModule = loadScriptModule(mainPath, requireFn);

		expect(typeof result.run).toBe("function");
		expect(result.paste).toBeUndefined();
	});
});

describe("loadScriptModule — LOAD ERROR: invalid paste block", () => {
	it("throws when paste.canHandle is not a function", () => {
		const scriptsDir = makeTempDir("mason-env-");
		const mainPath = path.join(scriptsDir, "bad-paste-canhandle.cjs");
		fs.writeFileSync(
			mainPath,
			`module.exports = { run: function() {}, paste: { canHandle: "not-a-fn", priority: 1 } };`,
		);

		const requireFn = makeRequireFn(scriptsDir);
		expect(() => loadScriptModule(mainPath, requireFn)).toThrow(/paste/i);
	});

	it("throws when paste.priority is not a number", () => {
		const scriptsDir = makeTempDir("mason-env-");
		const mainPath = path.join(scriptsDir, "bad-paste-priority.cjs");
		fs.writeFileSync(
			mainPath,
			`module.exports = { run: function() {}, paste: { canHandle: function() { return true; }, priority: "high" } };`,
		);

		const requireFn = makeRequireFn(scriptsDir);
		expect(() => loadScriptModule(mainPath, requireFn)).toThrow(/paste/i);
	});

	it("throws when paste has neither canHandle nor priority", () => {
		const scriptsDir = makeTempDir("mason-env-");
		const mainPath = path.join(scriptsDir, "empty-paste.cjs");
		fs.writeFileSync(
			mainPath,
			"module.exports = { run: function() {}, paste: {} };",
		);

		const requireFn = makeRequireFn(scriptsDir);
		expect(() => loadScriptModule(mainPath, requireFn)).toThrow(/paste/i);
	});
});

describe("loadScriptModule — ESM-to-CJS .default interop", () => {
	it("resolves envelope from module.exports.default when it is the envelope", () => {
		const scriptsDir = makeTempDir("mason-env-");
		const mainPath = path.join(scriptsDir, "esm-default.cjs");
		fs.writeFileSync(
			mainPath,
			`module.exports = { default: { run: function(ctx) { return undefined; } } };`,
		);

		const requireFn = makeRequireFn(scriptsDir);
		const result: ScriptModule = loadScriptModule(mainPath, requireFn);

		expect(typeof result.run).toBe("function");
		expect(result.paste).toBeUndefined();
	});
});

describe("loadScriptModule — prefix cache-evict (peer .cjs re-read on change)", () => {
	it("picks up a changed helper after re-load (cache evicted by prefix)", () => {
		const scriptsDir = makeTempDir("mason-env-evict-");

		// Write helper v1
		const helperPath = path.join(scriptsDir, "_helper.cjs");
		fs.writeFileSync(helperPath, `module.exports = "v1";`);

		// Write main script as envelope that requires the helper
		const mainPath = path.join(scriptsDir, "main.cjs");
		fs.writeFileSync(
			mainPath,
			`const h = require("./_helper.cjs");
module.exports = { run: function(ctx) { return h; } };`,
		);

		const requireFn = makeRequireFn(scriptsDir);

		// Load v1 — run returns "v1"
		const mod1 = loadScriptModule(mainPath, requireFn);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect((mod1.run as any)()).toBe("v1");

		// Overwrite helper to v2
		fs.writeFileSync(helperPath, `module.exports = "v2";`);

		// Load again — cache eviction MUST cause helper v2 to be picked up
		const mod2 = loadScriptModule(mainPath, requireFn);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect((mod2.run as any)()).toBe("v2");
	});
});

// ---------------------------------------------------------------------------
// resolveScriptsDir — vault-relative manifest.dir → ABSOLUTE require path
//
// require/createRequire reject a relative path; this helper prefixes the vault
// base path from the adapter's getBasePath() so script modules can be loaded.
// ---------------------------------------------------------------------------

describe("resolveScriptsDir", () => {
	it("prefixes the vault base path when the adapter exposes getBasePath()", () => {
		const adapter = { getBasePath: () => "/Users/me/Vault" };
		expect(resolveScriptsDir(adapter, ".obsidian/plugins/markdown-mason")).toBe(
			"/Users/me/Vault/.obsidian/plugins/markdown-mason/scripts",
		);
	});

	it("returns an absolute path that createRequire accepts (no throw)", () => {
		const base = fs.mkdtempSync(path.join(os.tmpdir(), "mason-absdir-"));
		const adapter = { getBasePath: () => base };
		const abs = resolveScriptsDir(adapter, "plugin");
		expect(path.isAbsolute(abs)).toBe(true);
		// The real failure mode was createRequire throwing on a relative base.
		expect(() => module.createRequire(abs + "/")).not.toThrow();
	});

	it("falls back to the relative path when getBasePath is absent (e.g. a mock adapter)", () => {
		expect(resolveScriptsDir({}, "plugin-dir")).toBe("plugin-dir/scripts");
	});

	it("tolerates an undefined manifest.dir", () => {
		expect(resolveScriptsDir({ getBasePath: () => "/v" }, undefined)).toBe("/v//scripts");
	});
});

// ---------------------------------------------------------------------------
// extractScriptDescription — "// description:" header convention
// ---------------------------------------------------------------------------

describe("extractScriptDescription", () => {
	it("reads a leading '// description:' header", () => {
		const src = `// description: Prefix every heading with "=> ".\nmodule.exports = { run() {} };`;
		expect(extractScriptDescription(src)).toBe('Prefix every heading with "=> ".');
	});

	it("is case-insensitive and tolerates missing spaces", () => {
		expect(extractScriptDescription("//Description:Hello")).toBe("Hello");
		expect(extractScriptDescription("   // DESCRIPTION:   spaced   ")).toBe("spaced");
	});

	it("returns undefined when there is no description header", () => {
		expect(extractScriptDescription("module.exports = { run() {} };")).toBeUndefined();
	});

	it("returns undefined for an empty description", () => {
		expect(extractScriptDescription("// description:   ")).toBeUndefined();
	});

	it("does NOT execute the script — pure text parse", () => {
		// A source that would throw if evaluated still yields its description.
		const src = "// description: safe\nthrow new Error('should never run');";
		expect(extractScriptDescription(src)).toBe("safe");
	});
});
