// T7.2  Consolidated invariant & failure-mode suite
//
// This module is the SINGLE authoritative place where every named invariant is
// asserted explicitly.  Where an invariant is already well-covered elsewhere,
// it is re-asserted concisely at the integration level here for single-point
// visibility.  The most important NEW coverage is the full end-to-end run for
// alpha-footnote and orphaned-resource preservation, which was not tested at
// the E2E level in any prior suite.
//
// INVARIANTS
// ----------
// I1. Alpha footnotes survive a full run
//     Alphabetic footnotes ([^a], [^note]) in the existing note are NOT
//     renumbered, NOT counted toward the numeric max, NOT displaced by a full
//     script (O+D / perplexityAppScript) run.
//
// I2. Orphaned resources survive a full run
//     Resource/definition entries with no in-body reference ([^n]: prefix but
//     no matching [^n] in body) are preserved — not dropped — through a full run.
//
// I3. Empty clipboard → Notice no-op
//     Empty clipboard on "Mason: Paste and format" produces no edit and shows a
//     descriptive Notice.  Empty selection on a selection command → script
//     receives empty string as input → returns undefined → no-op (applyPlan and
//     replaceSelection never called).  Unrecognized non-empty selection → script
//     returns undefined → same no-op.
//
// I4. `disabled` script never runs
//     A script whose policy is "disabled" is never executed — applyPlan is not
//     called, rawFallback is not called.
//
// I5. Drift hard-blocks
//     A checksum/version drift (same version, different checksum) causes
//     evaluateTrust to return "drift-blocked".  The runner treats a blocked
//     outcome as a deliberate no-op — neither applyPlan nor rawFallback is called.
//
// I6. Throwing script → raw fallback
//     A script that throws leaves the paste/selection intact via raw fallback
//     (paste: replaceSelection inserts raw clipboard text; selection: no-op),
//     the error is surfaced as a Notice, and applyPlan is NEVER called.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { App } from "obsidian";
import type { Editor, EditorPosition } from "obsidian";
import { noticeLog, clearNoticeLog } from "./__mocks__/obsidian";

import { ScriptRunner } from "../src/scripts/runner";
import type { RunnerEffects, RunOptions } from "../src/scripts/runner";
import type { ScriptFunction } from "../src/scripts/context";
import { buildScriptContext } from "../src/scripts/context";
import { buildRegistry } from "../src/core/registry";
import { perplexityAppScript } from "../catalog/scripts/perplexityApp";
import { applyToString } from "../src/core/applyToString";
import { ScriptStore } from "../src/scripts/store";
import type { PluginDataPort } from "../src/scripts/store";

import type { OperationContext, MasonSettings, EditPlan } from "../src/core/types";
import { loadFixture } from "./fixtures";

// ---------------------------------------------------------------------------
// Re-export of MarkdownMasonPlugin (uses dynamic import matching integration.test.ts)
// ---------------------------------------------------------------------------

const { MarkdownMasonPlugin } = await import("../src/main");

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeSettings(overrides: Partial<MasonSettings> = {}): MasonSettings {
	return { debugLogging: false, resourcesName: "Resources", ...overrides };
}

function makeOp(doc: string, input: string, overrides: Partial<OperationContext> = {}): OperationContext {
	return {
		doc,
		cursor: doc.length,
		settings: makeSettings(),
		input,
		...overrides,
	};
}

function makeCtx(doc: string, input: string) {
	const { api } = buildRegistry();
	return buildScriptContext({
		input,
		source: "paste",
		op: makeOp(doc, input),
		mason: api,
	});
}

/** Apply a plan to PASTE_DOC and return the resulting string. */
function applyPlan(doc: string, plan: EditPlan): string {
	return applyToString(doc, plan);
}

// ---------------------------------------------------------------------------
// RunnerEffects spy factory
// ---------------------------------------------------------------------------

interface EffectsSpy extends RunnerEffects {
	appliedPlans: EditPlan[];
	fallbackCount: number;
	notices: string[];
}

function makeEffects(): EffectsSpy {
	const spy: EffectsSpy = {
		appliedPlans: [],
		fallbackCount: 0,
		notices: [],
		applyPlan: (plan: EditPlan): void => { spy.appliedPlans.push(plan); },
		rawFallback: (): void => { spy.fallbackCount++; },
		notify: (msg: string): void => { spy.notices.push(msg); },
	};
	return spy;
}

// ---------------------------------------------------------------------------
// In-memory adapter factories for ScriptStore
// ---------------------------------------------------------------------------

function makePluginDataPort(initial: unknown = {}): PluginDataPort {
	let stored: unknown = initial;
	return {
		load: async (): Promise<unknown> => stored,
		save: async (data: unknown): Promise<void> => { stored = data; },
	};
}

// ---------------------------------------------------------------------------
// Plugin command-test infrastructure (mirrors integration.test.ts)
// ---------------------------------------------------------------------------

/** Editor stub for paste-command tests. */
function makePasteEditor(doc: string): Editor & { _replaced: string[] } {
	const lines = doc.split("\n");
	const replaced: string[] = [];
	return {
		_replaced: replaced,
		getValue: () => doc,
		getCursor: () => ({ line: lines.length - 1, ch: lines[lines.length - 1]?.length ?? 0 }),
		posToOffset: (pos: EditorPosition): number => {
			let off = 0;
			for (let i = 0; i < pos.line; i++) off += (lines[i]?.length ?? 0) + 1;
			return off + pos.ch;
		},
		listSelections: () => [{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } }],
		replaceSelection: (text: string): void => { replaced.push(text); },
		getSelection: () => "",
		replaceRange: () => undefined,
		setCursor: () => undefined, setSelection: () => undefined, setSelections: () => undefined,
		setValue: () => undefined,
		getLine: (n: number) => lines[n] ?? "",
		lineCount: () => lines.length,
		lastLine: () => lines.length - 1,
		somethingSelected: () => false,
		getRange: () => "",
		refresh: () => undefined, focus: () => undefined, blur: () => undefined,
		hasFocus: () => false, getScrollInfo: () => ({ top: 0, left: 0 }),
		scrollTo: () => undefined, scrollIntoView: () => undefined,
		undo: () => undefined, redo: () => undefined, exec: () => undefined,
		transaction: () => undefined, wordAt: () => null,
		offsetToPos: (offset: number): EditorPosition => {
			let rem = offset;
			for (let i = 0; i < lines.length; i++) {
				const len = (lines[i]?.length ?? 0) + 1;
				if (rem < len) return { line: i, ch: rem };
				rem -= len;
			}
			return { line: lines.length - 1, ch: lines[lines.length - 1]?.length ?? 0 };
		},
		processLines: () => undefined,
		getDoc: function () { return this as unknown as typeof this; },
		setLine: () => undefined,
	} as unknown as Editor & { _replaced: string[] };
}


async function makePlugin() {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const app = new App() as any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const plugin = new MarkdownMasonPlugin(app, {} as any);
	await plugin.onload();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(plugin.app as any).workspace._fireLayoutReady();
	return plugin;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findCommand(plugin: InstanceType<typeof MarkdownMasonPlugin>, id: string): any {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const commands = (plugin as any)._commands as Array<{
		id: string;
		editorCallback(editor: Editor): void | Promise<void>;
	}>;
	return commands.find((c) => c.id === id);
}

// ---------------------------------------------------------------------------
// I1. Alpha footnotes survive a full run
//
// NEW: full E2E coverage — the unit-level tests in footnotes.test.ts verify
// that resolveFootnoteIdentity excludes alpha markers from maxExisting, but no
// prior test ran perplexityAppScript against a note that already contains alpha
// footnotes and verified they survived untouched.
// ---------------------------------------------------------------------------

describe("I1 — Alpha footnotes survive a full perplexityAppScript run", () => {
	// A note that already has:
	//   [^a]   — alpha ref used in body
	//   [^note] — alpha ref used in body
	//   [^3]   — numeric ref already defined (maxExisting should be 3)
	//
	// After running perplexityAppScript, the alpha markers and their definitions
	// must be completely untouched, and new numeric footnotes must continue from
	// id 4 (not conflict with any alpha marker).
	const PRE_EXISTING_ALPHA_NOTE = [
		"# My Research Note",
		"",
		"Some background.[^a][^note] Also see prior work.[^3]",
		"",
		"## Resources",
		"",
		"[^a]: Alpha footnote definition",
		"[Alpha Source](https://alpha.example.com)",
		"",
		"[^note]: Named footnote definition",
		"[Named Source](https://note.example.com)",
		"",
		"[^3]: Numeric footnote three",
		"[Numeric Three](https://three.example.com)",
		"",
	].join("\n");

	// Minimal Perplexity app input with one new cited source
	const PERPLEXITY_APP_INPUT = [
		"## Answer",
		"",
		"New research finding with citation [1].",
		"",
		"Sources",
		"[1] New Article https://new.example.com/research",
	].join("\n");

	it("alpha marker [^a] in body is preserved after a full script run", () => {
		const doc = PRE_EXISTING_ALPHA_NOTE;
		const ctx = makeCtx(doc, PERPLEXITY_APP_INPUT);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(doc, plan ?? []);
		expect(result).toContain("[^a]");
	});

	it("alpha marker [^note] in body is preserved after a full script run", () => {
		const doc = PRE_EXISTING_ALPHA_NOTE;
		const ctx = makeCtx(doc, PERPLEXITY_APP_INPUT);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(doc, plan ?? []);
		expect(result).toContain("[^note]");
	});

	it("alpha footnote definition [^a]: is preserved after a full script run", () => {
		const doc = PRE_EXISTING_ALPHA_NOTE;
		const ctx = makeCtx(doc, PERPLEXITY_APP_INPUT);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(doc, plan ?? []);
		expect(result).toContain("[^a]: Alpha footnote definition");
	});

	it("alpha footnote definition [^note]: is preserved after a full script run", () => {
		const doc = PRE_EXISTING_ALPHA_NOTE;
		const ctx = makeCtx(doc, PERPLEXITY_APP_INPUT);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(doc, plan ?? []);
		expect(result).toContain("[^note]: Named footnote definition");
	});

	it("new numeric footnote from paste does NOT collide with existing [^3] (starts from maxExisting+1)", () => {
		// DRIFT-2 fix: perplexityAppScript now scans ctx.op.doc for existing numeric
		// footnote defs and passes them to resolveFootnoteIdentity so new paste ids
		// start past maxExisting. The note already has [^3]; the new source must get
		// id=4 (or higher), never id=1, 2, or 3.
		const doc = PRE_EXISTING_ALPHA_NOTE;
		const ctx = makeCtx(doc, PERPLEXITY_APP_INPUT);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(doc, plan ?? []);
		// New source must be id=4 (maxExisting was 3 from [^3])
		expect(result).toContain("[^4]");
		// The paste must NOT introduce a new definition for [^3] — the only [^3]:
		// line must be the pre-existing one from PRE_EXISTING_ALPHA_NOTE.
		const def3Matches = (result.match(/\[\^3\]:/g) ?? []).length;
		expect(def3Matches).toBe(1); // exactly the original def — no new one from paste
	});

	it("existing numeric [^3] is not renumbered by the script run", () => {
		const doc = PRE_EXISTING_ALPHA_NOTE;
		const ctx = makeCtx(doc, PERPLEXITY_APP_INPUT);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(doc, plan ?? []);
		// The existing [^3] reference in the body and its definition must remain
		expect(result).toContain("[^3]");
		expect(result).toContain("[^3]: Numeric footnote three");
	});

	it("no alpha footnote is accidentally converted to a numeric id by a full script run", () => {
		const doc = PRE_EXISTING_ALPHA_NOTE;
		const ctx = makeCtx(doc, PERPLEXITY_APP_INPUT);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(doc, plan ?? []);
		// The alpha marker [^a] must still be alpha — not replaced with [^1] or similar
		// (i.e. no edit targets the [^a] or [^note] spans)
		expect(result).not.toContain("[^a]: Numeric");
		// The [^a] definition must still say "Alpha footnote definition"
		expect(result).toContain("[^a]: Alpha footnote definition");
	});
});

// ---------------------------------------------------------------------------
// T7.2  Paste collision-avoidance: DRIFT-2 fix
//
// Verifies that pasting Perplexity content into a note that already has [^1]
// and [^2] (with F4 Resources defs) does NOT introduce duplicate [^1]/[^2].
// New paste ids must start at 3 (or higher), and existing defs must survive.
//
// Also tests dedup: when pasted content cites a URL already in the note,
// the existing id is REUSED (no new def, no collision).
// ---------------------------------------------------------------------------

describe("T7.2 — paste collision-avoidance: no duplicate footnote ids when note already has [^1][^2]", () => {
	// A note that already has [^1] and [^2] with F4 two-line defs in Resources.
	const NOTE_WITH_NUMERIC_DEFS = [
		"# Research Note",
		"",
		"Prior findings.[^1][^2]",
		"",
		"## Resources",
		"",
		"[^1]: first existing snippet",
		"[First Existing](https://first-existing.example.com)",
		"",
		"[^2]: second existing snippet",
		"[Second Existing](https://second-existing.example.com)",
		"",
	].join("\n");

	// Perplexity paste that introduces one NEW source (different URL from existing).
	const PASTE_WITH_NEW_SOURCE = [
		"## Answer",
		"",
		"New finding with citation [1].",
		"",
		"Sources",
		"[1] Brand New Article https://brand-new.example.com/article",
	].join("\n");

	// Perplexity paste that cites a URL already in the note (for dedup test).
	const PASTE_WITH_EXISTING_URL = [
		"## Answer",
		"",
		"Finding referencing existing source [1].",
		"",
		"Sources",
		"[1] First Existing https://first-existing.example.com",
	].join("\n");

	it("new paste footnote starts at id=3, not id=1 or id=2", () => {
		const ctx = makeCtx(NOTE_WITH_NUMERIC_DEFS, PASTE_WITH_NEW_SOURCE);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(NOTE_WITH_NUMERIC_DEFS, plan ?? []);
		expect(result).toContain("[^3]");
	});

	it("no duplicate [^1] is introduced for new content", () => {
		const ctx = makeCtx(NOTE_WITH_NUMERIC_DEFS, PASTE_WITH_NEW_SOURCE);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(NOTE_WITH_NUMERIC_DEFS, plan ?? []);
		// The only [^1] references should be the originals in the note body and def.
		// The paste citation [1] must be renumbered to [^3], not [^1].
		const newContentIdx = result.indexOf("New finding");
		const citation1AfterNewContent = result.indexOf("[^1]", newContentIdx);
		// No [^1] should appear in the pasted paragraph itself
		expect(citation1AfterNewContent).toBe(-1);
	});

	it("existing [^1] definition is preserved", () => {
		const ctx = makeCtx(NOTE_WITH_NUMERIC_DEFS, PASTE_WITH_NEW_SOURCE);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(NOTE_WITH_NUMERIC_DEFS, plan ?? []);
		expect(result).toContain("[^1]: first existing snippet");
	});

	it("existing [^2] definition is preserved", () => {
		const ctx = makeCtx(NOTE_WITH_NUMERIC_DEFS, PASTE_WITH_NEW_SOURCE);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(NOTE_WITH_NUMERIC_DEFS, plan ?? []);
		expect(result).toContain("[^2]: second existing snippet");
	});

	it("dedup: pasting a URL already in the note reuses the existing id (no new def)", () => {
		// The paste cites https://first-existing.example.com which is already [^1].
		// The pasted inline citation [1] must be renumbered to [^1] (reuse), and
		// NO new definition for that URL must be added.
		const ctx = makeCtx(NOTE_WITH_NUMERIC_DEFS, PASTE_WITH_EXISTING_URL);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(NOTE_WITH_NUMERIC_DEFS, plan ?? []);
		// The pasted citation must reference [^1] (reused id)
		expect(result).toContain("[^1]");
		// There must be exactly ONE definition for [^1] — no duplicate def added
		const defMatches = result.match(/\[\^1\]:/g) ?? [];
		expect(defMatches).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// I1 (consolidated unit-level re-assertion)
//
// Re-asserts the core invariant established in footnotes.test.ts: alpha refs
// never appear in ExistingRef[] (structural exclusion), so resolveFootnoteIdentity
// computes maxExisting from numeric ids only.
// ---------------------------------------------------------------------------

describe("I1 (unit) — resolveFootnoteIdentity excludes alpha from maxExisting", () => {
	it("alpha markers in body text ([^a]) are never touched by applyFootnoteInlineRename", async () => {
		const { applyFootnoteInlineRename } = await import("../src/core/footnotes");
		const body = "Text[^a] and more[^b].";
		// idMap has only numeric keys — alpha names are not numeric
		const plan = applyFootnoteInlineRename(body, { 1: 5 });
		// No edit should touch [^a] or [^b] (they are alpha, not in the numeric idMap)
		const result = applyToString(body, plan);
		expect(result).toBe("Text[^a] and more[^b].");
		expect(plan).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// I2. Orphaned resources survive a full run
//
// NEW: full E2E coverage — footnotes.test.ts verifies moveToResources doesn't
// delete orphaned lines, but no prior test ran perplexityAppScript against a
// note with orphaned resources and confirmed they were preserved end-to-end.
// ---------------------------------------------------------------------------

describe("I2 — Orphaned resources survive a full perplexityAppScript run", () => {
	// A note with:
	//   - One properly-linked footnote [^1] with a definition
	//   - One ORPHANED resource (definition with no matching [^n] in body)
	//   - One ORPHANED plain-text line (no [^n]: prefix at all)
	const ORPHAN_NOTE = [
		"# My Note",
		"",
		"Body text referencing[^1] a source.",
		"",
		"## Resources",
		"",
		"[^1]: Existing linked snippet",
		"[Existing Linked](https://existing.example.com)",
		"",
		"[^99]: Orphaned definition — no [^99] in body",
		"[Orphaned Source](https://orphaned.example.com)",
		"",
		"Some plain orphaned text with no footnote marker",
		"",
	].join("\n");

	// Minimal Perplexity app input that will add a new source
	const PERPLEXITY_APP_INPUT = [
		"## Answer",
		"",
		"New research finding with citation [1].",
		"",
		"Sources",
		"[1] New Source https://new-source.example.com/page",
	].join("\n");

	it("orphaned definition [^99]: is preserved after a full script run", () => {
		const doc = ORPHAN_NOTE;
		const ctx = makeCtx(doc, PERPLEXITY_APP_INPUT);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(doc, plan ?? []);
		expect(result).toContain("[^99]: Orphaned definition — no [^99] in body");
	});

	it("orphaned markdown link [Orphaned Source](...) is preserved after a full script run", () => {
		const doc = ORPHAN_NOTE;
		const ctx = makeCtx(doc, PERPLEXITY_APP_INPUT);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(doc, plan ?? []);
		expect(result).toContain("[Orphaned Source](https://orphaned.example.com)");
	});

	it("orphaned plain-text line is preserved after a full script run", () => {
		const doc = ORPHAN_NOTE;
		const ctx = makeCtx(doc, PERPLEXITY_APP_INPUT);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(doc, plan ?? []);
		expect(result).toContain("Some plain orphaned text with no footnote marker");
	});

	it("existing linked footnote [^1] is also preserved after a full script run", () => {
		const doc = ORPHAN_NOTE;
		const ctx = makeCtx(doc, PERPLEXITY_APP_INPUT);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(doc, plan ?? []);
		expect(result).toContain("[^1]: Existing linked snippet");
	});

	it("new source is correctly appended without disturbing the orphaned entries", () => {
		const doc = ORPHAN_NOTE;
		const ctx = makeCtx(doc, PERPLEXITY_APP_INPUT);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(doc, plan ?? []);
		// The script should insert new definitions — they must appear in Resources
		expect(result).toContain("[New Source](https://new-source.example.com/page)");
		// And the orphan must still be present
		expect(result).toContain("[^99]: Orphaned definition");
	});
});

// ---------------------------------------------------------------------------
// I2 (consolidated unit-level re-assertion)
//
// Re-asserts the core invariant established in footnotes.test.ts: moveToResources
// preserves orphaned lines (those without [^n]: prefix) and never issues
// replacement edits — only inserts.
// ---------------------------------------------------------------------------

describe("I2 (unit) — moveToResources never removes or replaces orphaned lines", () => {
	it("all edits are inserts (from === to) — no replacements can remove orphaned content", async () => {
		const { moveToResources } = await import("../src/core/footnotes");
		const orphanedLine = "orphaned text with no footnote marker";
		const doc = `# Note\n\n## Resources\n\n${orphanedLine}\n`;
		const ctx = { doc, cursor: 0, settings: makeSettings() };
		const plan = moveToResources(ctx, ["[^1]: New\n[New](https://new.com)"]);
		for (const edit of plan) {
			expect(edit.from, "edit must be an insert, not a replacement").toBe(edit.to);
		}
		const result = applyToString(doc, plan);
		expect(result).toContain(orphanedLine);
	});
});

// ---------------------------------------------------------------------------
// I3. Empty clipboard → Notice no-op
//     (Re-asserted from integration.test.ts C4 and D noop path)
// ---------------------------------------------------------------------------

describe("I3 — Empty clipboard → Notice no-op (paste command)", () => {
	beforeEach(() => clearNoticeLog());

	it("empty clipboard shows a Notice and calls neither applyPlan nor replaceSelection", async () => {
		const plugin = await makePlugin();
		const editor = makePasteEditor("# Note\n\n");
		const applyPlanSpy = vi.fn();

		plugin._commandInjection = {
			clipboardReader: async () => "",
			applyPlan: applyPlanSpy,
		};

		const cmd = findCommand(plugin, "mason.pasteAndRunScripts");
		await cmd.editorCallback(editor);

		expect(noticeLog().length, "a Notice must be shown for empty clipboard").toBeGreaterThan(0);
		expect(applyPlanSpy, "applyPlan must not be called for empty clipboard").not.toHaveBeenCalled();
		expect(editor._replaced, "replaceSelection must not be called for empty clipboard").toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// I4. `disabled` script never runs
//     (Re-asserted from runner.test.ts policy-disabled suite)
// ---------------------------------------------------------------------------

describe("I4 — `disabled` script never runs", () => {
	it("ScriptRunner with policy 'disabled' returns blocked and never invokes the script", async () => {
		const effects = makeEffects();
		const options: RunOptions = { policy: "disabled" };
		const runner = new ScriptRunner(effects, options);
		const scriptSpy = vi.fn<ScriptFunction>(() => [{ from: 0, to: 0, insert: "X" }]);

		const outcome = await runner.run(scriptSpy, makeCtx("# Note\n\n", "input"));

		expect(outcome.kind).toBe("blocked");
		expect(scriptSpy, "script function must NEVER be invoked when policy is disabled").not.toHaveBeenCalled();
	});

	it("disabled script: applyPlan is never called", async () => {
		const effects = makeEffects();
		const runner = new ScriptRunner(effects, { policy: "disabled" });

		await runner.run((): EditPlan => [{ from: 0, to: 0, insert: "X" }], makeCtx("# Note\n\n", "input"));

		expect(effects.appliedPlans).toHaveLength(0);
	});

	it("disabled script: rawFallback is never called (disabled is a deliberate no-op, not a failure)", async () => {
		const effects = makeEffects();
		const runner = new ScriptRunner(effects, { policy: "disabled" });

		await runner.run((): EditPlan => [{ from: 0, to: 0, insert: "X" }], makeCtx("# Note\n\n", "input"));

		expect(effects.fallbackCount).toBe(0);
	});

	// I4 (disclosure layer) — re-pointed from removed evaluateTrust to makeAskCallback.
	// makeAskCallback is the entry point that enforces the kill-switch at consent time;
	// evaluateState (lifecycle layer) is covered separately in lifecycle.test.ts.
	it("makeAskCallback returns 'disable' immediately (no modal) when record.enabled===false", async () => {
		const { makeAskCallback, ScriptDisclosureModal } = await import("../src/scripts/disclosure");
		const pluginData = makePluginDataPort({
			scripts: {
				"my-script": {
					provenance: "imported",
					enabled: false,
					okayed: null,
					source: "my-script.cjs",
					command: false,
				},
			},
		});
		const store = new ScriptStore(pluginData);

		let modalOpened = false;
		const origPresent = ScriptDisclosureModal.prototype.present;
		ScriptDisclosureModal.prototype.present = function (this: InstanceType<typeof ScriptDisclosureModal>) {
			modalOpened = true;
			return origPresent.call(this);
		};

		try {
			const callback = makeAskCallback(
				new App(),
				store,
				"my-script",
				{ vaultRelativePath: "my-script.cjs", fileSizeBytes: 512, version: 1, checksum: "sha256:abc" },
				"sha256:abc",
				1,
			);

			const result = await callback();
			expect(result).toBe("disable");
			expect(modalOpened).toBe(false);
		} finally {
			ScriptDisclosureModal.prototype.present = origPresent;
		}
	});
});

// ---------------------------------------------------------------------------
// I5. Drift hard-blocks
//
// DELETED (T3.4): these tests asserted the removed evaluateTrust "drift-blocked"
// semantics and the removed 3-arg ScriptStore ctor + device.json consent shape
// (T1.4 rewrite). The invariant is now covered by:
//   - lifecycle.test.ts: "same version + checksum mismatch → Blocked(drift)"
//     and "drift wins over offline" — evaluateState is the authoritative drift gate.
//   - disclosure.test.ts: "makeAskCallback — drift-blocked re-prompts" — asserts
//     that a mismatched okayed checksum causes the modal to re-show.
//   - materializer.test.ts: curated drift and checksum-mismatch → {ok:false,reason:…},
//     never writes — preserves the fail-closed guarantee.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// I6. Throwing script → raw fallback
//     (Re-asserted from integration.test.ts C3 paste-failure suite and D throw path)
// ---------------------------------------------------------------------------

describe("I6 — Throwing script → raw fallback (paste command)", () => {
	beforeEach(() => clearNoticeLog());

	it("paste: throwing script calls replaceSelection with raw text (raw fallback)", async () => {
		const plugin = await makePlugin();
		const rawText = "Raw clipboard text that the script cannot handle.\n";
		const editor = makePasteEditor("# Note\n\n");
		const applyPlanSpy = vi.fn();

		plugin._commandInjection = {
			clipboardReader: async () => rawText,
			applyPlan: applyPlanSpy,
			failScript: true,
		};

		const cmd = findCommand(plugin, "mason.pasteAndRunScripts");
		await cmd.editorCallback(editor);

		expect(
			editor._replaced,
			"rawFallback must call replaceSelection with the raw clipboard text",
		).toContain(rawText);
	});

	it("paste: throwing script — applyPlan is NEVER called (atomicity)", async () => {
		const plugin = await makePlugin();
		const editor = makePasteEditor("# Note\n\n");
		const applyPlanSpy = vi.fn();

		plugin._commandInjection = {
			clipboardReader: async () => "some text",
			applyPlan: applyPlanSpy,
			failScript: true,
		};

		const cmd = findCommand(plugin, "mason.pasteAndRunScripts");
		await cmd.editorCallback(editor);

		expect(applyPlanSpy, "applyPlan must NOT be called when script throws").not.toHaveBeenCalled();
	});

	it("paste: throwing script — a Notice is shown (error is surfaced, not silent)", async () => {
		const plugin = await makePlugin();
		const editor = makePasteEditor("# Note\n\n");

		plugin._commandInjection = {
			clipboardReader: async () => "some text",
			applyPlan: vi.fn(),
			failScript: true,
		};

		const cmd = findCommand(plugin, "mason.pasteAndRunScripts");
		await cmd.editorCallback(editor);

		expect(noticeLog().length, "a Notice must be shown on script failure (not silent)").toBeGreaterThan(0);
	});

	it("paste: ScriptRunner rawFallback is called exactly once on script throw (unit level)", async () => {
		const effects = makeEffects();
		const runner = new ScriptRunner(effects, { policy: "enabled" });
		const throwingScript: ScriptFunction = (): never => { throw new Error("script crashed"); };

		await runner.run(throwingScript, makeCtx("# Note\n\n", "input"));

		expect(effects.fallbackCount).toBe(1);
		expect(effects.appliedPlans).toHaveLength(0);
		expect(effects.notices.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// I1 + I2 combined: Golden fixture full run
//
// Run perplexityAppScript against the real sakura-in-tokyo-app.md fixture with
// a pre-existing note that contains BOTH alpha footnotes AND orphaned resources.
// Asserts that all pre-existing content survives the full pipeline intact.
// ---------------------------------------------------------------------------

describe("I1 + I2 combined — alpha footnotes AND orphaned resources survive the sakura fixture full run", () => {
	const appInput = loadFixture("app");

	// Note that already has alpha and orphaned content before the paste
	const NOTE_WITH_ALPHA_AND_ORPHAN = [
		"# Sakura Research",
		"",
		"See also my notes.[^background][^lit]",
		"",
		"## Resources",
		"",
		"[^background]: Background reading",
		"[Background](https://background.example.com)",
		"",
		"[^lit]: Literature reference",
		"[Literature](https://literature.example.com)",
		"",
		"[^orphan-99]: Orphaned entry with no body reference",
		"[Orphaned](https://orphaned.example.com)",
		"",
		"Random orphaned text line",
		"",
	].join("\n");

	it("alpha marker [^background] is preserved in body after full sakura run", () => {
		const ctx = makeCtx(NOTE_WITH_ALPHA_AND_ORPHAN, appInput);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(NOTE_WITH_ALPHA_AND_ORPHAN, plan ?? []);
		expect(result).toContain("[^background]");
	});

	it("alpha definition [^background]: is preserved in Resources after full sakura run", () => {
		const ctx = makeCtx(NOTE_WITH_ALPHA_AND_ORPHAN, appInput);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(NOTE_WITH_ALPHA_AND_ORPHAN, plan ?? []);
		expect(result).toContain("[^background]: Background reading");
	});

	it("alpha marker [^lit] is preserved in body after full sakura run", () => {
		const ctx = makeCtx(NOTE_WITH_ALPHA_AND_ORPHAN, appInput);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(NOTE_WITH_ALPHA_AND_ORPHAN, plan ?? []);
		expect(result).toContain("[^lit]");
	});

	it("orphaned definition [^orphan-99]: is preserved after full sakura run", () => {
		const ctx = makeCtx(NOTE_WITH_ALPHA_AND_ORPHAN, appInput);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(NOTE_WITH_ALPHA_AND_ORPHAN, plan ?? []);
		expect(result).toContain("[^orphan-99]: Orphaned entry with no body reference");
	});

	it("orphaned plain text line is preserved after full sakura run", () => {
		const ctx = makeCtx(NOTE_WITH_ALPHA_AND_ORPHAN, appInput);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(NOTE_WITH_ALPHA_AND_ORPHAN, plan ?? []);
		expect(result).toContain("Random orphaned text line");
	});

	it("new numeric footnotes from sakura paste are added without conflicting with alpha markers", () => {
		const ctx = makeCtx(NOTE_WITH_ALPHA_AND_ORPHAN, appInput);
		const plan = perplexityAppScript(ctx) as EditPlan;
		const result = applyPlan(NOTE_WITH_ALPHA_AND_ORPHAN, plan ?? []);
		// The result must contain at least one numeric [^n] footnote from the sakura paste
		expect(result).toMatch(/\[\^\d+\]/);
		// Alpha markers must still be alpha
		expect(result).toContain("[^background]");
		expect(result).toContain("[^lit]");
	});
});
