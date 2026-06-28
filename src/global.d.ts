// Global ambient declarations for build-time constants injected by esbuild.
// These are defined via the `define` option in esbuild.config.mjs and must be
// declared here so TypeScript's type checker resolves them without error.
// The actual values are substituted at bundle time; tsc only sees the type.

/**
 * Build-time dead-code elimination flag (ADR-15).
 *
 * Defined as literal "true" in dev builds and "false" in production builds by
 * esbuild. When "false", esbuild tree-shakes any `if (__MASON_DEV__)` branch
 * and all imports reachable only through that branch (e.g. DevDirAdapter).
 *
 * NEVER read this value at runtime — it is replaced by a literal before the
 * bundle is evaluated. References outside an `if (__MASON_DEV__)` guard will
 * not be tree-shaken.
 */
declare const __MASON_DEV__: boolean;

/**
 * Build-time catalog distribution overrides (ADR-15 Phase 5).
 *
 * Injected by esbuild `define` from the MASON_RAW_BASE / MASON_PINNED_REF env
 * vars. Each is the empty string when its env var is unset, in which case
 * src/scripts/catalog/pinnedRef.ts falls back to its committed *_DEFAULT.
 *
 * Declared optional because no runner other than esbuild defines them — the
 * vitest runner leaves them undefined, and pinnedRef.ts guards the read with
 * `typeof`. NEVER read these directly; import RAW_BASE / PINNED_REF instead.
 */
declare const __MASON_RAW_BASE__: string | undefined;
declare const __MASON_PINNED_REF__: string | undefined;
