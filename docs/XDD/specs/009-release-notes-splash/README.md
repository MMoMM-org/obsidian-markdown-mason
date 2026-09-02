# Specification: 009-release-notes-splash

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-09-02 |
| **Current Phase** | Implemented (unmerged; manual Obsidian smoke pending) |
| **Last Updated** | 2026-09-02 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | 6 requirements; features-only, build-time extraction |
| solution.md | completed | `scripts/releaseNotes.mjs` parser + esbuild `define` + `RELEASE_NOTES` + splash rendering |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-09-02 | Put real release notes in the update splash | With zero waiting script updates — the normal case — the whole dialog reads "updated to vX" plus "you're all set": a modal interrupt carrying no information about the update, behind a setting literally called *Show update notes*. |
| 2026-09-02 | Source them from `CHANGELOG.md` at build time | User decision. `@semantic-release/changelog` runs BEFORE the `exec` step that builds, so the bundle already sees the finished entry for the version it is stamping. No network, no second file to maintain, and the notes cannot drift from the version. |
| 2026-09-02 | Features only, no bug fixes | User decision. The splash answers "what can I do now", not "what was repaired"; a patch-only release produces no notes and falls back to today's dialog (ADR-45). |
| 2026-09-02 | Ship together with spec 008 in one PR | User decision. The splash that renders the notes is in the same bundle as the notes, so the first release carrying the feature already shows its own notes — including the spec-008 list paste. Shipping them apart would waste a release on an empty "What's new". |
| 2026-09-02 | Parser in `scripts/`, not `src/` | It runs under node at build time and would otherwise be dead code bundled into every user's `main.js`. `scripts/check-manifest.mjs` + `test/check-manifest.test.ts` set the precedent (ADR-46). |
| 2026-09-02 | Mechanical cleanup only | `cleanBullet` strips link syntax, SHAs and `**` — noise that is provably not prose. It does not reword or drop scopes: guessing at meaning mangles real feature text, and a bad bullet is fixed by a better commit subject (ADR-47). |
| 2026-09-02 | Implementation complete | `scripts/releaseNotes.mjs` (`extractFeatureNotes` / `cleanBullet`) + `readReleaseNotes()` and the `__MASON_RELEASE_NOTES__` define in `esbuild.config.mjs` + `src/core/releaseNotes.ts` (`RELEASE_NOTES`, cap 8) + `UpdateSplashOptions.notes` and the "What's new" list + `styles.css` rules + the eslint global. 11 parser tests, 3 splash tests, 2 constant tests; full suite 1723 green, lint and typecheck clean. Verified end to end in the dev bundle: esbuild hoists the array define to `define_MASON_RELEASE_NOTES_default`, currently `[]` because 0.8.1 is a bug-fix-only release — exactly the designed fallback. |

## Context

Extends `src/ui/updateSplashModal.ts` (spec 002's post-update splash) with the
content it was always missing. Rides three existing rails: the `scripts/*.mjs` +
vitest pattern of `check-manifest.mjs`, the esbuild `define` pattern of
`__MASON_DEV__` / `__MASON_PINNED_REF__`, and the `typeof`-guarded build-constant
read of `src/scripts/catalog/pinnedRef.ts`.

Ships in the same PR and release as [spec 008](../008-paste-list-context/README.md).

---
*This file is managed by the xdd-meta skill.*
