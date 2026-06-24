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

	/**
	 * Checkbox-style value (T4.2). The Scripts tab renders its enable toggle as a
	 * `<input type="checkbox">`; `checked` mirrors the DOM property. setValue() is
	 * a test convenience that sets `checked` and fires registered "change"
	 * listeners so onChange-style wiring is observable.
	 */
	checked: boolean = false;

	/** Mirror of MockHTMLElement.checked, surfaced as _value for assertion parity. */
	get _value(): boolean {
		return this.checked;
	}

	/** Test helper: set checked and dispatch a "change" event. */
	setValue(v: boolean): void {
		this.checked = v;
		this._dispatch({ type: "change" });
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

	/** Returns the value of a stored attribute, or undefined. */
	_attr(key: string): string | undefined {
		return this._attrs.get(key);
	}

	/** Find the first descendant checkbox input (the Scripts-tab enable toggle). */
	_findToggle(): MockHTMLElement | undefined {
		for (const child of this._children) {
			if (child.tagName === "input" && child._attr("type") === "checkbox") {
				return child;
			}
			const found = child._findToggle();
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

	/** Returns true if cls is in the element's class list. */
	_hasClass(cls: string): boolean {
		return this._classes.includes(cls);
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
// Menu — minimal stub for the ⋯ action menu (T4.2)
//
// Obsidian API surface used by scriptsTab.ts:
//   const m = new Menu();
//   m.addItem(item => item.setTitle("…").setIcon("…").onClick(() => {…}));
//   m.showAtMouseEvent(evt);
//
// Test-only helpers:
//   _items      — captured MockMenuItem list (title/icon/onClick)
//   _titles()   — convenience: array of every item title
//   _click(t)   — invoke the onClick of the item whose title === t
//   _shown      — true once showAtMouseEvent / showAtPosition was called
// ---------------------------------------------------------------------------

export class MockMenuItem {
	_title: string = "";
	_icon: string = "";
	_onClick: (() => void | Promise<void>) | null = null;
	_disabled: boolean = false;

	setTitle(title: string): this {
		this._title = title;
		return this;
	}

	setIcon(icon: string): this {
		this._icon = icon;
		return this;
	}

	setDisabled(disabled: boolean): this {
		this._disabled = disabled;
		return this;
	}

	onClick(cb: () => void | Promise<void>): this {
		this._onClick = cb;
		return this;
	}
}

export class Menu {
	readonly _items: MockMenuItem[] = [];
	_shown: boolean = false;

	addItem(cb: (item: MockMenuItem) => void): this {
		const item = new MockMenuItem();
		this._items.push(item);
		cb(item);
		return this;
	}

	addSeparator(): this {
		return this;
	}

	showAtMouseEvent(_evt: unknown): void {
		this._shown = true;
	}

	showAtPosition(_pos: unknown): void {
		this._shown = true;
	}

	/** Test helper: titles of all captured items, in order. */
	_titles(): string[] {
		return this._items.map((i) => i._title);
	}

	/** Test helper: invoke the onClick of the item whose title matches. */
	async _click(title: string): Promise<void> {
		const item = this._items.find((i) => i._title === title);
		if (item?._onClick) {
			await item._onClick();
		}
	}
}

// ---------------------------------------------------------------------------
// Command descriptor shape (mirrors Obsidian's addCommand parameter)
// ---------------------------------------------------------------------------

export interface CommandSpec {
	id: string;
	name: string;
	hotkeys?: unknown;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	editorCallback?: (editor: unknown, ...rest: any[]) => void | Promise<void>;
	callback?: () => void;
}

// ---------------------------------------------------------------------------
// Vault + DataAdapter — minimal in-memory stubs (T5.5)
//
// App.vault exposes adapter with read/write/exists/mkdir over a Map.
// Tests that need vault I/O seed files via app.vault.adapter._files.
// ---------------------------------------------------------------------------

export class MockDataAdapter {
	readonly _files: Map<string, string> = new Map();

	async read(path: string): Promise<string> {
		const content = this._files.get(path);
		if (content === undefined) throw new Error(`MockDataAdapter: file not found: ${path}`);
		return content;
	}

	async write(path: string, data: string): Promise<void> {
		this._files.set(path, data);
	}

	async exists(path: string): Promise<boolean> {
		return this._files.has(path);
	}

	async mkdir(_path: string): Promise<void> {
		// no-op in the simple stub; tests that check mkdir use their own VaultAdapterPort
	}
}

export class Vault {
	readonly adapter: MockDataAdapter = new MockDataAdapter();
}

// ---------------------------------------------------------------------------
// App, Workspace
// ---------------------------------------------------------------------------

export class App {
	workspace: Workspace;
	vault: Vault;
	constructor() {
		this.workspace = new Workspace();
		this.vault = new Vault();
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
	manifest: { id: string; [key: string]: unknown };
	private _registeredCleanups: Array<() => void> = [];
	private _registeredEventRefs: EventRef[] = [];
	private _savedData: unknown = undefined;
	private _capturedCommands: CommandSpec[] = [];

	constructor(app: App, manifest?: { id?: string; [key: string]: unknown }) {
		this.app = app;
		// Provide a stable manifest with a default id so tests that need manifest.id
		// (e.g. CommandManager which calls removeCommand with the full prefixed id)
		// work without needing to supply a real manifest. Callers may override after
		// construction: plugin.manifest.id = "my-plugin".
		this.manifest = { id: "markdown-mason", ...manifest };
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

	/** Captures the command descriptor for test inspection. Returns the registered command. */
	addCommand(cmd: CommandSpec): CommandSpec {
		this._capturedCommands.push(cmd);
		return cmd;
	}

	/**
	 * Removes a previously-registered command by its FULL prefixed id
	 * (e.g. "markdown-mason:my-command"). Matches on either the prefixed id OR
	 * the raw id to stay forward-compatible with both calling conventions.
	 */
	removeCommand(fullId: string): void {
		const idx = this._capturedCommands.findIndex(
			c => `${this.manifest.id}:${c.id}` === fullId || c.id === fullId,
		);
		if (idx !== -1) {
			this._capturedCommands.splice(idx, 1);
		}
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

	/**
	 * Stub for addSettingTab — records the tab for test inspection.
	 * In production Obsidian registers and renders the tab; here we just capture it.
	 */
	addSettingTab(_tab: unknown): void {
		// no-op in tests
	}
}

// ---------------------------------------------------------------------------
// Mock text/toggle/button control builders — T6.1
//
// Each addText / addToggle / addButton call on a Setting passes one of these
// mock control objects to the consumer callback, then records it on the setting
// for test introspection.
//
// Controls are ACTIVE: setValue fires all registered onChange callbacks so that
// tests can simulate user interaction and observe side-effects (e.g. saveSettings).
// ---------------------------------------------------------------------------

class MockTextControl {
	_value: string = "";
	private _onChangeCbs: Array<(v: string) => void> = [];

	setValue(v: string): this {
		this._value = v;
		for (const cb of this._onChangeCbs) {
			cb(v);
		}
		return this;
	}

	getValue(): string {
		return this._value;
	}

	onChange(cb: (v: string) => void): this {
		this._onChangeCbs.push(cb);
		return this;
	}

	setPlaceholder(_placeholder: string): this {
		return this;
	}
}

class MockToggleControl {
	_value: boolean = false;
	private _onChangeCbs: Array<(v: boolean) => void> = [];

	setValue(v: boolean): this {
		this._value = v;
		for (const cb of this._onChangeCbs) {
			cb(v);
		}
		return this;
	}

	getValue(): boolean {
		return this._value;
	}

	onChange(cb: (v: boolean) => void): this {
		this._onChangeCbs.push(cb);
		return this;
	}
}

class MockButtonControl {
	_text: string = "";
	private _clickCbs: Array<() => void | Promise<void>> = [];

	setButtonText(text: string): this {
		this._text = text;
		return this;
	}

	onClick(cb: () => void | Promise<void>): this {
		this._clickCbs.push(cb);
		return this;
	}

	async _simulateClick(): Promise<void> {
		for (const cb of this._clickCbs) {
			await cb();
		}
	}
}

// ---------------------------------------------------------------------------
// CapturedSetting — the record stored per new Setting(containerEl)
// ---------------------------------------------------------------------------

interface CapturedSettingRecord {
	name: string;
	desc: string;
	isHeading: boolean;
	textControls: MockTextControl[];
	toggleControls: MockToggleControl[];
	buttonControls: MockButtonControl[];
}

// Module-level capture list — cleared between tests via clearCapturedSettings().
const _capturedSettings: CapturedSettingRecord[] = [];

/** Test helper: returns a snapshot of all Setting instances built so far. */
export function capturedSettings(): CapturedSettingRecord[] {
	return [..._capturedSettings];
}

/** Test helper: clears the captured settings list. Call in beforeEach or before renderTab(). */
export function clearCapturedSettings(): void {
	_capturedSettings.length = 0;
}

// ---------------------------------------------------------------------------
// Setting — chainable builder; records itself in _capturedSettings on construction
//
// Supports the Obsidian Setting API surface used by MasonSettingTab:
//   setName(s)    — set the setting label
//   setDesc(s)    — set the description
//   setHeading()  — mark as a section heading
//   addText(cb)   — add a text input; cb receives MockTextControl
//   addToggle(cb) — add a toggle; cb receives MockToggleControl
//   addButton(cb) — add a button; cb receives MockButtonControl
// ---------------------------------------------------------------------------

export class Setting {
	private readonly _record: CapturedSettingRecord;

	/** containerEl is accepted to match the Obsidian API signature; not used in the mock. */
	constructor(_containerEl: unknown) {
		this._record = {
			name: "",
			desc: "",
			isHeading: false,
			textControls: [],
			toggleControls: [],
			buttonControls: [],
		};
		_capturedSettings.push(this._record);
	}

	setName(name: string): this {
		this._record.name = name;
		return this;
	}

	setDesc(desc: string): this {
		this._record.desc = desc;
		return this;
	}

	setHeading(): this {
		this._record.isHeading = true;
		return this;
	}

	addText(cb: (text: MockTextControl) => void): this {
		const ctrl = new MockTextControl();
		this._record.textControls.push(ctrl);
		cb(ctrl);
		return this;
	}

	addToggle(cb: (toggle: MockToggleControl) => void): this {
		const ctrl = new MockToggleControl();
		this._record.toggleControls.push(ctrl);
		cb(ctrl);
		return this;
	}

	addButton(cb: (button: MockButtonControl) => void): this {
		const ctrl = new MockButtonControl();
		this._record.buttonControls.push(ctrl);
		cb(ctrl);
		return this;
	}
}

// ---------------------------------------------------------------------------
// PluginSettingTab — T6.1
//
// Base class for settings tabs. In production Obsidian provides this;
// here we expose a minimal stub with containerEl and lifecycle methods.
// MasonSettingTab extends this class.
// ---------------------------------------------------------------------------

export class PluginSettingTab {
	app: App;
	containerEl: MockHTMLElement;

	constructor(app: App, _plugin: unknown) {
		this.app = app;
		this.containerEl = new MockHTMLElement("div");
	}

	/** Override to render settings. */
	display(): void | Promise<void> {
		// no-op base implementation
	}

	/** Override to clean up. */
	hide(): void {
		// no-op base implementation
	}
}
