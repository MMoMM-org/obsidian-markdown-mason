---
title: "Phase 4: Perplexity Parsers & Auto-Dispatcher"
status: completed
version: "1.0"
phase: 4
---

# Phase 4: Perplexity Parsers & Auto-Dispatcher

## Phase Context

**GATE**: Read before starting.

**Specification References**:
- `[ref: SDD/Per-surface parser strategies]` `[ref: SDD/ADR-9]`
- `[ref: PRD/Feature 9]` `[ref: README §2]`
- Fixtures: `assets/sakura-in-tokyo-{app,web,web-download}.md`

**Key Decisions**:
- Three grammars → three parsers + a sniffing dispatcher (ADR-9). Pure logic, fixture-driven.

**Dependencies**: Phase 2 (core types, `ParseResult`).

---

## Tasks

Delivers the pure, fixture-tested parsers producing `ParseResult` for the core operations. All
parsers are `[parallel: true]` after T4.1.

**Expected `ParseResult` per fixture (golden targets):**
- **app:** per `## Answer`/`Sources` pair → `sources` with `incomingId` **globally-unique sequential across all answer blocks** (block 1 → 1..N₁, block 2 → (N₁+1)..(N₁+N₂), etc.) — ~~incomingId restarting per answer (no global offset)~~ (revised in Phase 5; see T4.2 note); `url` from the `[n] <title> <url>` line, `title` the text between; `body` strips `Sources` marker + entry lines and renumbers prose inline markers to global values; identity stage deduplicates by URL downstream; multiple pairs preserved.
- **web:** `sources` derived from each inline `[text](url)` (title=text, url=href, `incomingId` sequential in document order); `body` is the text with those links marked for footnote conversion; no `Sources` block.
- **web-download:** HTML stripped; `sources` from `[^a_b]: <url>` lines (url only → title = URL host); inline `[^a_b]` mapped; `a_b` namespacing preserved until identity renumbers; `---` separates answers.

- [x] **T4.1 Parser interface** `[activity: domain-modeling]`
  1. Prime: `[ref: SDD/parsers/types]`
  2. Test: type fixture for `CitationParser { canParse, parse }`.
  3. Implement: `src/parsers/types.ts`.
  4. Validate: typecheck clean.
  - Success: parser contract exists `[ref: SDD/ADR-9]`

- [x] **T4.2 perplexity-app parser** `[activity: domain-modeling]` `[parallel: true]`
  1. Prime: `assets/sakura-in-tokyo-app.md` `[ref: SDD/parser strategies]`
  2. Test: splits on the bare `Sources` marker (NOT a heading) within each `## Answer` block; parses inline `[\d+]`; parses `Sources` lines `[\d+] <title> <url>`; **outputs globally-unique sequential `incomingId` across all answer blocks (block 1 → 1..N₁, block 2 → (N₁+1)..(N₁+N₂), etc.); `body` strips the `Sources` marker line and all `[n] title url` source-entry lines, and renumbers inline prose markers to their global values; `sources[]` carries all source data; identity stage deduplicates by URL downstream**. (revised in Phase 5: fixed per-block incomingId restart that caused silent collision in `resolveFootnoteIdentity` — second block's sources were dropped because duplicate incomingIds keyed the same identity slot.)
  3. Implement: `src/parsers/perplexityApp.ts`.
  4. Validate: golden-fixture test passes.
  - Success: `[ref: PRD/AC F9.2 (app), F9.3]`

- [x] **T4.3 perplexity-web parser** `[activity: domain-modeling]` `[parallel: true]`
  1. Prime: `assets/sakura-in-tokyo-web.md`
  2. Test: extracts inline `[text](url)` links as sources (title=text, url=href); no markers/block; golden output.
  3. Implement: `src/parsers/perplexityWeb.ts`.
  4. Validate: golden-fixture test passes.
  - Success: `[ref: PRD/AC F9.2 (web), F9.3]`

- [x] **T4.4 perplexity-web-download parser** `[activity: domain-modeling]` `[parallel: true]`
  1. Prime: `assets/sakura-in-tokyo-web-download.md`
  2. Test: strips HTML (`<img>`, hidden `<span>`, `⁂`); reads inline `[^a_b]` + definition list `[^a_b]: <url>`; renumbers `a_b`→sequential; derives title from URL host; `---` answer separation; golden output.
  3. Implement: `src/parsers/perplexityWebDownload.ts`.
  4. Validate: golden-fixture test passes.
  - Success: `[ref: PRD/AC F9.2 (web-download), F9.3]`

- [x] **T4.5 Format detector (auto-dispatcher)** `[activity: domain-modeling]`
  1. Prime: `[ref: SDD/detect (perplexity-auto dispatcher)]`
  2. Test: `Sources`/`Citations:`/`Quellen` block ⇒ app; `^\[\^\w+_\w+\]:` def lines ⇒ web-download; only inline `[text](url)` ⇒ web; none ⇒ null; each of the three fixtures routes correctly.
  3. Implement: `src/parsers/detect.ts`.
  4. Validate: routing tests against all three fixtures.
  - Success: correct routing `[ref: SDD/ADR-9]`

- [x] **T4.6 Phase Validation** `[activity: validate]`
  - All parser + detector golden tests green; zero `obsidian` import under `src/parsers/`; lint + typecheck clean.
