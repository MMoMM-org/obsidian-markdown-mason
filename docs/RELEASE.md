# Release process

## Overview

This plugin has two repositories:

- **Plugin repo** (this one) — TypeScript source, build, tests, settings UI.
- **Catalog repo** (`markdown-mason-scripts`) — curated `.cjs` scripts, versioned
  and reviewed independently.

A plugin release pins a specific catalog commit so users always get a reviewed,
immutable set of scripts. No moving branches, no background polling.

---

## Release order

1. **Publish the catalog first.** Merge reviewed script changes to the catalog
   repo and note the resulting commit SHA (40 hex chars).

2. **Pin that SHA in the plugin.** Update `src/scripts/catalog/pinnedRef.ts`:
   - Set `PINNED_REF` to the 40-char commit SHA from step 1.
   - Set `RAW_BASE` to the actual GitHub raw-content URL
     (`https://raw.githubusercontent.com/<owner>/markdown-mason-scripts`).

3. **Rebuild the catalog dist.** Run `npm run build:catalog` to regenerate
   `catalog/dist/` with the placeholder `ref` field. This is also the build
   step that emits the byte-exact `.cjs` files and their checksums into
   `catalog/dist/index.json`.

   > The `ref` field in `catalog/dist/index.json` stays at the all-zeros
   > placeholder during development. The real SHA lives in `pinnedRef.ts` and
   > is embedded in the plugin bundle at build time, not in the dist artifact.

4. **Build the plugin.** Run `npm run build`. This runs `tsc -noEmit` then
   esbuild in production mode:
   - `__MASON_DEV__` is set to `"false"` — esbuild eliminates the
     `DevDirAdapter` import and all `if (__MASON_DEV__)` branches (ADR-15).
   - The curated script bodies in `catalog/dist/*.cjs` are NOT compiled into
     `main.js`. They are distributed via the catalog and materialized into the
     vault at runtime. The old paste autodetect `parsers/detect.ts` was retired
     in T5.2 (ADR-16) and is not compiled into `main.js`.
   - The resulting `main.js` is minified with no inline sourcemaps.

5. **Run checks.** Confirm all of the following pass before tagging:
   ```
   npm run check:manifest
   npm run build
   npm test
   npm run lint
   ```

6. **Bump the version.** Update `manifest.json` and `versions.json`:
   - `manifest.json`: set `"version"` to the new semver string.
   - `versions.json`: add an entry mapping the new version to `minAppVersion`.

7. **Tag and create a GitHub release.**
   - Create a git tag matching `manifest.json` `"version"` (e.g. `0.2.0`).
   - Attach the three release assets:
     - `main.js`
     - `manifest.json`
     - `styles.css` (if present)
   - Per Obsidian community guidance, attach attestations / provenance records
     for the build artifacts so users and the review bot can verify the
     release was produced from the tagged source.

---

## How the pinned SHA is injected

`src/scripts/catalog/pinnedRef.ts` exports two constants:

```ts
export const RAW_BASE = "https://raw.githubusercontent.com/<owner>/markdown-mason-scripts";
export const PINNED_REF = "0000000000000000000000000000000000000000"; // placeholder
```

At release time, `PINNED_REF` is replaced with the real 40-char catalog
commit SHA and the plugin is rebuilt. The SHA is compiled into the production
bundle as a string literal. The `requestUrlAdapter` constructs catalog fetch
URLs as `${RAW_BASE}/${PINNED_REF}/index.json` for the index and
`${RAW_BASE}/${PINNED_REF}/<entry.path>` for scripts (where `entry.path` is the
script filename, e.g. `perplexity-app.cjs`), pointing at immutable content
published to the vetted repo root, never a moving branch.

The `catalog/build-catalog.mjs` build script has a parallel constant
`PINNED_REF_PLACEHOLDER` that is written into `catalog/dist/index.json`'s
`ref` field during development builds. That field is informational only; the
authoritative SHA lives in `pinnedRef.ts`.

---

## Byte-exact checksum integrity

Every `.cjs` in `catalog/dist/` has a `sha256:<hex>` checksum recorded in
`catalog/dist/index.json`. The checksum is computed with Node's built-in
`crypto.createHash("sha256")` over the raw file bytes — no encoding step, no
newline normalization. The same algorithm is implemented in
`src/scripts/checksum.ts` (`sha256Bytes`).

At runtime, after the plugin fetches a `.cjs` via `requestUrl`, the
Materializer recomputes the checksum over the response bytes and compares it
to the catalog entry. A mismatch enters `Blocked(drift)` and the script is
not run. This guarantees byte-exact integrity: even a one-byte change in the
served file is caught.

---

## Rollback

Rollback is a new plugin release that pins an earlier catalog SHA. No database
migration is needed. Scripts already materialized on the user's device continue
to work until they enable an updated version; `data.json` is unaffected.

---

## Dev loop (MASON_DEV_DIR override)

During development, `__MASON_DEV__` is set to `"true"` by the esbuild config.
This makes `buildCatalogSource()` use `DevDirAdapter` instead of the network
adapter.

To enable the override:

1. Set `MASON_DEV_DIR` to the absolute path of your local catalog working-tree
   directory (the directory that contains `index.json` and the `.cjs` files,
   i.e. the output of `npm run build:catalog` from the catalog repo or this
   repo's own `catalog/dist/`).

   ```
   MASON_DEV_DIR=/path/to/catalog/dist
   ```

   The variable is typically stored in a gitignored env file (e.g.
   `test/mason/.env`) or exported in your shell profile. It is **never**
   read from `data.json` or any `ScriptRecord`.

2. Run `npm run dev` (or the esbuild watch mode). The dev build physically
   includes `DevDirAdapter` and reads the catalog from the local directory.

3. The production build (`npm run build`) defines `__MASON_DEV__` as `"false"`.
   esbuild's dead-code elimination removes `DevDirAdapter` entirely from
   `main.js`. The override cannot be activated in a production build — there
   is no code path to reach it.

The DCE guarantee is verified by `test/bundling/devAdapterDce.test.ts`, which
greps the production bundle for the `__MASON_DEV_DIR_ADAPTER__` marker that
only `devDirAdapter.ts` contains.

---

## Parked / future work

### Parked: user-configurable paste-order overlay (ADR-16)

ADR-16 defines paste-chain priority as a static constant per script
(app=300, web-download=200, web=100). A user-facing overlay to reorder or
disable individual scripts in the paste autodetect chain was considered and
parked.

**Context:** The data model (`ScriptRecord`) and the `buildPasteChain` function
both accept priority values, so the wiring already tolerates per-record
overrides. What is missing is the UI surface (a drag-to-reorder list in the
Commands or Scripts settings tab) and the persistence layer (storing user
overrides in `data.json`).

**When to open:** after the Scripts/Commands settings UI (T4.2, T4.4) is
stable and the catalog has more than the initial three scripts, so the
ordering surface has enough scripts to be worth building.

See also: ADR-16 in `docs/XDD/specs/002-script-distribution-and-settings/solution.md`.
