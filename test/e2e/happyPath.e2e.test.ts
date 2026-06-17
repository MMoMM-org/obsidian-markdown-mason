// T7.1  End-to-end happy path
//
// Wires ALL layers together through a real (headless) CM6 editor for each of
// the three golden fixtures:
//
//   1. Load fixture text from assets/sakura-in-tokyo-{app,web,web-download}.md
//   2. Drive the paste/script flow:
//        detect format → run the matching library script AND perplexity-auto
//        → apply the resulting EditPlan into a headless CM6 EditorView via
//        applyEditPlan
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
//   loadFixture → detect → script (concrete + perplexityAuto) → applyEditPlan
//   → CM6 state → undo → compare
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

import { perplexityAppScript } from "../../src/scripts/library/perplexityApp";
import { perplexityWebScript } from "../../src/scripts/library/perplexityWeb";
import { perplexityWebDownloadScript } from "../../src/scripts/library/perplexityWebDownload";
import { perplexityAutoScript } from "../../src/scripts/library/perplexityAuto";

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
// On the SUCCESS path, the current production implementation does NOT emit
// a Notice — ScriptRunner returns { kind: "applied" } silently; no notify()
// is called. Zero Notices is the correct expected behavior for a successful
// paste when invoked at the script layer (not through the full plugin wiring).
// ---------------------------------------------------------------------------

function assertNoNoticesOnSuccess(): void {
	const notices = noticeLog();
	expect(notices).toHaveLength(0);
}

// ---------------------------------------------------------------------------
// Concrete + auto equivalence assertion
//
// For each fixture the perplexity-auto dispatcher must produce the SAME output
// as the matching concrete script — this is the E2E proof that auto-detection
// routes correctly end-to-end.
// ---------------------------------------------------------------------------

async function assertAutoEquivalence(
	concreteScript: ScriptFunction,
	fixtureInput: string,
): Promise<void> {
	const ctxConcrete = makeCtx(fixtureInput);
	const ctxAuto = makeCtx(fixtureInput);

	const concretePlan = (await concreteScript(ctxConcrete)) as EditPlan;
	const autoPlan = (await perplexityAutoScript(ctxAuto)) as EditPlan;

	const concreteOutput = applyToString(PASTE_DOC, concretePlan);
	const autoOutput = applyToString(PASTE_DOC, autoPlan);

	expect(autoOutput).toBe(concreteOutput);
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

	it("perplexityAppScript output has no Sources/Quellen/Citations scaffolding", async () => {
		const { outputStr } = await runE2E(perplexityAppScript, appInput);
		assertNoScaffolding(outputStr);
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

	it("perplexity-auto routes to the same output as perplexityAppScript for app fixture", async () => {
		await assertAutoEquivalence(perplexityAppScript, appInput);
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

	it("perplexityWebScript output has no Sources/Quellen/Citations scaffolding", async () => {
		const { outputStr } = await runE2E(perplexityWebScript, webInput);
		assertNoScaffolding(outputStr);
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

	it("perplexity-auto routes to the same output as perplexityWebScript for web fixture", async () => {
		await assertAutoEquivalence(perplexityWebScript, webInput);
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

	it("perplexityWebDownloadScript output has no Sources/Quellen/Citations scaffolding", async () => {
		const { outputStr } = await runE2E(perplexityWebDownloadScript, webDownloadInput);
		assertNoScaffolding(outputStr);
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

	it("perplexity-auto routes to the same output as perplexityWebDownloadScript for web-download fixture", async () => {
		await assertAutoEquivalence(perplexityWebDownloadScript, webDownloadInput);
	});

	it("zero Notices fire on the success path for the web-download fixture", async () => {
		await runE2E(perplexityWebDownloadScript, webDownloadInput);
		assertNoNoticesOnSuccess();
	});
});

// ===========================================================================
// Cross-fixture: perplexity-auto dispatcher correctness proof
//
// The auto-dispatcher must NOT cross-route: app input must not match web,
// etc.  Each auto-route must produce an output that passes the same golden
// structure assertions as the concrete script.
// ===========================================================================

describe("E2E happy path — perplexity-auto dispatcher end-to-end (all three fixtures)", () => {
	beforeEach(() => clearNoticeLog());

	it("perplexity-auto on app fixture: structured output, no scaffolding, gap-free footnotes", async () => {
		const { outputStr } = await runE2E(perplexityAutoScript, appInput);
		assertGoldenStructure(outputStr);
	});

	it("perplexity-auto on web fixture: structured output, no scaffolding, gap-free footnotes", async () => {
		const { outputStr } = await runE2E(perplexityAutoScript, webInput);
		assertGoldenStructure(outputStr);
	});

	it("perplexity-auto on web-download fixture: structured output, no scaffolding, gap-free footnotes", async () => {
		const { outputStr } = await runE2E(perplexityAutoScript, webDownloadInput);
		assertGoldenStructure(outputStr);
	});

	it("perplexity-auto single undo holds for app fixture", async () => {
		const { editor } = await runE2E(perplexityAutoScript, appInput);
		assertSingleUndo(editor);
	});

	it("perplexity-auto single undo holds for web fixture", async () => {
		const { editor } = await runE2E(perplexityAutoScript, webInput);
		assertSingleUndo(editor);
	});

	it("perplexity-auto single undo holds for web-download fixture", async () => {
		const { editor } = await runE2E(perplexityAutoScript, webDownloadInput);
		assertSingleUndo(editor);
	});
});
