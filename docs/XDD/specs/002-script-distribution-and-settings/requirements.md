---
title: "Scripts distribution & settings redesign (v0.2)"
status: draft
version: "1.0"
source_brief: docs/XDD/ideas/2026-06-22-scripts-redesign.md
---

# Product Requirements Document

## Validation Checklist

### CRITICAL GATES (Must Pass)

- [x] All required sections are complete
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Problem statement is specific and measurable
- [x] Every feature has testable acceptance criteria (Gherkin format)
- [x] No contradictions between sections

### QUALITY CHECKS (Should Pass)

- [x] Problem is validated by evidence (not assumptions)
- [x] Context → Problem → Solution flow makes sense
- [x] Every persona has at least one user journey
- [x] All MoSCoW categories addressed (Must/Should/Could/Won't)
- [x] Every metric has corresponding tracking events
- [x] No feature redundancy (check for duplicates)
- [x] No technical implementation details included
- [x] A new team member could understand this PRD

---

## Output Schema

### PRD Status Report

| Field | Value |
|-------|-------|
| specId | 002-script-distribution-and-settings |
| title | Scripts distribution & settings redesign (v0.2) |
| status | IN_REVIEW |
| clarificationsRemaining | 0 |
| acceptanceCriteria | 47 |

---

## Product Overview

### Vision
Every script in Markdown Mason — whether shipped by the maintainer or written by the user — is **first-class managed content**: discoverable, pulled on demand, consented to once, and removable, all under one trust model.

### Problem Statement
In **v0.1**, the four bundled Perplexity scripts are **compiled into `main.js`** as first-party code. This causes three concrete, observable problems:

1. **The Scripts settings panel lies.** It lists only *user-imported* scripts, so it reads **"No scripts installed yet"** even though four scripts are visibly working (`src/ui/settingsTab.ts:119-125`). Users cannot see, configure, or reason about the scripts they are actually running.
2. **Bundled scripts are not removable and bypass consent.** They run under the SEC-006 bundled-code consent bypass (`src/main.ts:234-239, 316-321`) and cannot be disabled-and-removed like imported scripts — there is **one trust model for code the user pulled and a different, invisible one for code the maintainer shipped**.
3. **Adding or updating curated scripts requires shipping a new compiled `main.js`**, bloating the bundle and coupling content cadence to binary releases.

The consequence: the plugin under-sells itself (its flagship scripts are invisible), the trust story is inconsistent, and `main.js` carries content it shouldn't.

### Value Proposition
A single, coherent lifecycle for **all** scripts — curated and imported alike: install, consent, enable/disable, **remove/reinstall**, update, and recover. Users gain visibility and control over exactly what code runs in their vault; the maintainer gains a leaner `main.js` and the ability to ship and update curated scripts as **pre-vetted, SHA-pinned content** without recompiling the plugin. The same disclosure-and-checksum trust gate protects every script, so there are no invisible privileges.

**Glossary (domain terms used throughout):**
- **Curated script** — a script published by the maintainer in the official vetted repository, pre-vetted and SHA-pinned.
- **Imported script** — a `.cjs` script the user adds from their own vault, at their discretion.
- **Provenance** — whether a script is `curated` or `imported`. Affects only *where its code is re-fetched from* and a presentation badge — never the trust gates.
- **Materialize** — fetch (curated) or copy (imported) a script's code to local storage so it can run on this device.
- **Disclosure** — the consent modal shown before a script runs for the first time, or whenever its code identity changes.
- **`{version, checksum}` (okayed record)** — the exact code identity the user consented to. Acceptance is granted only when the locally materialized code matches it.
- **Catalog** — the SHA-pinned `index.json` in the official repo listing each curated script's `{version, checksum, path}`.

---

## User Personas

### Primary Persona: Vault owner ("the curator-user")
- **Demographics:** Obsidian desktop user, intermediate technical comfort; pastes research/citations from tools like Perplexity into notes. Not necessarily a programmer.
- **Goals:** Turn messy pasted content into clean Markdown with footnotes; see and control which scripts are active; trust that nothing runs without their say-so.
- **Pain Points (v0.1):** Cannot see the scripts that are actually running; "No scripts installed yet" is confusing; cannot remove or reset a bundled script; no clear story for what a script is allowed to do.

### Secondary Personas

**Community-script importer ("the tinkerer")**
- **Demographics:** Advanced user / light developer; writes or borrows `.cjs` scripts.
- **Goals:** Import a custom script from the vault, consent to it knowingly, bind it to a hotkey, and remove it cleanly when done.
- **Pain Points (v0.1):** The "Import from vault…" button is a non-functional placeholder (`src/ui/settingsTab.ts:141-153`); no first-class import UX.

**Multi-device Sync user ("the syncer")**
- **Demographics:** Uses Obsidian Sync across two or more desktops.
- **Goals:** Enable a script once and have that decision carry to other devices — without re-consenting on each, and without code silently running on a device they never approved.
- **Pain Points (v0.1):** Per-device sidecar means consent does not travel; cross-device behavior is undefined for curated scripts.

**Plugin developer ("the maintainer")**
- **Demographics:** The plugin author / contributors.
- **Goals:** Iterate on script code against a live vault without publishing; publish and update curated scripts as content; keep `main.js` lean.
- **Pain Points (v0.1):** Curated scripts are compiled in; updating them means recompiling and re-releasing the whole plugin.

---

## User Journey Maps

### Primary User Journey: Discover, enable, and use a curated script
1. **Awareness:** User opens Settings → Scripts and sees a real catalog of official scripts (not an empty panel), each with a clear status.
2. **Consideration:** User clicks "Browse official", reads what a script does and that it is pre-vetted, and weighs whether to enable it.
3. **Adoption:** User toggles a curated script on → a disclosure modal explains the script's full privileges and shows its identity → user accepts.
4. **Usage:** The script's code is fetched and verified; the script becomes **Active**. The user runs it via "Paste and format" autodetect, its own command, or the "Run script…" launcher.
5. **Retention:** When the maintainer ships an update, the user sees a "Update available" badge, reviews, and re-consents in one click; the decision propagates to their other devices automatically.

### Secondary User Journeys

**Import a community script (tinkerer)**
1. Settings → Scripts → "Import from vault" → pick a `.cjs` file.
2. Disclosure modal shows the script's path, size, and privileges → accept.
3. Script is copied to local storage, verified, and becomes Active; user optionally creates a command for it in the Commands tab and binds a hotkey via Obsidian's core Hotkeys tab.
4. User later removes it; the script and its command disappear cleanly.

**Second-device materialization (syncer)**
1. User enabled a script on device A; the enable + `{version, checksum}` rode `data.json` to device B via Sync.
2. On device B the script is enabled but its code is absent → the plugin re-materializes the code (fetch for curated, copy for imported).
3. The code runs **only if it matches** the okayed `{version, checksum}`; on a mismatch or unavailable source, the script shows **Blocked** with a reason and recovery — it never silently runs. No re-consent prompt appears for a matching script.

**Recover a Blocked script (any user)**
1. A script row shows 🔴 Blocked with a human-readable reason (drift / offline / source missing).
2. The row offers the matching recovery action (retry fetch, re-review consent, or re-import).
3. After successful recovery the script returns to Active.

**Iterate on script code (maintainer)**
1. Developer points a dev-only source override at their local working-tree directory.
2. Enabling/running a curated script reads the current local code instantly — no publish, no push.
3. The override exists only in dev builds; the production bundle has no code path that can read it.

---

## Feature Requirements

### Must Have Features

#### Feature 1: Unified script lifecycle (curated + imported)
- **User Story:** As a vault owner, I want every script — bundled or imported — to follow the same install/consent/enable/disable/remove lifecycle, so that I have one consistent, trustworthy mental model.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a curated script that has never been enabled, When the user views the Scripts tab, Then it appears as a catalog entry with status "Available" and an "Official" provenance badge.
  - [ ] Given an imported script and a curated script that are both enabled and verified, When the user inspects them, Then they expose the same set of lifecycle actions (disable, remove, re-review consent) differing only by provenance badge and re-materialization source.
  - [ ] Given any enabled-and-verified script, When the user removes a curated script, Then it returns to "Available" (re-installable); When the user removes an imported script, Then it becomes "Absent" (gone unless re-imported).
  - [ ] Given the v0.1 bundled Perplexity scripts, When v0.2 is installed, Then none of them run until the user explicitly enables each one through disclosure (no bundled bypass remains).

#### Feature 2: Enable-implies-consent with disclosure on identity change
- **User Story:** As a vault owner, I want enabling a script to be the single act of consent, and to be re-asked only when the code actually changes, so that I am protected without nagging friction.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a script the user has never enabled, When the user enables it, Then a disclosure modal appears stating the script's full privileges and its `{version, checksum}` identity.
  - [ ] Given the user accepts the disclosure, When acceptance completes, Then the okayed `{version, checksum}` is recorded and the script proceeds to materialization.
  - [ ] Given a previously consented script whose `{version, checksum}` is unchanged, When the user disables and then re-enables it, Then NO disclosure modal appears.
  - [ ] Given a previously consented script whose `version` or `checksum` has changed, When the user enables/updates it, Then the disclosure modal appears again before any new code runs.
  - [ ] Given the disclosure modal is shown, When the user cancels (button, Escape, or closing the modal), Then the script does not run and remains in its prior state (Available/Absent/Disabled).

#### Feature 3: Nothing auto-enables; graceful offline & first-run
- **User Story:** As a vault owner, I want installing or upgrading the plugin to never silently run script code, so that I am always the one who opts in.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a fresh install or a plugin upgrade, When the plugin loads, Then no curated or imported script runs until explicitly enabled by the user.
  - [ ] Given no scripts have been enabled and the device is offline, When the user uses the plugin, Then nothing is broken and "Browse official" offers a retry.
  - [ ] Given a script was already materialized locally, When the device is offline, Then that script still runs.
  - [ ] Given a script is enabled (via Sync) but not yet materialized on this device, When the device is offline, Then the script shows Blocked with reason "offline" and a retry action — it does not run.

#### Feature 4: On-demand distribution & updates (curated)
- **User Story:** As a vault owner, I want curated scripts pulled from the official vetted source and updated through plugin releases, so that I run only pre-vetted code with a clear update path.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given the user enables a curated script, When disclosure is accepted, Then the script's code is fetched from the official source at the pinned reference and its checksum is verified against the catalog before it is recorded and materialized.
  - [ ] Given a fetched curated script whose checksum does not match the catalog, When verification runs, Then the script does not run and shows Blocked.
  - [ ] Given a plugin release that pins a newer catalog exposing a higher script version, When the user opens the Scripts tab, Then the affected script shows a 🟡 "Update available" badge.
  - [ ] Given an "Update available" script, When the user updates and accepts the re-disclosure, Then the okayed `{version, checksum}` is bumped and the update propagates once to the user's other Sync devices without a re-prompt there.
  - [ ] Given the plugin is installed, When it runs, Then it does NOT independently poll a moving branch for updates (updates ride pinned plugin releases only).

#### Feature 5: Cross-device materialization with match-gate safety
- **User Story:** As a multi-device Sync user, I want my enable decision to carry across devices without re-consent, while code is re-verified per device, so that I get convenience without unapproved code execution.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a script enabled on device A with an okayed `{version, checksum}`, When that record syncs to device B where the code is absent, Then device B re-materializes the code from the script's provenance source.
  - [ ] Given device B has re-materialized code that matches the okayed `{version, checksum}`, When the script is invoked, Then it runs without showing a disclosure modal.
  - [ ] Given device B's re-materialized code does NOT match the okayed `{version, checksum}`, When materialization completes, Then the script shows Blocked (reason: drift) and does not run.
  - [ ] Given an imported script whose recorded vault source path is missing on device B, When materialization is attempted, Then the script shows Blocked (reason: "source missing") with a re-import recovery action.

#### Feature 6: Fail-closed Blocked state with reason + recovery
- **User Story:** As a vault owner, I want any failure to materialize or verify a script to stop it safely and tell me why and how to fix it, so that I am never running surprise code and never stuck without a path forward.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a script enters the Blocked state for any cause (checksum drift, source unreachable, or vault source missing), When the user views its row, Then a human-readable reason and a matching recovery action are shown inline.
  - [ ] Given a Blocked script, When it is invoked by any means, Then it does not execute.
  - [ ] Given a Blocked script whose underlying cause is resolved (source reachable / re-imported / consent re-reviewed), When the user triggers the recovery action and materialization matches, Then the script returns to Active.
  - [ ] Given a script with the same recorded version but a different checksum than okayed, When trust is evaluated, Then it is treated as drift and Blocked (not a dismissable warning).

#### Feature 7: Settings — segmented navigation (General · Scripts · Commands · Advanced)
- **User Story:** As a vault owner, I want the settings organized into clear sections, so that scripts, command bindings, and general options don't crowd one another.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given the Settings tab is open, When it renders, Then a horizontal segmented control offers exactly four sections: General, Scripts, Commands, Advanced.
  - [ ] Given the user selects a segment, When the view updates, Then only that section's content is shown and the selection persists while the tab is open.
  - [ ] Given the General and Advanced sections, When they render, Then they retain the v0.1 controls (resources section name, numeric-only footnotes; debug logging) with no loss of function.

#### Feature 8: Scripts tab — card rows with status and contextual actions
- **User Story:** As a vault owner, I want each script shown as a card with its status and only the actions that currently apply, so that I can manage it at a glance.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given the Scripts tab, When it renders, Then each script appears as a full-width card showing name, provenance badge (Official / Imported), status pill (🟢 Active / ⚪ Disabled / 🟡 Update / 🔴 Blocked), version, and an enable toggle.
  - [ ] Given a script card, When the user opens its ⋯ context menu, Then only valid actions for the current state appear (e.g. "update to vN" only when an update exists; "retry fetch" only when Blocked; "view source" links to the repo for curated and reveals the vault file for imported).
  - [ ] Given a Blocked card, When it renders, Then its reason and recovery are shown inline on the card.
  - [ ] Given the Scripts tab toolbar, When it renders, Then it offers "Import from vault" and "Browse official" actions.
  - [ ] Given no curated catalog entries and no imported scripts, When the Scripts tab renders, Then it shows a meaningful empty state (not a misleading "No scripts installed yet" when curated entries are in fact available).

#### Feature 9: Commands tab — opt-in command creation + Run-script launcher
- **User Story:** As a vault owner, I want to choose which enabled scripts get a command (and bind keys via Obsidian's own Hotkeys), and to run any active script without binding one, so that command clutter and key bindings stay under my control.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given an enabled script, When the user toggles "Create command" for it in the Commands tab, Then an Obsidian command is registered for that script; When the user toggles it off, Then the command is unregistered.
  - [ ] Given command creation, When a command is registered, Then no default hotkey is assigned (binding is done via Obsidian's core Hotkeys tab).
  - [ ] Given "Create command" state, When the user disables or removes the script, Then any registered command is unregistered, and a removed script's command state does not linger.
  - [ ] Given the built-in "Mason: Run script…" command, When invoked, Then it opens a selector modal listing only Active scripts; disabled or blocked scripts never appear.
  - [ ] Given a stale command invoked against a script that is no longer Active, When it runs, Then it fails safe and surfaces the Blocked/disabled reason rather than executing.

#### Feature 10: Data-driven "Paste and format" autodetect
- **User Story:** As a vault owner, I want "Paste and format" to automatically pick the right enabled script for my pasted content, so that I get correct formatting without choosing a script each time.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given several enabled scripts that declare paste-handling, When the user runs "Paste and format", Then the plugin builds an ordered matcher chain from those scripts and runs the first whose cheap predicate claims the input.
  - [ ] Given the matcher chain, When ordering is computed, Then curated scripts precede imported scripts, then higher priority precedes lower, then ties break by script id — so an imported catch-all cannot hijack a format a curated script recognizes.
  - [ ] Given pasted content that no enabled script claims, When "Paste and format" runs, Then the raw text is pasted unchanged and a "no recognized format" notice is shown (unchanged v0.1 fallback).
  - [ ] Given a script that does not declare paste-handling, When the chain is built, Then that script never participates in autodetect (it remains command-only).
  - [ ] Given the three migrated Perplexity scripts, When they are all enabled, Then autodetect precedence reproduces today's order (app, then web-download, then web).

#### Feature 11: Migrate Perplexity scripts to catalog entries; retire the meta-script
- **User Story:** As a maintainer, I want the bundled Perplexity scripts shipped as ordinary catalog entries and the hardcoded auto-detector retired, so that `main.js` is lean and curated content is updatable independently.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given v0.2, When the plugin is built, Then the three concrete Perplexity scripts are catalog entries (not compiled into `main.js`) and each declares its paste predicate and priority.
  - [ ] Given v0.2, When the plugin is built, Then the hardcoded `perplexity-auto` meta-script and the compiled-in detection delegation are removed in favor of the runtime matcher chain.
  - [ ] Given a user upgrading from v0.1, When v0.2 loads, Then no migration of existing consent is required (there are no released v0.1 users) and the Perplexity scripts behave as ordinary opt-in catalog entries.

### Should Have Features

- **Dev-only source override.** A non-synced, dev-build-only mechanism that points the curated source at a local working-tree directory for fast iteration, with a build-time guarantee that the production bundle physically omits the override path.
  - [ ] Given a dev build with the override configured, When a curated script is enabled/run, Then its code is read from the local working-tree directory.
  - [ ] Given a production build, When it runs, Then there is no code path that reads any dev override, and the override value is never written to `data.json`.

### Could Have Features

- **Minimal "Browse official" list.** A simple, viable list of curated scripts available to enable (richer browsing UX deferred).
- **"View source" deep links.** Curated → official repo link; imported → reveal the vault file.

### Won't Have (This Phase)

- Field-level merge for `data.json` across devices — accept Obsidian Sync's last-write-wins (documented limitation).
- Auto rename/move tracking for imported-script sources — user re-imports on Blocked.
- Independent catalog polling of a moving reference — rejected (defeats SHA-pinning).
- Multiple commands per script — 1:1 script↔command holds for now.
- Manual reordering of the paste-autodetect chain — deferred (kept cheap to add later via a single ordering chokepoint).
- Rich "Browse official" browsing experience beyond a minimal list.

---

## Detailed Feature Specifications

### Feature: Cross-device materialization & the Blocked recovery model (most complex)
**Description:** A script's *decision* (enabled + the okayed `{version, checksum}`) lives in synced storage, but its *code* never syncs. On any device, the plugin reconciles "what was decided" against "what code is present locally", materializing and verifying code as needed, and refusing to run anything that doesn't match.

**User Flow:**
1. User enables script S on device A; accepts disclosure; S becomes Active. The enable + okayed `{version, checksum}` ride the synced data file.
2. Device B receives the synced decision. S is "enabled" but its code is absent locally.
3. Device B materializes S's code (fetch for curated at the pinned reference; copy from the recorded vault path for imported).
4. Device B verifies the materialized code against the okayed `{version, checksum}`.
5. On match → S is Active on B and runs without re-consent. On mismatch or unavailable source → S is Blocked with a specific reason and recovery; it never runs.

**Business Rules:**
- Re-materialization source is chosen by provenance only: curated → official pinned source; imported → recorded vault-relative path.
- Consent is per-vault (rides the synced decision), not per-device; the device-B safety is the match-gate at materialization time, not a re-prompt.
- Code identity is the exact bytes of the script; verification compares the materialized code's checksum to the okayed checksum and the version to the okayed version.
- Re-enabling an unchanged script never re-discloses; an actual `{version, checksum}` change always re-discloses.

**Edge Cases:**
- Concurrent edits to the synced decision on two devices → last-write-wins (whole-file replication); documented limitation, no field merge.
- Same version, different checksum → drift → Blocked (fail-closed), even though SHA-pinning makes this near-impossible for curated scripts in production.
- Curated source unreachable (offline) on a device that hasn't materialized yet → Blocked (reason: offline) with retry.
- Imported source path missing/moved → Blocked (reason: source missing) with re-import recovery; no automatic rename tracking.
- Checksum computed over decoded text vs raw bytes could falsely report drift across line-ending/encoding differences → identity MUST be byte-exact and code MUST be materialized verbatim so this never happens.

---

## Success Metrics

> Markdown Mason is a free, open-source Obsidian plugin; "success" is measured in correctness, trust-safety, and code health rather than revenue.

### Key Performance Indicators

- **Adoption:** The Scripts tab shows the real set of scripts — 0% of users see a misleading empty panel when curated entries exist. Curated scripts are enable-able on demand (the four scripts are no longer compiled in).
- **Engagement:** Users can enable, disable, remove, reinstall, and update scripts and bind commands via the new tabs without editing files by hand.
- **Quality (trust-safety):** Zero code paths execute a script that does not match its okayed `{version, checksum}`; every Blocked state surfaces a reason + recovery; no script auto-runs on install/upgrade. The production bundle contains no dev-override read path.
- **Code health:** `main.js` no longer bundles curated script bodies or the hardcoded detector; one trust model and one state machine cover both provenances.

### Tracking Requirements

> "Tracking" here means observable/testable signals and debug-log traces (no telemetry is sent off-device; the plugin uses `console.debug` only).

| Event | Properties | Purpose |
|-------|------------|---------|
| Script state transition | script id, from-state, to-state, reason | Verify lifecycle correctness and Blocked reasons in tests/debug logs |
| Disclosure shown | script id, trigger (first-enable / identity-change) | Confirm consent appears only when required |
| Materialization result | script id, provenance, match/mismatch, source-available | Confirm match-gate and fail-closed behavior |
| Command registered/unregistered | script id | Confirm command lifecycle decoupled from enable and cleaned up on remove |
| Paste autodetect outcome | matched script id or "none" | Confirm chain ordering and raw-paste fallback |

---

## Constraints and Assumptions

### Constraints
- **Platform:** Obsidian Desktop only (Electron/Node runtime). Scripts are `.cjs`. Obsidian provides no native settings sub-tabs, so the segmented nav lives inside a single settings tab.
- **Sync:** Obsidian Sync replicates only the plugin's own core files (`manifest.json`, `main.js`, `data.json`) — not arbitrary sidecar files or script code. Therefore consent must ride `data.json` and code must be re-materialized per device (inherits the T7.5 Sync correction).
- **Distribution:** The official source is a commit-SHA-pinned vetted repository; it is the only auto-download source, and adding a script requires a documented, vetted PR (inherits ADR-8). Network access uses Obsidian's CORS-safe request API, not `fetch`.
- **Compliance:** Must continue to pass Obsidian community-submission rules (sentence-case UI text, no `innerHTML`/`outerHTML`, `console.debug` only, no default hotkeys, listener/command cleanup) — with heightened reviewer scrutiny because the plugin downloads and executes code.
- **Network discipline:** No background polling of a moving reference; updates ride pinned plugin releases.

### Assumptions
- There are **no released v0.1 users**, so no consent/data migration is required.
- Curated scripts are Markdown-in-note transforms only (per the vetted-repo policy); imported scripts are the user's own risk.
- Paste predicates are cheap, pure, and synchronous (mirrors the proven v0.1 parser predicate separation), so building the matcher chain on every paste is acceptable.
- Users who want hotkeys will bind them via Obsidian's core Hotkeys tab.

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| A script runs that the user didn't approve (trust bypass) | High | Low | Single trust model; enable-implies-consent; match-gate at materialization; remove the v0.1 bundled bypass |
| Dev-override path ships in production (arbitrary local code load) | High | Low | Build-time dead-code elimination so the prod bundle physically omits the path; override never stored in `data.json` |
| False "drift" from line-ending/encoding differences | Medium | Medium | Byte-exact checksum + verbatim materialization for both fetch and import |
| Cross-device confusion (script enabled but Blocked on device B) | Medium | Medium | Clear Blocked reason + recovery on the card; "offline"/"source missing"/"drift" distinguished |
| Curated source unreachable breaks the user | Medium | Low | Already-materialized scripts work offline; nothing auto-enables, so a fresh/offline state has nothing to break; retry offered |
| Imported catch-all hijacks a recognized format | Low | Medium | Deterministic chain order: curated before imported, then priority, then id |
| `data.json` last-write-wins loses a device's recent change | Low | Low | Documented limitation; no field-merge engine (YAGNI) |

## Open Questions

- [ ] None blocking. (All seven of the parked brief's open questions were resolved in the 2026-06-22 convergence; this PRD records them as decided.) Remaining specifics — exact catalog schema, the build flag mechanism, byte-exact I/O, and storage-migration details — are **HOW** concerns deferred to the SDD.

---

## Supporting Research

### Competitive Analysis
- **Templater (Obsidian):** establishes the user-script + per-script command + core-Hotkeys binding model this PRD adopts (the "Create command" + Run-script-launcher pattern). Lesson: decouple command registration from enabling, and lean on Obsidian's own Hotkeys tab rather than shipping defaults.
- **QuickAdd / Dataview-style plugins:** show that users accept a settings list of "things the plugin can do" with per-item toggles; reinforces card-row management.
- **Lesson applied:** no plugin in this space silently runs downloaded code; a visible, consented, removable lifecycle is the expected norm and a differentiator when done with an explicit checksum gate.

### User Research
- Direct evidence from the codebase: the v0.1 Scripts panel shows "No scripts installed yet" despite four working scripts (`src/ui/settingsTab.ts:119-125`), and "Import from vault…" is a non-functional placeholder (`src/ui/settingsTab.ts:141-153`) — confirming the visibility and control gaps this PRD targets.
- The T7.5 Sync verification spike established the real Sync replication boundary, grounding the cross-device requirements in observed behavior rather than assumption.

### Market Data
- Markdown Mason is a free community plugin; relevant "market" signal is Obsidian community-directory acceptance, which imposes the compliance constraints listed above and applies heightened scrutiny to plugins that download and execute code — making the explicit, auditable trust model a submission-readiness requirement, not just a nicety.
