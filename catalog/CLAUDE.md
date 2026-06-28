# catalog/ — script authoring contract

This directory holds the **source** of curated Markdown Mason scripts. A script
transforms pasted or selected Markdown into the target note's structure. This
file is the contract you need to write one **without reading the plugin source**.
For layout + the build/checksum flow, see [README.md](./README.md).

> Accuracy note: every signature below is mirrored from `src/core/registry.ts`,
> `src/core/types.ts`, and `src/scripts/context.ts`. Those files are canonical —
> if this doc and the code disagree, the code wins (and fix this doc).

## The one rule: scripts COMPOSE built-ins; nothing auto-runs

When the user invokes **Paste and format**, Mason picks **exactly one** script
from the ordered chain (`chain.find(h => h.canHandle(rawText))`, `src/main.ts`)
and runs it. **Built-in transforms never run automatically.** The selected
script does all the work by explicitly calling the `mason.*` API it wants.

Consequences for you as an author:
- **Use a built-in** → call it: `ctx.mason.headings.cascade(ctx.op)`.
- **"Suppress" a built-in** → just don't call it. Suppression is the default;
  there is no opt-out flag because there is nothing auto-running to opt out of.
- Your script's returned `EditPlan` is the whole result. There is no pre/post
  built-in stage wrapping it.

If a "clean every paste by default" behaviour is ever wanted, it ships as a
**curated catch-all script** (low `priority`, `canHandle: () => true`) that other
scripts override by provenance/priority — not as an auto-injected core stage.

## What your script exports (ADR-16 envelope)

```js
module.exports = {
  // Required. The transform. Receives ONE ScriptContext, returns an EditPlan.
  run: async (ctx) => { /* … */ return plan; },

  // Optional. Present → script participates in "Paste and format".
  paste: {
    canHandle: (input) => boolean,  // does this script recognize the clipboard text?
    priority: 300,                  // higher = tried first within same provenance
  },
};
```

`run` may be sync or async. Return `undefined` or `[]` to mean **"nothing to
do"** (no-op; Mason does NOT fall back to a raw paste). **Throwing** (or a
rejected promise) makes Mason discard the result and do a plain paste instead.

## What `run` receives: `ScriptContext`

```ts
interface ScriptContext {
  input: string;                              // text to transform (clipboard or selection)
  source: "paste" | "selection" | "command"; // how it was triggered
  op: OperationContext;                       // full doc state (pass this to mason.* ops)
  mason: MasonApi;                            // the built-in API (see below)
  logger: { info; warn; error };             // info() is gated by the Debug-logging setting
}

interface OperationContext {                  // === ctx.op ===
  doc: string;                                // full current document
  cursor: number;                             // insertion point (paste)
  selection?: { from: number; to: number };
  replaceRange?: { from: number; to: number };// set → cascade replaces this range (format-in-place)
  input?: string;
  settings: MasonSettings;                    // resourcesName, numericOnly, debugLogging, …
}
```

`logger.info(...)` only prints when the user enables **Debug logging** (Settings
→ Advanced). `warn`/`error` always print. Use `info` for traces.

## The built-in API: `ctx.mason.*`

All offsets in any returned `EditPlan` are against the **original `ctx.op.doc`**
(an `Edit` is `{ from, to, insert }`). Built-ins read settings off `ctx.op.settings`.

| Call | Does | When to use | Reads |
|---|---|---|---|
| `mason.headings.cascade(op)` | Shifts the pasted block's headings so its top heading sits one level below the heading **above the cursor**; clamps to 1–6. Empty plan if no heading above cursor or no headings in input. | Place a pasted section under the current context heading. | `op.doc`, `op.cursor`, `op.input`, `op.replaceRange?` |
| `mason.headings.normalize(op)` | Rewrites headings across the **whole doc** so no level gap exceeds 1 (e.g. `#` then `###` → `##`). | Tidy an existing note's heading ladder. | `op.doc` |
| `mason.footnotes.fromCitations(op, parseResult)` | Converts bare `[n]` citation markers to `[^n]` footnote refs in `parseResult.body`. Pass `allowedIds` (core `fromCitations`) to skip ids with no source so you never create dangling `[^n]`. | Paste flow: turn cited prose into footnotes. | `parseResult` |
| `mason.footnotes.identity(op, parseResult)` | Renumbers numeric footnotes gap-free in **first-reference order** and dedups by normalized URL. Use `entry.identityFull(op, pr)` to also get `newRefs` to thread into `move`. Alpha footnotes (`[^A]`) untouched. | Paste flow: assign collision-free ids past the note's existing ones. | `op.doc`, `op.settings.resourcesName` |
| `mason.footnotes.move(op, defs?)` | Moves numeric footnote **definitions** into the `## Resources` section (creates it at note end if absent and `defs` is non-empty). Alpha defs untouched. | File definitions under Resources. | `op.settings.resourcesName` |
| `mason.util.normalizeUrl(raw)` → `string` | Canonical URL key (lowercases scheme/host, strips trailing slash, sorts query, drops fragment). Pure string→string. | Build your own URL dedup keys. | — |

Note the two call shapes: **whole-note** commands call `entry.run(op)` (operate
on `op.doc`); **paste-flow** ops (`fromCitations`/`identity`) take a
`ParseResult` you produce from `ctx.input` via your parser. See
`catalog/scripts/perplexityApp.ts` for the canonical paste composition.

## Multi-stage transforms: thread through a string

Because every plan's offsets are vs the **original**, you can't naively
concatenate plans from sequential stages. Apply each stage to a working string,
then emit the final plan against the original:

```js
import { applyToString } from "../../src/core/applyToString";
const body1 = applyToString(pr.body, fromCitationsEdits);   // stage 1 result
const body2 = applyToString(body1, renameEdits);            // stage 2 result
// …compute the final insert against ctx.op.doc from body2
```

## Paste chain ordering (which script wins)

`buildPasteChain` (`src/scripts/paste/buildPasteChain.ts`) sorts candidates by:
1. **provenance** — curated before imported (a curated catch-all can't be hijacked);
2. **priority DESC** — higher first;
3. **id ASC** — deterministic tiebreak.

The first whose `canHandle(input)` returns `true` runs. Pick a `priority` that
slots your script correctly relative to siblings (Perplexity: app 300 ·
web-download 200 · web 100).

## Adding things

- **New script:** add `scripts/<name>.ts` (+ `parsers/` if it parses a source) and
  an `entries/<name>.ts` exporting the envelope, then `npm run build:catalog`
  (regenerates `dist/<name>.cjs` + `dist/index.json` with checksums).
- **New built-in op:** it belongs in `src/core/` as a pure `(ctx) => EditPlan`,
  registered once in `src/core/registry.ts` (which makes it both a command AND a
  `mason.*` method) — then document it in the table above.
