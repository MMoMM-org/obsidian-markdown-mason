---
title: "Settings search: Markdown Mason settings in Obsidian's settings search"
status: draft
version: "1.0"
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

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| specId | string | Yes | Spec identifier (NNN-name format) |
| title | string | Yes | Feature title |
| status | enum: `DRAFT`, `IN_REVIEW`, `COMPLETE` | Yes | Document readiness |
| sections | SectionStatus[] | Yes | Status of each PRD section |
| clarificationsRemaining | number | Yes | Count of `[NEEDS CLARIFICATION]` markers |
| acceptanceCriteria | number | Yes | Total testable acceptance criteria defined |
| openQuestions | string[] | No | Unresolved items requiring stakeholder input |

### SectionStatus

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Section name |
| status | enum: `COMPLETE`, `NEEDS_CLARIFICATION`, `IN_PROGRESS` | Yes | Current state |
| detail | string | No | What clarification is needed or what's in progress |

---

## Product Overview

### Vision
Every Markdown Mason setting can be found by typing what it does into Obsidian's settings search, and the settings look and behave like the rest of Obsidian.

### Problem Statement
Obsidian 1.13 (public since 2026-07-30; current public release 1.15.1) rebuilt settings around a global search: "You can now search for settings by name or description … Community plugins can migrate to the new settings API to appear in search results." Markdown Mason has not migrated, so:

- **None of its 18 fixed settings, and none of its scripts or script commands, show up in settings search.** A user who types "footnotes", "reflow" or "debug" finds nothing from Mason, even though Mason owns those settings.
- **Its custom five-segment tab (General / Scripts / Commands / Format selection / Advanced) bypasses the new settings window.** It gets none of the keyboard navigation, back/history or search deep-links that native settings now have.
- **Obsidian's community scorecard flags it.** The 0.9.2 scorecard carries the warning "This PluginSettingTab does not implement getSettingDefinitions(); its settings will not appear in Obsidian's settings search for users on 1.13.0 or later". That costs scorecard standing on the public plugin listing.

If nothing changes, Mason's settings become harder to find than core settings and than competing plugins that have already migrated (Linter, Templater, BRAT, ExcaliBrain, Switcher++), and the scorecard warning stays.

### Value Proposition
- **For users:** jump straight to any Mason option from settings search, using the words they already use ("paste", "footnotes", "OCR", "hotkey"), and navigate it with the keyboard like any core setting.
- **For the maintainer:** a clean scorecard, and one definition per setting instead of a hand-built segment UI to maintain.

## User Personas

### Primary Persona: Note-taker who tunes formatting
- **Demographics:** Adult knowledge worker or student; daily Obsidian user on desktop; comfortable with settings, not a developer.
- **Goals:** Change how Paste and format or Format selection behaves (for example, turn on reflow for OCR text, or change the Resources heading) without hunting through tabs.
- **Pain Points:** Has to remember that the option lives under Community plugins → Markdown Mason → the right segment. Settings search, which now finds everything else, finds nothing from Mason.

### Secondary Personas
- **Script power user.** A desktop user who installs official or imported scripts, enables them, binds them to commands and hotkeys, and updates them. Wants to reach a specific script or its command quickly, see at a glance which scripts are active, blocked or have updates, and act on them (enable, update, re-review, retry, remove). Pain point: scripts are only reachable by opening the Scripts segment and scanning cards.
- **User on Obsidian older than 1.13.** Has not updated Obsidian. Goal: keep a working Mason. Impact: after this change they stay on Mason 0.9.4 (Obsidian does not offer them versions that need a newer app) until they update Obsidian.
- **Plugin maintainer.** Ships Mason releases. Goals: a scorecard without this warning, and less settings UI code to keep in sync with docs and tests.

## User Journey Maps

### Primary User Journey: Find and change a setting by searching
1. **Awareness:** The note-taker pastes OCR text that comes out broken and remembers Mason has a reflow option.
2. **Consideration:** Opens Settings and types "reflow" (or "OCR") instead of browsing plugin tabs.
3. **Adoption:** The result "Reflow wrapped text" appears, labelled as Mason's.
4. **Usage:** Selects the result, lands on the setting with it in view, turns it on; the change is saved immediately.
5. **Retention:** Next time, searches again instead of remembering where options live.

### Secondary User Journeys
- **Browse Mason's settings without searching (any 1.13+ user).** Opens Mason's settings page: general options first, then the Format selection groups (Cleanup, Lists, Headings, Footnotes), then Advanced, plus entries for the Scripts and Commands sub-pages. Moves through them with mouse or keyboard and returns with Back.
- **Manage a script (script power user).** Searches for a script by name, or opens the Scripts page. Sees each script's status and version. Enables or disables it, and uses its actions menu to view the source, update, re-review consent, retry or remove it. Uses Import from vault or Browse official to add scripts. If a script is blocked, the recovery action sits right on its row.
- **Turn a script into a command (script power user).** Opens the Commands page (or searches the script's name). Names the command, switches it on, then binds a hotkey in Obsidian's Hotkeys settings. Renaming an active command keeps it working under the new name.
- **Act on update notes (script power user).** After a Mason update, the update notes window offers to open the Scripts settings, and choosing it opens the Scripts page directly. On the main page, the Scripts entry shows that updates are waiting.
- **Stay on an older Obsidian (user below 1.13).** Their Mason stays at 0.9.4 with its existing settings UI. After updating Obsidian to 1.13+, they get the current Mason and its searchable settings. Mason's README and installation docs state the minimum Obsidian version.
- **Release and verify (maintainer).** Ships the release. The next scorecard scan no longer lists the settings-search warning, and the lint rule that enforces the declarative API is switched on.

## Feature Requirements

### Must Have Features

#### Feature 1: Fixed settings are searchable
- **User Story:** As a note-taker, I want every Mason setting to appear in Obsidian's settings search by its name and description, so that I can reach it without knowing which tab it is on.
- **Acceptance Criteria:**
  - [ ] Given Obsidian 1.13+ with Mason enabled, When the user searches a setting's exact name (any of the 18: Resources section heading, Show update notes, Numeric-only footnotes, Fit paste to list context, the 13 Format selection toggles, Debug logging), Then that setting appears in the results.
  - [ ] Given a search for a word that appears only in a setting's description (for example "ligature" or "OCR"), When results show, Then the matching Mason setting is included.
  - [ ] Given a search result for a Mason setting, When the user selects it, Then the setting is shown and can be changed there.
  - [ ] Given a search that matches no Mason setting, When results show, Then no Mason entry is listed.

#### Feature 2: Native main-page layout
- **User Story:** As a note-taker, I want Mason's settings page organised like core settings, so that I can scan and keyboard-navigate it the way I do everywhere else in Obsidian.
- **Acceptance Criteria:**
  - [ ] Given the user opens Mason's settings, When the page renders, Then the 4 general settings come first with no section heading, followed by Format selection, then Advanced, each under its own heading, plus entries for Scripts and Commands.
  - [ ] Given the Format selection section, When it renders, Then its 13 toggles appear under the headings Cleanup, Lists, Headings and Footnotes in today's order, with the explanation of which steps "Format selection" and "Paste and format" run.
  - [ ] Given the 4 toggles that apply only to "Format selection" (Cascade headings, Convert citations to footnotes, Resolve footnote identity, Move footnotes to resources), When shown, Then each still carries the "Format selection only — not applied by Paste and format" note.
  - [ ] Given the page, When rendered, Then the custom segment button bar is gone and all text is in sentence case.

#### Feature 3: Settings behave exactly as before
- **User Story:** As a note-taker, I want changing a setting to have the same effect as today, so that the migration changes how I find settings, not what they do.
- **Acceptance Criteria:**
  - [ ] Given an existing vault with saved Mason settings, When the user upgrades and opens settings, Then every control shows the previously saved value (no reset).
  - [ ] Given a fresh install, When settings are opened, Then defaults are as today: all Format selection toggles on except Reflow wrapped text, which is off; Show update notes, Numeric-only footnotes and Fit paste to list context on; Debug logging off; Resources heading "## Resources".
  - [ ] Given any setting is changed, When Obsidian is restarted, Then the new value is still in effect.
  - [ ] Given the user switches Debug logging on or off, When they next run a Mason command, Then logging follows the new value immediately, without a reload.
  - [ ] Given the user changes the Resources section heading or a Format selection toggle, When they next run the affected command, Then the command uses the new value.

#### Feature 4: Scripts sub-page with one row per script
- **User Story:** As a script power user, I want a Scripts page that lists each script with its status and actions, so that I can see and manage all my scripts in one native list.
- **Acceptance Criteria:**
  - [ ] Given installed or available scripts, When the user opens the Scripts page, Then each script has one row showing its name, provenance (Official or Imported), status (Active, Disabled, Update available, Available, Materializing, Blocked, Not installed) and version.
  - [ ] Given a script whose state allows it (Active, Update available, Disabled, Available), When the user flips its enable switch, Then the script is enabled or disabled as today, including the consent review before first enabling.
  - [ ] Given a script row, When the user opens its actions menu, Then it offers today's state-dependent actions (View source; Re-review consent; Update to version N; Retry fetch; Remove), and each does what it does today.
  - [ ] Given a blocked script, When its row renders, Then it shows the reason (source missing, bytes changed, offline, checksum mismatch) and the matching recovery action (Re-import or Retry fetch).
  - [ ] Given the Scripts page, When rendered, Then Import from vault and Browse official are available, and with no scripts an empty-state message explains how to get started.
  - [ ] Given any script action completes (enable, update, remove, import), When it finishes, Then the list reflects the new state without the user leaving and re-entering the page.
  - [ ] Given a script's name, When the user types it into settings search, Then that script's row is a result.

#### Feature 5: Commands sub-page
- **User Story:** As a script power user, I want a Commands page where I can turn each enabled script into a named command, so that I can bind it to a hotkey.
- **Acceptance Criteria:**
  - [ ] Given enabled scripts, When the user opens the Commands page, Then each enabled script has a row with a command name field and a create-command switch reflecting today's saved state. Disabled scripts are not listed.
  - [ ] Given the switch is turned on, When the user opens the command palette, Then the command is listed under the chosen name (or the script id if no name is set). Turning it off removes it without disabling the script.
  - [ ] Given an active command, When the user renames it, Then it stays available under the new name. Clearing the name falls back to the script id.
  - [ ] Given no enabled scripts, When the Commands page opens, Then a message tells the user to enable a script on the Scripts page first.
  - [ ] Given a script is enabled or disabled on the Scripts page, When the user opens the Commands page, Then its rows match the current set of enabled scripts.

#### Feature 6: Update indicator and deep link to Scripts
- **User Story:** As a script power user, I want to see from the main settings page that script updates are waiting, and to jump to them from the update notes, so that I don't miss updates.
- **Acceptance Criteria:**
  - [ ] Given N > 0 scripts have updates available, When the main Mason settings page shows, Then the Scripts entry indicates that updates are waiting and how many.
  - [ ] Given no updates are available, When the page shows, Then the Scripts entry shows no update indicator.
  - [ ] Given the user applies or removes updates on the Scripts page, When they return to the main page, Then the indicator reflects the new count.
  - [ ] Given the update notes window after a Mason update, When the user chooses to open the Scripts settings, Then Obsidian's settings open directly on Mason's Scripts page.

#### Feature 7: Obsidian 1.13 becomes the minimum version
- **User Story:** As a user on older Obsidian, I want Mason to state clearly that it now needs Obsidian 1.13+, so that I understand why I'm not offered the new version and what to do.
- **Acceptance Criteria:**
  - [ ] Given the released plugin, When its listing and README are read, Then both state Obsidian 1.13.0 as the minimum version.
  - [ ] Given a user on Obsidian older than 1.13, When they check for plugin updates, Then they are not offered this version and keep their installed Mason working.
  - [ ] Given the release notes for this version, When read, Then they mention the new minimum Obsidian version and the settings search support.

### Should Have Features

#### Feature 8: Search finds settings by everyday words
- **User Story:** As a note-taker, I want search to find Mason settings by the words I use, not only their exact titles, so that "OCR", "hotkey" or "catalog" still gets me there.
- **Acceptance Criteria:**
  - [ ] Given these words and their target settings: "OCR" / "TextSniper" (Reflow wrapped text), "paste" (Fit paste to list context and the Format selection group), "footnotes" (footnote settings), "hotkey" / "command palette" (Commands), "catalog" / "official scripts" (Scripts), "console" / "debug" (Debug logging), When each word is searched, Then the corresponding Mason setting or page is among the results.
  - [ ] Given a synonym term, When it is searched, Then it does not surface unrelated Mason settings.

#### Feature 9: Plugin identity and documentation link stay reachable
- **User Story:** As a user, I want to still see Mason's version and reach its documentation from its settings, so that I can check what I'm running and get help.
- **Acceptance Criteria:**
  - [ ] Given Mason's settings page, When opened, Then the plugin version and a working Documentation link are visible somewhere on it, without adding a heading above the general settings.

#### Feature 10: Docs, comments and lint match the new settings
- **User Story:** As the maintainer, I want the docs, code comments and lint rules to describe the new settings accurately, so that future changes don't drift.
- **Acceptance Criteria:**
  - [ ] Given the user docs (README, docs/configuration.md, docs/installation.md), When read, Then they describe the new layout (main page, Scripts and Commands pages, settings search) rather than five segments, give the correct minimum Obsidian version, and give step counts that match the settings.
  - [ ] Given the source comments that today say "four-segment", "eleven toggles" or mention a "Run-script launcher", When read, Then they match the code.
  - [ ] Given the lint configuration, When lint runs, Then the rule requiring the declarative settings API is enabled and passes, and the comment claiming 1.13 is not generally available is gone.

### Could Have Features
- **Filter box on the Scripts list:** a local filter that narrows the Scripts list as the user types. Only worth it for users with many scripts.
- **Summary on the Commands entry:** the Commands entry on the main page shows how many commands are active (for example "2 commands").

### Won't Have (This Phase)
- **Support for Obsidian below 1.13** (no fallback settings UI). Those users stay on 0.9.4.
- **New settings, or changes to what any setting does.** This is a presentation and findability change only.
- **Changes to the Browse official and script consent windows** beyond what is needed to open them from the new pages.
- **Restoring the custom segment bar or custom card styling.** The native look replaces them.
- **Searching inside script contents or catalog descriptions** that are not shown on a settings row.

## Detailed Feature Specifications

### Feature: Scripts sub-page with one row per script (Feature 4)
**Description:** The Scripts area is Mason's richest settings surface: a changing set of scripts, each with a lifecycle state and several state-dependent actions. Today it is a hand-drawn card grid. It becomes a native list on its own settings page, where each row is a script and the row carries the same information and actions the card did.

**User Flow:**
1. User opens Mason's settings and selects the Scripts entry, or selects a script from settings search, or chooses "open Scripts settings" in the update notes.
2. System shows the Scripts page: one row per script, plus Import from vault and Browse official.
3. User flips a script's enable switch.
4. System runs today's enable flow (consent review the first time, fetch and verify if needed), then updates that row's status in place.
5. User opens a row's actions menu and picks an action (for example Update to version N).
6. System performs it and refreshes the list. The update indicator on the main page reflects the new count.

**Business Rules:**
- Rule 1: Each script appears exactly once, in the same order as today.
- Rule 2: Which controls and actions a row offers depends only on the script's state, using the same mapping as today (for example, no enable switch while Blocked, Materializing or Not installed; Re-review consent only once consent exists).
- Rule 3: After any action that changes scripts, the Scripts list, the Commands page and the update indicator all agree on the new state the next time they are shown.
- Rule 4: A script's name and status are visible without opening any menu.
- Rule 5: Search finds a script by its display name. Description text that is shown on the row is searchable too.
- Rule 6: Nothing a script record contains (id, name, source, description) is treated as markup. Hostile text appears as literal text, as it does today.

**Edge Cases:**
- No scripts at all → Empty-state message plus Import from vault and Browse official.
- Script catalog unreachable (offline) → The list still shows local scripts with their stored status, affected rows show the offline reason with Retry fetch, and nothing errors.
- Script removed while its row is visible → The row disappears after the action and the Commands page no longer lists it.
- Two actions triggered in quick succession → Only one consistent list results; no duplicated rows or toolbar.
- Very long script name or description → The row stays readable (wraps or truncates) without breaking the page.
- User selects a search hit for a script and the page needs a moment to load scripts → The page opens and the script appears without the user searching again.

## Success Metrics

### Key Performance Indicators

- **Adoption:** 100% of Mason's user-facing settings are discoverable through settings search: all 18 fixed settings, the Scripts and Commands pages, and every script row.
- **Engagement:** For the vocabulary words in Feature 8, every term returns its target in a manual search test (target 100% hit rate). Mason ships no analytics, so engagement is checked by test, not measured in the field.
- **Quality:** Zero behaviour regressions: the existing settings behaviour tests, adapted to the new layout, all pass, the full suite passes, and the manual smoke test in Obsidian ≥1.13 passes. Zero new GitHub issues about lost or reset settings in the 30 days after release.
- **Business Impact:** The community scorecard for the first release containing this work no longer lists the `getSettingDefinitions()` warning.

### Tracking Requirements

Mason collects no usage telemetry by design, and this spec does not add any. Success is tracked through these checks:

| Event | Properties | Purpose |
|-------|------------|---------|
| Scorecard scan after release | plugin version, list of warnings | Confirms the settings-search warning is gone (Business Impact) |
| Manual search smoke test (release checklist) | Obsidian version, each search term, hit / miss, lands on setting yes/no | Verifies Adoption and Engagement targets, including search-to-sub-page navigation |
| Automated test run (CI) | tests passed/failed, settings defaults and persistence cases | Verifies Quality (no regressions) |
| GitHub issues labelled settings, 30 days post-release | count, summary | Detects missed regressions in the field (Quality) |

---

## Constraints and Assumptions

### Constraints
- **Platform:** Requires Obsidian 1.13.0 or newer (decision: Path A). Mason stays desktop-only, as today.
- **Search scope is set by Obsidian.** Search reaches only each setting's declared name, description and extra search terms, not anything drawn freely inside a row. Feature 8 relies on those extra terms.
- **Obsidian owns the settings window layout** (navigation, back button, search box). Mason cannot add its own navigation bar.
- **Obsidian style guide:** sentence case, no heading above the first group of settings, headings from the second section on, sub-pages used sparingly, one control per row where possible.
- **Existing saved settings and script records must be read without migration loss**, because users are upgrading from 0.9.4.
- **One feature per change** (repository standard): this spec covers the settings migration and the doc fixes it causes, nothing else.

### Assumptions
- Most active Mason users already run Obsidian 1.13+, given 1.13 has been public since 2026-07-30 and the current public release is 1.15.1. Users below 1.13 are an acceptable minority who keep 0.9.4.
- Obsidian does not offer a plugin update to users whose app is older than the plugin's declared minimum version, so those users are not broken.
- Selecting a search result that lives on a sub-page opens that sub-page. This is implied by Obsidian's 1.13.1 fix for "setting pages not always loading when navigating to them from setting search results"; it is checked in the manual smoke test.
- Obsidian's settings window supports showing a status or value on a sub-page entry, which the update indicator uses (Feature 6).

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Saved settings appear reset after upgrade (for example the nested Format selection choices) | High | Medium | Acceptance criteria in Feature 3. Automated tests load settings saved by 0.9.4 and assert the values shown. |
| Users on Obsidian below 1.13 lose updates | Medium | Medium | Accepted trade-off (Path A). State the minimum version in the README, release notes and listing (Feature 7). |
| Search hits that live on a sub-page don't open it reliably | Medium | Low | Manual smoke test on the current public Obsidian. If it is unreliable, add extra search terms on the page entry so search still leads users to the page. |
| Script rows lose information or actions compared with today's cards | High | Low | Feature 4 lists every state, action and recovery as acceptance criteria. Existing scripts-tab behaviour tests are carried over. |
| Lists don't refresh after script actions, showing stale state | Medium | Medium | Business Rule 3 plus its acceptance criterion. Tests cover refresh after each action type. |
| A large share of today's ~2,000 lines of settings UI tests depends on the old layout and has to be rewritten | Medium | High | Keep behaviour assertions (values, saving, actions, sentence case, safety against hostile text). Rewrite only the layout-specific ones. Sized in the SDD and plan. |
| Extra search terms surface unrelated settings (noise) | Low | Medium | Feature 8's second acceptance criterion. Keep terms specific to one target. |

## Open Questions

- [x] Migration path: Path A, minimum Obsidian 1.13.0 (decided 2026-11-21).
- [x] Scripts presentation: native list, one row per script (decided 2026-11-21).
- [x] Layout: general settings at the top, Format selection and Advanced as groups, Scripts and Commands as sub-pages (decided 2026-11-21).
- [x] Doc and lint drift: in scope (decided 2026-11-21).
- [ ] Where plugin identity (version and Documentation link, Feature 9) is shown, for example a description line or a final row: to be settled in the SDD within the style-guide constraint.
- [ ] Exactly how search results display and navigate into sub-pages on the current Obsidian: to be confirmed in the manual smoke test. The docs don't describe it.

---

## Supporting Research

### Competitive Analysis
Plugins that adopted the declarative settings API (source read on GitHub, 2026-11-21):
- **Linter** is the closest precedent: its old UI had custom tabs per rule category. Each category became a sub-page, each rule a group, custom rows carry extra search terms, and lists handle folders and extensions. It requires Obsidian 1.14.4 and dropped the old UI.
- **Templater** (min 1.13.0) and **Switcher++** (min 1.15.0) also require the new API and dropped the old UI.
- **BRAT** (min 1.11.4) and **ExcaliBrain** (min 1.8.7) keep both UIs. ExcaliBrain folds a large custom editor into one row and lists every inner label as extra search terms so they stay findable.
- Lesson: plugins with custom tab UIs move them to sub-pages, and give custom rows extra search terms so search can still find them.

### User Research
- Obsidian 1.13 public changelog (2026-07-30): settings revamped "with keyboard navigation, search, and new APIs". "Community plugins can migrate to the new settings API to appear in search results." 1.13.1 adds focus restore on Back, history via the mouse back button, a fix for search results that open sub-pages, and a value label on page entries. It also deprecates the community Settings Search plugin, because the built-in search replaces it.
- Obsidian developer docs: Settings page and "Migrate to declarative settings" guide (Path A recommended, Path B dual support), plus the style guide rules listed under Constraints.
- Mason's own docs (docs/configuration.md, docs/installation.md) describe five segments, and supply the user vocabulary used for Feature 8.
- No direct user interviews. The evidence is the platform change, the scorecard warning and the plugin's own documentation.

### Market Data
- Mason has about 2,000 total downloads and 16 releases (community listing, Sep 2026).
- Obsidian release timeline: 1.13.0 early access 2026-05-28; 1.13.4 public 2026-07-30; current public release 1.15.1 (2026-11-12).
- The community scorecard checks plugins for this API and shows a warning to their developers.
