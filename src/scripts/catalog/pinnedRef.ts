// T2.2  Pinned distribution coordinates (ADR-13, ADR-15 Phase 5)
//
// ADR-13: the catalog is pinned to a specific repo SHA embedded at build time.
// NEVER point at a moving branch — the SHA baked into a given bundle is fixed
// and immutable, so users always fetch a known, reviewed catalog revision.
//
// BUILD-TIME OVERRIDE (ADR-15 Phase 5)
// ------------------------------------
// RAW_BASE and PINNED_REF resolve from esbuild `define` globals injected from
// the MASON_RAW_BASE / MASON_PINNED_REF env vars (see esbuild.config.mjs). The
// release workflow resolves the catalog repo's current SHA and exports
// MASON_PINNED_REF, so a plugin release auto-pins to it — no manual edit here.
//
// The committed *_DEFAULT values below are the fallback used whenever the env
// override is absent: local builds, `npm run build` without the var set, and
// the vitest runner (which defines no globals — the `typeof` guard makes the
// module-level read safe there). They MUST stay a known-good owner + SHA, never
// a placeholder, so a build with no override still ships a working catalog pin.
//
// To move the pin by hand (e.g. without the workflow): republish the catalog
// repo and update PINNED_REF_DEFAULT to the new commit SHA.

// __MASON_RAW_BASE__ / __MASON_PINNED_REF__ are esbuild `define` globals
// (declared in src/global.d.ts): a string when the env override is set, else ""
// / undefined. The typeof guards below keep the module-level read safe under
// runners that define no globals (vitest) — they fall through to the defaults.

/** Fallback raw-content URL for the markdown-mason-scripts repository. */
const RAW_BASE_DEFAULT =
	"https://raw.githubusercontent.com/MMoMM-org/markdown-mason-scripts";

/** Fallback catalog commit SHA (MMoMM-org/markdown-mason-scripts). */
const PINNED_REF_DEFAULT = "452468d2f88755e037639ecc4c0b037bc5311663";

/** Base raw-content URL — build-time override or committed default. */
export const RAW_BASE =
	typeof __MASON_RAW_BASE__ === "string" && __MASON_RAW_BASE__.length > 0
		? __MASON_RAW_BASE__
		: RAW_BASE_DEFAULT;

/**
 * Git SHA pinned at build time (ADR-13) — build-time override or committed
 * default. Points at the reviewed catalog commit in the scripts repository.
 */
export const PINNED_REF =
	typeof __MASON_PINNED_REF__ === "string" && __MASON_PINNED_REF__.length > 0
		? __MASON_PINNED_REF__
		: PINNED_REF_DEFAULT;
