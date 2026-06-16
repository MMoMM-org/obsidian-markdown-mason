// No obsidian import — this module is pure domain; unit-testable without Obsidian.

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface MasonSettings {
	/** Enable verbose console.debug traces. Off by default. */
	debugLogging: boolean;
	/** Folder name used as a Resources section when building heading cascades. */
	resourcesName: string;
}

export const DEFAULT_SETTINGS: MasonSettings = {
	debugLogging: false,
	resourcesName: "Resources",
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
