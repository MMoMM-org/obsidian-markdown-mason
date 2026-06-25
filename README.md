# Markdown Mason

> Reshape pasted or whole-note Markdown to fit a note's structure — heading cascade,
> footnote renumbering and dedup — plus a runnable, consent-gated script library.

Markdown Mason is a desktop Obsidian plugin for the moment **after** you paste. When you drop
an answer from Perplexity (or another LLM or web source) into an existing note, the heading
levels rarely match and citation numbers restart from `[1]`, colliding with footnotes you
already have. Mason fits the incoming text into the target note instead: it cascades headings
relative to where the cursor sits, turns inline citations into real footnotes, renumbers and
deduplicates them against what's already there, and files them into a `Resources` section.

The transforms run as small **scripts** managed by the plugin — installed from a curated,
reviewed library or imported from your own vault — not as loose files scattered through your
notes.

> **Status:** early (`v0.0.1`). Desktop-only; requires Obsidian `1.6.6` or newer.

## Features

- **Paste and format** — transform clipboard text and insert it at the cursor in one step,
  with a plain-paste fallback if anything goes wrong.
- **Run a script on a selection** — reformat text already in your note *in place*, or run a
  script across the whole note.
- **Curated script library** — install reviewed formatters (currently three Perplexity copy
  surfaces) from the in-plugin catalog, with update notifications when newer versions ship.
- **Bring your own scripts** — import scripts from your vault and bind any script to its own
  command and hotkey.
- **Consent-gated execution** — scripts run with full plugin permissions only after an
  explicit, per-version disclosure; a per-script kill-switch disables any of them instantly.

## Installation

Open **Settings → Community plugins → Browse**, search for **Markdown Mason**, then
**Install** and **Enable**. Markdown Mason is desktop-only and requires Obsidian 1.6.6 or
newer. For manual installation, updating, and verification steps, see
**[docs/installation.md](docs/installation.md)**.

## Quick start

1. Open **Settings → Community plugins → Markdown Mason → Scripts**.
2. Click **Browse official**, enable a script, and confirm the disclosure prompt.
3. Copy some text, place your cursor, and run **Markdown Mason: Paste and format** from the
   command palette.

The full walkthrough — common workflows, format-in-place, and per-script commands — is in
**[docs/usage.md](docs/usage.md)**.

## Commands

| Command | What it does |
|---|---|
| **Markdown Mason: Paste and format** | Runs your enabled paste scripts on the clipboard and inserts the result at the cursor. |
| **Markdown Mason: Run script…** | Pick an active script to run on the current selection (or the whole note). |
| *Per-script commands* | Optional palette entries you enable per script in the **Commands** settings tab. |

No default hotkeys are registered — assign your own under **Settings → Hotkeys**.

## Scripts and trust

Mason's scripts are real JavaScript running with full plugin permissions — there is no
sandbox. Safety comes from policy, disclosure, and consent, in two tiers:

- **Official library (reviewed):** submitted by pull request, documented, and limited to
  editing Markdown in the current note — no network or cross-plugin access.
- **Imported / self-written (unreviewed):** brought in from your vault and run **at your own
  discretion and risk**, exactly like your own hand-written scripts.

To write your own, see **[docs/SCRIPT_AUTHORING.md](docs/SCRIPT_AUTHORING.md)**.

## Support

If you find Markdown Mason useful, you can support development via
[Buy Me a Coffee](https://ko-fi.com/mmomm) or
[GitHub Sponsors](https://github.com/sponsors/MMoMM-org).

The original German design briefing for the project is preserved at
[`PROJECT_BRIEFING.de.md`](PROJECT_BRIEFING.de.md).

<!-- doc-product:documentation:start -->
## Documentation

- [Installation](docs/installation.md)
- [Configuration](docs/configuration.md)
- [Usage](docs/usage.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Commands Reference](docs/commands-reference.md)
- [Release process](docs/RELEASE.md)
- [Writing a Markdown Mason script](docs/SCRIPT_AUTHORING.md)
<!-- doc-product:documentation:end -->

## License

[MIT](LICENSE) © Marcus Breiden
