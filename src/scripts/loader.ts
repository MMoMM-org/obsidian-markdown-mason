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
	// Resolve the canonical cache key that Node will use for this module.
	const resolved = requireFn.resolve(absolutePath);

	// Compute the directory prefix: everything up to and including the final
	// path separator. Use path.dirname + path.sep rather than lastIndexOf("/")
	// so Windows path separators are handled correctly.
	const dirPrefix = path.dirname(resolved) + path.sep;

	// Evict every cache entry under the directory prefix.
	// Entries outside this prefix (node_modules, other dirs) are untouched.
	for (const k of Object.keys(requireFn.cache)) {
		if (k.startsWith(dirPrefix)) {
			delete requireFn.cache[k];
		}
	}

	const mod = requireFn(absolutePath);

	// Resolve function export: prefer direct function, then .default (ESM-to-CJS).
	if (typeof mod === "function") return mod as ScriptFn;
	if (typeof (mod as { default?: unknown })?.default === "function") {
		return (mod as { default: ScriptFn }).default;
	}

	console.warn(`[mason] "${absolutePath}" exports no function — ignored`);
	return noop;
}
