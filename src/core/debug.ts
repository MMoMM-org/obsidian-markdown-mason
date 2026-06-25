// Gated diagnostic logging.
//
// All Markdown Mason trace output goes through debug() so it is suppressed
// unless the user turns on the "Debug logging" setting. The plugin bundles to a
// single module, so the module-level flag is shared across every call site;
// main.ts seeds it from settings on load and the Advanced toggle updates it live.
//
// console.warn / console.error are intentionally NOT routed here — genuine
// warnings and errors should always surface. console.log is banned outright
// (see compliance tests); use debug() for traces.

let _enabled = false;

/** Enable or disable diagnostic trace output (mirrors the debugLogging setting). */
export function setDebugLogging(enabled: boolean): void {
	_enabled = enabled;
}

/** True when diagnostic tracing is currently enabled. */
export function isDebugLogging(): boolean {
	return _enabled;
}

/** Emit a diagnostic trace via console.debug — a no-op unless debug logging is on. */
export function debug(...args: unknown[]): void {
	if (_enabled) {
		console.debug(...args);
	}
}
