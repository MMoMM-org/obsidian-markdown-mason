---
title: "T7.5 — Obsidian Sync Verification Spike (outcome)"
status: resolved
date: 2026-06-18
gates: v0.2
refs: [SDD/ADR-6, SDD/ADR-8, PRD/Open Questions — Sync]
---

# T7.5 — Sync Verification Spike

**Purpose.** Settle the open question behind ADR-6: how does Obsidian Sync treat the
plugin's script storage across two Sync-paired desktops, and does the trust model hold?
This spike **gates v0.2** (cross-device distribution); it is **not** a v0.1 release blocker.

## Procedure (for re-verification)

On two desktops paired via Obsidian Sync with **"Sync installed community plugins"** enabled:

1. On **Device A**, drop a script file into `.obsidian/plugins/markdown-mason/scripts/foo.cjs`
   and import it (records a manifest entry in `data.json` + consent in `device.json`).
2. Wait for Sync, then inspect **Device B**'s
   `.obsidian/plugins/markdown-mason/` directory and `data.json` / `device.json`.
3. Observe, independently:
   - (a) did `scripts/foo.cjs` replicate?
   - (b) did `data.json` (manifest + recorded checksum/version) replicate?
   - (c) did the consent/enable state replicate, or stay per-device?

## Findings (observed, 2026-06-18)

| # | Observation | Result |
|---|-------------|--------|
| 1 | Arbitrary plugin files (`scripts/*.cjs`, `device.json`) replicate | **No** — Sync replicates only the plugin's *own* core files |
| 2 | Plugin core files replicate (`manifest.json`, `main.js`, `data.json`) | **Yes** |
| 3 | Recorded enable/consent replicates | **Yes — because it must ride `data.json`** in the target design |

**Empirical rule:** Obsidian Sync's "installed community plugins" replicates a plugin's
own `manifest.json`, `main.js`, (and `styles.css`/`data.json`) — **not** extra files the
plugin writes, and **not** subdirectories such as `scripts/`.
(See Obsidian Sync documentation, "Sync installed community plugins".)

## Decision — corrects ADR-6's cross-device assumption

ADR-6 stored per-device `enabled`/`consent` in a **non-syncing `device.json` sidecar**,
on the premise that "Sync replicates the whole plugin folder." **That premise was wrong:**
Sync does **not** carry `device.json` or `scripts/*.cjs` at all.

Two consequences:

- **v0.1 (ships as-is, safe).** The `device.json` sidecar genuinely does not sync, so it
  behaves as a correct per-device trust store. Imported `.cjs` files also do not propagate,
  so v0.1's local-import-only model is internally consistent: each device imports and
  consents independently, fail-closed. **No v0.1 code change required.**

- **v0.2 (new target model — supersedes the sidecar for cross-device consent).**
  Enable/consent **rides `data.json`** (which syncs) instead of a per-device sidecar.
  On a second device, the script **code is re-materialized**, never synced as a file:
  1. auto-download from the **vetted, commit-SHA-pinned official repo** (ADR-8), or
  2. **import from a copy in the vault**,

  and the materialized code is accepted **only when its `checksum` + `version` match the
  synced `data.json` manifest entry**. Safety comes from this match gate at materialization
  time, not from forcing a re-consent on every device.

This keeps drift protection intact (same-version + different-checksum still hard-blocks)
while removing the per-device re-consent friction the sidecar imposed.

## Follow-ups for v0.2 (not in this plan)
- Move `enabled`/`consent` from `device.json` → `data.json` (synced), or document a
  migration; reconcile with the ADR-6 sidecar.
- Implement vetted-repo auto-download + vault-import materialization gated on checksum/version (ADR-8).
- Re-run this procedure on real hardware to confirm before shipping v0.2 distribution.
