// src/core/releaseNotes.ts — spec-009: the "What's new" bullets for the update splash.
//
// __MASON_RELEASE_NOTES__ is an esbuild `define` global (declared in
// src/global.d.ts), injected from the "### Features" and "### Bug Fixes" bullets
// of the current version's CHANGELOG.md section — see readReleaseNotes() in
// esbuild.config.mjs.
//
// The `typeof` guard is required, not defensive style: `declare const` emits a
// bare identifier reference, which throws ReferenceError under any runner that
// does not define it (vitest). src/scripts/catalog/pinnedRef.ts carries the same
// guard for the same reason.

/** Most bullets ever rendered, ACROSS both groups, so a large release cannot overflow the modal. */
const MAX_NOTES = 8;

/** What one release brought, grouped so the splash can label each group. */
export interface ReleaseNotes {
	/** "### Features" bullets — rendered under "What's new". */
	readonly features: readonly string[];
	/** "### Bug Fixes" bullets — rendered under "Fixed". */
	readonly fixes: readonly string[];
}

const EMPTY: ReleaseNotes = { features: [], fixes: [] };

/** True when `v` has the shape the esbuild define is supposed to inject. */
function isNotes(v: unknown): v is { features: string[]; fixes: string[] } {
	if (typeof v !== "object" || v === null) return false;
	const o = v as Record<string, unknown>;
	return Array.isArray(o["features"]) && Array.isArray(o["fixes"]);
}

/**
 * Trim both groups to MAX_NOTES bullets TOTAL.
 *
 * The budget is spent on features FIRST: a release with eight features shows no
 * fixes, which is the right trade — the splash answers "what can I do now"
 * before "what was repaired".
 *
 * Exported so the cap can be tested directly: under vitest the define global is
 * undefined, so RELEASE_NOTES itself can only ever exercise the fallback.
 */
export function capNotes(notes: ReleaseNotes): ReleaseNotes {
	const features = notes.features.slice(0, MAX_NOTES);
	return { features, fixes: notes.fixes.slice(0, MAX_NOTES - features.length) };
}

/**
 * Notes for the version this bundle was built at.
 *
 * Both groups empty for a build with no readable CHANGELOG.md and under the
 * vitest runner.
 */
export const RELEASE_NOTES: ReleaseNotes =
	typeof __MASON_RELEASE_NOTES__ !== "undefined" && isNotes(__MASON_RELEASE_NOTES__)
		? capNotes(__MASON_RELEASE_NOTES__)
		: EMPTY;
