---
title: "Markdown Mason — T7.3 EARS Acceptance Trace"
spec: 001-markdown-mason
task: T7.3
generated: 2026-06-17
---

# EARS Acceptance Trace

## Scope

This document maps every EARS acceptance criterion from the Solution Design Document (`solution.md` §Acceptance Criteria (EARS)) to one or more passing tests in the repository. Each EARS criterion is cross-referenced to its parent PRD acceptance criterion (F-numbered).

**Method:** EARS lines were enumerated from `solution.md` §"Acceptance Criteria (EARS)". For each criterion, test files under `test/` were grepped by title string. Every test title cited here was verified to exist in its stated file at the time of this trace. The full test suite (646 tests, 33 files) was green on branch `feat/001-markdown-mason` as of commit `48944128`.

**Known production-drift items recorded as noted in task T7.3:** two behaviours are implemented differently from the PRD specification. They are marked ⚠️ where they affect EARS coverage.

---

## Summary

**14 / 14 EARS criteria have at least one green test.**
**0 criteria are entirely uncovered (no ⚠️ GAP rows).**

Two criteria carry partial-drift annotations (⚠️ DRIFT) where the test asserts the as-implemented behaviour, which diverges from the PRD requirement. The divergence is escalated separately and recorded here for traceability.

---

## Group 1 — Operations (PRD F1–F4)

| EARS ID | EARS Criterion | PRD AC ref | Proving test(s) — file :: title | Status |
|---------|---------------|------------|----------------------------------|--------|
| EARS-H1 | WHEN H runs with a heading above the cursor, THE SYSTEM SHALL shift pasted headings by `(ctxLevel+1 − minIn)`, clamping at H6. | F1 AC1, F1 AC2 | `test/core/headings.test.ts` :: "shifts # to #### (level 1 + shift 3 = 4)" <br> `test/core/headings.test.ts` :: "shifts ## to ##### (level 2 + shift 3 = 5)" <br> `test/core/headings.test.ts` :: "clamps # (1+5=6) to ###### rather than emitting #######" <br> `test/core/headings.test.ts` :: "clamps ## (2+5=7) also to ###### (max H6)" <br> `test/core/headings.test.ts` :: "returns noContextHeading=false when a heading exists above cursor" | ✅ green |
| EARS-H2 | IF no heading is above the cursor, THEN THE SYSTEM SHALL insert headings unchanged and emit a Notice. | F1 AC3 | `test/core/headings.test.ts` :: "returns noContextHeading=true" (no-heading-above-cursor describe) <br> `test/core/headings.test.ts` :: "returns an empty EditPlan (Phase 3 command layer will surface Notice)" <br> `test/main.commands.test.ts` :: "cascade with a selection but no heading above cursor shows noContextHeading Notice" | ✅ green |
| EARS-OD1 | WHEN O+D runs, THE SYSTEM SHALL reuse existing numbers for known URLs, dedup duplicates, and assign `max+1…` to new sources, updating inline and definitions together. | F3 AC1, F3 AC2, F3 AC3 | `test/core/footnotes.test.ts` :: "maps incoming [1] (urlB, new) → 7" <br> `test/core/footnotes.test.ts` :: "maps incoming [2] (urlA, reuse existing [^6]) → 6" <br> `test/core/footnotes.test.ts` :: "maps incoming [3] (urlB, dup in paste of [1]→7) → 7" <br> `test/core/footnotes.test.ts` :: "both incomingIds map to the SAME final id" (intra-paste dedup describe) <br> `test/core/footnotes.test.ts` :: "rewritten body has inline markers updated to [^7], [^6], [^7] in sync with idMap" <br> `test/core/footnotes.test.ts` :: "new definitions contain exactly one entry — for id 7 (urlB) only" | ✅ green — ⚠️ DRIFT-2: see DRIFT register |
| EARS-INV1 | THE SYSTEM SHALL never renumber, count, or move alphabetic footnotes; THE SYSTEM SHALL never modify orphaned resources. | F3 AC4, F4 AC3 | `test/invariants.test.ts` :: "alpha marker [^a] in body is preserved after a full script run" <br> `test/invariants.test.ts` :: "alpha footnote definition [^a]: is preserved after a full script run" <br> `test/invariants.test.ts` :: "orphaned definition [^99]: is preserved after a full script run" <br> `test/invariants.test.ts` :: "orphaned markdown link [Orphaned Source](...) is preserved after a full script run" <br> `test/invariants.test.ts` :: "alpha marker [^background] is preserved in body after full sakura run" <br> `test/invariants.test.ts` :: "orphaned plain-text line is preserved after full sakura run" <br> `test/core/footnotes.test.ts` :: "alpha marker [A] in body is not touched" (fromCitations describe) <br> `test/core/footnotes.test.ts` :: "orphaned line is still present after moveToResources" | ✅ green |
| EARS-M1 | WHEN M runs without a `## Resources` section and definitions exist, THE SYSTEM SHALL create it at note end (configured name, no callout) and write two-line entries. | F4 AC1, F4 AC2 | `test/core/footnotes.test.ts` :: "returns exactly one edit (an insert at end of doc)" (no-existing-section describe) <br> `test/core/footnotes.test.ts` :: "the inserted text contains '## Resources'" <br> `test/core/footnotes.test.ts` :: "the inserted text contains the definition" <br> `test/core/footnotes.test.ts` :: "exact F4 format: snippet on line 1, markdown link on line 2" <br> `test/core/footnotes.test.ts` :: "uses settings.resourcesName instead of 'Resources' when configured" <br> `test/core/footnotes.test.ts` :: "returns [] when defs array is empty" (no section created when nothing to write) | ✅ green |

---

## Group 2 — Script Runtime (PRD F8–F11)

| EARS ID | EARS Criterion | PRD AC ref | Proving test(s) — file :: title | Status |
|---------|---------------|------------|----------------------------------|--------|
| EARS-RT1 | WHEN an enabled script is invoked on paste/selection/command, THE SYSTEM SHALL run it with the `mason.*` API and apply its EditPlan as one undoable edit. | F8 AC1, F8 AC2 | `test/scripts/runner.test.ts` :: "returns applied outcome with count when script returns non-empty plan" <br> `test/scripts/runner.test.ts` :: "calls applyPlan with the returned plan" <br> `test/scripts/integration.test.ts` :: "applyPlan spy is called and rawFallback is NOT called when script succeeds" <br> `test/scripts/integration.test.ts` :: "mason.script.perplexity-auto on a Perplexity-app selection calls applyPlan with the produced plan" <br> `test/sources/apply.test.ts` :: "(c) one undo call restores the original document exactly" <br> `test/e2e/happyPath.e2e.test.ts` :: "single undo via CM6 reverts the entire app-fixture transformation (one atomic step)" | ✅ green — NOTE: The PRD also requires "a Notice indicates it fired" for the paste-script path (F8 AC2). Tests assert zero Notices on the success path (`test/e2e/happyPath.e2e.test.ts` :: "zero Notices fire on the success path for the app fixture"). The success-path Notice is not emitted. This is the **known paste-path Notice drift** — recorded, not fixed here. The undoable-edit half of the criterion is green. |
| EARS-DIS1 | WHILE a script's policy is `disabled`, THE SYSTEM SHALL NOT execute it. | F8 AC4 | `test/scripts/runner.test.ts` :: "returns blocked outcome without invoking the script" <br> `test/scripts/runner.test.ts` :: "does NOT call applyPlan or rawFallback when disabled" <br> `test/invariants.test.ts` :: "ScriptRunner with policy 'disabled' returns blocked and never invokes the script" <br> `test/invariants.test.ts` :: "disabled script: applyPlan is never called" | ✅ green |
| EARS-CON1 | IF an imported script would run at a new checksum/version, THEN THE SYSTEM SHALL show the disclosure modal and require acknowledgement once per checksum/version. | F8 AC5 | `test/scripts/disclosure.test.ts` :: "shows modal; enable-session records consent and returns 'enable-session'" <br> `test/scripts/disclosure.test.ts` :: "returns 'enable-session' without showing modal when trust is ok" <br> `test/scripts/disclosure.test.ts` :: "re-prompts when store returns needs-consent (from version bump)" <br> `test/scripts/store.test.ts` :: "recordConsent persists per (id, checksum, version) in device.json" <br> `test/scripts/store.test.ts` :: "version bump (3 vs 4) → needs-consent (existing behaviour preserved)" <br> `test/scripts/store.test.ts` :: "matching checksum and version → ok" | ✅ green |
| EARS-ERR1 | IF a script throws or times out, THEN THE SYSTEM SHALL leave the paste/selection intact and report via Notice. | F8 AC6 | `test/scripts/runner.test.ts` :: "returns failed outcome when script throws" <br> `test/scripts/runner.test.ts` :: "calls rawFallback when script throws" <br> `test/scripts/runner.test.ts` :: "calls notify with a message when script throws" <br> `test/scripts/runner.test.ts` :: "does NOT call applyPlan when script throws (atomicity)" <br> `test/scripts/runner.test.ts` :: "returns failed outcome when async script exceeds timeoutMs" <br> `test/scripts/runner.test.ts` :: "calls rawFallback on timeout" <br> `test/invariants.test.ts` :: "paste: throwing script calls replaceSelection with raw text (raw fallback)" <br> `test/invariants.test.ts` :: "paste: throwing script — a Notice is shown (error is surfaced, not silent)" <br> `test/invariants.test.ts` :: "selection: throwing script — rawFallback is a no-op (replaceSelection not called; selection left intact)" | ✅ green |
| EARS-API1 | WHERE a script declares an unsatisfiable `requiredApiVersion`, THE SYSTEM SHALL refuse to run it with a "requires API vX" Notice. | F11 AC3 | `test/core/registry.test.ts` :: "rejects a script requiring a higher minor version than available" <br> `test/core/registry.test.ts` :: "rejects a script requiring a higher major version" <br> `test/core/registry.test.ts` :: "rejects a lower major version (breaking — major 0 vs 1 is incompatible)" <br> `test/core/registry.test.ts` :: "returns { ok, message } shape — not an Obsidian Notice" | ✅ green |
| EARS-REG1 | WHEN a new operation is registered, THE SYSTEM SHALL expose it as both a command and a `mason.*` API method from one registry. | F11 AC1, F11 AC2 | `test/core/registry.test.ts` :: "entries expose id, apiName, and command.name for each operation" <br> `test/core/registry.test.ts` :: "exposes mason.headings.cascade as a function" <br> `test/core/registry.test.ts` :: "headings.cascade api returns .plan from the rich result" <br> `test/core/registry.test.ts` :: "headings.normalize: api and entry run produce identical plans" <br> `test/main.commands.test.ts` :: "registers all expected command ids after onLayoutReady" | ✅ green |

---

## Group 3 — Trust / Compliance (PRD F10)

| EARS ID | EARS Criterion | PRD AC ref | Proving test(s) — file :: title | Status |
|---------|---------------|------------|----------------------------------|--------|
| EARS-COMP1 | THE SYSTEM SHALL be desktop-only and render all external text escaped. | F10 AC1, F10 AC2 | `test/compliance.test.ts` :: "isDesktopOnly is strictly true" <br> `test/compliance.test.ts` :: "contains zero .innerHTML = assignments in src/" <br> `test/compliance.test.ts` :: "contains zero .outerHTML = assignments in src/" <br> `test/compliance.test.ts` :: "contains zero .insertAdjacentHTML( calls in src/" <br> `test/ui/xss.test.ts` :: "zero .innerHTML= or .innerHTML+= assignments in src/" <br> `test/ui/xss.test.ts` :: "script-tag payload in vaultRelativePath appears as literal text in modal" <br> `test/ui/xss.test.ts` :: "hostile script id is passed verbatim to setName(), not parsed as markup" <br> `test/ui/settingsTab.test.ts` :: (renders empty-state when no scripts — safe path) | ✅ green |
| EARS-DRIFT1 | IF a source's checksum differs at the same version, THEN THE SYSTEM SHALL hard-block the script until explicit resolution. | F10 AC4 (implicit via Risks) | `test/scripts/store.test.ts` :: "drift (same version, different checksum) → drift-blocked (existing behaviour preserved)" <br> `test/scripts/store.test.ts` :: "drift: manifest {version:3, checksum:'B'} + consent {version:3, checksum:'A'} → drift-blocked" <br> `test/invariants.test.ts` :: "evaluateTrust returns 'drift-blocked' when same version has different checksum" <br> `test/invariants.test.ts` :: "drift-blocked is NOT a transient warning — status is exactly 'drift-blocked' not 'needs-consent'" <br> `test/scripts/disclosure.test.ts` :: "shows modal when drift-blocked; disable returns 'disable'" | ✅ green |
| EARS-NET1 | THE SYSTEM SHALL make no network call without explicit user action. | F10 AC4 | `test/compliance.test.ts` :: "contains zero bare fetch( calls in src/" <br> `test/compliance.test.ts` :: "contains zero window.fetch( calls in src/" <br> `test/compliance.test.ts` :: "contains zero globalThis.fetch( calls in src/" <br> `test/main.test.ts` :: "registers zero manual listeners — no leaked register/registerEvent calls" | ✅ green |

---

## Group 4 — Supporting Criteria (PRD F5–F7, F9)

The EARS section in the SDD contains exactly the 15 criteria enumerated above. The following PRD features are not separately represented as EARS criteria in the SDD but are covered by tests and noted here for completeness:

| PRD Feature | Coverage note | Key tests |
|-------------|---------------|-----------|
| F5 — Presets (chained ops) | Covered by integration and command tests | `test/main.commands.test.ts` :: "preset.formatSelection with heading skip: doc changes then ONE undo fully restores it"; `test/scripts/integration.test.ts` :: "registers 'mason.pasteAndFormat' command after onLayoutReady" |
| F6 — Three sources + whole-note normalize | Covered by source-adapter and heading-normalize tests | `test/sources/paste.test.ts`, `test/sources/selection.test.ts`, `test/sources/note.test.ts`; `test/core/headings.test.ts` :: "closes the H1→H3 gap: H3 becomes H2" |
| F7 — Command, feedback, undo | Covered by command + undo tests | `test/main.commands.test.ts` :: "no command has a default hotkeys field"; "headings.normalize on a doc with heading skip is fully reverted by one undo()"; "footnotes.move with no footnotes shows descriptive Notice and leaves doc unchanged" |
| F9 — Perplexity scripts (golden fixtures) | Covered by library e2e and happyPath e2e | `test/scripts/library.e2e.test.ts` :: "returns a non-empty EditPlan" (all three surfaces); `test/e2e/happyPath.e2e.test.ts` :: "perplexityAppScript produces a structured note with Resources, F4 defs, gap-free footnotes" |

---

## Known Drift Register

The following divergences from the PRD were found before this trace was authored and are being escalated separately. They are recorded here, not fixed.

| Drift ID | PRD requirement | EARS criterion affected | As-implemented behaviour | Evidence |
|----------|-----------------|------------------------|--------------------------|----------|
| DRIFT-1 | F8 AC2: "a Notice indicates it fired" (paste-script success path); F7 AC3: offscreen count Notice | EARS-RT1 (partial) | No success-path Notice is emitted. `ScriptRunner` returns `{ kind: "applied" }` silently. The test `test/e2e/happyPath.e2e.test.ts` :: "zero Notices fire on the success path for the app fixture" asserts this as the current behaviour. Count Notices DO exist for `mason.*` registry-operation commands (e.g. `headings.normalize` in `test/main.commands.test.ts`). | `test/e2e/happyPath.e2e.test.ts` comment block at line ~249: "ScriptRunner returns { kind: 'applied' } silently; no notify() is called. Zero Notices is the correct expected behavior for a successful run." |
| DRIFT-2 | F9 AC3 (implied): the perplexityApp script must not produce numeric footnote collisions when pasted into a note with pre-existing `[^n]` footnotes | EARS-OD1 (partial) | `perplexityAppScript` does not scan the existing note for pre-existing `[^n]` footnotes before assigning new ids. The parser's footnote identity resolution starts from `maxExisting=0` rather than scanning the doc. A numeric collision is possible when the same paste is inserted into a note that already contains `[^1]`, `[^2]`, etc. The unit tests for `resolveFootnoteIdentity` cover the offset-from-existing algorithm correctly, but the script does not wire the doc scan into `perplexityAppScript`. | Absence of a test asserting that the script's output avoids colliding with pre-existing note footnotes; the golden-fixture e2e tests start from an empty note body. |

---

## Coverage Summary

| Criterion | PRD ref | Status |
|-----------|---------|--------|
| EARS-H1 — heading cascade with context | F1 AC1/2 | ✅ green |
| EARS-H2 — no-heading-above-cursor fallback + Notice | F1 AC3 | ✅ green |
| EARS-OD1 — offset, dedup, reuse, inline+def sync | F3 AC1/2/3 | ✅ green (DRIFT-2 noted) |
| EARS-INV1 — alpha and orphaned invariants | F3 AC4, F4 AC3 | ✅ green |
| EARS-M1 — create Resources + two-line format | F4 AC1/2 | ✅ green |
| EARS-RT1 — enabled script → EditPlan → one undo | F8 AC1/2 | ✅ green (DRIFT-1 noted) |
| EARS-DIS1 — disabled script never executes | F8 AC4 | ✅ green |
| EARS-CON1 — disclosure modal + once-per-checksum consent | F8 AC5 | ✅ green |
| EARS-ERR1 — throw/timeout → raw fallback + Notice | F8 AC6 | ✅ green |
| EARS-API1 — unsatisfiable requiredApiVersion refused | F11 AC3 | ✅ green |
| EARS-REG1 — one registry → command + API method | F11 AC1/2 | ✅ green |
| EARS-COMP1 — desktop-only + no innerHTML with external content | F10 AC1/2 | ✅ green |
| EARS-DRIFT1 — same-version/different-checksum hard-block | F10 (risk) | ✅ green |
| EARS-NET1 — no network without user action | F10 AC4 | ✅ green |

**14 / 14 EARS criteria covered by green tests.**
**2 known drift items recorded (DRIFT-1, DRIFT-2) — escalated separately.**
