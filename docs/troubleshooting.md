# Troubleshooting

Most problems fall into two buckets: the plugin or a command isn't showing up, or a script
won't run. Work from the symptom below. Mason is built to **fail safe** — on any script error
it leaves your text untouched — so a "nothing happened" result is almost always a script
that's off, blocked, or didn't match your text, not lost data.

## Common issues

### Markdown Mason doesn't appear in the plugin list

- **On mobile:** Mason is desktop-only and won't appear on Obsidian mobile — use a desktop
  vault.
- **On desktop:** enable Community plugins (Settings → Community plugins, Restricted mode
  off) and make sure you're on Obsidian 1.6.6 or newer. After a
  [manual install](installation.md#install-manually), click the
  refresh icon next to *Installed plugins*, or restart Obsidian.

### "Mason: …" commands aren't in the command palette

- Confirm the plugin is enabled (Settings → Community plugins → Installed plugins, toggled
  on).
- Only **Markdown Mason: Paste and format** and **Markdown Mason: Run script…** are always present. A script's
  own command appears only after you toggle *Create command* for it in the **Commands**
  settings tab.

### Paste and format just inserts the raw text, unchanged

This is the safe fallback — it happens when no enabled script transformed the clipboard:

- Make sure a paste-capable script is **enabled and Active** in the Scripts tab. With no
  active script, Mason pastes normally.
- The script may not match how you copied the text. For Perplexity, enable the script for
  your copy surface (app / web / web download — see [Usage](usage.md)).
- If a script errors or times out, Mason deliberately falls back to a plain paste rather than
  a partial edit. Turn on Debug logging (below) to see why.

### "Mason: clipboard is empty — nothing to paste."

The clipboard had no text after trimming. Copy something first. **"Mason: clipboard
unavailable — …"** means the clipboard API was blocked (it needs a secure context) — restart
Obsidian and try again.

### A script shows as Blocked and won't run

The Scripts tab marks a script **Blocked** when it can't be trusted or found:

- **Checksum mismatch / drift** — the file on disk no longer matches its approved version.
  Mason hard-blocks rather than run changed code. Use the ⋯ menu to re-review (re-consent to
  the new version), or remove and reinstall it.
- **Source missing** — the script's source (catalog entry or vault file) is gone. Reinstall
  from Browse official, or re-import from your vault.
- **Offline** — catalog actions (Browse official, update, view source) need network access;
  you'll see *"Mason: could not reach the catalog."* Retry when you're online.

### The consent/disclosure prompt keeps reappearing

Consent is tied to a script's exact version and checksum. If the file changes — an update, or
you edited it — Mason re-prompts so you approve the new code. This is expected after updates
or edits.

### "Mason: a script named '…' already exists"

You imported a script whose id collides with one already installed. Rename the file or remove
the existing script first, then import again.

## Debug information

- **Enable Debug logging:** Settings → Markdown Mason → **Advanced → Debug logging** (takes
  effect immediately).
- **Open the developer console:** Ctrl+Shift+I (Windows/Linux) or Cmd+Option+I (macOS), then
  the Console tab. Mason's traces are prefixed `[MarkdownMason]`.
- Genuine warnings and errors always appear in the console even with Debug logging off.
- **Before asking for help, gather:** your Obsidian version and OS, the Markdown Mason
  version, the script's id and its state in the Scripts tab, the exact text of any Notice,
  and the console output with Debug logging on.

## Getting help

File an issue at <https://github.com/MMoMM-org/obsidian-markdown-mason/issues>. Include the
details from *Debug information* above so the problem can be reproduced. Turn Debug logging
back off once you've captured what you need.
