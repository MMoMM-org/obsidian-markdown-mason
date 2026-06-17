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
import type { EditPlan, MasonSettings, OperationContext } from "./core/types";

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

function showCountNotice(count: number): void {
	const label = count === 1 ? "change" : "changes";
	new Notice(`Mason: ${count} ${label}`);
}

function showEmptyNotice(opId: string): void {
	new Notice(EMPTY_NOTICES[opId] ?? DEFAULT_EMPTY_NOTICE);
}

// ---------------------------------------------------------------------------
// Build OperationContext synchronously from an editor
// (editorCallback always provides an Editor — no vault read needed)
// ---------------------------------------------------------------------------

function editorCtx(editor: Editor, settings: MasonSettings): OperationContext {
	const doc = editor.getValue();
	return {
		doc,
		cursor: 0,
		input: doc,
		settings,
	};
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
 */
function runOperation(
	entry: RegistryEntry,
	editor: Editor,
	settings: MasonSettings,
	apply: boolean,
): EditPlan {
	const ctx = editorCtx(editor, settings);

	// cascade: use runRich to surface noContextHeading Notice (F7 / SDD)
	if (entry.id === "headings.cascade" && entry.runRich) {
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
	settings: MasonSettings,
	presetNoOpNotice: string,
): void {
	// Collect plans without applying individually (apply=false)
	const combined: EditPlan = [];
	for (const entry of entries) {
		const plan = runOperation(entry, editor, settings, false);
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
		name: "Mason: Tidy footnotes",
		editorCallback(editor: Editor): void {
			const steps = [
				byId["footnotes.fromCitations"],
				byId["footnotes.identity"],
				byId["footnotes.move"],
			].filter((e): e is RegistryEntry => e !== undefined);
			runPreset(steps, editor, plugin.settings, "No footnotes found to tidy");
		},
	});

	// "Mason: Format selection" — cascade → normalize → fromCitations → identity → move
	// PARSER-PENDING: footnote steps are stubs until Phase 4. Cascade + normalize work now.
	// TODO(Phase 4): wire selection-scoped context for footnote steps.
	plugin.addCommand({
		id: "preset.formatSelection",
		name: "Mason: Format selection",
		editorCallback(editor: Editor): void {
			const steps = [
				byId["headings.cascade"],
				byId["headings.normalize"],
				byId["footnotes.fromCitations"],
				byId["footnotes.identity"],
				byId["footnotes.move"],
			].filter((e): e is RegistryEntry => e !== undefined);
			runPreset(steps, editor, plugin.settings, "Nothing to format");
		},
	});

	// "Mason: Paste and format" — cascade → normalize → fromCitations → identity → move
	// PARSER-PENDING: clipboard reading + paste interception = Phase 5.
	// TODO(Phase 5): intercept paste event, read clipboard, prepend content
	// before the format steps so pasted text is processed.
	plugin.addCommand({
		id: "preset.pasteAndFormat",
		name: "Mason: Paste and format",
		editorCallback(editor: Editor): void {
			// Phase 5 seam: clipboard content will be read here and inserted before
			// running the format pipeline. Empty clipboard → Notice (F5 AC).
			// TODO(Phase 5): if clipboard empty → show Notice "Nothing is on the clipboard"; return.
			const steps = [
				byId["headings.cascade"],
				byId["headings.normalize"],
				byId["footnotes.fromCitations"],
				byId["footnotes.identity"],
				byId["footnotes.move"],
			].filter((e): e is RegistryEntry => e !== undefined);
			runPreset(steps, editor, plugin.settings, "Nothing to paste and format");
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

		// Capture entry in closure to avoid loop-variable aliasing
		const capturedEntry = entry;

		plugin.addCommand({
			id: capturedEntry.id,
			name: capturedEntry.command.name,
			editorCallback(editor: Editor): void {
				runOperation(capturedEntry, editor, plugin.settings, true);
			},
		});
	}

	if (plugin.settings.debugLogging) {
		const count = entries.length - SKIP_IDS.size + 3;
		console.debug(`[MarkdownMason] registered ${count} commands`);
	}
}
