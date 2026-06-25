// T2.2  Pinned distribution coordinates (ADR-13)
//
// ADR-13: the catalog is pinned to a specific repo SHA embedded at build time.
// Bump PINNED_REF (and republish) to ship curated script updates to users.
// NEVER point at a moving branch — that would allow unreviewed scripts to land.
//
// These are SOURCE constants. The dev-override / esbuild `define` mechanism
// (ADR-15, Phase 5) replaces them at build time for release builds. Until then,
// maintainers bump these values manually and commit the change.
//
// RAW_BASE: base URL for the curated script repository's raw content.
//           Replace <owner> with the actual GitHub org/user before first release.
// PINNED_REF: 40-character git SHA of the tagged catalog revision to ship.
//             The placeholder SHA below is intentionally all-zeros — set it
//             to a real commit SHA at release time.

/** Base raw-content URL for the markdown-mason-scripts repository. */
export const RAW_BASE =
	"https://raw.githubusercontent.com/<owner>/markdown-mason-scripts";

/**
 * Git SHA pinned at build time (ADR-13).
 * Placeholder: all-zeros SHA — MUST be replaced with a real commit SHA at release.
 */
export const PINNED_REF = "0000000000000000000000000000000000000000";
