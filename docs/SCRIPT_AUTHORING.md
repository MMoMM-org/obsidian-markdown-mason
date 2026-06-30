# Writing a Markdown Mason script

This guide is for authoring your **own** script and importing it into your vault.
The curated catalog scripts (`catalog/scripts/*`) are good *reference reading*, but
they are bundled at build time and import the plugin's internals — an imported
script cannot do that. This page describes the surface that **is** available to you.

A runnable copy-paste starting point lives at
[`docs/examples/example-script.cjs`](./examples/example-script.cjs).

> **Trust:** a script runs with **full plugin privileges** — vault access, Node
> filesystem and network, shell, environment variables. Mason gates every script
> behind a one-time disclosure + a byte checksum, but that only protects you from
> *silent* changes. Only enable scripts you understand. Disabling or removing a
> script revokes it.

---

## 1. The envelope

An imported script is a **CommonJS `.cjs` file** that exports an envelope:

```js
module.exports = {
  run,        // required — the transform
  paste,      // optional — makes it a "Paste and run scripts" handler too
};
```

- `run` is **required** and must be a function. A missing/non-function `run` is a
  load error and the script will not run.
- `paste` is **optional**. With no `paste` block the script is *command-only*
  (still usable via **Mason: Run script…** and any command you create for it).
- A `default` export also works (`module.exports.default = { run, paste }`) for
  authors who compile from TypeScript, but plain `module.exports = { … }` is the
  simplest path — no build step.

---

## 2. What `run` receives — the `ScriptContext`

```ts
run(ctx: ScriptContext): EditPlan | undefined | Promise<EditPlan | undefined>
```

| Field        | Type                                   | Notes |
|--------------|----------------------------------------|-------|
| `ctx.input`  | `string`                               | The text to transform. Clipboard text on paste; the selected text on a command run over a selection; empty string for a command with no selection. |
| `ctx.source` | `"paste" \| "selection" \| "command"`  | How the script was triggered — branch on it if behaviour should differ. |
| `ctx.op`     | `OperationContext`                     | The document context (below). |
| `ctx.mason`  | `MasonApi`                             | The supported helper API (section 5). |
| `ctx.logger` | `{ info, warn, error }`                | Messages to the dev console (`console.debug`/`warn`/`error`). |

`run` may be **async** (return a `Promise`). Returning `undefined` or `[]` means
**no-op** — nothing is applied (on paste, the raw text is pasted as-is).

### `OperationContext` (`ctx.op`)

| Field              | Type                          | Notes |
|--------------------|-------------------------------|-------|
| `doc`              | `string`                      | Full current note text. **All edit offsets are against this.** |
| `cursor`           | `number`                      | Caret offset — the paste insertion point. |
| `selection?`       | `{ from, to }`                | Present when text is selected. |
| `replaceRange?`    | `{ from, to }`                | Set when a **command runs on a non-empty selection**. Write your result here to replace the selection in place (see section 4). |
| `input?`           | `string`                      | The source-scoped payload (mirrors `ctx.input`). |
| `settings`         | `MasonSettings`               | e.g. `settings.resourcesName`. |

---

## 3. The `EditPlan` — how you change the document

You don't mutate the document; you **return a plan** of edits and Mason applies
them atomically (one undo step).

```ts
type Edit = { from: number; to: number; insert: string };
type EditPlan = Edit[];
```

- Offsets are against the **original** `ctx.op.doc`.
- `from === to` → an **insert** at that offset.
- `from < to` → a **replace** of `doc[from..to]`.
- Edits must **not overlap**. Order doesn't matter — Mason applies them
  right-to-left so offsets never drift.

---

## 4. Triggers, and format-in-place

A script can be reached two ways:

**Paste** — via **Mason: Paste and run scripts**. Only scripts with a `paste` block
participate. `paste.canHandle(input)` decides whether your script claims the
clipboard text; `paste.priority` orders competing handlers (higher first). On
paste there is no prior selection, so you insert at `ctx.op.cursor`.

**Command / Run script** — via a command you create for the script, or via
**Mason: Run script…**. Here `ctx.input` is the **selected** text. When the
selection is non-empty, Mason sets `ctx.op.replaceRange` to the selection span so
you can **replace the selection in place** instead of inserting a copy:

```js
const target = ctx.op.replaceRange ?? { from: ctx.op.cursor, to: ctx.op.cursor };
return [{ from: target.from, to: target.to, insert: result }];
```

This one line makes a script do the right thing in **both** modes. (The
`ctx.mason.headings.*` helpers already honour `replaceRange` for you.)

---

## 5. The `ctx.mason` API — the only supported helpers

These are the version-gated public helpers. Each returns an `EditPlan`
(offsets against `ctx.op.doc`) unless noted. They take `ctx.op`, not `ctx`.

```ts
ctx.mason.headings.cascade(ctx.op)                    // re-level input headings under the note context
ctx.mason.headings.normalize(ctx.op)                  // close heading-level gaps across the note
ctx.mason.footnotes.fromCitations(ctx.op, parseResult)// [n] markers → [^n] references
ctx.mason.footnotes.identity(ctx.op, parseResult)     // dedupe by URL + renumber gap-free
ctx.mason.footnotes.move(ctx.op, defs?)               // file footnote defs into ## Resources
ctx.mason.util.normalizeUrl(rawUrl)                   // → string (pure)
```

The `footnotes.*` helpers take a `ParseResult { body, inline, sources }` — you
produce that yourself from `ctx.input` if you want to use them.

---

## 6. What you **cannot** import

The catalog scripts `import { … } from "../../src/core/*"` — that works **only**
because they are bundled by esbuild at catalog-build time. An imported `.cjs`
runs through Node's `require` anchored at your vault's scripts directory and
**cannot resolve `src/core/*`**. Use `ctx.mason.*`, or write plain JavaScript.
(You *can* `require` peer `.cjs` files next to your script and installed
`node_modules`.)

---

## 7. Importing your script

1. Put your `.cjs` anywhere in your vault.
2. **Settings → Markdown Mason → Scripts → Import from vault**, pick the file.
3. The script **id** is derived from the filename (`my-script.cjs` → `my-script`).
4. Review the disclosure (path, size, version, checksum) and **Enable**.
5. Optional: a `// description: …` line anywhere in the file is parsed and shown
   in the disclosure and the Scripts card, so you know what you're approving.

To run it: enable **Paste and run scripts**, or create a command for it in the
**Commands** tab (then bind a hotkey in Obsidian's core Hotkeys), or use
**Mason: Run script…**.

---

## 8. Checklist

- [ ] `module.exports = { run, paste? }` — `run` is a function.
- [ ] `run` returns an `EditPlan` (or `undefined`/`[]` for no-op).
- [ ] Edit offsets are against `ctx.op.doc`; no overlaps.
- [ ] Handle both modes: `ctx.op.replaceRange ?? { from: cursor, to: cursor }`.
- [ ] If it's a paste handler: `paste.canHandle` is cheap + side-effect-free, and
      `paste.priority` is set.
- [ ] No `import` of `src/core/*` — use `ctx.mason.*` or plain JS.
- [ ] Optional `// description:` header.

See [`docs/examples/example-script.cjs`](./examples/example-script.cjs) for a
complete, commented starting point.
