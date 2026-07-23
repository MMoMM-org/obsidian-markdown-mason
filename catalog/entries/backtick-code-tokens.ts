// Catalog entry envelope — backtick code tokens (ADR-16)
//
// Standalone `backtick-code-tokens.cjs` artifact entry point. Command-only:
// there is NO `paste` handler, so the script never participates in "Paste and
// format" / never runs automatically — the user runs it on a selection via its
// command. See catalog/scripts/backtickCodeTokens.ts for the heuristic rationale.

import { backtickCodeTokensScript } from "../scripts/backtickCodeTokens";

export default {
	run: backtickCodeTokensScript,
};
