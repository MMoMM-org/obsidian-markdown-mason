// No obsidian import — this module is pure domain; unit-testable without Obsidian.
// Uses the WHATWG URL API (global in all target environments: browser, Node ≥10, Obsidian).

/**
 * Return a canonical key for a URL so that semantically identical URLs
 * (differing only in scheme/host case, trailing slash, query-param order,
 * or fragment) collapse to the same string.
 *
 * Rules:
 *  1. Lowercase scheme and host (WHATWG URL does this automatically).
 *  2. Strip one trailing slash from pathname, including the root path.
 *     Canonical root form: "https://x.com" (no trailing slash).
 *  3. Sort query parameters by UTF-16 code-unit order (locale-independent).
 *     Encoding is preserved correctly via URLSearchParams.toString().
 *  4. Drop the fragment (hash).
 *  5. Non-http(s) scheme: return raw.trim().toLowerCase() (same as non-URL).
 *  6. Non-URL input: return raw.trim().toLowerCase().
 */
export function normalizeUrl(raw: string): string {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return raw.trim().toLowerCase();
	}

	// Only canonicalize web URLs; route other schemes through the text fallback
	// to avoid producing malformed keys like "mailto://user@example.com".
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return raw.trim().toLowerCase();
	}

	return buildCanonical(parsed);
}

function buildCanonical(url: URL): string {
	const host = url.host; // already lowercased by WHATWG URL
	const pathname = stripTrailingSlash(url.pathname);

	// Sort by UTF-16 code-unit order (locale-independent, stable for duplicate
	// keys) and let URLSearchParams.toString() handle percent-encoding correctly.
	// This avoids the collision bug where decoded reconstruction would merge
	// "?a=x%26b%3D2" (one param) with "?a=x&b=2" (two params).
	url.searchParams.sort();
	const query = url.searchParams.toString();
	const suffix = query ? `?${query}` : "";

	return `${url.protocol}//${host}${pathname}${suffix}`;
}

function stripTrailingSlash(pathname: string): string {
	if (pathname.length > 1 && pathname.endsWith("/")) {
		return pathname.slice(0, -1);
	}
	// Root path "/" becomes "": produces "https://x.com" with no trailing slash.
	if (pathname === "/") {
		return "";
	}
	return pathname;
}
