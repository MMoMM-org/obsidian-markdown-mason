# Commands Reference

Markdown Mason contributes two built-in commands to the Obsidian command palette, plus one
optional command per script you choose to expose. In the palette they all appear under the
plugin name — search **Markdown Mason** (or just "Mason") to find them. None ship with a
default hotkey; assign your own under Settings → Hotkeys.

## Commands

| Command | Palette label | What it does | Preconditions |
|---|---|---|---|
| **Paste and format** | `Markdown Mason: Paste and format` | Runs your enabled paste-capable scripts on the clipboard and inserts the result at the cursor; falls back to a plain paste on error or if nothing matches. | An editor is focused. Produces *formatted* output only when at least one paste-capable script is enabled and Active. |
| **Run script…** | `Markdown Mason: Run script…` | Opens a picker of all Active scripts; choose one to run on the current selection (format-in-place), or the whole note when nothing is selected. | An editor is focused, and at least one script is Active (the picker lists only Active scripts). |
| **Per-script command** | `Markdown Mason: <command name>` | Runs that one script directly, without the picker. | You enabled it in the Commands settings tab. Runs only while the script is Active. |

## Notes

- **Per-script commands are opt-in.** In Settings → Markdown Mason → **Commands**, name the
  command (the script's id is used if you leave it blank), then toggle it on. Toggling off
  removes the command; renaming re-registers it so the palette and Hotkeys labels update
  immediately.
- **No default hotkeys.** Assign keys for any command under Settings → Hotkeys (search
  "Mason") — Markdown Mason follows Obsidian's guidance against shipping default bindings.
- **State is re-checked at run time.** A per-script command whose script is no longer Active
  (disabled, blocked, materializing, or has a pending update) won't run; instead Mason shows
  a Notice explaining why — e.g. *`Mason: "<name>" is blocked (checksum-mismatch)`* or
  *`…has an update — update it in settings → scripts to run it`*.
- See [Usage](usage.md) for workflows and [Troubleshooting](troubleshooting.md) if a command
  is missing or a script won't run.
