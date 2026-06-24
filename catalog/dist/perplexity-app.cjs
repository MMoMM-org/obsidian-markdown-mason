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

// catalog/entries/perplexity-app.ts
var perplexity_app_exports = {};
__export(perplexity_app_exports, {
  default: () => perplexity_app_default
});
module.exports = __toCommonJS(perplexity_app_exports);

// catalog/parsers/perplexityApp.ts
var SOURCES_MARKER_RE = /^(Sources|Citations:|Quellen)\s*$/m;
var SOURCE_LINE_RE = /^\[(\d+)\]\s+(.+?)\s+(https?:\/\/\S+)\s*$/;
var INLINE_MARKER_RE = /\[(\d+)\]/g;
function canParse(input) {
  if (!SOURCES_MARKER_RE.test(input)) return false;
  return input.split("\n").some((line) => SOURCE_LINE_RE.test(line));
}
function splitIntoAnswerBlocks(lines) {
  const blocks = [];
  let inAnswer = false;
  let inSources = false;
  let current = { proseLines: [], sourceLines: [] };
  for (const line of lines) {
    if (line.startsWith("## Answer")) {
      if (inAnswer) blocks.push(current);
      current = { proseLines: [], sourceLines: [] };
      inAnswer = true;
      inSources = false;
      current.proseLines.push(line);
      continue;
    }
    if (!inAnswer) continue;
    if (SOURCES_MARKER_RE.test(line)) {
      inSources = true;
      continue;
    }
    if (inSources && line.startsWith("## ")) {
      inSources = false;
    }
    if (inSources) {
      if (SOURCE_LINE_RE.test(line)) {
        current.sourceLines.push(line);
      }
    } else {
      current.proseLines.push(line);
    }
  }
  if (inAnswer) blocks.push(current);
  return blocks;
}
function parseSourceLine(line) {
  const m = SOURCE_LINE_RE.exec(line);
  if (!m) return null;
  const title = m[2].trim();
  const url = m[3].trim();
  return { title, url, snippet: title };
}
function collectSources(blocks) {
  const result = [];
  let globalCounter = 0;
  for (const block of blocks) {
    for (const line of block.sourceLines) {
      const parsed = parseSourceLine(line);
      if (!parsed) continue;
      globalCounter++;
      result.push({ incomingId: globalCounter, ...parsed });
    }
  }
  return result;
}
function renumberProseMarkers(line, offset) {
  if (offset === 0) return line;
  return line.replace(INLINE_MARKER_RE, (_match, digits) => {
    return `[${parseInt(digits, 10) + offset}]`;
  });
}
function collectInlineMarkers(proseLines, offset) {
  const markers = [];
  for (const line of proseLines) {
    INLINE_MARKER_RE.lastIndex = 0;
    let match;
    while ((match = INLINE_MARKER_RE.exec(line)) !== null) {
      const globalN = parseInt(match[1], 10) + offset;
      markers.push({ marker: `[${globalN}]`, n: globalN });
    }
  }
  return markers;
}
function parse(input) {
  const inputLines = input.split("\n");
  const blocks = splitIntoAnswerBlocks(inputLines);
  const offsets = [];
  let running = 0;
  for (const block of blocks) {
    offsets.push(running);
    running += block.sourceLines.length;
  }
  const sources = collectSources(blocks);
  const inline = [];
  for (let i = 0; i < blocks.length; i++) {
    const blockMarkers = collectInlineMarkers(blocks[i].proseLines, offsets[i]);
    inline.push(...blockMarkers);
  }
  const firstAnswerIdx = inputLines.findIndex((l) => l.startsWith("## Answer"));
  const preLines = firstAnswerIdx >= 0 ? inputLines.slice(0, firstAnswerIdx) : [];
  const bodyLines = [...preLines];
  for (let i = 0; i < blocks.length; i++) {
    const offset = offsets[i];
    for (const line of blocks[i].proseLines) {
      bodyLines.push(renumberProseMarkers(line, offset));
    }
    if (i < blocks.length - 1) {
      bodyLines.push("");
    }
  }
  const body = bodyLines.join("\n");
  return { body, inline, sources };
}
var perplexityApp = { canParse, parse };

// src/core/url.ts
function normalizeUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return raw.trim().toLowerCase();
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return raw.trim().toLowerCase();
  }
  return buildCanonical(parsed);
}
function buildCanonical(url) {
  const host = url.host;
  const pathname = stripTrailingSlash(url.pathname);
  url.searchParams.sort();
  const query = url.searchParams.toString();
  const suffix = query ? `?${query}` : "";
  return `${url.protocol}//${host}${pathname}${suffix}`;
}
function stripTrailingSlash(pathname) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  if (pathname === "/") {
    return "";
  }
  return pathname;
}

// src/core/footnotes.ts
function resolveFootnoteIdentity(incoming, existing) {
  const maxStart = existing.reduce((m, e) => Math.max(m, e.id), 0);
  let maxExisting = maxStart;
  const existingByUrl = buildExistingByUrl(existing);
  const seenInPaste = {};
  const idMap = {};
  const newRefs = [];
  for (const ref of incoming) {
    if (idMap[ref.incomingId] !== void 0) continue;
    const norm = normalizeUrl(ref.url);
    const firstInPaste = seenInPaste[norm];
    if (firstInPaste !== void 0) {
      idMap[ref.incomingId] = idMap[firstInPaste];
      continue;
    }
    seenInPaste[norm] = ref.incomingId;
    const existingId = existingByUrl[norm];
    if (existingId !== void 0) {
      idMap[ref.incomingId] = existingId;
    } else {
      const newId = ++maxExisting;
      idMap[ref.incomingId] = newId;
      newRefs.push({ ...ref, id: newId });
    }
  }
  return { idMap, newRefs };
}
function buildExistingByUrl(existing) {
  const map = {};
  for (const e of existing) {
    map[normalizeUrl(e.url)] = e.id;
  }
  return map;
}
function scanExistingRefs(doc) {
  const refs = [];
  const lines = doc.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const id = parseNumericDefLine(lines[i]);
    if (id === null) continue;
    const url = parseUrlLine(lines[i + 1]);
    refs.push({ id, url });
  }
  return refs;
}
function parseNumericDefLine(line) {
  const m = /^\[\^(\d+)\]:/.exec(line);
  if (!m) return null;
  return Number(m[1]);
}
function parseUrlLine(line) {
  if (!line) return "";
  const m = /^\[[^\]]*\]\(([^)]+)\)/.exec(line);
  return m ? m[1] : "";
}
function applyFootnoteInlineRename(body, idMap) {
  const plan = [];
  const re = /\[\^(\d+)\]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const n = Number(m[1]);
    const newId = idMap[n];
    if (newId === void 0) continue;
    plan.push({
      from: m.index,
      to: m.index + m[0].length,
      insert: `[^${newId}]`
    });
  }
  return plan;
}
function formatF4Def(ref) {
  return `[^${ref.id}]: ${ref.snippet}
[${ref.title}](${ref.url})`;
}
function newRefDefinitions(newRefs) {
  return newRefs.map(formatF4Def);
}
function fromCitations(parseResult) {
  if (parseResult.inline.length === 0) return [];
  const targetCount = countTargets(parseResult.inline);
  const plan = [];
  for (const [n, count] of Object.entries(targetCount)) {
    const numeric = Number(n);
    const re = new RegExp(`\\[${numeric}\\](?!\\()`, "g");
    let m;
    let found = 0;
    while ((m = re.exec(parseResult.body)) !== null && found < count) {
      plan.push({
        from: m.index,
        to: m.index + m[0].length,
        insert: `[^${numeric}]`
      });
      found++;
    }
  }
  return plan.sort((a, b) => a.from - b.from);
}
function countTargets(inline) {
  const counts = {};
  for (const marker of inline) {
    counts[marker.n] = (counts[marker.n] ?? 0) + 1;
  }
  return counts;
}
function moveToResources(ctx, defs) {
  if (defs.length === 0) return [];
  const { doc, settings } = ctx;
  const headingLine = `## ${settings.resourcesName}`;
  const insertOffset = findSectionInsertOffset(doc, headingLine);
  if (insertOffset === null) {
    return [buildNoteEndInsert(doc, headingLine, defs)];
  }
  return [buildSectionAppend(insertOffset, defs)];
}
function findSectionInsertOffset(doc, headingLine) {
  const lines = doc.split("\n");
  let inSection = false;
  let offset = 0;
  let sectionEndOffset = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inSection) {
      if (line === headingLine) {
        inSection = true;
      }
      offset += line.length + 1;
      continue;
    }
    if (line.startsWith("## ")) {
      sectionEndOffset = offset;
      break;
    }
    offset += line.length + 1;
    sectionEndOffset = offset;
  }
  if (!inSection) return null;
  return Math.min(sectionEndOffset, doc.length);
}
function buildSectionAppend(offset, defs) {
  const sep = defs.some((d) => d.includes("\n")) ? "\n\n" : "\n";
  const content = "\n" + defs.join(sep) + "\n";
  return { from: offset, to: offset, insert: content };
}
function buildNoteEndInsert(doc, headingLine, defs) {
  const sep = defs.some((d) => d.includes("\n")) ? "\n\n" : "\n";
  const content = `
${headingLine}

${defs.join(sep)}`;
  return { from: doc.length, to: doc.length, insert: content };
}

// src/core/applyToString.ts
function applyToString(doc, plan) {
  if (plan.length === 0) return doc;
  const tagged = plan.map((edit, i) => ({ edit, i }));
  tagged.sort((a, b) => {
    const byFrom = b.edit.from - a.edit.from;
    if (byFrom !== 0) return byFrom;
    return b.i - a.i;
  });
  let result = doc;
  for (const { edit } of tagged) {
    result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
  }
  return result;
}

// src/core/headings.ts
function parseHeadings(text) {
  const headings = [];
  let pos = 0;
  for (const line of text.split("\n")) {
    const m = line.match(/^(#{1,6})\s/);
    if (m) {
      headings.push({ offset: pos, level: m[1].length, text: line });
    }
    pos += line.length + 1;
  }
  return headings;
}
function findContextLevel(doc, cursor) {
  const textBefore = doc.slice(0, cursor);
  const headings = parseHeadings(textBefore);
  if (headings.length === 0) return 0;
  return headings[headings.length - 1].level;
}
function clampLevel(level) {
  return Math.max(1, Math.min(6, level));
}
function cascade(ctx) {
  const input = ctx.input ?? "";
  const ctxLevel = findContextLevel(ctx.doc, ctx.cursor);
  if (ctxLevel === 0) {
    return { plan: [], noContextHeading: true };
  }
  const inputHeadings = parseHeadings(input);
  if (inputHeadings.length === 0) {
    return { plan: [], noContextHeading: false };
  }
  const minIn = Math.min(...inputHeadings.map((h) => h.level));
  const shift = ctxLevel + 1 - minIn;
  const transformed = applyShiftToText(input, shift);
  return {
    plan: [{ from: ctx.cursor, to: ctx.cursor, insert: transformed }],
    noContextHeading: false
  };
}
function applyShiftToText(text, shift) {
  return text.replace(/^(#{1,6})(\s)/gm, (_match, hashes, space) => {
    const newLevel = clampLevel(hashes.length + shift);
    return "#".repeat(newLevel) + space;
  });
}

// catalog/scripts/replaceMarkersInBody.ts
function filterCitedSources(sources, inline) {
  const citedIds = new Set(inline.map((m) => m.n));
  return sources.filter((s) => citedIds.has(s.incomingId));
}

// catalog/scripts/perplexityApp.ts
var perplexityAppScript = (ctx) => {
  if (!perplexityApp.canParse(ctx.input)) return void 0;
  ctx.logger.info(`perplexity-app started (source=${ctx.source})`);
  const pr = perplexityApp.parse(ctx.input);
  const fromCitationsEdits = fromCitations(pr);
  const bodyFC = applyToString(pr.body, fromCitationsEdits);
  const citedSources = filterCitedSources(pr.sources, pr.inline);
  const existing = scanExistingRefs(ctx.op.doc);
  const { idMap, newRefs } = resolveFootnoteIdentity(citedSources, existing);
  ctx.logger.info(`resolved ${citedSources.length} footnotes (${newRefs.length} new, ${citedSources.length - newRefs.length} reused)`);
  const renameEdits = applyFootnoteInlineRename(bodyFC, idMap);
  const finalBody = applyToString(bodyFC, renameEdits);
  const cascadeOp = { ...ctx.op, input: finalBody };
  const { plan: cascadePlan } = cascade(cascadeOp);
  const defs = newRefDefinitions(newRefs);
  const resourcesPlan = moveToResources(ctx.op, defs);
  const plan = [...cascadePlan, ...resourcesPlan];
  ctx.logger.info(`plan: ${plan.length} edits`);
  return plan;
};

// catalog/entries/perplexity-app.ts
var perplexity_app_default = {
  run: perplexityAppScript,
  paste: {
    canHandle: (input) => perplexityApp.canParse(input),
    priority: 300
  }
};
