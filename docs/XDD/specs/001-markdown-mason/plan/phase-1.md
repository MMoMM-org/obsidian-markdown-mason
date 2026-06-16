---
title: "Phase 1: Scaffolding & Build Harness"
status: in_progress
version: "1.0"
phase: 1
---

# Phase 1: Scaffolding & Build Harness

## Phase Context

**GATE**: Read before starting.

**Specification References**:
- `[ref: SDD/Constraints; CON-1, CON-2, CON-3]`
- `[ref: SDD/Directory Map]`
- `[ref: SDD/Deployment View]`

**Key Decisions**:
- Desktop-only (ADR-7); pure-core testable without Obsidian (CON-2); esbuild→`main.js`.

**Dependencies**: none (greenfield; `src/` does not exist yet).

---

## Tasks

Establishes a building, loading, testable plugin skeleton.

- [x] **T1.1 Build & TypeScript config** `[activity: build-tooling]`
  1. Prime: Read `package.json`, `manifest.json`, `versions.json` `[ref: SDD/Implementation Context]`
  2. Test: `npm run build` produces `main.js`; `tsc -noEmit` passes on a trivial `src/main.ts`.
  3. Implement: Author `tsconfig.json` (strict, ESNext, bundler resolution) and `esbuild.config.mjs` (entry `src/main.ts`, format cjs, external `obsidian`/electron/builtins, watch+prod modes).
  4. Validate: `npm run build` and `npm run dev` succeed; lint clean.
  - Success: a minimal plugin bundles to `main.js` `[ref: SDD/Deployment View]`

- [ ] **T1.2 Manifest & compliance baseline** `[activity: build-tooling]`
  1. Prime: Review submission rules `[ref: SDD/CON-3]` `[ref: PRD/Feature 10]`
  2. Test: a lint/assert script confirms `isDesktopOnly:true`, id has no "obsidian", description ends with "." and omits "Obsidian".
  3. Implement: Update `manifest.json` — `isDesktopOnly:true`, rewrite the declarative-era description to the scripts/footnotes wording.
  4. Validate: assertions pass.
  - Success: manifest passes submission lint `[ref: PRD/AC F10.1]`

- [ ] **T1.3 Plugin lifecycle skeleton** `[activity: backend-api]`
  1. Prime: Obsidian `Plugin` lifecycle, `onload`/`onunload`, `registerEvent` `[ref: SDD/Cross-Cutting]`
  2. Test: plugin loads/unloads with no leaked listeners (mock App); `console.debug` used (no `console.log`).
  3. Implement: `src/main.ts` — empty `MarkdownMasonPlugin` with `loadSettings`/`saveSettings` stubs and `onLayoutReady` hook point.
  4. Validate: unit test for load/unload; lint clean.
  - Success: plugin enables/disables cleanly `[ref: SDD/CON-3]`

- [ ] **T1.4 Test harness & fixtures wiring** `[activity: testing]`
  1. Prime: Vitest config; the three fixtures `[ref: SDD/Implementation Context]`
  2. Test: a smoke test reads `assets/sakura-in-tokyo-app.md` and asserts it is non-empty.
  3. Implement: `vitest.config.ts`; a `test/fixtures.ts` loader exposing the three samples.
  4. Validate: `npm test` runs green.
  - Success: fixtures loadable in tests `[ref: SDD/CON-2]`

- [ ] **T1.5 Phase Validation** `[activity: validate]`
  - `npm run build`, `npm test`, `npm run lint` all green; manifest compliant.
