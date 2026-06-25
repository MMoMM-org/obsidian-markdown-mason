// T7.1  End-to-end happy path
//
// Wires ALL layers together through a real (headless) CM6 editor for each of
// the three golden fixtures:
//
//   1. Load fixture text from assets/sakura-in-tokyo-{app,web,web-download}.md
//   2. Drive the paste/script flow:
//        run the matching concrete library script → apply the resulting EditPlan
//        into a headless CM6 EditorView via applyEditPlan
//   3. Assert the final document matches the golden structured output
//        (gap-free 1..K footnotes, ## Resources two-line F4 defs, no scaffolding)
//   4. Assert that exactly ONE undo() reverts the entire change back to the
//        original pasted text — proving one atomic transaction = one undo step
//   5. Assert the expected count of Notices (zero on success path — the current
//        production implementation does not emit a success Notice)
//
// Headless CM6 harness pattern: mirrors test/sources/apply.test.ts — an
// EditorState with history() extension, wrapped in a { cm: { state, dispatch } }
// object that applyEditPlan reaches via `(editor as any).cm`.
//
// Layer integration order:
//   loadFixture → concrete script → applyEditPlan → CM6 state → undo → compare
//
// PRD AC F5, F9; PRD Success Metrics — fixtures.

import { describe, it, expect, beforeEach } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { applyEditPlan } from "../../src/sources/apply";
import { buildRegistry } from "../../src/core/registry";
import { buildScriptContext } from "../../src/scripts/context";
import { applyToString } from "../../src/core/applyToString";
import { loadFixture } from "../fixtures";
import { noticeLog, clearNoticeLog } from "../__mocks__/obsidian";

import { perplexityAppScript } from "../../catalog/scripts/perplexityApp";
import { perplexityWebScript } from "../../catalog/scripts/perplexityWeb";
import { perplexityWebDownloadScript } from "../../catalog/scripts/perplexityWebDownload";

import type { EditPlan, OperationContext, MasonSettings } from "../../src/core/types";
import type { ScriptFunction } from "../../src/scripts/context";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const appInput = loadFixture("app");
const webInput = loadFixture("web");
const webDownloadInput = loadFixture("webDownload");

// ---------------------------------------------------------------------------
// Headless CM6 editor harness
//
// Mirrors the pattern in test/sources/apply.test.ts.
// applyEditPlan reaches `(editor as any).cm`, so we expose { cm: { state, dispatch } }.
// dispatch() mutates currentState in-place so undo() can revert via history().
// ---------------------------------------------------------------------------

interface HeadlessCm {
	state: EditorState;
	dispatch(...specs: TransactionSpec[]): void;
}

interface HeadlessEditor {
	cm: HeadlessCm;
}

function makeEditor(doc: string): HeadlessEditor {
	let currentState = EditorState.create({ doc, extensions: [history()] });

	const cm: HeadlessCm = {
		get state(): EditorState {
			return currentState;
		},
		dispatch(...specs: TransactionSpec[]): void {
			for (const spec of specs) {
				currentState = currentState.update(spec).state;
			}
		},
	};

	return { cm };
}

// ---------------------------------------------------------------------------
// Context factory
//
// "Paste-into-blank-note" model: the fixture is pasted at the end of a note
// that already has a H1 title + blank line (so the heading cascade resolver
// can find a context heading above the cursor).
//
// ctx.op.doc    = PASTE_DOC
// ctx.op.cursor = PASTE_DOC.length   (cursor at end — paste point)
// ctx.input     = fixture text
// ---------------------------------------------------------------------------

const PASTE_DOC = "# Sakura Notes\n\n";

function makeSettings(): MasonSettings {
	return { debugLogging: false, resourcesName: "Resources" };
}

function makeOp(input: string): OperationContext {
	return {
		doc: PASTE_DOC,
		cursor: PASTE_DOC.length,
		settings: makeSettings(),
		input,
	};
}

function makeCtx(input: string) {
	const { api } = buildRegistry();
	return buildScriptContext({
		input,
		source: "paste",
		op: makeOp(input),
		mason: api,
		logger: { info: () => {}, warn: () => {}, error: () => {} },
	});
}

// ---------------------------------------------------------------------------
// Structural assertion helpers (mirrored from library.e2e.test.ts)
// ---------------------------------------------------------------------------

function extractResourcesSection(output: string): string {
	const idx = output.indexOf("## Resources");
	if (idx === -1) return "";
	return output.slice(idx);
}

function extractBodySection(output: string): string {
	const idx = output.indexOf("## Resources");
	if (idx === -1) return output;
	return output.slice(0, idx);
}

function assertNoScaffolding(output: string): void {
	expect(output).not.toMatch(/^Sources\s*$/m);
	expect(output).not.toMatch(/^Citations:\s*$/m);
	expect(output).not.toMatch(/^Quellen\s*$/m);
	expect(output).not.toMatch(/^\[\d+\]\s+\S.*https?:\/\/\S+\s*$/m);
}

function assertF4Defs(resourcesSection: string): void {
	expect(resourcesSection).toMatch(/\[\^\d+\]: .+\n\[.+\]\(https?:\/\/.+\)/);
}

function assertFootnoteConsistency(output: string): { K: number } {
	const bodySection = extractBodySection(output);
	const resourcesSection = extractResourcesSection(output);

	const bodyMarkers = new Set<number>();
	for (const m of bodySection.matchAll(/\[\^(\d+)\]/g)) {
		bodyMarkers.add(Number(m[1]));
	}

	const defMarkers = new Set<number>();
	for (const m of resourcesSection.matchAll(/^\[\^(\d+)\]:/gm)) {
		defMarkers.add(Number(m[1]));
	}

	for (const n of bodyMarkers) {
		expect(defMarkers.has(n), `body has [^${n}] but no def in Resources`).toBe(true);
	}
	for (const n of defMarkers) {
		expect(bodyMarkers.has(n), `Resources has [^${n}]: def but no marker in body`).toBe(true);
	}

	const K = defMarkers.size;
	expect(K).toBeGreaterThan(0);
	for (let i = 1; i <= K; i++) {
		expect(defMarkers.has(i), `Expected [^${i}] in Resources but not found (K=${K})`).toBe(true);
	}

	return { K };
}

// ---------------------------------------------------------------------------
// Core harness helper
//
// Runs a single E2E round-trip:
//   1. Compute EditPlan by calling script(ctx)
//   2. Apply to the string (for structural assertions — mirrors library.e2e.test.ts)
//   3. Apply via applyEditPlan into the CM6 editor (for undo assertion)
//   4. Return { outputStr, editor, plan } for per-fixture assertions
// ---------------------------------------------------------------------------

async function runE2E(script: ScriptFunction, fixtureInput: string): Promise<{
	outputStr: string;
	editor: HeadlessEditor;
	plan: EditPlan;
}> {
	const ctx = makeCtx(fixtureInput);
	const plan = (await script(ctx)) as EditPlan;

	expect(plan, "script must return a non-empty EditPlan").toBeDefined();
	expect(Array.isArray(plan)).toBe(true);
	expect(plan.length).toBeGreaterThan(0);

	// String-apply for structural assertions (ADR-1 semantics)
	const outputStr = applyToString(PASTE_DOC, plan);

	// CM6 apply for undo assertions — creates a fresh editor per run
	const editor = makeEditor(PASTE_DOC);
	applyEditPlan(editor as never, plan);

	return { outputStr, editor, plan };
}

// ---------------------------------------------------------------------------
// Shared structural assertions for ALL three fixtures
// ---------------------------------------------------------------------------

function assertGoldenStructure(outputStr: string): void {
	expect(outputStr).toContain("## Resources");
	assertNoScaffolding(outputStr);
	assertF4Defs(extractResourcesSection(outputStr));
	assertFootnoteConsistency(outputStr);
}

// ---------------------------------------------------------------------------
// Single-undo assertion
//
// Verifies that exactly one call to undo() reverts the CM6 editor back to
// the original PASTE_DOC (PRD F4.4 / F7.1: one atomic transaction = one step).
// ---------------------------------------------------------------------------

function assertSingleUndo(editor: HeadlessEditor): void {
	// Confirm the plan was applied (document differs from original)
	const afterApply = editor.cm.state.doc.toString();
	expect(afterApply).not.toBe(PASTE_DOC);

	// Exactly ONE undo reverts everything
	undo(editor.cm);

	const afterUndo = editor.cm.state.doc.toString();
	expect(afterUndo).toBe(PASTE_DOC);
}

// ---------------------------------------------------------------------------
// Notice count assertion
//
// PRD F8-AC2 / F7-AC3: a success Notice fires and includes the count of changes.
// Convention (matching commands.ts showCountNotice): "Mason: N change" (N=1) or
// "Mason: N changes" (N>1). The E2E harness calls the script directly (not
// through the full plugin wiring), so no Notice is emitted at this layer —
// the count Notice is the command layer's job (main.ts), not the script layer's.
// These assertions verify the script layer stays silent on success (zero Notices),
// which is the correct contract: the runner does NOT emit the success Notice.
//
// NOTE: The command-layer Notice is tested in test/scripts/integration.test.ts
// (the "count Notice" tests that drive the full paste/selection commands).
// ---------------------------------------------------------------------------

function assertNoNoticesOnSuccess(): void {
	const notices = noticeLog();
	expect(notices, "script layer must not emit Notices on success (command layer's job)").toHaveLength(0);
}

// ===========================================================================
// App fixture (sakura-in-tokyo-app.md)
// ===========================================================================

describe("E2E happy path — app fixture (sakura-in-tokyo-app.md)", () => {
	beforeEach(() => clearNoticeLog());

	it("perplexityAppScript produces a structured note with Resources, F4 defs, gap-free footnotes", async () => {
		const { outputStr } = await runE2E(perplexityAppScript, appInput);
		assertGoldenStructure(outputStr);
	});

	it("perplexityAppScript EditPlan has exactly 2 operations (one body edit + one Resources edit)", async () => {
		const { plan } = await runE2E(perplexityAppScript, appInput);
		expect(plan).toHaveLength(2);
	});

	it("perplexityAppScript body has [^n] markers, no bare [n] citations", async () => {
		const { outputStr } = await runE2E(perplexityAppScript, appInput);
		const body = extractBodySection(outputStr);
		expect(body).toMatch(/\[\^\d+\]/);
		expect(body).not.toMatch(/\[\d+\](?!\()/);
	});

	it("perplexityAppScript output retains BOTH Question headings (Tokyo + Sapporo)", async () => {
		const { outputStr } = await runE2E(perplexityAppScript, appInput);
		const body = extractBodySection(outputStr);
		const questionCount = (body.match(/^## Question$/gm) ?? []).length;
		expect(questionCount).toBe(2);
	});

	it("perplexityAppScript output body contains Sapporo question and Tokyo sakura prose", async () => {
		const { outputStr } = await runE2E(perplexityAppScript, appInput);
		expect(extractBodySection(outputStr)).toContain("When will it be in Sapporo?");
		expect(extractBodySection(outputStr)).toContain("sakura are forecast to start blooming");
	});

	it("single undo via CM6 reverts the entire app-fixture transformation (one atomic step)", async () => {
		const { editor } = await runE2E(perplexityAppScript, appInput);
		assertSingleUndo(editor);
	});

	it("zero Notices fire on the success path for the app fixture", async () => {
		await runE2E(perplexityAppScript, appInput);
		assertNoNoticesOnSuccess();
	});
});

// ===========================================================================
// Web fixture (sakura-in-tokyo-web.md)
// ===========================================================================

describe("E2E happy path — web fixture (sakura-in-tokyo-web.md)", () => {
	beforeEach(() => clearNoticeLog());

	it("perplexityWebScript produces a structured note with Resources, F4 defs, gap-free footnotes", async () => {
		const { outputStr } = await runE2E(perplexityWebScript, webInput);
		assertGoldenStructure(outputStr);
	});

	it("perplexityWebScript EditPlan has exactly 2 operations (one body edit + one Resources edit)", async () => {
		const { plan } = await runE2E(perplexityWebScript, webInput);
		expect(plan).toHaveLength(2);
	});

	it("perplexityWebScript body has no raw [text](url) citation links", async () => {
		const { outputStr } = await runE2E(perplexityWebScript, webInput);
		const body = extractBodySection(outputStr);
		// [text](url) links should have been converted to [^n] footnote markers
		expect(body).not.toMatch(/\[[\w-]+\]\(https?:\/\//);
	});

	it("single undo via CM6 reverts the entire web-fixture transformation (one atomic step)", async () => {
		const { editor } = await runE2E(perplexityWebScript, webInput);
		assertSingleUndo(editor);
	});

	it("zero Notices fire on the success path for the web fixture", async () => {
		await runE2E(perplexityWebScript, webInput);
		assertNoNoticesOnSuccess();
	});
});

// ===========================================================================
// Web-download fixture (sakura-in-tokyo-web-download.md)
// ===========================================================================

describe("E2E happy path — web-download fixture (sakura-in-tokyo-web-download.md)", () => {
	beforeEach(() => clearNoticeLog());

	it("perplexityWebDownloadScript produces a structured note with Resources, F4 defs, gap-free footnotes", async () => {
		const { outputStr } = await runE2E(perplexityWebDownloadScript, webDownloadInput);
		assertGoldenStructure(outputStr);
	});

	it("perplexityWebDownloadScript EditPlan has exactly 2 operations (one body edit + one Resources edit)", async () => {
		const { plan } = await runE2E(perplexityWebDownloadScript, webDownloadInput);
		expect(plan).toHaveLength(2);
	});

	it("perplexityWebDownloadScript body has no [^a_b] web-download markers remaining", async () => {
		const { outputStr } = await runE2E(perplexityWebDownloadScript, webDownloadInput);
		const body = extractBodySection(outputStr);
		expect(body).not.toMatch(/\[\^\w+_\w+\]/);
	});

	it("single undo via CM6 reverts the entire web-download-fixture transformation (one atomic step)", async () => {
		const { editor } = await runE2E(perplexityWebDownloadScript, webDownloadInput);
		assertSingleUndo(editor);
	});

	it("zero Notices fire on the success path for the web-download fixture", async () => {
		await runE2E(perplexityWebDownloadScript, webDownloadInput);
		assertNoNoticesOnSuccess();
	});
});

// ---------------------------------------------------------------------------
// Regression — paste into a BLANK note (no heading above the cursor).
//
// cascade() returns an empty plan when there is no context heading; the scripts
// used to spread that empty plan and silently DROP the entire body, leaving only
// the ## Resources footnotes. cascadeOrInsert now inserts the body verbatim.
// ---------------------------------------------------------------------------

describe("paste into a blank note — body is never dropped", () => {
	function runBlank(script: ScriptFunction, input: string): string {
		const { api } = buildRegistry();
		const ctx = buildScriptContext({
			input,
			source: "paste",
			op: { doc: "", cursor: 0, settings: makeSettings(), input },
			mason: api,
			logger: { info: () => {}, warn: () => {}, error: () => {} },
		});
		const plan = script(ctx);
		expect(plan, "script must return a plan").toBeDefined();
		return applyToString("", plan as EditPlan);
	}

	it("perplexity-app keeps the prose body, not just the Resources footnotes", () => {
		const output = runBlank(perplexityAppScript, appInput);
		expect(output).toContain("## Resources");
		// The actual article prose survived (this is the regression that was lost).
		expect(output).toContain("forecast to start blooming");
		// And inline footnote markers exist in the body, not only in the defs.
		expect(extractBodySection(output)).toMatch(/\[\^\d+\]/);
	});

	it("perplexity-web keeps the body when pasted into a blank note", () => {
		const output = runBlank(perplexityWebScript, webInput);
		expect(extractBodySection(output).trim().length).toBeGreaterThan(0);
	});

	it("perplexity-web-download keeps the body when pasted into a blank note", () => {
		const output = runBlank(perplexityWebDownloadScript, webDownloadInput);
		expect(extractBodySection(output).trim().length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// Regression (F-1) — a malformed Sources line must NOT silently lose the
// citation as a dangling [^n] footnote. The unresolved marker stays plain [n].
// ---------------------------------------------------------------------------

describe("perplexity-app — malformed source line leaves a plain [n], not a broken footnote", () => {
	const input = [
		"## Answer",
		"",
		"Claim one[1] and claim two[2].",
		"",
		"Sources",
		"[1] Good source https://example.com/good",
		"[2] Malformed line with no url",
		"",
	].join("\n");

	it("converts the resolvable citation but leaves the unresolvable one as [2]", () => {
		const doc = "# Notes\n\n";
		const { api } = buildRegistry();
		const ctx = buildScriptContext({
			input,
			source: "paste",
			op: { doc, cursor: doc.length, settings: makeSettings(), input },
			mason: api,
			logger: { info: () => {}, warn: () => {}, error: () => {} },
		});
		const output = applyToString(doc, perplexityAppScript(ctx) as EditPlan);
		const body = extractBodySection(output);

		// The unresolved citation stays a plain, visible [2] — never a [^2].
		expect(body).toContain("[2]");
		expect(body).not.toMatch(/\[\^2\]/);
		// And there is no dangling [^2]: definition.
		expect(output).not.toMatch(/\[\^2\]:/);
		// The well-formed source still became a footnote with a definition.
		expect(body).toMatch(/\[\^\d+\]/);
		expect(extractResourcesSection(output)).toMatch(/\[\^\d+\]:/);
	});
});
