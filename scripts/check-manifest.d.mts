/**
 * Type declaration for scripts/check-manifest.mjs.
 * Provides editor/tsserver type resolution without modifying the runnable ESM script.
 */

/**
 * Pure validation function — no I/O, no side effects.
 * @param manifest Parsed manifest object to validate.
 * @returns List of failure messages; empty array means compliant.
 */
export declare function checkManifest(manifest: Record<string, unknown>): string[];
