---
title: "Release notes in the update splash — solution design"
status: implemented
version: "1.0"
---

# Solution Design Document

## Overview

Three small pieces, each on an existing rail:

| Piece | Rail it follows |
|-------|-----------------|
| `scripts/releaseNotes.mjs` — the parser | `scripts/check-manifest.mjs`: a build-adjacent `.mjs` module unit-tested from vitest |
| `esbuild.config.mjs` `define` — the injection | `__MASON_DEV__`, `__MASON_RAW_BASE__`, `__MASON_PINNED_REF__` |
| `src/core/releaseNotes.ts` — the runtime read | `src/scripts/catalog/pinnedRef.ts`'s `typeof`-guarded constant |

Plus a presentational change to `UpdateSplashModal`. Detection and gating in
`main.ts` are untouched.

## The parser — `scripts/releaseNotes.mjs`

```js
export function extractFeatureNotes(changelog, version)   // → string[]
export function cleanBullet(line)                          // → string (exported for tests)
```

Section grammar, as emitted by `@semantic-release/release-notes-generator` with
the `conventionalcommits` preset:

```
## [0.8.1](https://…/compare/0.8.0...0.8.1) (2026-08-31)     ← "##" minor/patch, "#" major

### Bug Fixes

* **scripts:** pass local id to removeCommand … ([#35](…)) ([3bfde5a](…)), closes [#25](…)
```

`extractFeatureNotes`:

1. Split the file on `/^#{1,2} \[?([^\]\s]+)/m` heading matches to get sections
   with their versions.
2. Pick the section whose version equals `version`, or the first section when
   `version` is undefined or unmatched.
3. Inside it, take the lines after `### Features` up to the next `###` or the end.
4. Keep `* `-prefixed lines, run each through `cleanBullet`, drop empties.
5. Any failure at any step returns `[]`.

`cleanBullet` applies, in order:

| Step | Pattern |
|------|---------|
| drop the marker | `/^\*\s+/` |
| drop a `closes …` trailer | `/,?\s*closes\s+(\[[^\]]*\]\([^)]*\)[,\s]*)+$/i` |
| drop trailing link groups | `/\s*\(\[[^\]]*\]\([^)]*\)\)/g` |
| drop bare links, keeping the text | `/\[([^\]]*)\]\([^)]*\)/g` → `$1` |
| drop emphasis | `/\*\*/g` |
| tidy | collapse whitespace, trim, strip a trailing `,` |

## Injection — `esbuild.config.mjs`

```js
const releaseNotes = readReleaseNotes();   // try/catch → []
define: {
  …,
  __MASON_RELEASE_NOTES__: JSON.stringify(releaseNotes),   // valid JSON → valid JS source
}
```

`readReleaseNotes()` reads `CHANGELOG.md` and passes `manifest.version` as the
target version, so a release build pins the notes to the version it is stamping
rather than to whatever happens to sit at the top. Every failure path — file
missing, unreadable, unparsable — returns `[]`; the build never fails over notes.

## Runtime read — `src/core/releaseNotes.ts`

```ts
export const RELEASE_NOTES: readonly string[] =
	typeof __MASON_RELEASE_NOTES__ !== "undefined" && Array.isArray(__MASON_RELEASE_NOTES__)
		? __MASON_RELEASE_NOTES__
		: [];
```

The `typeof` guard is mandatory, not defensive style: `declare const` emits a
bare identifier reference, which throws `ReferenceError` under any runner that
does not define it (vitest). `pinnedRef.ts` carries the same guard for the same
reason. Declared in `src/global.d.ts` as `string[] | undefined`.

A `MAX_NOTES` cap (8) is applied here, not in the parser, so the full list stays
available to anything else that may want it later.

## Presentation — `UpdateSplashModal`

`UpdateSplashOptions` gains `notes: readonly string[]`. `onOpen()` renders, after
the title and before the script summary:

```
h3   "What's new"                       .mason-update-splash-notes-heading
ul                                       .mason-update-splash-notes
  li  <one cleaned bullet>
```

Skipped entirely when `notes` is empty — the zero-notes dialog stays exactly what
it is today. `createEl` only; `styles.css` gains list styling beside the existing
`.mason-update-splash-*` rules.

`main.ts` passes `notes: RELEASE_NOTES` at the single construction site.

## Design decisions (ADRs)

- **ADR-43 — build-time extraction, not a runtime fetch.** A `requestUrl` to the
  GitHub releases API would add a network dependency, an offline failure mode and
  a privacy surface (a callout on every update) to a dialog that must be instant
  and silent. The changelog is already on disk when the bundle is built.
- **ADR-44 — generated changelog, not a hand-maintained notes file.** semantic-release
  computes the version *after* the commit that would have to carry the notes, so a
  hand-written file is always written for an unknown version and drifts silently.
  Deriving from `CHANGELOG.md` cannot drift: the notes and the version are produced
  by the same release run.
- **ADR-45 — features only.** The splash answers "what can I do now". Bug fixes in
  a modal interrupt read as a defect list, and a patch-only release should not
  produce a dialog with nothing to celebrate — it produces no notes and falls back
  to the old content.
- **ADR-46 — the parser lives in `scripts/`, not `src/`.** It runs at build time
  under node, never in the plugin. Putting it in `src/` would bundle dead code into
  every user's `main.js`. `scripts/check-manifest.mjs` set this precedent, tests
  included.
- **ADR-47 — mechanical cleanup only.** `cleanBullet` removes link syntax, SHAs and
  emphasis markers — noise that is provably not prose. It does not reword, strip
  scopes or drop "(spec NNN)" references: guessing at meaning would mangle real
  feature text, and the honest fix for a bad bullet is a better commit subject.

## Testing (planned)

`test/releaseNotes.test.ts` — against the repository's own `CHANGELOG.md` shape:

- a `##` minor section, a `#` major section, and version-targeted selection;
- a section with only `### Bug Fixes` → `[]`;
- a missing version, an empty file, malformed input → `[]`, never a throw;
- `cleanBullet` over the real 0.8.0 and 0.8.1 lines (link groups, `closes`
  trailer, `**scope:**`).

`test/ui/updateSplashModal.test.ts` — extend the existing suite:

- notes render as list items under a "What's new" heading, above the summary;
- empty notes render no heading and no list;
- the cap limits how many items appear.

`test/core/releaseNotes.test.ts` — `RELEASE_NOTES` is `[]` under vitest (no
define) and importing it does not throw.
