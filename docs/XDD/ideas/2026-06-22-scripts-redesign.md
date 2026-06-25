---
title: "Scripts distribution & settings redesign (v0.2)"
status: converged-design
created: 2026-06-22
origin: brainstorm parked 2026-06-18, resumed & converged 2026-06-22
target_spec: 002-script-distribution-and-settings
refs:
  - docs/XDD/specs/001-markdown-mason/sync-spike.md     # T7.5 Sync correction
  - docs/XDD/specs/001-markdown-mason/solution.md        # ADR-6, ADR-8
  - docs/XDD/specs/001-markdown-mason/requirements.md    # Should-Have / Could-Have
---

# Scripts distribution & settings redesign — v0.2 (converged design)

> **Status:** converged design, **ready for `/xdd`**. The parked brief's seven open questions
> were resolved in the 2026-06-22 brainstorm (decisions + rationale below). The trust model
> inherits ADR-8 + the T7.5 Sync correction. Next step: run
> `/xdd docs/XDD/ideas/2026-06-22-scripts-redesign.md` to scaffold spec
> `002-script-distribution-and-settings` (PRD → SDD → plan).

## Motivation

In **v0.1**, the four Perplexity scripts are **compiled into `main.js`** as first-party code, run
under the SEC-006 bundled-code consent bypass, registered as commands, and are **not removable**.
The **Settings → Scripts** panel only lists *user-imported* scripts, so it reads
**"No scripts installed yet"** even though four scripts are clearly working — confusing, and it
under-sells the plugin.

Direction: curated scripts become **first-class managed content**, not baked-in code — shipped in
the vetted repo, **pre-vetted**, **pulled on demand**, and given the **same full lifecycle** as any
imported script (install, consent, enable/disable, **remove/reinstall**). One trust model across
built-in and imported scripts; a leaner `main.js`.

## Converged design

### Model (the spine)

- **Unified machinery + provenance.** One state machine, one trust model, one storage path for all
  scripts. A `provenance: curated | imported` attribute determines only **where re-materialization
  reads the code from** (vetted repo vs. recorded vault path) and presentation (a badge) — **never**
  the trust gates.
- **Enable implies consent.** A single okayed `{version, checksum}` record per script (no separate
  persisted consent flag). The disclosure modal appears on **first enable** and whenever
  `{version, checksum}` **changes**. Acceptance writes the okayed record and proceeds to
  materialization.
- **`data.json` (synced) is the source of truth.** It holds `enabled` + the okayed
  `{version, checksum}` per script. Script **code is never synced**; it is **re-materialized
  per-device** and accepted **only on `version` + `checksum` match** (per T7.5).
- **Consent is per-vault, not per-device** (deliberate T7.5 tradeoff). Because consent rides
  `data.json`, the safety on a second device is the **match-gate at materialization time**, not a
  re-prompt. This removes per-device re-consent friction by design.

### Lifecycle state machine (per script, per device)

```
[*] --> Available   (curated: present in catalog)
[*] --> Absent      (imported: nothing yet)

Available --> Disclosing : user enables
Absent    --> Disclosing : user imports (pick vault file)
Disclosing --> Materializing : accept {version, checksum}
Disclosing --> Available/Absent : cancel

Materializing --> Active  : fetched/copied code matches data.json {v,c}
Materializing --> Blocked : mismatch / source unavailable

Active   --> Disabled : user disables
Disabled --> Active   : re-enable (v,c unchanged -> NO disclosure)
Active/Disabled --> Available : remove (curated, re-installable)
Active/Disabled --> Absent    : remove (imported, gone unless re-imported)

Active --> UpdateAvailable : repo version > okayed (curated only)
UpdateAvailable --> Disclosing : user clicks update

Blocked --> Materializing : retry / fix source / re-review
Active  --> Materializing : sync arrives, local code missing/stale
```

- **`Materializing`** is the cross-device heart: on a synced device, `data.json` says
  "enabled @ {v,c}" but local code is absent → fetch from repo (curated) or copy from the recorded
  vault path (imported) → run only on match.
- **`Blocked`** unifies three failure modes — **checksum drift**, **repo unreachable**,
  **vault source missing** — and **always surfaces a human reason + a recovery action**. Never
  silently runs.
- **Re-enable is friction-free** when `{v,c}` is unchanged; the disclosure re-appears only on an
  actual `{v,c}` change (update or drift recovery).

### Distribution & updates

- The vetted repo holds a **SHA-pinned `index.json` catalog**: per script `{version, checksum,
  path}`. Fetched via **`requestUrl`** (CORS-safe).
- **Enabling a curated script** fetches its `.cjs` at the pinned SHA, verifies the checksum against
  the index, records `{version, checksum}` in `data.json`, and materializes the code locally
  (written **verbatim**, see Edge cases #5).
- **Nothing auto-enables.** Install/upgrade never silently runs code; the user opts in per script.
  **No bundled fallback** (keeps `main.js` lean). First-run/offline degrades gracefully: nothing was
  installed, so nothing is broken; "Browse official" shows a retry. Already-materialized scripts work
  offline. A synced device that hasn't materialized yet + offline → `Blocked` (reason: "offline").
- **Curated updates ride plugin releases.** Each plugin release embeds a newer pinned SHA → the
  catalog at that SHA exposes higher script versions → 🟡 **UpdateAvailable** badge → user reviews →
  re-disclosure → `data.json` bumps → propagates **once** to synced devices (which re-materialize on
  match, no re-prompt). No independent polling of a moving `main` (would defeat SHA-pinning).
- **No v0.1 migration** — there are no existing users. The Perplexity scripts are ordinary opt-in
  catalog entries; they go through `Disclosing` on first enable like any other.

### Script module contract & "Paste and format" autodetect

v0.2 generalizes the v0.1 **hardcoded** autodetect (`mason.pasteAndFormat` → `perplexityAutoScript`
→ `detect()` over compiled-in parsers, `src/main.ts:144,326` · `parsers/detect.ts:25`) into a
**data-driven matcher chain** built at runtime from enabled scripts. Compiled-in registries can't
reference dynamically-pulled `.cjs`, so this requires extending the script module shape.

**Module shape.** A v0.2 script exports an envelope, not a bare function:

```js
module.exports = {
  run(ctx) { /* existing ScriptFunction: (ctx) => EditPlan | undefined */ },
  paste: {                          // OPTIONAL — opt into Paste-and-format autodetect
    canHandle(input) { /* boolean — cheap, PURE, synchronous, no I/O */ },
    priority: 300,                  // higher is tried first
  },
};
```

- `run` is the existing `ScriptFunction` contract (`src/scripts/context.ts:73`), unchanged — it still
  receives `ctx.source: "paste" | "selection" | "command"` and returns `EditPlan | undefined`.
- A script **without** a `paste` block is **command-only** (runnable via its own command or the
  "Run script…" launcher) and never joins the paste chain.
- `canHandle` mirrors today's `CitationParser.canParse` (`src/parsers/perplexityApp.ts:46`, etc.): a
  cheap, **side-effect-free, synchronous** predicate. It must not do I/O — the host calls it on every
  paste across potentially many scripts.

**Autodetect flow.** `mason.pasteAndFormat`:
1. Builds the matcher chain from all **enabled** scripts declaring a `paste` block (their code is
   already materialized locally).
2. Orders the chain (precedence below) and calls each `canHandle(input)` until the first match.
3. Runs that script's `run` with `source: "paste"`; applies the returned `EditPlan`.
4. No match → unchanged **raw-paste fallback** + "no recognized format" notice (`src/main.ts:344`).

**Precedence & shadowing.** Chain order: **curated scripts before imported scripts**, then within
each group by `priority` descending, then by script id. A curated parser always gets first claim, so
an imported script with `canHandle: () => true` can only catch pastes **no curated script claimed** —
it cannot hijack recognized formats. (Default rule; revisitable if users need manual reordering.)

**Forward-compat (single chokepoint).** All chain ordering MUST flow through one
`buildPasteChain(enabledScripts)` function. Manual reordering is then a future **additive** overlay —
an optional `pasteOrder: string[]` (script ids) in `data.json` that, when present, replaces the
default sort inside that one function. No contract change, no migration (absent = default order).
Parked for v0.2 (see Parking lot).

**Why declared detection (not speculative try-all).** Today's scripts are pure/synchronous, but the
contract permits `Promise` (`context.ts:73`) and imported scripts may do anything; running every
script speculatively to "see what sticks" risks I/O and side effects. The cheap, pure `canHandle`
preserves the proven `canParse`/`parse` separation.

**Perplexity migration.** The three concrete scripts ship as catalog entries, each declaring
`paste.canHandle` = its parser's `canParse`, with descending priorities preserving today's `detect()`
order: **app 300 / web-download 200 / web 100**. The meta-script **`perplexity-auto` is retired** —
the generic chain replaces its hardcoded delegation; `src/parsers/detect.ts` and
`src/scripts/library/perplexityAuto.ts` are removed.

### Settings UI — segmented top nav

Navigation: **`General · Scripts · Commands · Advanced`** (horizontal segmented control inside the
single `PluginSettingTab`; Obsidian has no native sub-tabs).

- **Scripts tab** — full-width **card rows**, each: name, provenance badge (Official / Imported),
  status pill (🟢 Active / ⚪ Disabled / 🟡 Update / 🔴 Blocked), version, enable toggle, and a `⋯`
  context menu (only valid actions appear): **view source** (curated → repo link · imported → reveal
  vault file), **re-review consent**, **update to vN** (when available), **retry fetch** (when
  blocked), **remove**. `Blocked` rows show the reason + recovery inline. Toolbar: **Import from
  vault**, **Browse official**.
- **Commands tab (Templater model)** — for each **enabled** script, an opt-in **"Create command"**
  toggle that registers an Obsidian command (bound to keys via the **core Hotkeys** tab; no default
  hotkeys). Command registration is **decoupled** from enable. Plus one always-registered built-in
  command **"Mason: Run script…"** that opens a **selector modal** listing only **`Active`** scripts
  to run. Disabled/blocked scripts never appear in the launcher.
- **Advanced tab** — existing debug logging, etc.

### Testing & dev

- **Automated tests** inject a fake **`CatalogSource` port** (fetch index, fetch script bytes) —
  no network, no branch. Matches the existing DI pattern (`PluginDataPort`, `VaultAdapterPort`).
- **Dev-only source override** lives in a **non-synced, gitignored dev config / env var, read only
  by dev builds**. It can point `scriptSource` at the **local working-tree** dir (read current code
  instantly, no push). **Production builds have no code path to read it** — the SDD must specify the
  build-time guarantee (e.g. dead-code elimination behind a build flag, so the prod bundle physically
  omits the override path, not merely skips it at runtime) — and pin to a **release SHA**. It is never
  stored in `data.json` (which syncs) — closing both the sync-leak and the arbitrary-local-code-load
  vector.

## Resolved decisions (maps to the parked brief's open questions)

| # | Question | Decision | Why |
|---|----------|----------|-----|
| 1 | Pull mechanism | SHA-pinned `index.json` via `requestUrl`; fetch `.cjs` on enable; verify checksum vs index | CORS-safe, deterministic, ADR-8-pinned |
| 2 | Lifecycle state machine | Single machine above; `Disclosing`/`Materializing`/`Blocked` transient/terminal states | One model for curated + imported |
| 3 | Consent migration | None — no v0.1 users; consent rides synced `data.json`, safety via match-gate | T7.5 correction; no install base |
| 4 | Command Management UX | Templater model: per-script opt-in "Create command" + one "Run script…" launcher; decoupled from enable | Reuses Obsidian Hotkeys; supports run-without-binding |
| 5 | Scripts tab structure | Segmented top nav + card rows | Light, breathes, right-sized for our script count |
| 6 | Integrity & drift | `Blocked` unifies drift/offline/missing; same-version+diff-checksum = drift (existing `evaluateTrust` rule 5) | Fail-closed, reuses v0.1 trust precedence |
| 7 | Offline / first-run | No auto-enable, no bundled fallback → nothing to break offline | Keeps `main.js` lean; graceful degradation |
| + | Update cadence | Curated updates ride plugin releases (pinned SHA) | ADR-8 consistent; no moving-source drift |
| + | Curated vs imported | Unified machinery + `provenance` flag | One trust model; provenance = re-materialization source |
| + | Enable vs consent | Enable implies consent (one okayed `{v,c}` record) | Fewer states; disclosure still shown on change |
| + | Dev source flavor | Local-path override, dev-build only, non-synced | Fastest loop, production-safe |
| + | Paste-and-format autodetect | Per-script `paste.canHandle` + `priority`; host builds runtime matcher chain; curated-before-imported precedence | Generalizes compiled-in `detect()`; no speculative execution; `perplexity-auto` retired |

## Edge cases & resolutions (from gap review)

1. **`data.json` concurrent edits** are last-write-wins (Obsidian Sync replicates the whole file —
   true for every plugin). **Documented limitation**; no field-merge engine (YAGNI).
2. **Consent decoupled from executing device** is the deliberate per-vault T7.5 model; the
   **match-gate** is the device-B safety, not a re-prompt.
3. **"Create command" state** rides `data.json` (synced). The Obsidian command is **physically
   registered only while the script is `Active`**, is not invokable while `Blocked`, and is
   **dropped + unregistered on remove**.
4. **Launcher** lists only **`Active`** scripts; a stale command invoked against a non-active script
   **fails safe** with the Blocked/disabled reason.
5. **Checksum** is over the **exact raw bytes** of the fetched `.cjs`; the materializer writes those
   bytes **verbatim** (no line-ending/encoding normalization); the index is generated from the same
   bytes. Prevents CRLF false-drift.
6. **Same version, different checksum** → **drift → `Blocked`** (existing `evaluateTrust` rule 5).
   SHA-pinning makes this near-impossible in production; the fail-closed path exists regardless.
7. **Dev override** is non-synced and dev-build-only (see Testing & dev) — no `data.json` leakage,
   no production code path.
8. **Imported vault path** is recorded **vault-relative**; re-materialization reads it; if
   missing/moved → `Blocked` ("source missing") with a **re-import** recovery. No auto
   rename-tracking (YAGNI).

## Trust & distribution model (inherited, already recorded)

- **ADR-8 — vetted-repo distribution:** the official **commit-SHA-pinned** repo is the only
  auto-download source (Markdown-in-note transforms only, doc-required PR to add a script);
  vault-import remains for community scripts at user discretion.
- **T7.5 Sync correction** (`sync-spike.md`, supersedes ADR-6's per-device sidecar for cross-device
  consent): Obsidian Sync replicates only the plugin's own core files (`manifest.json`, `main.js`,
  `data.json`) — **not** `scripts/*.cjs` or a sidecar. So: **enable/consent rides `data.json`**, and
  on a second device the **code is re-materialized** from the vetted SHA-pinned repo (or
  vault-import), accepted **only on `checksum` + `version` match**. Drift (same version, different
  checksum) still hard-blocks.

## v0.1 building blocks to reuse / reconcile

- `src/scripts/store.ts` — `ScriptStore`: `data.json` manifest + `evaluateTrust` precedence
  (`ok` / `needs-consent` / `drift-blocked` / `disabled` / `unknown`). **v0.2 folds the v0.1
  `device.json` sidecar's `enabled`/`consent` into synced `data.json`** per T7.5; the okayed
  `{version, checksum}` replaces the separate consent record.
- `src/scripts/runner.ts`, `src/scripts/disclosure.ts` — execution + consent modal (reused for
  `Disclosing`).
- `src/scripts/loader.ts` — vault import flow (path-traversal guards, checksum recording) — reused
  for the imported-provenance path.
- `src/ui/settingsTab.ts` — current single-section tab → becomes the segmented `General · Scripts ·
  Commands · Advanced` shell. (Reference: miyo-kado's `002-ui-settings-rework` multi-tab pattern.)
- `src/scripts/library/perplexity*.ts` — **migrate from compiled-in to catalog entries** in the
  vetted repo, each wrapped in the v0.2 module envelope (`{ run, paste:{canHandle, priority} }`).
- `src/parsers/detect.ts` + `src/scripts/library/perplexityAuto.ts` — **retired**; their static
  delegation is replaced by the runtime matcher chain. The per-parser `canParse` logic moves into
  each script's `paste.canHandle`.
- `src/main.ts` paste command (`mason.pasteAndFormat`, line 144) — rewire from the hardcoded
  `perplexityAutoScript` call to the data-driven matcher chain; the raw-paste fallback is unchanged.
- **New:** a `CatalogSource` port (fetch index / fetch script bytes) + concrete `requestUrl` adapter.

## Parking lot (deferred / explicitly out of scope)

- **Field-level merge for `data.json`** across devices — accept Obsidian's last-write-wins.
- **Auto rename/move tracking** for imported-script sources — user re-imports on `Blocked`.
- **Independent catalog polling** of a moving ref — rejected (defeats SHA-pinning).
- **Multiple commands per script** — rejected; 1:1 script↔command holds for now.
- **Manual reordering of the paste-autodetect chain** — deferred; default is curated-before-imported
  + `priority`. Kept cheap to add later via the `buildPasteChain()` chokepoint + additive
  `pasteOrder` overlay (see autodetect section). Tracked as a GitHub issue.
- Full **"Browse official repo"** browsing UX richness — minimal viable list in v0.2; richer
  browsing can follow.

## Next step

Run `/xdd docs/XDD/ideas/2026-06-22-scripts-redesign.md` to scaffold spec
`002-script-distribution-and-settings` (PRD → SDD → plan). **User-triggered** — not automatic.
