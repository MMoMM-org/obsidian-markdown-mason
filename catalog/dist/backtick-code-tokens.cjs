"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// catalog/entries/backtick-code-tokens.ts
var backtick_code_tokens_exports = {};
__export(backtick_code_tokens_exports, {
  default: () => backtick_code_tokens_default
});
module.exports = __toCommonJS(backtick_code_tokens_exports);

// catalog/scripts/backtickCodeTokens.ts
var PATTERNS = [
  // path/file with a line (or line-range): render.py:102-110, parser.py:432
  { name: "path-line", re: /(?<![\w`])[\w./+-]*\.[A-Za-z]{1,8}:\d+(?:-\d+)?(?![\w`])/g },
  // dataview / wikilink field written literally: up:: [[MOC]]
  { name: "field-wikilink", re: /(?<![\w`])\w+::\s*\[\[[^\]\n]+\]\](?![`])/g },
  // empty/JSON-ish field value: detail.candidate_mocs: []
  { name: "json-empty", re: /(?<![\w`])\w+(?:\.\w+)+:\s*\[\](?![\w`])/g },
  // standalone wikilink meant as literal text: [[MOC]]
  { name: "wikilink", re: /(?<![`[])\[\[[^\]\n]+\]\](?![`\]])/g },
  // RISKY — dotted identifier / member access: detail.candidate_mocs, foo.bar.
  // Also matches "e.g", domain-ish tokens. Disable if it overreaches.
  { name: "dotted-ident", re: /(?<![\w`.])[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+(?![\w`(])/g }
];
var PROTECT = [
  /```[\s\S]*?```/g,
  // fenced code
  /`[^`\n]+`/g,
  // inline code
  /!?\[[^\]\n]*\]\([^)\n]*\)/g
  // markdown links / images
];
function protectedRanges(text) {
  const ranges = [];
  for (const re of PROTECT) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      ranges.push({ from: m.index, to: m.index + m[0].length });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return ranges;
}
function overlaps(from, to, ranges) {
  return ranges.some((r) => from < r.to && to > r.from);
}
function applyWraps(text, wraps) {
  wraps.sort((a, b) => b.from - a.from);
  let out = text;
  for (const w of wraps) {
    out = out.slice(0, w.from) + "`" + out.slice(w.from, w.to) + "`" + out.slice(w.to);
  }
  return out;
}
function bodyTarget(op) {
  return op.replaceRange ?? { from: op.cursor, to: op.cursor };
}
var backtickCodeTokensScript = (ctx) => {
  const text = ctx.input ?? "";
  if (text.length === 0) return void 0;
  const taken = protectedRanges(text);
  const wraps = [];
  for (const { re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const from = m.index;
      const to = from + m[0].length;
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (overlaps(from, to, taken)) continue;
      wraps.push({ from, to });
      taken.push({ from, to });
    }
  }
  if (wraps.length === 0) return void 0;
  const transformed = applyWraps(text, wraps);
  if (transformed === text) return void 0;
  ctx.logger.info(`backtick-code-tokens: wrapped ${wraps.length} token(s)`);
  const t = bodyTarget(ctx.op);
  return [{ from: t.from, to: t.to, insert: transformed }];
};

// catalog/entries/backtick-code-tokens.ts
var backtick_code_tokens_default = {
  run: backtickCodeTokensScript
};
