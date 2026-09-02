---
title: "Release notes in the update splash — show what the update actually brought"
status: implemented
version: "1.0"
---

# Product Requirements Document

## Problem

`UpdateSplashModal` fires once per plugin version bump and says one thing: how
many curated scripts now have updates waiting. When that count is zero — which
is the normal case, because script versions only move when the catalog pin moves
— the entire dialog reads:

```
Markdown Mason — updated to v0.9.0

No script updates right now — you're all set.

[ ] Show update notes on new versions            [ Close ]
```

A modal interrupt that carries **no information about the update**. The user is
told a version number and nothing about what changed in it. The setting is even
called *Show update **notes*** — and there are no notes.

Meanwhile the information exists and is already generated: `@semantic-release/changelog`
writes `CHANGELOG.md` on every release, and it does so **before** the
`@semantic-release/exec` step that runs `node version-bump.mjs && npm run build`.
The build already sees the finished entry for the version it is building.

## Users & Journey

A user updates Markdown Mason through Obsidian's community-plugin updater. On the
next load the splash appears. They want the same thing every release dialog
exists for: *what can I do now that I could not do before?* Today they must leave
Obsidian and find the GitHub release to answer that.

## Key insight (makes it feasible)

The build pipeline already has everything, at exactly the right moment:

- `CHANGELOG.md` carries the new version's entry **before** the release build runs
  (`.releaserc` plugin order: `changelog` → `npm` → `exec(version-bump && build)`).
- `esbuild.config.mjs` already injects build-time constants through `define`
  (`__MASON_DEV__`, `__MASON_RAW_BASE__`, `__MASON_PINNED_REF__`), with the
  `typeof`-guard fallback pattern established in `pinnedRef.ts`.
- The splash that renders the notes ships **in the same bundle** as the notes, so
  the very first release carrying this feature already displays its own notes.
  There is no version where the feature exists but has nothing to show.

No network call, no runtime fetch, no maintained second changelog.

## Must-have

### F1 — Extract the release's features at build time

A pure function `extractFeatureNotes(changelog: string, version?: string): string[]`
in `scripts/releaseNotes.mjs` (the established `scripts/*.mjs` + vitest pattern,
as used by `check-manifest.mjs`).

- Locate the changelog section for `version`, or the topmost section when no
  version is given. Section headings are `#` **or** `##` followed by
  `[<version>](<compare-url>) (<date>)` — semantic-release uses `#` for a major
  and `##` for minor/patch.
- Within that section take **only** the `### Features` subsection's `*` bullets.
  `### Bug Fixes` and every other subsection are ignored (F2).
- Return `[]` when the section, the subsection, or the file is missing. Never throw.

### F2 — Features only

The splash answers "what can I do now", not "what was repaired". A patch release
with no `### Features` therefore yields no notes and the splash falls back to
exactly today's content.

### F3 — Readable bullets, not commit lines

Each bullet is cleaned for a human reader:

- strip the leading `* `;
- remove Markdown link groups — the trailing `([#35](url))` / `([3bfde5a](url))`
  and any `closes [#25](url)` trailer;
- remove `**` emphasis markers, keeping the conventional-commit scope as plain
  text (`**cleanup:** box-drawing …` → `cleanup: box-drawing …`);
- collapse whitespace runs and trim.

Nothing else is rewritten. Over-cleaning risks mangling real feature text, so the
transformation stays to demonstrably mechanical noise.

### F4 — Injected as a build-time constant

`esbuild.config.mjs` reads `CHANGELOG.md`, calls `extractFeatureNotes`, and
injects the result as `__MASON_RELEASE_NOTES__` via `define`. A missing or
unreadable `CHANGELOG.md` yields `[]` and never fails the build.

`src/core/releaseNotes.ts` exposes `RELEASE_NOTES: readonly string[]`, resolving
the global behind a `typeof` guard so the vitest runner (which defines no
globals) reads `[]` instead of throwing — the same contract `pinnedRef.ts` uses.

### F5 — Render them first

`UpdateSplashModal` takes `notes: readonly string[]`. When non-empty it renders a
"What's new" heading and one list item per note, **above** the existing script
summary. When empty the modal is byte-identical to today's.

All UI text stays sentence case; the DOM is built exclusively with
`createEl` / `createDiv` / `setText` — never `innerHTML` (the notes come from the
repository's own changelog, but the no-HTML rule is unconditional).

### F6 — No change to when the splash fires

Detection, `lastSeenVersion` advancement, the fresh-install silence and the
`showUpdateSplash` gate are untouched. This spec only changes what the dialog
*contains*.

## Acceptance criteria

```
Given a release whose changelog section has a "### Features" subsection
 When the user updates and the splash opens
 Then a "What's new" list shows one entry per feature bullet
  And each entry carries no Markdown link, SHA or ** marker

Given a patch release with only "### Bug Fixes"
 When the splash opens
 Then no "What's new" section is rendered
  And the dialog matches the pre-009 build exactly

Given CHANGELOG.md is missing at build time
 When the bundle is built
 Then the build succeeds and RELEASE_NOTES is []

Given the vitest runner (no esbuild define)
 When src/core/releaseNotes.ts is imported
 Then RELEASE_NOTES is [] and nothing throws
```

## MoSCoW

- **Must:** F1–F6.
- **Should:** a cap on the number of rendered bullets so a large release cannot
  produce a modal taller than the window.
- **Could:** a "Full changelog" link to the GitHub release; rendering
  `### Bug Fixes` in a secondary group. *(Explicitly deferred — the splash
  answers "what is new", and a patch-only release should stay quiet.)*
- **Won't:** a hand-maintained notes file; a runtime fetch of the GitHub release.

## Known limitations (accepted)

- Note quality equals commit-subject quality. A vague `feat:` subject produces a
  vague bullet; the fix is writing better commit subjects, not a second
  changelog to maintain.
- A dev build shows the **last released** version's features, because that is
  what `CHANGELOG.md` holds outside a release run. Harmless, and it makes the
  feature testable in the dev vault.
