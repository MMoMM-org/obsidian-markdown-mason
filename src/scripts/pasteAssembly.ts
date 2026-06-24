// pasteAssembly.ts — T6.3 injectable paste-chain assembly (W1)
//
// Extracted from MarkdownMasonPlugin._buildEnabledPasteScripts so that tests
// can drive the REAL assembly wire (real LifecycleResolver.resolveLocalState +
// real byte-hash drift detection) without instantiating the full Obsidian plugin.
//
// The plugin method delegates to this function with its live deps.
// Tests inject a real LifecycleResolver (with a fake vault) and a fake loader.

import type { ScriptRecord } from "./store";
import type { LifecycleState } from "./lifecycle";
import type { ScriptModule, RequireFn } from "./loader";
import type { LoadedScript } from "./paste/buildPasteChain";

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

/** Dependencies injected into buildEnabledPasteScripts. */
export interface PasteAssemblyDeps {
	/** All script records from the store. */
	records: Record<string, ScriptRecord>;
	/** Resolver that resolveLocalState is called on per script. */
	resolver: {
		resolveLocalState(id: string, record: ScriptRecord): Promise<LifecycleState>;
	};
	/** Absolute path to the scripts directory. */
	scriptsDir: string;
	/** Module loader function (wraps loadScriptModule). */
	loadModule: (absolutePath: string, requireFn: RequireFn) => ScriptModule;
	/** Node require function (or test stub). */
	requireFn: RequireFn;
}

// ---------------------------------------------------------------------------
// Pure assembly function
// ---------------------------------------------------------------------------

/**
 * Build the set of LoadedScript entries for the paste chain.
 *
 * For each script record, calls resolver.resolveLocalState — which performs a
 * BYTE-AUTHORITATIVE drift check (reads actual .cjs bytes and hashes them)
 * without any network fetch. Only scripts whose state is Active are included.
 *
 * Lazy loading: loadModule is only called for Active scripts.
 *
 * This function is pure with respect to its deps — the plugin method
 * _buildEnabledPasteScripts delegates to it with its live deps so that the
 * same logic can be driven by tests with a real LifecycleResolver.
 */
export async function buildEnabledPasteScripts(deps: PasteAssemblyDeps): Promise<LoadedScript[]> {
	const { records, resolver, scriptsDir, loadModule, requireFn } = deps;
	const results: LoadedScript[] = [];

	for (const [id, record] of Object.entries(records)) {
		const state = await resolver.resolveLocalState(id, record);
		if (state.kind !== "Active") {
			continue;
		}

		const absolutePath = `${scriptsDir}/${id}.cjs`;
		let module: ScriptModule | null;
		try {
			module = loadModule(absolutePath, requireFn);
		} catch (err: unknown) {
			console.debug(`[MarkdownMason] paste: failed to load module "${id}":`, err);
			module = null;
		}

		results.push({ id, record: { provenance: record.provenance }, module });
	}

	return results;
}
