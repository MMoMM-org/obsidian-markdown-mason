# Installation

Markdown Mason is a **desktop-only** Obsidian plugin. Install it from Obsidian's Community
Plugins browser, or manually from a GitHub release.

## Prerequisites

- **Obsidian 1.6.6 or newer**, on **desktop** (Windows, macOS, or Linux). Markdown Mason is
  desktop-only — its script runtime needs Node, so it does not run on Obsidian mobile and
  won't appear in the mobile plugin list.
- **Community plugins enabled.** If you've never installed a community plugin, open
  **Settings → Community plugins** and turn off Restricted mode (formerly "Safe mode") first.

## Install from Community Plugins

1. Open **Settings → Community plugins**.
2. Click **Browse**.
3. Search for **Markdown Mason**.
4. Click **Install**, then **Enable**.

The plugin is now active. No scripts run until you enable one — see [Usage](usage.md) to get
started.

## Install manually

Use this to get a specific release, or a pre-release build that isn't in the directory yet.

1. Download the three assets from the
   [latest GitHub release](https://github.com/MMoMM-org/obsidian-markdown-mason/releases):
   `main.js`, `manifest.json`, and `styles.css`.
2. In your vault, create the folder `.obsidian/plugins/markdown-mason/` if it doesn't exist.
3. Copy the three files into that folder.
4. In Obsidian, open **Settings → Community plugins**, click the refresh icon next to
   *Installed plugins*, then enable **Markdown Mason**. (Restart Obsidian if it doesn't
   appear.)

## Verify the installation

After enabling, confirm Mason loaded:

- **Markdown Mason** appears under Settings → Community plugins → Installed plugins, toggled
  on.
- A **Markdown Mason** entry is in the settings sidebar, showing the General / Scripts /
  Commands / Format selection / Advanced segments.
- Opening the command palette and typing "Mason" lists **Markdown Mason: Paste and run
  scripts**, **Paste and format**, **Format selection**, and **Run script…**.

If any of these are missing, see [Troubleshooting](troubleshooting.md).

## Updating

- **From Community Plugins:** Obsidian flags available updates under **Settings → Community
  plugins → Check for updates**. Click **Update** next to Markdown Mason.
- **Manual installs:** download the newer release assets and overwrite the three files in
  `.obsidian/plugins/markdown-mason/`, then reload Obsidian.

Curated scripts you've installed update separately from the plugin — the **Scripts** settings
tab shows a badge when newer script versions are waiting (see [Usage](usage.md)).
