// src/core/releaseNotes.ts — spec-009: the "What's new" bullets for the update splash.
//
// __MASON_RELEASE_NOTES__ is an esbuild `define` global (declared in
// src/global.d.ts), injected from the "### Features" bullets of the current
// version's CHANGELOG.md section — see readReleaseNotes() in esbuild.config.mjs.
//
// The `typeof` guard is required, not defensive style: `declare const` emits a
// bare identifier reference, which throws ReferenceError under any runner that
// does not define it (vitest). src/scripts/catalog/pinnedRef.ts carries the same
// guard for the same reason.

/** Most bullets ever rendered, so a large release cannot overflow the modal. */
const MAX_NOTES = 8;

/**
 * Feature bullets for the version this bundle was built at.
 *
 * Empty for a release with no features, for a build with no readable
 * CHANGELOG.md, and under the vitest runner.
 */
export const RELEASE_NOTES: readonly string[] =
	typeof __MASON_RELEASE_NOTES__ !== "undefined" && Array.isArray(__MASON_RELEASE_NOTES__)
		? __MASON_RELEASE_NOTES__.slice(0, MAX_NOTES)
		: [];
