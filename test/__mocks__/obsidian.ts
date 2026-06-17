/**
 * Minimal vitest mock for the 'obsidian' package (types-only, no runtime).
 * Exposes the minimal surface used by MarkdownMasonPlugin.
 * Reusable by later test phases.
 *
 * Extensions for T3.4:
 *   - Plugin._commands   captures every addCommand() call (array of command descriptors)
 *   - Notice class       records messages in module-level _noticeMessages
 *   - noticeLog()        test helper — returns a copy of captured Notice messages
 *   - clearNoticeLog()   test helper — empties the capture list between tests
 *
 * Extensions for T5.3:
 *   - MockHTMLElement    lightweight HTMLElement-like with createEl/createDiv/setText/
 *                        setAttribute/addClass/empty/addEventListener/removeEventListener
 *                        plus test helpers: _collectText(), _findButtonByText(),
 *                        _findAllButtons(), _dispatch()
 *   - Modal              base class: contentEl (MockHTMLElement), titleEl, open/close,
 *                        onOpen/onClose lifecycle hooks called synchronously
 */

export interface EventRef {
	_mockEventRef: true;
}

// ---------------------------------------------------------------------------
// MockHTMLElement — lightweight DOM node for modal unit tests (T5.3)
//
// Supports the Obsidian DOM-builder API surface:
//   createEl(tag, opts?)  — creates a child MockHTMLElement; opts.text sets text
//   createDiv(opts?)      — shorthand for createEl("div", opts)
//   setText(text)         — sets this node's own text content
//   setAttribute(k, v)    — stores an attribute
//   addClass(cls)         — stores a class name
//   empty()               — removes all children and clears own text
//   addEventListener()    — stores handler
//   removeEventListener() — removes handler by type+fn identity
//
// Test-only helpers:
//   _collectText()            — joins all text in this subtree
//   _findButtonByText(label)  — finds a descendant button element by exact text
//   _findAllButtons()         — all descendant button elements
//   _dispatch(event)          — fires all matching listeners on this node
//   _click()                  — dispatches a synthetic click event
//   _text                     — own text content (without children)
// ---------------------------------------------------------------------------

type EventHandler = (evt: { key?: string; type?: string }) => void;

export class MockHTMLElement {
	readonly tagName: string;
	_text: string = "";
	_focused: boolean = false;
	private _attrs: Map<string, string> = new Map();
	private _classes: string[] = [];
	private _children: MockHTMLElement[] = [];
	private _listeners: Map<string, EventHandler[]> = new Map();

	constructor(tagName: string) {
		this.tagName = tagName;
	}

	/** Obsidian API: create a child element, optionally with text. */
	createEl(tag: string, opts?: { text?: string; cls?: string; attr?: Record<string, string> }): MockHTMLElement {
		const child = new MockHTMLElement(tag);
		if (opts?.text) {
			child.setText(opts.text);
		}
		if (opts?.cls) {
			child.addClass(opts.cls);
		}
		if (opts?.attr) {
			for (const [k, v] of Object.entries(opts.attr)) {
				child.setAttribute(k, v);
			}
		}
		this._children.push(child);
		return child;
	}

	/** Obsidian API: shorthand for createEl("div", opts). */
	createDiv(opts?: { text?: string; cls?: string }): MockHTMLElement {
		return this.createEl("div", opts);
	}

	/** Obsidian API: set own text content. */
	setText(text: string): void {
		this._text = text;
	}

	/** Obsidian API: store an attribute. */
	setAttribute(key: string, value: string): void {
		this._attrs.set(key, value);
	}

	/** Obsidian API: store a class name. */
	addClass(cls: string): void {
		this._classes.push(cls);
	}

	/** Obsidian API: clear all children and own text. */
	empty(): void {
		this._children = [];
		this._text = "";
		this._listeners = new Map();
	}

	/** Obsidian / DOM API: register an event listener. */
	addEventListener(type: string, handler: EventHandler): void {
		const list = this._listeners.get(type) ?? [];
		list.push(handler);
		this._listeners.set(type, list);
	}

	/** Obsidian / DOM API: remove a specific event listener. */
	removeEventListener(type: string, handler: EventHandler): void {
		const list = this._listeners.get(type) ?? [];
		this._listeners.set(type, list.filter(h => h !== handler));
	}

	/** DOM API: focus this element. Sets _focused = true for test assertions. */
	focus(): void {
		this._focused = true;
	}

	// -------------------------------------------------------------------------
	// Test helpers
	// -------------------------------------------------------------------------

	/** Collect all text in this subtree (depth-first). */
	_collectText(): string {
		const parts: string[] = [];
		if (this._text) {
			parts.push(this._text);
		}
		for (const child of this._children) {
			parts.push(child._collectText());
		}
		return parts.join(" ");
	}

	/** Find first descendant button whose _text exactly matches label. */
	_findButtonByText(label: string): MockHTMLElement | undefined {
		for (const child of this._children) {
			if (child.tagName === "button" && child._text === label) {
				return child;
			}
			const found = child._findButtonByText(label);
			if (found) {
				return found;
			}
		}
		return undefined;
	}

	/** All descendant button elements (depth-first). */
	_findAllButtons(): MockHTMLElement[] {
		const result: MockHTMLElement[] = [];
		for (const child of this._children) {
			if (child.tagName === "button") {
				result.push(child);
			}
			result.push(...child._findAllButtons());
		}
		return result;
	}

	/** Dispatch a synthetic event to all listeners of the given type. */
	_dispatch(event: { key?: string; type?: string }): void {
		const type = event.type ?? "keydown";
		const handlers = this._listeners.get(type) ?? [];
		for (const h of handlers) {
			h(event);
		}
	}

	/** Simulate a click on this element (dispatches "click" event). */
	_click(): void {
		this._dispatch({ type: "click" });
	}

	/** Find the first descendant (or self) that has _focused === true. */
	_findFocusedElement(): MockHTMLElement | undefined {
		if (this._focused) {
			return this;
		}
		for (const child of this._children) {
			const found = child._findFocusedElement();
			if (found) {
				return found;
			}
		}
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// Modal base class — T5.3
//
// open() calls onOpen() synchronously so tests can inspect the rendered
// contentEl immediately after open() returns (no async tick needed).
// close() calls onClose() synchronously.
//
// The resolver pattern is: present() opens the modal; button/key handlers
// in onOpen() call close() which calls onClose() which resolveOnce("disable")
// as the safe-default.  Button handlers resolve first, then close, so the
// final resolution is the button's decision.
// ---------------------------------------------------------------------------

export class Modal {
	app: App;
	contentEl: MockHTMLElement;
	titleEl?: MockHTMLElement;

	constructor(app: App) {
		this.app = app;
		this.contentEl = new MockHTMLElement("div");
		this.titleEl = new MockHTMLElement("div");
	}

	/** Open the modal — calls onOpen() synchronously. */
	open(): void {
		this.onOpen();
	}

	/** Close the modal — calls onClose() synchronously. */
	close(): void {
		this.onClose();
	}

	/** Override in subclass to build modal content. */
	onOpen(): void {
		// no-op base implementation
	}

	/** Override in subclass to clean up. */
	onClose(): void {
		// no-op base implementation
	}
}

// ---------------------------------------------------------------------------
// Notice capture — module-level so all Notice instances write to one log
// ---------------------------------------------------------------------------

const _noticeMessages: string[] = [];

/** Test helper: returns a snapshot of all Notice messages shown so far. */
export function noticeLog(): string[] {
	return [..._noticeMessages];
}

/** Test helper: clears the Notice message log. Call in beforeEach. */
export function clearNoticeLog(): void {
	_noticeMessages.length = 0;
}

/**
 * Stub for the Obsidian Notice class.
 * Appends the message to the module-level capture log so tests can spy on it.
 */
export class Notice {
	readonly message: string;

	constructor(message: string, _timeout?: number) {
		this.message = message;
		_noticeMessages.push(message);
	}
}

// ---------------------------------------------------------------------------
// Command descriptor shape (mirrors Obsidian's addCommand parameter)
// ---------------------------------------------------------------------------

export interface CommandSpec {
	id: string;
	name: string;
	hotkeys?: unknown;
	editorCallback?: (editor: unknown) => void;
	callback?: () => void;
}

// ---------------------------------------------------------------------------
// App, Workspace
// ---------------------------------------------------------------------------

export class App {
	workspace: Workspace;
	constructor() {
		this.workspace = new Workspace();
	}
}

export class Workspace {
	private _layoutReadyCallbacks: Array<() => void> = [];

	onLayoutReady(cb: () => void): void {
		this._layoutReadyCallbacks.push(cb);
	}

	/** Test helper: fire all registered onLayoutReady callbacks. */
	_fireLayoutReady(): void {
		for (const cb of this._layoutReadyCallbacks) {
			cb();
		}
	}

	/** Test helper: how many layout-ready callbacks were registered. */
	get _layoutReadyCount(): number {
		return this._layoutReadyCallbacks.length;
	}
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export class Plugin {
	app: App;
	private _registeredCleanups: Array<() => void> = [];
	private _registeredEventRefs: EventRef[] = [];
	private _savedData: unknown = undefined;
	private _capturedCommands: CommandSpec[] = [];

	constructor(app: App, _manifest?: unknown) {
		this.app = app;
	}

	async loadData(): Promise<unknown> {
		return this._savedData ?? {};
	}

	async saveData(data: unknown): Promise<void> {
		this._savedData = data;
	}

	registerEvent(ref: EventRef): void {
		this._registeredEventRefs.push(ref);
	}

	register(cb: () => void): void {
		this._registeredCleanups.push(cb);
	}

	/** Captures the command descriptor for test inspection. */
	addCommand(cmd: CommandSpec): void {
		this._capturedCommands.push(cmd);
	}

	/** Test helper: all commands registered via addCommand(). */
	get _commands(): CommandSpec[] {
		return [...this._capturedCommands];
	}

	/** Test helper: cleanups registered via register(). */
	get _cleanups(): Array<() => void> {
		return [...this._registeredCleanups];
	}

	/** Test helper: event refs registered via registerEvent(). */
	get _eventRefs(): EventRef[] {
		return [...this._registeredEventRefs];
	}

	/** Test helper: the in-memory saved data. */
	get _persistedData(): unknown {
		return this._savedData;
	}
}
