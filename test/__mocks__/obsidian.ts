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
 */

export interface EventRef {
	_mockEventRef: true;
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
