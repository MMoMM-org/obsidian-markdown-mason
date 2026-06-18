// T3.4  Registry-driven command layer — registers Mason commands in Obsidian.
//
// DESIGN
// ------
// registerCommands(plugin) is called from MarkdownMasonPlugin.onLayoutReady().
// For each registry entry that has an editorCallback form, it registers a
// command via plugin.addCommand({ id, name, editorCallback }).
//
// SOURCE SELECTION (per SDD Building Block View)
//   editorCallback always supplies an Editor → build OperationContext directly
//   from editor.getValue() (synchronous; no vault read needed).
//   This avoids async in editorCallback (Obsidian expects synchronous callbacks)
//   while still being consistent with the TOCTOU mitigation in noteContext
//   (prefer editor over vault when editor is present).
//
// NOTICES
//   Non-empty plan  →  count Notice: "Mason: N change" / "Mason: N changes"
//   Empty plan      →  descriptive Notice per-op (see EMPTY_NOTICES map)
//   noContextHeading (cascade only) → shown via runRich before count check
//
// CASCADE SELECTION SEMANTICS (F6.1 ops×sources matrix)
//   cascade is a PASTE + SELECTION operation — it transforms content that is
//   NEW to the document (pasted text) or SELECTED text that should be re-levelled
//   relative to the heading above. It is NOT a whole-note operation.
//
//   When cascade runs on a selection the core returns a plan with a single
//   INSERT at cursor ({from:cursor, to:cursor, insert:<transformed text>}).
//   That insert semantics is correct for PASTE (new content appears at cursor).
//   For a SELECTION the content already exists in the document, so we REMAP
//   the insert into a REPLACE over the selection bounds:
//     {from: selection.from, to: selection.to, insert: plan[0].insert}
//   This replaces the existing selected headings in place without duplicating them.
//   See cascadeSelectionPlan() below.
//
// PRESETS (F5)
//   Chains ops by concatenating their EditPlans from entry.run(ctx) and
//   applying via ONE applyEditPlan call (single undo step).
//   Footnote steps (fromCitations, identity, move-with-defs) are PARSER-PENDING:
//   entry.run(ctx) returns [] until Phase 4 plumbs a ParseResult from ctx.doc.
//   TODO(Phase 4): replace entry.run(ctx) stubs with parser-backed calls so
//   preset steps produce real footnote EditPlans.
//
// CONSTRAINTS
//   - No default hotkeys (no `hotkeys` field on any addCommand call).
//   - console.debug only (CON-3).
//   - No obsidian import in src/core (CON-2 unchanged; this file is NOT in core).

import { Notice } from "obsidian";
import type { Plugin } from "obsidian";
import type { Editor } from "obsidian";
import { buildRegistry } from "./core/registry";
import type { RegistryEntry } from "./core/registry";
import { applyEditPlan } from "./sources/apply";
import { selectionContext } from "./sources/selection";
import type { Edit, EditPlan, MasonSettings, OperationContext } from "./core/types";

// ---------------------------------------------------------------------------
// Descriptive no-op Notices per operation (F7 — never silent)
// ---------------------------------------------------------------------------

const EMPTY_NOTICES: Record<string, string> = {
	"headings.cascade": "No heading above cursor to cascade from",
	"headings.normalize": "No headings found to normalize",
	"footnotes.fromCitations": "No citations found to convert",
	"footnotes.identity": "No numeric footnotes found",
	"footnotes.move": "No footnotes to move",
};

const DEFAULT_EMPTY_NOTICE = "Nothing to do";

// ---------------------------------------------------------------------------
// Notice helpers
// ---------------------------------------------------------------------------

/** Returns the count Notice message string — "Mason: N change" or "Mason: N changes". */
export function countNoticeMessage(count: number): string {
	const label = count === 1 ? "change" : "changes";
	return `Mason: ${count} ${label}`;
}
// TODO: registry-operation command Notices (e.g. "Tidy footnotes") could adopt
// countFootnoteDefs from src/core/footnotes.ts in a future pass to report
// "N footnotes filed" instead of the generic edit count.


function showCountNotice(count: number): void {
	new Notice(countNoticeMessage(count));
}

function showEmptyNotice(opId: string): void {
	new Notice(EMPTY_NOTICES[opId] ?? DEFAULT_EMPTY_NOTICE);
}

// ---------------------------------------------------------------------------
// OperationContext factory type — passed into runOperation / runPreset so
// selection-scoped and whole-note paths can share the same dispatch logic.
// ---------------------------------------------------------------------------

type CtxFactory = (editor: Editor) => OperationContext;

// ---------------------------------------------------------------------------
// Context factories
// (editorCallback always provides an Editor — no vault read needed)
// ---------------------------------------------------------------------------

/** Whole-note context: full doc as input, real caret position as cursor. */
function wholeNoteCtx(settings: MasonSettings): CtxFactory {
	return (editor: Editor): OperationContext => {
		const doc = editor.getValue();
		return {
			doc,
			cursor: editor.posToOffset(editor.getCursor()),
			input: doc,
			settings,
		};
	};
}

/** Selection-scoped context: selected text as input, head offset as cursor. */
function selectionCtx(settings: MasonSettings): CtxFactory {
	return (editor: Editor): OperationContext => selectionContext(editor, settings);
}

// ---------------------------------------------------------------------------
// cascadeSelectionPlan — insert→replace remap for the already-in-doc selection
//
// cascade core emits {from:cursor, to:cursor, insert:<transformed text>} —
// this is correct for PASTE (new content is inserted at cursor). When cascade
// operates on a SELECTION, the selected text already lives in the document.
// We remap the insert into a REPLACE over the selection range:
//   {from: selection.from, to: selection.to, insert: <transformed text>}
// so the existing selected headings are replaced in place rather than the
// transformed text being inserted at cursor (which would double the selection).
//
// Returns null when the cascade result has no plan (noContextHeading or no
// headings in selection), so callers can handle that uniformly.
// ---------------------------------------------------------------------------

function cascadeSelectionPlan(
	entry: RegistryEntry,
	ctx: OperationContext,
): { plan: Edit[] | null; noContextHeading: boolean } {
	if (!entry.runRich) {
		return { plan: null, noContextHeading: false };
	}
	const result = entry.runRich(ctx);
	if (result.noContextHeading) {
		return { plan: null, noContextHeading: true };
	}
	if (result.plan.length === 0) {
		return { plan: null, noContextHeading: false };
	}
	// Remap insert-at-cursor → replace-over-selection.
	// ctx.selection is always set by selectionContext; non-null assertion is safe here.
	const sel = ctx.selection!;
	const transformedText = result.plan[0]!.insert;
	const replacePlan: Edit[] = [{ from: sel.from, to: sel.to, insert: transformedText }];
	return { plan: replacePlan, noContextHeading: false };
}

// ---------------------------------------------------------------------------
// runOperation — synchronous; builds ctx, runs op, dispatches result
// ---------------------------------------------------------------------------

/**
 * Runs a single registry entry against the editor, applying the EditPlan
 * and showing the appropriate Notice.
 *
 * Returns the EditPlan produced (may be empty) — used by preset chaining.
 * `apply` flag: false means collect the plan without applying (preset mode).
 * `buildCtx` controls whether context is whole-note or selection-scoped.
 */
function runOperation(
	entry: RegistryEntry,
	editor: Editor,
	buildCtx: CtxFactory,
	apply: boolean,
): EditPlan {
	const ctx = buildCtx(editor);

	// cascade: use cascadeSelectionPlan (when selection-scoped) or runRich (whole-note).
	// In both cases the insert→replace remap only applies when a selection is present.
	if (entry.id === "headings.cascade" && entry.runRich) {
		if (ctx.selection !== undefined) {
			// Selection-scoped cascade: remap insert→replace so the selection is
			// replaced in place, not inserted at cursor (which would double the text).
			const { plan, noContextHeading } = cascadeSelectionPlan(entry, ctx);
			if (noContextHeading) {
				if (apply) {
					new Notice(EMPTY_NOTICES["headings.cascade"] ?? DEFAULT_EMPTY_NOTICE);
				}
				return [];
			}
			if (plan === null || plan.length === 0) {
				if (apply) {
					showEmptyNotice(entry.id);
				}
				return [];
			}
			if (apply) {
				applyEditPlan(editor, plan);
				showCountNotice(plan.length);
			}
			return plan;
		}

		// No selection (whole-note path, e.g. from a command that builds wholeNoteCtx).
		// W3: In preset mode (apply=false) any noContextHeading result folds silently
		// into the preset-level no-op Notice rather than emitting a per-step Notice.
		// This is an intentional trade-off (one preset-level Notice, not per-step
		// Notices) so the user sees a single coherent message. F7 "never silent"
		// intent is satisfied at the preset level, not the step level.
		const result = entry.runRich(ctx);
		if (result.noContextHeading) {
			if (apply) {
				new Notice(EMPTY_NOTICES["headings.cascade"] ?? DEFAULT_EMPTY_NOTICE);
			}
			return [];
		}
		if (result.plan.length === 0) {
			if (apply) {
				showEmptyNotice(entry.id);
			}
			return [];
		}
		if (apply) {
			applyEditPlan(editor, result.plan);
			showCountNotice(result.plan.length);
		}
		return result.plan;
	}

	const plan = entry.run(ctx);

	if (plan.length === 0) {
		if (apply) {
			showEmptyNotice(entry.id);
		}
		return [];
	}

	if (apply) {
		applyEditPlan(editor, plan);
		showCountNotice(plan.length);
	}
	return plan;
}

// ---------------------------------------------------------------------------
// Preset: chain multiple ops into ONE applyEditPlan call (single undo)
// ---------------------------------------------------------------------------

/**
 * Chains multiple registry entries by concatenating their EditPlans and
 * applying the combined plan in a single applyEditPlan call (one undo step).
 *
 * PARSER-PENDING seam: footnote entries (fromCitations, identity, move) return
 * empty plans via entry.run(ctx) until Phase 4 supplies a ParseResult. The
 * chaining mechanism is real and tested; Phase 4 plugs the parser in.
 * TODO(Phase 4): replace entry.run stubs with parser-backed calls.
 */
function runPreset(
	entries: RegistryEntry[],
	editor: Editor,
	buildCtx: CtxFactory,
	presetNoOpNotice: string,
): void {
	// Collect plans without applying individually (apply=false)
	const combined: EditPlan = [];
	for (const entry of entries) {
		const plan = runOperation(entry, editor, buildCtx, false);
		combined.push(...plan);
	}

	if (combined.length === 0) {
		new Notice(presetNoOpNotice);
		return;
	}

	// Single applyEditPlan call = single CM6 transaction = single undo step (F5.1, F7.1)
	applyEditPlan(editor, combined);
	showCountNotice(combined.length);
}

// ---------------------------------------------------------------------------
// Public: registerCommands
// ---------------------------------------------------------------------------

/**
 * Registers all Mason commands via plugin.addCommand.
 *
 * Called from MarkdownMasonPlugin.onLayoutReady() once the workspace is ready.
 * Presets are registered first (SDD: presets registered first).
 */
export function registerCommands(
	plugin: Plugin & { settings: MasonSettings },
): void {
	const { entries } = buildRegistry();

	// Index entries by id for preset lookup
	const byId = Object.fromEntries(entries.map((e) => [e.id, e]));

	// -------------------------------------------------------------------------
	// Preset commands (registered first per SDD)
	// -------------------------------------------------------------------------

	// "Mason: Tidy footnotes" — fromCitations → identity → move across the note
	// PARSER-PENDING: all three footnote steps return [] until Phase 4.
	// TODO(Phase 4): replace entry.run stubs with ParseResult-backed calls.
	plugin.addCommand({
		id: "preset.tidyFootnotes",
		name: "Tidy footnotes",
		editorCallback(editor: Editor): void {
			const steps = [
				byId["footnotes.fromCitations"],
				byId["footnotes.identity"],
				byId["footnotes.move"],
			].filter((e): e is RegistryEntry => e !== undefined);
			runPreset(steps, editor, wholeNoteCtx(plugin.settings), "No footnotes found to tidy");
		},
	});

	// "Mason: Format selection" — cascade → normalize → fromCitations → identity → move
	// Operates on the SELECTION (F5.2): context is built via selectionContext so cascade
	// and normalize act on the selected text, not the whole document.
	// cascade step uses selection-replace semantics (cascadeSelectionPlan remap):
	// the selected headings are replaced in place, not inserted at cursor.
	// PARSER-PENDING: footnote steps are stubs until Phase 4.
	// TODO(Phase 4): wire selection-scoped context for footnote steps.
	plugin.addCommand({
		id: "preset.formatSelection",
		name: "Format selection",
		editorCallback(editor: Editor): void {
			const steps = [
				byId["headings.cascade"],
				byId["headings.normalize"],
				byId["footnotes.fromCitations"],
				byId["footnotes.identity"],
				byId["footnotes.move"],
			].filter((e): e is RegistryEntry => e !== undefined);
			runPreset(steps, editor, selectionCtx(plugin.settings), "Nothing to format");
		},
	});

	// -------------------------------------------------------------------------
	// Single-operation commands (one per registry entry that has editorCallback form)
	// util.normalizeUrl is excluded — no ctx-based EditPlan form (SDD design note 5).
	// -------------------------------------------------------------------------

	const SKIP_IDS = new Set(["util.normalizeUrl"]);

	for (const entry of entries) {
		if (SKIP_IDS.has(entry.id)) {
			continue;
		}

		// "Mason: Cascade headings" — SELECTION-scoped (F6.1 ops×sources matrix).
		// cascade is a PASTE + SELECTION operation; it is NOT a whole-note op.
		// With no selection (collapsed/empty): show descriptive Notice and return.
		// With a selection: build selectionCtx, run cascade via runOperation
		// (which calls cascadeSelectionPlan to remap insert→replace), apply, Notice.
		if (entry.id === "headings.cascade") {
			plugin.addCommand({
				id: entry.id,
				name: entry.command.name,
				editorCallback(editor: Editor): void {
					const ctx = selectionContext(editor, plugin.settings);
					// Guard: empty selection → no content to cascade
					if (ctx.input === "") {
						new Notice("Select text to cascade headings.");
						return;
					}
					runOperation(entry, editor, selectionCtx(plugin.settings), true);
				},
			});
			continue;
		}

		plugin.addCommand({
			id: entry.id,
			name: entry.command.name,
			editorCallback(editor: Editor): void {
				runOperation(entry, editor, wholeNoteCtx(plugin.settings), true);
			},
		});
	}

	if (plugin.settings.debugLogging) {
		const count = entries.length - SKIP_IDS.size + 2;
		console.debug(`[MarkdownMason] registered ${count} commands`);
	}
}
