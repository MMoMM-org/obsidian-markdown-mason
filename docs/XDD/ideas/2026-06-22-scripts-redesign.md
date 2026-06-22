---
title: "Scripts distribution & settings redesign (v0.2)"
status: parked-brief
created: 2026-06-22
origin: brainstorm parked 2026-06-18 (before spec-write step)
target_spec: 002-script-distribution-and-settings
refs:
  - docs/XDD/specs/001-markdown-mason/sync-spike.md
  - docs/XDD/specs/001-markdown-mason/solution.md  # ADR-6, ADR-8
  - docs/XDD/specs/001-markdown-mason/requirements.md  # Should-Have / Could-Have
---

# Scripts distribution & settings redesign — v0.2 (parked brief)

> **Status:** parked idea, **not** a validated design. This consolidates the direction Marcus
> set on 2026-06-18 plus the T7.5 Sync correction, so it's version-controlled and ready to
> resume. The next step is to **resume the brainstorm** to pin the open questions, then run
> `/xdd` to produce spec `002-script-distribution-and-settings`. Do **not** treat the choices
> below as settled — they're the starting point for probing.

## Motivation

In **v0.1**, the four Perplexity scripts (`perplexity-auto`, `perplexity-app`, `perplexity-web`,
`perplexity-web-download`) are **compiled into `main.js`** as first-party code, run with policy
`"enabled"` (the SEC-006 consent bypass for bundled code), registered as commands, and are **not
removable**. The **Settings → Scripts** panel only lists *user-imported* scripts (the `data.json`
manifest), so it reads **"No scripts installed yet"** even though four scripts are clearly working
as commands — confusing, and it under-sells the plugin.

Marcus's direction: the curated scripts should be **first-class managed content**, not baked-in
code — shipped in the repo, **pre-vetted**, and **pulled on install** so they get the same
**full lifecycle** as any imported script (install, consent, enable/disable, **remove/reinstall**).
That unifies the trust model across built-in and imported scripts and keeps the plugin lean.

## Target design (starting point — to be validated in brainstorm)

1. **Repo-shipped, pre-vetted scripts pulled on install.** The Perplexity scripts live in the
   vetted official repo (ADR-8: commit-SHA-pinned, doc-required PR to add). On plugin install (and
   on update), they are pulled into the vault as managed scripts rather than executed from `main.js`.
2. **Full lifecycle.** Each script is installed/enabled/consented and can be **removed and
   re-installed** — identical machinery to user-imported scripts. No special-cased "first-party
   always-on" path.
3. **Dedicated Scripts settings tab.** Move scripts out of the General tab (which would otherwise
   get too big) into its **own tab**, including **Command Management** — which scripts are bound to
   commands, per-script enable/disable, import, and (later) browse-the-vetted-repo.

## Trust & distribution model (inherited, already recorded)

This builds directly on two v0.1 decisions:

- **ADR-8 — vetted-repo distribution (deferred to v0.2):** the official commit-SHA-pinned repo is
  the only auto-download source (Markdown-in-note transforms only, doc-required PR); vault-import
  remains for community scripts at user discretion.
- **T7.5 Sync spike correction** (`sync-spike.md`, supersedes ADR-6's per-device sidecar for
  cross-device consent): Obsidian Sync replicates only the plugin's own core files
  (`manifest.json`, `main.js`, `data.json`) — **not** `scripts/*.cjs` or the `device.json` sidecar.
  So the v0.2 model is: **enable/consent rides synced `data.json`**, and on a second device the
  **code is re-materialized** from the vetted SHA-pinned repo (or vault-import), accepted **only on
  `checksum` + `version` match**. Drift (same version, different checksum) still hard-blocks.

## Current v0.1 building blocks to reuse / reconcile

- `src/scripts/store.ts` — `ScriptStore`: `data.json` manifest (synced) + `device.json` per-device
  sidecar (enable/consent) + `evaluateTrust` drift states (`ok` / `needs-consent` / `drift-blocked`
  / `disabled`).
- `src/scripts/runner.ts`, `src/scripts/disclosure.ts` — execution + consent modal.
- `src/scripts/loader.ts` — vault import flow (path-traversal guards, checksum recording).
- `src/ui/settingsTab.ts` — current General/Scripts/Advanced tabs (single `PluginSettingTab`).
- The four `src/scripts/library/perplexity*.ts` — would migrate from compiled-in to repo-distributed.

## Open questions to resolve in the brainstorm

1. **Pull mechanism.** How/when are scripts fetched on install/update? `requestUrl` to a SHA-pinned
   `index.json`? Bundle-then-extract on first run as an offline fallback? Network-permission UX.
2. **Lifecycle state machine.** Concrete states and transitions: not-installed → installed →
   consented → enabled ↔ disabled → removed (→ re-installable). How "built-in/curated" differs from
   "user-imported" (if at all).
3. **Consent migration.** v0.2 moves enable/consent from the non-syncing `device.json` sidecar onto
   synced `data.json`. Migration path from v0.1 installs; reconciliation with the re-materialize-on-
   checksum-match flow; what happens on a device where the code isn't yet materialized.
4. **Command Management UX.** Which scripts bind to which commands; enabling/disabling a script's
   command(s); how curated vs imported scripts are presented; default key-binding policy (none).
5. **Scripts tab structure.** Layout (per-script rows: status, version, source, enable, remove,
   re-consent); import button; optional "browse vetted repo"; how it coexists with General/Advanced.
   (Reference: miyo-kado's `002-ui-settings-rework` for a multi-tab settings pattern.)
6. **Integrity & drift.** How the existing `evaluateTrust` drift hard-block composes with auto-pull
   updates and cross-device re-materialization; update prompts.
7. **Offline / first-run.** Behavior with no network on first install (bundled fallback vs. empty
   library + prompt).

## Relationship to v0.1 (do NOT do as a v0.1 patch)

- Do **not** hack "list built-in scripts" into the current General/Scripts tab — that's throwaway
  under this design. (This is why the v0.1 Scripts panel was intentionally left showing
  "No scripts installed yet".)
- The whole-note footnote ops and the Perplexity output fixes landed in v0.1 are unrelated and
  already shipped; this redesign is purely about **how scripts are distributed, trusted, and
  managed**, plus the settings surface for it.

## Next step

Resume the parked brainstorm (terminal only — no visual companion; container URL isn't reachable)
to probe the open questions above and converge on one approach, then run
`/xdd docs/XDD/ideas/2026-06-22-scripts-redesign.md` to scaffold spec `002-script-distribution-and-settings`
(PRD → SDD → plan).
