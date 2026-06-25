# catalog/

In-repo SOURCE and built artifacts for the curated script catalog (PRD F11, ADR-16).

Curated scripts are NOT compiled into the plugin bundle. They ship as standalone
CommonJS envelope `.cjs` files, distributed via the catalog, materialized into the
vault, and enabled through the Scripts settings tab.

## Layout

- `scripts/` — pure-domain `ScriptFunction` source (e.g. `perplexityApp.ts`). May
  import shared helpers from `src/core/*`. MUST NOT import `obsidian`.
- `parsers/` — `CitationParser` source (`canParse` / `parse`) for each script.
- `entries/` — esbuild entry wrappers. Each default-exports the ADR-16 envelope
  `{ run, paste: { canHandle, priority } }`. Priority is the single source of
  truth for paste autodetect order (PRD F10): app=300, web-download=200, web=100.
- `dist/` — COMMITTED build output: one self-contained `<id>.cjs` per entry plus
  `index.json` (a `CatalogIndex`). These are the deterministic inputs the catalog
  tests and the `DevDirAdapter` read.
- `build-catalog.mjs` — the build script.

## Rebuild

```
npm run build:catalog
```

This bundles each entry to `dist/<id>.cjs` (esbuild, cjs, no externals — fully
self-contained pure domain) and regenerates `dist/index.json` with a byte-exact
`sha256:<hex>` checksum over each `.cjs` (same algorithm as
`src/scripts/checksum.ts`). The build is deterministic: rebuilding without source
changes leaves `dist/` byte-identical. Commit the regenerated `dist/` whenever a
catalog script, parser, or entry wrapper changes.

## Pinned ref

`index.json.ref` is a placeholder (`000…0`). The real release SHA — the SHA of the
catalog commit the shipped plugin pins to — is injected at release time
(`PINNED_REF_PLACEHOLDER` in `build-catalog.mjs`).
