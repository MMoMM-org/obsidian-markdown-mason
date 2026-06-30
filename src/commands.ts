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
//   The "Tidy footnotes" preset is handled separately via tidyFootnotes() because
//   C/O+D/M are not offset-independent and must be fused into a single diff.
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
import { debug } from "./core/debug";
import { tidyFootnotes, diffToEditPlan } from "./core/noteFootnotes";
import { resolveFormatSelectionRecipe } from "./core/formatSelection";
import { applyEditPlan } from "./sources/apply";
import { applyToString } from "./core/applyToString";
import { selectionContext } from "./sources/selection";
import { applyTextCleanup } from "./core/formatPipeline";
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
	"cleanup.dewrap":             "No wrapped paragraphs to join",
	"cleanup.dehyphenate":        "No hyphenated line breaks to join",
	"cleanup.decomposeLigatures": "No ligatures or smart punctuation to decompose",
	"cleanup.tidyWhitespace":     "No whitespace to tidy",
	"lists.normalizeBullets":     "No bullet markers to normalize",
	"lists.normalizeOrdered":     "No ordered lists to renumber",
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
	const transformedText = result.plan[0].insert;
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
// fusedFormatNote — fused in-memory pipeline for "Format selection"
//
// Scope: whole-note (not selection-scoped). "Format selection" applies heading
// ops to the selection region and footnote ops to the whole note. Because the
// footnote ops (C/O+D/M) must operate on the final post-heading doc (their
// offsets would be stale against the pre-heading doc), we compose ALL steps
// in-memory on a scratch string and emit a SINGLE diffToEditPlan result.
//
// Pipeline (9 gated transforms → 1 fused edit; final diff is unconditional):
//   1. dehyphenate:       join end-of-line hyphenated words (MUST precede dewrap)
//   2. dewrap:            join soft-wrapped paragraph lines into one line per para
//   3. tidyWhitespace:    collapse double spaces, strip trailing whitespace
//   4. decomposeLigatures: replace smart quotes and ligatures with ASCII
//   5. normalizeBullets:  replace non-'-' bullet markers with '-'
//   6. normalizeOrdered:  renumber ordered list items sequentially
//   7. normalize:         close heading level gaps (whole-note)
//   8. cascade:           shift selected headings relative to context heading
//   9. tidyFootnotes:     C → O+D → M fused footnote pipeline
//  10. diff original→final: one non-overlapping EditPlan → one CM6 transaction
//
// Ordering rationale:
//   dehyphenate before dewrap: dehyphenation removes the hyphen-newline sequence
//     so dewrap sees a single logical line and does not incorrectly join it.
//   normalize before cascade: closes pre-existing gaps before cascade shifts
//     headings, avoiding a conflict where cascade produces a gap that normalize
//     would undo (user intent: normalize then cascade the selection).
//
// Returns [] when nothing changed; returns a single Edit otherwise.
// ---------------------------------------------------------------------------

function fusedFormatNote(editor: Editor, settings: MasonSettings): EditPlan {
	const recipe = resolveFormatSelectionRecipe(settings);
	const ctx = selectionContext(editor, settings);
	const original = ctx.doc;

	// Build a step-logger gated on the debugLogging setting.
	// When off, log is undefined → applyTextCleanup emits nothing.
	const log = settings.debugLogging
		? (l: string) => debug(`[MarkdownMason] ${l}`)
		: undefined;

	// Steps 1-7: cleanup pipeline delegated to applyTextCleanup (spec 005 T1.2).
	// dehyphenate → dewrap → tidyWhitespace → decomposeLigatures →
	// normalizeBullets → normalizeOrdered → normalize (heading gap-close).
	// Each step is gated by the matching boolean key in recipe; log receives
	// one "format: <name> …" line per step.
	const s7 = applyTextCleanup(original, recipe, log);

	// Step 8: cascade (EXISTING — preserve the current null-guard EXACTLY)
	let s8 = s7;
	if (recipe.cascade && ctx.selection !== undefined) {
		const cascadeEntry = buildRegistry().entries.find((e) => e.id === "headings.cascade");
		if (cascadeEntry) {
			const { plan: cascadePlan, noContextHeading } = cascadeSelectionPlan(cascadeEntry, { ...ctx, doc: s7 });
			if (!noContextHeading && cascadePlan && cascadePlan.length > 0) {
				s8 = applyToString(s7, cascadePlan);
			}
		}
	}

	// Step 9: tidyFootnotes (EXISTING) — with per-stage gates from recipe
	const tidyPlan = tidyFootnotes({ ...ctx, doc: s8 }, {
		fromCitations: recipe.fromCitations,
		identity:      recipe.identity,
		move:          recipe.move,
	});
	const s9 = applyToString(s8, tidyPlan);

	// Step 10: diff original→final — one non-overlapping edit (single undo step).
	// Empty result when nothing changed → caller shows "Nothing to format".
	const plan = diffToEditPlan(original, s9);
	log?.(`format: result ${plan.length} edit${plan.length === 1 ? "" : "s"}`);
	return plan;
}

// ---------------------------------------------------------------------------
// Public: registerCommands
// ---------------------------------------------------------------------------

/**
 * Minimal host surface this module needs from the plugin: command registration
 * plus the live settings. Declaring `settings` here (rather than via `Plugin &
 * { settings }`) keeps the access resolving to Mason's own field instead of the
 * official `Plugin.settings` slot — that slot only exists in Obsidian ≥1.13.0
 * (Catalyst beta), and depending on it would force minAppVersion past stable.
 */
interface CommandHost {
	addCommand: Plugin["addCommand"];
	settings: MasonSettings;
}

/**
 * Registers all Mason commands via plugin.addCommand.
 *
 * Called from MarkdownMasonPlugin.onLayoutReady() once the workspace is ready.
 * Presets are registered first (SDD: presets registered first).
 */
export function registerCommands(plugin: CommandHost): void {
	const { entries } = buildRegistry();

	// -------------------------------------------------------------------------
	// Preset commands (registered first per SDD)
	// -------------------------------------------------------------------------

	// "Mason: Tidy footnotes" — C → O+D → M fused via tidyFootnotes.
	// Uses a fused single-pass composition rather than chaining three independent
	// entry.run() calls because C, O+D, and M are not offset-independent: C
	// expands bare [n] (adding a character each), shifting all subsequent offsets.
	// tidyFootnotes composes via applyToString on scratch strings and emits ONE
	// EditPlan vs the original doc (single CM6 transaction = single undo step).
	plugin.addCommand({
		id: "preset.tidyFootnotes",
		name: "Tidy footnotes",
		editorCallback(editor: Editor): void {
			const ctx = wholeNoteCtx(plugin.settings)(editor);
			const plan = tidyFootnotes(ctx);
			if (plan.length === 0) {
				new Notice("No footnotes found to tidy");
				return;
			}
			applyEditPlan(editor, plan);
			showCountNotice(plan.length);
		},
	});

	// "Mason: Format selection" — cascade → normalize → C → O+D → M
	//
	// Heading steps (cascade, normalize) are selection-scoped:
	//   - cascade uses selection-replace semantics (cascadeSelectionPlan remap):
	//     the selected headings are replaced in-place, not inserted at cursor.
	//   - normalize applies gap-close on the post-cascade whole-note doc.
	//
	// Footnote steps (C/O+D/M) are whole-note: they process ctx.doc regardless
	// of the selection. This is intentionally conservative — Format selection
	// applies heading ops to the selection and footnote ops to the whole note.
	//
	// Implementation: fusedFormatNote composes ALL steps via in-memory application
	// on a scratch string (cascade→normalize→tidyFootnotes) and emits ONE
	// diffToEditPlan result vs the original doc. This avoids overlapping edits
	// that would occur if C/O+D/M were concatenated via runPreset — both O+D and
	// M emit edits over the same def span (renumber + delete before moving),
	// producing garbled output when concatenated.
	//
	// Result: a single Edit vs original → one CM6 transaction → one undo step.
	plugin.addCommand({
		id: "preset.formatSelection",
		name: "Format selection",
		editorCallback(editor: Editor): void {
			const plan = fusedFormatNote(editor, plugin.settings);
			if (plan.length === 0) {
				new Notice("Nothing to format");
				return;
			}
			applyEditPlan(editor, plan);
			showCountNotice(plan.length);
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
		debug(`[MarkdownMason] registered ${count} commands`);
	}
}
