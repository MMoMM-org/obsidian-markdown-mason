// No obsidian import — this module is pure domain; unit-testable without Obsidian.
import type { FormatSelectionRecipe } from "./formatSelection";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface MasonSettings {
	/** Enable verbose console.debug traces. Off by default. */
	debugLogging: boolean;
	/**
	 * Heading where "Tidy / Move footnotes" collects footnote definitions. Carries
	 * an optional ATX level prefix (e.g. "## Resources", "### Resources") so the
	 * user controls the heading level. An existing section with this name is reused
	 * at whatever level it already has. See core/resourcesHeading.ts.
	 */
	resourcesName: string;
	/**
	 * When true (default), only numeric footnote references are processed;
	 * alpha markers such as [^A] are excluded.
	 *
	 * Optional to preserve backward compatibility with persisted data and existing
	 * test fixtures that do not include this field. Treated as `true` when absent.
	 *
	 * KNOWN LIMITATION (v0.1): this setting persists and threads into
	 * OperationContext.settings, but numericOnly=false is not yet honoured
	 * by the core footnote logic. The core already behaves as if numericOnly
	 * is always true (ExistingRef is defined as numeric-only; see types.ts).
	 * Wiring numericOnly=false to allow alpha markers is a planned follow-up.
	 */
	numericOnly?: boolean;
	/**
	 * When true (default), a one-shot "what's new" splash is shown the first time
	 * the plugin runs after its version changes. Surfaces how many curated scripts
	 * have a newer catalog version waiting (scripts ride pinned plugin releases, so
	 * a plugin update is the only moment a script version can change). User-gated
	 * via General settings and the in-splash toggle.
	 *
	 * Optional for backward-compat with persisted data predating this field;
	 * treated as `true` when absent.
	 */
	showUpdateSplash?: boolean;
	/**
	 * The plugin version (manifest.version) last shown to the user. Compared against
	 * the current manifest.version on load to detect an update (mirrors Excalidraw's
	 * `previousRelease`). Empty string means "never recorded" → fresh install, which
	 * is recorded silently without a splash.
	 *
	 * Optional for backward-compat; treated as `""` when absent.
	 */
	lastSeenVersion?: string;
	/**
	 * Per-step toggles for the Format selection command. All eleven toggles default to
	 * true when absent. Absent field (older persisted data) resolves to all-on via
	 * resolveFormatSelectionRecipe(). See spec 003 and spec 004.
	 */
	formatSelection?: Partial<FormatSelectionRecipe>;
}

export const DEFAULT_SETTINGS: MasonSettings = {
	debugLogging: false,
	resourcesName: "## Resources",
	numericOnly: true,
	showUpdateSplash: true,
	lastSeenVersion: "",
	formatSelection: {
		cascade: true, normalize: true, fromCitations: true, identity: true, move: true,
		dewrap: true, dehyphenate: true, decomposeLigatures: true,
		tidyWhitespace: true, normalizeBullets: true, normalizeOrdered: true,
	},
};

// ---------------------------------------------------------------------------
// Edit primitives
// ---------------------------------------------------------------------------

/** A single text replacement expressed as offsets against the ORIGINAL document. */
export interface Edit {
	from: number;
	to: number;
	insert: string;
}

/** An ordered set of edits to apply to produce the transformed document. */
export type EditPlan = Edit[];

// ---------------------------------------------------------------------------
// Operation context
// ---------------------------------------------------------------------------

export interface OperationContext {
	/** Full current document text. */
	doc: string;
	/** Cursor offset; for paste operations this is the insertion point. */
	cursor: number;
	selection?: { from: number; to: number };
	/**
	 * When set, body-insertion helpers (cascade / cascadeOrInsert) REPLACE this
	 * range instead of inserting at `cursor`. The command path sets it to the
	 * active selection so paste-formatter scripts transform the selected raw text
	 * in place (format-in-place) instead of inserting a formatted copy and leaving
	 * the original behind. Paste never sets it (no prior selection) → insert-at-cursor.
	 */
	replaceRange?: { from: number; to: number };
	/** Paste or selection payload when the operation is source-scoped. */
	input?: string;
	/** Plugin settings (resourcesName, debugLogging, …). */
	settings: MasonSettings;
}

// ---------------------------------------------------------------------------
// Footnote domain types
// ---------------------------------------------------------------------------

export interface FootnoteRef {
	incomingId: number;
	snippet: string;
	title: string;
	url: string;
}

/** Numeric-only existing footnote reference; alpha markers such as [^A] are excluded. */
export interface ExistingRef {
	id: number;
	url: string;
}

export interface InlineMarker {
	marker: string;
	n: number;
}

export interface ParseResult {
	body: string;
	inline: InlineMarker[];
	sources: FootnoteRef[];
}

// ---------------------------------------------------------------------------
// Operation — unit registered once, exposed as command AND mason.* API
// ---------------------------------------------------------------------------

export interface Operation {
	/** Dot-namespaced identifier, e.g. "headings.cascade". */
	id: string;
	/** Fully-qualified API name, e.g. "mason.headings.cascade". */
	apiName: string;
	/** Optional Obsidian command registration. */
	command?: { name: string };
	run(ctx: OperationContext): EditPlan;
}
