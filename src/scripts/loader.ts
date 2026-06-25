// Script loader — Phase 5, T5.1
//
// Resolves and freshly loads user-authored CJS scripts from the vault's scripts
// directory (default: .obsidian/plugins/markdown-mason/scripts/).
//
// DESIGN OVERVIEW
// ---------------
// Two exports drive the script runtime:
//
//   FsScriptLoader.resolve(id)
//     Given a script id (e.g. "perplexity-app"), locates <scriptsDir>/<id>.cjs
//     within the vault. Returns a ResolvedScript or null (soft-fail throughout —
//     never throws on missing/unreadable resources).
//
//   loadScriptFresh(absolutePath, requireFn)
//     Requires a script, evicting every cache entry under the script's directory
//     prefix first. This ensures that a changed helper (e.g. ./_helper.cjs) is
//     re-read on every invocation rather than served stale from Node's module
//     cache. Node_modules entries are NOT evicted (prefix stops at the file's
//     own directory).
//
// SECURITY — ESCAPE GUARD
// -----------------------
// Before reading anything, resolve() verifies that the canonical scriptsDir
// (after resolving symlinks with realpathSync) is either equal to or a
// direct descendant of the canonical vault base path. This stops a tampered
// settings value (e.g. via Sync overwriting the settings.json) from loading
// code stored outside the vault.
//
// If realpathSync throws (e.g. on a non-existent path), the guard falls back
// to the pre-realpath comparison so a missing directory still soft-fails cleanly.
//
// DESKTOP-ONLY (Electron)
// -----------------------
// Obsidian Desktop bundles a full Node runtime, so node:fs / node:path /
// node:module are available. This module intentionally does NOT import obsidian;
// it is pure Node and unit-testable without the Obsidian environment.
//
// CJS REQUIREMENT
// ---------------
// Electron's renderer context does not support bare ".js" requires — scripts
// must be authored as ".cjs". If only "<id>.js" is found, resolve() emits a
// console.warn and returns null so the caller can surface a user-facing message.

import * as fs from "node:fs";
import * as path from "node:path";
import type { ScriptFunction } from "./context";
import { debug } from "../core/debug";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Metadata for a located script file. */
export interface ResolvedScript {
	/** Canonical absolute path to the <id>.cjs file. */
	absolutePath: string;
	/** File size and mtime at resolve time; undefined if stat fails. */
	fingerprint?: { size: number; mtimeMs: number };
}

/**
 * Minimal require-function interface needed by loadScriptFresh.
 *
 * Accepts the real Node require (or module.createRequire result) cast to this
 * type. The cache and resolve members match Node's require internals.
 */
export interface RequireFn {
	(id: string): unknown;
	resolve(id: string): string;
	cache: Record<string, unknown>;
}

/** The value returned by loadScriptFresh — the script's exported callable. */
export type ScriptFn = (...args: unknown[]) => unknown;

/**
 * The optional paste-handler block inside an ADR-16 script envelope.
 *
 * Must be a plain object with a synchronous, side-effect-free `canHandle`
 * predicate and a numeric `priority` used for conflict resolution when
 * multiple scripts claim the same paste input.
 */
export interface PasteBlock {
	canHandle(input: string): boolean;
	priority: number;
}

/**
 * An ADR-16 script envelope — the shape that loadScriptModule requires and
 * returns.  A script without a `paste` block is command-only (valid).
 *
 * `run` is exactly ScriptFunction (context.ts:73) — the same signature that
 * the v0.1 bare-function scripts used, now wrapped in an envelope object.
 */
export interface ScriptModule {
	run: ScriptFunction;
	paste?: PasteBlock;
}

// ---------------------------------------------------------------------------
// FsScriptLoader
// ---------------------------------------------------------------------------

/**
 * Locates user scripts on disk within the vault boundary.
 *
 * Injected dependencies:
 *   vaultBasePath  — root of the Obsidian vault (resolved at construction time)
 *   getScriptsDir  — thunk returning the configured scripts directory path;
 *                    called on each resolve() so hot-changes to settings work
 *   debug          — optional trace callback; only called for non-error traces
 */
export class FsScriptLoader {
	private readonly vaultBasePath: string;
	private readonly getScriptsDir: () => string;
	private readonly debug: (msg: string) => void;

	constructor(
		vaultBasePath: string,
		getScriptsDir: () => string,
		debug: (msg: string) => void = () => undefined,
	) {
		this.vaultBasePath = vaultBasePath;
		this.getScriptsDir = getScriptsDir;
		this.debug = debug;
	}

	/**
	 * Locate <id>.cjs in the configured scripts directory.
	 *
	 * Returns null (never throws) when:
	 *   • The scripts dir is absent or unreadable (normal "no scripts" case).
	 *   • The escape guard rejects the scripts dir (security: outside vault).
	 *   • No <id>.cjs file exists in the dir (only <id>.js → warns about .cjs).
	 */
	resolve(id: string): ResolvedScript | null {
		const absoluteDir = path.resolve(this.vaultBasePath, this.getScriptsDir());

		// --- escape guard -------------------------------------------------------
		// Canonicalize both paths to dereference symlinks so a scripts dir that
		// points outside the vault via a symlink chain is caught.
		// Soft-fail to pre-realpath values if realpathSync throws (e.g. missing dir).
		let canonicalDir = absoluteDir;
		let canonicalBase = this.vaultBasePath;
		try {
			canonicalDir = fs.realpathSync(absoluteDir);
			canonicalBase = fs.realpathSync(this.vaultBasePath);
		} catch { /* soft-fail: use pre-realpath values */ }

		const isEqual = canonicalDir === canonicalBase;
		const isDescendant = canonicalDir.startsWith(canonicalBase + path.sep);
		if (!isEqual && !isDescendant) {
			console.warn(
				`[mason] scriptsDir "${canonicalDir}" is outside vault base "${canonicalBase}" — skipped (escape guard)`,
			);
			return null;
		}
		// --- end escape guard ---------------------------------------------------

		// Read directory entries; missing/unreadable dir is a normal "no scripts" case.
		let entries: string[];
		try {
			entries = fs.readdirSync(absoluteDir);
		} catch {
			this.debug(`[mason] scripts dir "${absoluteDir}" unreadable or absent — no scripts loaded`);
			return null;
		}

		const matches = entries.filter((e) => e === `${id}.cjs`);
		const jsOnly = entries.filter((e) => e === `${id}.js`);
		if (jsOnly.length > 0 && matches.length === 0) {
			console.warn(
				`[mason] "${id}.js" ignored — Electron requires .cjs; rename the file to "${id}.cjs"`,
			);
		}
		if (matches.length === 0) return null;

		const absolutePath = path.join(absoluteDir, matches[0]!);

		// Fingerprint: soft-fail to undefined if stat throws.
		let fingerprint: { size: number; mtimeMs: number } | undefined;
		try {
			const s = fs.statSync(absolutePath);
			fingerprint = { size: s.size, mtimeMs: s.mtimeMs };
		} catch { /* soft-fail */ }

		return {
			absolutePath,
			...(fingerprint !== undefined ? { fingerprint } : {}),
		};
	}
}

// ---------------------------------------------------------------------------
// loadScriptFresh
// ---------------------------------------------------------------------------

/** No-op fallback when a script exports no callable. */
function noop(): unknown { return undefined; }

/**
 * Evict every require-cache entry under the directory that contains
 * `absolutePath`.  Both loadScriptFresh and loadScriptModule call this so
 * that peer `.cjs` edits are always re-read from disk on the next load.
 * node_modules entries (outside the directory) are left warm.
 */
function evictPrefix(absolutePath: string, requireFn: RequireFn): void {
	const resolved = requireFn.resolve(absolutePath);
	const dirPrefix = path.dirname(resolved) + path.sep;
	for (const k of Object.keys(requireFn.cache)) {
		if (k.startsWith(dirPrefix)) {
			delete requireFn.cache[k];
		}
	}
}

/**
 * Load an ADR-16 envelope-only script module from an already-resolved
 * absolute path.
 *
 * ADR-16 CONTRACT
 * ---------------
 * Every v0.2 script must export an envelope object:
 *   module.exports = { run(ctx): EditPlan | undefined, paste?: { ... } }
 *
 * A module that does not expose a callable `run` is a LOAD ERROR (throws).
 * There is no bare-function fallback — that was the v0.1 loadScriptFresh
 * behaviour, explicitly retired for this loader.
 *
 * SECURITY
 * --------
 * The escape guard (path-traversal check) runs at FsScriptLoader.resolve()
 * time before this function is ever called.  loadScriptModule receives an
 * already-validated absolute path and does NOT re-run the guard.
 *
 * CHECKSUMS
 * ---------
 * Per ADR-14, code arriving here is pre-verified by the Materializer before
 * it lands on disk.  loadScriptModule does NOT re-hash; it requires + shape-
 * validates only.
 *
 * @param absolutePath - Canonical path to the <id>.cjs script file.
 * @param requireFn    - The Node require function (or createRequire result).
 * @returns Validated ScriptModule envelope { run, paste? }.
 * @throws  Error with a descriptive message if the envelope shape is invalid.
 */
export function loadScriptModule(absolutePath: string, requireFn: RequireFn): ScriptModule {
	evictPrefix(absolutePath, requireFn);

	const mod = requireFn(absolutePath);

	// Resolve the envelope object: top-level run wins; fall back to mod.default
	// for ESM→CJS interop (e.g. a script compiled with `export default { run, paste }`).
	let envelope: unknown;
	if (isEnvelopeCandidate(mod) && "run" in mod) {
		envelope = mod;
	} else if (isEnvelopeCandidate(mod) && isEnvelopeCandidate((mod as Record<string, unknown>)["default"])) {
		envelope = (mod as Record<string, unknown>)["default"];
	} else {
		envelope = mod;
	}

	if (envelope === null || envelope === undefined) {
		throw new Error(
			`mason: script "${absolutePath}" has no callable run() export (envelope-only, ADR-16)`,
		);
	}

	const env = envelope as Record<string, unknown>;

	if (typeof env["run"] !== "function") {
		throw new Error(
			`mason: script "${absolutePath}" has no callable run() export (envelope-only, ADR-16)`,
		);
	}

	if (env["paste"] != null) {
		const paste = env["paste"] as Record<string, unknown>;
		if (typeof paste["canHandle"] !== "function" || typeof paste["priority"] !== "number") {
			throw new Error(
				`mason: script "${absolutePath}" has an invalid paste block — ` +
				`paste.canHandle must be a function and paste.priority must be a number (ADR-16)`,
			);
		}
		return {
			run: env["run"] as ScriptFunction,
			paste: paste as unknown as PasteBlock,
		};
	}

	return { run: env["run"] as ScriptFunction };
}

/** True when `v` looks like it could be an envelope object (not a function). */
function isEnvelopeCandidate(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === "object";
}

// ---------------------------------------------------------------------------
// Shared loader helpers — used by main.ts and settingsTab.ts (S1/S2)
// ---------------------------------------------------------------------------

/**
 * Resolve the ABSOLUTE filesystem path to the materialized scripts directory.
 *
 * WHY: scripts are materialized via Obsidian's vault adapter, whose paths are
 * vault-RELATIVE (e.g. ".obsidian/plugins/markdown-mason/scripts"). But Node's
 * require / module.createRequire — used to load a script module — require an
 * ABSOLUTE path or they throw ("The argument 'filename' must be … an absolute
 * path"), which surfaces as the soft-fail "require unavailable" stub. So we
 * prefix the vault base path (FileSystemAdapter.getBasePath) when available.
 *
 * Duck-typed on `getBasePath` rather than `instanceof FileSystemAdapter` so this
 * stays obsidian-free (pure Node, unit-testable) and so a mock adapter without
 * getBasePath simply falls back to the relative path.
 *
 * @param adapter     Obsidian's vault data adapter (FileSystemAdapter on desktop).
 * @param manifestDir The plugin's vault-relative manifest.dir.
 */
/**
 * Extract an optional one-line description that a user declared in an imported
 * script via a `// description: ...` header comment, e.g.
 *
 *   // description: Prefix every Markdown heading with "=> ".
 *
 * Parsed from the script SOURCE text — this NEVER executes the script, so it is
 * safe to call before consent. Returns the trimmed text, or undefined if absent.
 */
export function extractScriptDescription(source: string): string | undefined {
	const m = source.match(/^[ \t]*\/\/[ \t]*description:[ \t]*(.+?)[ \t]*$/im);
	const text = m?.[1]?.trim();
	return text !== undefined && text.length > 0 ? text : undefined;
}

export function resolveScriptsDir(adapter: unknown, manifestDir: string | undefined): string {
	const dir = manifestDir ?? "";
	const getBasePath = (adapter as { getBasePath?: () => string } | null)?.getBasePath;
	const base = typeof getBasePath === "function" ? getBasePath.call(adapter) : undefined;
	return base !== undefined && base !== ""
		? `${base}/${dir}/scripts`
		: `${dir}/scripts`;
}

/**
 * Build a Node require function for loading materialized CJS scripts.
 *
 * Desktop-only: uses module.createRequire (Electron/Node). The scriptsDir
 * is used as the base URL so relative requires within a script resolve correctly.
 * Falls back to a no-op stub (soft-fail) if createRequire is unavailable or
 * the path is invalid (e.g. in test environments without a real vault path).
 */
export function buildRequireFn(scriptsDir: string): RequireFn {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const nodeModule = require("node:module") as { createRequire(from: string): RequireFn };
		return nodeModule.createRequire(scriptsDir + "/");
	} catch {
		// Non-Electron environment or invalid path: return a stub that always throws.
		const stub = (): never => { throw new Error("require unavailable"); };
		(stub as unknown as RequireFn).resolve = (): never => { throw new Error("require unavailable"); };
		(stub as unknown as RequireFn).cache = {} as Record<string, unknown>;
		return stub as unknown as RequireFn;
	}
}

/**
 * Load and return the `run` function from a materialized script module.
 *
 * Returns a safe no-op if the module cannot be loaded (soft-fail).
 * Used by resolveScriptFn in the Run script launcher and Commands tab.
 */
export function loadRunFnSafe(
	id: string,
	scriptsDir: string,
	requireFn: RequireFn,
): import("./context").ScriptFunction {
	const absolutePath = `${scriptsDir}/${id}.cjs`;
	try {
		const mod = loadScriptModule(absolutePath, requireFn);
		return mod.run;
	} catch (err: unknown) {
		debug(`[MarkdownMason] resolveScriptFn: failed to load module "${id}":`, err);
		return (): undefined => undefined;
	}
}

/**
 * Require a script, evicting every module-cache entry under the script's
 * own directory prefix before loading.
 *
 * WHY prefix eviction:
 *   Node caches every require'd file. If the user edits a script's helper
 *   module (e.g. ./_helper.cjs) after the first load, a plain require() call
 *   returns the stale cached version. By deleting all cache keys that start
 *   with the script's directory prefix, we ensure that any peer .cjs file in
 *   the same directory is re-read from disk on the next require. We
 *   intentionally stop at the directory boundary so that node_modules entries
 *   (which live under a different path entirely) are left warm.
 *
 * @param absolutePath - Canonical path to the <id>.cjs script file.
 * @param requireFn    - The Node require function (or createRequire result).
 * @returns The script's function export, or a noop if no function is exported.
 */
export function loadScriptFresh(absolutePath: string, requireFn: RequireFn): ScriptFn {
	// Evict every cache entry under the directory prefix so that peer .cjs
	// helper edits are re-read from disk on the next require call.
	evictPrefix(absolutePath, requireFn);

	const mod = requireFn(absolutePath);

	// Resolve function export: prefer direct function, then .default (ESM-to-CJS).
	if (typeof mod === "function") return mod as ScriptFn;
	if (typeof (mod as { default?: unknown })?.default === "function") {
		return (mod as { default: ScriptFn }).default;
	}

	console.warn(`[mason] "${absolutePath}" exports no function — ignored`);
	return noop;
}
