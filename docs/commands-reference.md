# Commands Reference

Markdown Mason contributes **nine built-in commands** to the Obsidian command palette, plus
one optional command per script you choose to expose. In the palette they all appear under
the plugin name — search **Markdown Mason** (or just "Mason") to find them. None ship with a
default hotkey; assign your own under Settings → Hotkeys.

![Obsidian command palette filtered to "mason", listing the Markdown Mason commands](../assets/mason-commands.png)

## Built-in commands

All nine appear in the palette as `Markdown Mason: <name>` and require a focused editor.
Each shows a descriptive Notice when there is nothing to do (e.g. *No footnotes found to
tidy*, *Select text to cascade headings*).

| Command | What it does | Scope |
|---|---|---|
| **Tidy footnotes** | Convert citations, renumber and de-duplicate, then file definitions under the Resources heading — fused into a single undo step. | Whole note |
| **Format selection** | Cascade and normalize the selected headings, then tidy footnotes across the note — one undo step. | Selection (headings) + whole note (footnotes) |
| **Cascade headings** | Re-level the selected headings relative to the heading above the selection (the paste/selection operation). | Selection |
| **Normalize headings** | Close gaps in heading levels so they step by one (e.g. `H1 → H3` becomes `H1 → H2`). | Whole note |
| **Convert citations to footnotes** | Turn bare `[n]` citation markers into `[^n]` footnote references. | Whole note |
| **Resolve footnote identity** | Renumber numeric footnotes gap-free in first-reference order and de-duplicate by URL. | Whole note |
| **Move footnotes to resources** | Move numeric footnote definitions under the Resources heading — created at your configured level if absent, or an existing section reused at whatever level it has (see [Configuration](configuration.md)). | Whole note |
| **Paste and format** | Run your enabled paste-capable scripts on the clipboard and insert the result at the cursor; plain-paste fallback on error or if nothing matches. | Clipboard → cursor |
| **Run script…** | Open a picker of all Active scripts; run one on the current selection (format-in-place), or the whole note when nothing is selected. | Selection or whole note |

> `Normalize url` is an API-only operation (used by scripts) and is intentionally **not**
> registered as a command.

## Per-script commands

Beyond the built-ins, you can promote any script to its own command — `Markdown Mason:
<command name>` — which runs that one script directly, without the picker. It runs only while
the script is Active.

These are **opt-in**. In Settings → Markdown Mason → **Commands**, name the command (the
script's id is used if you leave it blank), then toggle it on. Toggling off removes the
command; renaming re-registers it so the palette and Hotkeys labels update immediately.

![Markdown Mason Commands settings tab: a name field and toggle for each script to create a per-script command](../assets/settings-commands.png)

## Notes

- **No default hotkeys.** Assign keys for any command under Settings → Hotkeys (search
  "Mason") — Markdown Mason follows Obsidian's guidance against shipping default bindings.
- **State is re-checked at run time.** A per-script command whose script is no longer Active
  (disabled, blocked, materializing, or has a pending update) won't run; instead Mason shows
  a Notice explaining why — e.g. *`Mason: "<name>" is blocked (checksum-mismatch)`* or
  *`…has an update — update it in settings → scripts to run it`*.
- See [Usage](usage.md) for workflows and [Troubleshooting](troubleshooting.md) if a command
  is missing or a script won't run.
