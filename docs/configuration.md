# Configuration

Markdown Mason is configured entirely from its settings page inside Obsidian — there is no
separate config file to edit by hand. Changes you make to a control are saved immediately,
and most take effect right away.

## Where settings live

Open **Settings → Community plugins → Markdown Mason** (or click the options/gear icon next
to the plugin). Everything sits on one main page, with two sub-pages for scripts:

| On the main page | What it holds |
|---|---|
| Four everyday settings (no heading) | *Resources section heading*, *Show update notes*, *Numeric-only footnotes*, *Fit paste to list context* |
| **Scripts** (opens a page) | Your script library — see [The Scripts page](#the-scripts-page) |
| **Commands** (opens a page) | One command per enabled script — see [The Commands page](#the-commands-page) |
| **Format selection** | *Which steps run*, a short reminder of which command runs which steps |
| **Cleanup**, **Lists**, **Headings**, **Footnotes** | The step toggles — see [Format selection steps](#format-selection-steps) |
| **Advanced** | *Debug logging*, and *Documentation*, which shows the plugin version and opens the project page |

Mason uses Obsidian's own settings layout, so its settings also show up in Obsidian's
settings search — see [Finding a setting with search](#finding-a-setting-with-search).

Your choices are stored in the plugin's `data.json` file
(`<vault>/.obsidian/plugins/markdown-mason/data.json`), alongside the script library. You
should not normally need to edit this file directly — use the settings page instead.

## Finding a setting with search

Type in the search box at the top of Obsidian's settings window. Mason's settings match on
their name and description, and on a few everyday words that appear in neither:

| Search for | Finds |
|---|---|
| `OCR`, `TextSniper` | *Reflow wrapped text* |
| `paste`, `paste and format` | *Fit paste to list context* and *Which steps run* |
| `footnotes` | The footnote settings, including *Resolve footnote identity* |
| `hotkey`, `command palette` | *Script commands* on the Commands page |
| `import` | *Import from vault* on the Scripts page |
| `catalog`, `official scripts` | *Browse official* on the Scripts page |
| `console`, `debug` | *Debug logging* |
| `help`, `version` | *Documentation* |

Your scripts are searchable too: by name, by description, and by script id.

## The Scripts page

**Scripts** lists every script you have installed, one row each. A row shows the script's
name, whether it is *Official* or *Imported*, its state (for example *Active*, *Disabled*,
*Update available* or *Blocked*) and its version. On the right are a toggle to enable or
disable the script and a **⋯** menu with the actions that apply to it: *View source*,
*Update to v…*, *Re-review consent*, *Retry fetch* and *Remove*.

A *Blocked* script says why below its description and offers one button to recover —
*Re-import* when its vault file is missing, *Retry fetch* otherwise. See
[Troubleshooting](troubleshooting.md#a-script-shows-as-blocked-and-wont-run).

To add scripts, use the two buttons in the list header: **Import from vault** and **Browse
official** (the store icon). Both are also rows at the bottom of the page, which is what
lets search find them.

### Update indicator

When newer versions of your official scripts are waiting, the **Scripts** entry on the main
page shows how many — *1 update available*, *2 updates available* — with a warning marker.
Open the page and choose *Update to v…* in a script's **⋯** menu. With *Show update notes*
on, the notes shown after a plugin update also mention waiting script updates, and their
**Open scripts settings** button opens the Scripts page directly.

See [Usage](usage.md) for the script lifecycle.

## The Commands page

**Commands** turns scripts into commands of their own. Below the *Script commands* intro
there is one row per **enabled** script: type a name for the command (the script id is used
if you leave it blank), then switch the toggle on. The command appears in the command
palette right away; bind keys to it under **Settings → Hotkeys**. Switching the toggle off
removes the command.

With no enabled script the page shows *No enabled scripts* — enable one on the Scripts page
first. See the [Commands Reference](commands-reference.md#per-script-commands).

## Format selection steps

The **Cleanup**, **Lists**, **Headings** and **Footnotes** groups hold one toggle per step
of the *Format selection* command: 13 steps in all. The *Paste and format* command runs 9
of them on the text you paste; the other 4 steps are *Format selection* only.

| Group | Step | Default | Runs in *Paste and format* |
|---|---|---|---|
| Cleanup | Convert box-drawing table | on | yes |
| Cleanup | Reflow wrapped text | **off** | yes |
| Cleanup | Dewrap paragraphs | on | yes |
| Cleanup | Dehyphenate words | on | yes |
| Cleanup | Decompose ligatures and punctuation | on | yes |
| Cleanup | Tidy whitespace | on | yes |
| Lists | Normalize bullets | on | yes |
| Lists | Normalize ordered list | on | yes |
| Headings | Cascade headings | on | no |
| Headings | Normalize headings | on | yes |
| Footnotes | Convert citations to footnotes | on | no |
| Footnotes | Resolve footnote identity | on | no |
| Footnotes | Move footnotes to resources | on | no |

> **Reflow wrapped text** rebuilds screen-capture OCR text (e.g. TextSniper slide captures)
> that has hard line breaks and no blank lines between blocks, turning it back into
> paragraphs and `- ` bullet lists. Nesting survives: a sub-bullet keeps its level, and the
> indent step you already used (2 spaces, 4 spaces or a tab) is the one written back, so an
> already-tidy nested list passes through untouched. It is off by default because it reshapes
> structure more aggressively than the other steps — enable it when you paste OCR/slide text,
> or run the standalone **Markdown Mason: Reflow wrapped text** command on a selection. It
> runs before the other cleanup steps.

The toggles govern both commands:

- **Shared by both commands (9 steps):** the Cleanup and Lists steps and *Normalize
  headings*. Toggling one of these off also stops it from running during *Paste and format*.
- **Format selection only (4 steps):** *Cascade headings* and the footnote steps (*Convert
  citations to footnotes*, *Resolve footnote identity*, *Move footnotes to resources*). These
  never run during *Paste and format*. Each is marked in its description with
  *ℹ️ "Format selection" only — not applied by "Paste and format".*

So if you ran *Paste and format* and a particular cleanup step didn't happen, check whether
that step is toggled off here. (Steps unique to *Format selection* are expected not to run on
a paste — that is by design.)

The toggles are stored in `data.json` under `formatSelection`.

## Pasting into a list

When your cursor sits inside a list item — an open `- ` you were about to fill in, or the
end of an item you have already typed — both paste commands fit what you paste to that
list instead of dropping it in as-is:

- every pasted paragraph becomes its own item at your current level;
- the blank lines that separated those paragraphs are dropped, so the list stays intact;
- a list that came along with the pasted text is nested one level **under** the paragraph
  that introduces it;
- an ordered list keeps counting (`3.` → `4.` → `5.`), and a task list stays a task list
  with fresh unchecked boxes.

Pasting anywhere else is unaffected — outside a list item the step does nothing at all.
Turn it off with **Fit paste to list context** (`pasteListContext`) on the main page.

Two deliberate boundaries: the surrounding list is never renumbered or re-indented (only
the text you paste is shaped), and a paste that fails inside a converter script always
degrades to a plain, verbatim paste.

## Settings reference

Each row lists a setting's internal name (as stored in `data.json`), its type, default
value, and what it controls.

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `debugLogging` | `boolean` | `false` | Enable verbose console.debug traces. Off by default. |
| `resourcesName` | `string` | `"## Resources"` | Heading where *Tidy / Move footnotes* collects footnote definitions. Carries an optional ATX level prefix (e.g. `## Resources`, `### Resources`) so you choose the heading level. An existing section with this name is reused at whatever level it already has. |
| `numericOnly` | `boolean` | `true` | When true (default), only numeric footnote references are processed; alpha markers such as [^A] are excluded. Optional to preserve backward compatibility with persisted data and existing test fixtures that do not include this field. Treated as `true` when absent. KNOWN LIMITATION (v0.1): this setting persists and threads into OperationContext.settings, but numericOnly=false is not yet honoured by the core footnote logic. The core already behaves as if numericOnly is always true (ExistingRef is defined as numeric-only; see types.ts). Wiring numericOnly=false to allow alpha markers is a planned follow-up. |
| `showUpdateSplash` | `boolean` | `true` | When true (default), a one-shot "what's new" splash is shown the first time the plugin runs after its version changes. It lists the features that release brought (taken from the release's changelog entry at build time — features only, so a bug-fix-only release shows none) and how many curated scripts have a newer catalog version waiting (scripts ride pinned plugin releases, so a plugin update is the only moment a script version can change). User-gated via the *Show update notes* setting and the in-splash toggle. Optional for backward-compat with persisted data predating this field; treated as `true` when absent. |
| `pasteListContext` | `boolean` | `true` | When true (default), pasted content is fitted to the list item the cursor is in: each paragraph becomes its own item, the blank lines that separated them are dropped, and a pasted sub-list nests under the item that introduces it. Applies to *Paste and format* and to *Paste and run scripts* when no script recognises the clipboard. Provably a no-op when the cursor is not inside a list, hence on by default. Optional for backward-compat with persisted data predating this field; treated as `true` when absent. |
| `lastSeenVersion` | `string` | `""` | The plugin version (manifest.version) last shown to the user. Compared against the current manifest.version on load to detect an update (mirrors Excalidraw's `previousRelease`). Empty string means "never recorded" → fresh install, which is recorded silently without a splash. Optional for backward-compat; treated as `""` when absent. |

`lastSeenVersion` has no control on the settings page — Markdown Mason manages it
automatically to decide when to show the update-notes splash. It is listed here only for
completeness.

## Override mechanism

Each of these settings maps to a control on the main settings page:

| Setting | Location | Control |
|---|---|---|
| `resourcesName` | Top of the page → Resources section heading | text field |
| `showUpdateSplash` | Top of the page → Show update notes | toggle |
| `numericOnly` | Top of the page → Numeric-only footnotes | toggle |
| `pasteListContext` | Top of the page → Fit paste to list context | toggle |
| `debugLogging` | Advanced → Debug logging | toggle |

Changing a control writes to `data.json` immediately — there is no separate Save button.
`debugLogging` applies live (traces start or stop without reloading Obsidian). Any setting
absent from `data.json` falls back to its default, so a fresh install — or a deleted key —
simply restores that default.

## Defaults and safe values

The defaults are chosen to work out of the box; a fresh install needs no configuration.

- **`resourcesName`** (`"## Resources"`) — the heading that *Tidy / Move footnotes* files
  definitions under. Add `#`s to choose the level (e.g. `### Resources` for a level-3
  section); an existing section with this name is reused at its current level.
- **`numericOnly`** (`true`) — leave enabled. Disabling it is a planned feature: the setting
  persists, but alpha footnote markers such as `[^A]` are not yet honoured by the core, so
  turning it off currently has no effect.
- **`showUpdateSplash`** (`true`) — leave enabled to see what a new version brought and a
  summary of waiting script updates after a plugin upgrade; turn it off if you prefer no
  post-update splash.
- **`pasteListContext`** (`true`) — leave enabled. It only ever acts when the cursor is
  inside a list item; turn it off if you want a paste to land exactly as copied even
  mid-list.
- **`debugLogging`** (`false`) — leave off for normal use. Enable it only when diagnosing a
  problem or filing a bug report; it writes verbose traces to the developer console.
