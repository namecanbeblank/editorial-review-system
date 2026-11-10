import type { Segment } from "./schema.js";

/**
 * Markdown -> paragraphs/sentences/headings/listItems with ABSOLUTE character offsets
 * into the original source string. Every segment satisfies `text === source.slice(start,
 * end)` by construction: we only ever slice the source to produce `text`, never rebuild
 * it by joining strings, so the invariant can't drift.
 */

interface Span {
  start: number;
  end: number;
}

/**
 * Abbreviations that block a following period from ending a sentence. The first six are
 * exactly as listed in rules/inventory.md (segment.ts spec, sentence splitter guards).
 * Matched case-sensitively via `endsWith` against text up to and including the period,
 * so "US." or "no." (a real word before a real sentence break) are NOT guarded — only
 * the exact capitalizations the inventory names are.
 *
 * "et al." added 2026-08-10 (B1 bug fix, P3 eval): a markdown citation link like
 * "([Berry et al. 2024](url))" was splitting into two sentences at the unguarded period
 * in "al.", which silently broke pat.vague-praise's same-sentence digit-suppression
 * (the digit ended up in the OTHER half of the wrongly-split sentence). Guarding the
 * full "et al." string (not bare "al.") matters: "al." alone would also swallow the
 * period in ordinary words like "digital."/"legal." that happen to end in those two
 * letters, which "et al." (with the leading "et " and the space) does not.
 */
const ABBREVIATIONS = ["e.g.", "i.e.", "vs.", "etc.", "U.S.", "No.", "et al."];

/** Split source into line spans. `end` excludes a trailing \r so CRLF sources don't
 *  leak \r into segment text; the \r (if any) is still skipped when advancing to the
 *  next line's start. */
function getLines(source: string): Span[] {
  const lines: Span[] = [];
  let pos = 0;
  while (pos <= source.length) {
    const nl = source.indexOf("\n", pos);
    if (nl === -1) {
      lines.push({ start: pos, end: source.length });
      break;
    }
    let end = nl;
    if (end > pos && source[end - 1] === "\r") end -= 1;
    lines.push({ start: pos, end });
    pos = nl + 1;
  }
  return lines;
}

/** Fenced code block spans (``` ... ```), fence markers included. Content inside is
 *  excluded from paragraph/heading/listItem/sentence segmentation entirely. Non-greedy
 *  so back-to-back fenced blocks don't merge into one span. An unterminated opening
 *  fence (odd fence count) matches nothing and its content falls back to normal prose --
 *  a reasonable, conservative default for malformed input. */
function findCodeSpans(source: string): Span[] {
  const spans: Span[] = [];
  const re = /```[\s\S]*?```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

function isBlankLine(source: string, line: Span): boolean {
  for (let i = line.start; i < line.end; i++) {
    if (!/\s/.test(source[i]!)) return false;
  }
  return true;
}

function isInsideAny(pos: number, spans: Span[]): boolean {
  return spans.some((s) => pos >= s.start && pos < s.end);
}

/** ATX headings only (`#{1,6} `), per rules/inventory.md. Setext (underline-style)
 *  headings are out of scope -- the inventory's regex only covers ATX. */
const HEADING_RE = /^(#{1,6}) (.*)$/;

/**
 * Bullet (-, *, +) or numbered ("1.") list markers. Group 1 = leading indent, group 2 =
 * the marker itself (used to compute the "attachment" indent threshold for continuation
 * lines), group 3 = the required run of whitespace after the marker, group 4 = the rest
 * of the line. A bare "-"/"---" (no following whitespace, e.g. a horizontal rule) does
 * NOT match -- CommonMark requires at least one space/tab after a list marker too, so
 * this falls out of the regex for free rather than needing a special case.
 */
const LIST_MARKER_RE = /^(\s*)([-*+]|\d+\.)(\s+)(.*)$/;

function leadingWhitespaceCount(source: string, line: Span): number {
  let i = line.start;
  while (i < line.end && /[ \t]/.test(source[i]!)) i++;
  return i - line.start;
}

function trimSpan(text: string, start: number, end: number): Span {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s]!)) s++;
  while (e > s && /\s/.test(text[e - 1]!)) e--;
  return { start: s, end: e };
}

/** Guard checks for a candidate sentence-ending period at `periodIndex` in `text`.
 *  Both guards only ever apply to a lone "." terminator (callers check that). */
function isGuardedPeriod(text: string, periodIndex: number): boolean {
  // Decimal guard: digit "." digit (e.g. "3.5") never ends a sentence. In practice this
  // is already excluded by the "must be followed by whitespace/EOF" rule below (the
  // digit right after the period isn't whitespace), but we check explicitly too so the
  // guard is self-documenting and independently testable.
  const before = text[periodIndex - 1];
  const after = text[periodIndex + 1];
  if (before && after && /\d/.test(before) && /\d/.test(after)) return true;

  // Abbreviation guard: does the text up to and including this period end with one of
  // the exact guarded forms?
  const prefix = text.slice(0, periodIndex + 1);
  return ABBREVIATIONS.some((abbr) => prefix.endsWith(abbr));
}

/**
 * Naive sentence splitter (relative offsets into `text`). Terminators are runs of
 * .!? optionally followed by closing quotes/parens (so the closer stays attached to
 * the sentence it closes, e.g. `He said "Stop."`). A run is only a real boundary when
 * followed by whitespace or end-of-text; a lone "." is additionally checked against the
 * abbreviation/decimal guards above. Any trailing unpunctuated text (common in bullet
 * lines with no terminal period) is emitted as a final sentence.
 */
function splitSentences(text: string): Span[] {
  const spans: Span[] = [];
  const TERMINATOR_RE = /([.!?]+)(["')\]]*)/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = TERMINATOR_RE.exec(text)) !== null) {
    const punct = m[1]!;
    const termStart = m.index;
    const afterAll = m.index + m[0].length;

    if (punct === "." && isGuardedPeriod(text, termStart)) continue;

    const nextChar = text[afterAll];
    const isBoundary = afterAll >= text.length || /\s/.test(nextChar!);
    if (!isBoundary) continue;

    const trimmed = trimSpan(text, cursor, afterAll);
    if (trimmed.start < trimmed.end) spans.push(trimmed);
    cursor = afterAll;
  }
  if (cursor < text.length) {
    const trimmed = trimSpan(text, cursor, text.length);
    if (trimmed.start < trimmed.end) spans.push(trimmed);
  }
  return spans;
}

/**
 * Segment a markdown document into headings, paragraphs, listItems, and sentences.
 *
 * - Paragraphs are runs of consecutive non-blank, non-heading, non-code, non-list lines,
 *   split on blank lines (and always broken by a heading, code-block, or list-marker
 *   line, even absent a blank line around it).
 * - Headings are ATX (`#{1,6} `) lines; `text`/offsets cover the heading text only (the
 *   `#` marks and the separating space are excluded), `depth` carries the level.
 * - ListItems are bullet/numbered lines. Like headings, `text`/offsets exclude the
 *   marker itself (and its trailing required whitespace) so rules see the same clean
 *   prose text a paragraph would give them (e.g. a sentence-initial regex still anchors
 *   correctly against "Effective..." rather than "- Effective..."). A subsequent plain
 *   line MORE indented than the marker that started the item is treated as an attached
 *   continuation (extends the item); a line at or below that indent, a blank line, a new
 *   marker, a heading, or a code block all close it. This is a deliberately simple
 *   approximation of CommonMark list-continuation rules, not a full list parser: every
 *   marker line always starts its OWN flat listItem regardless of nesting depth (Segment
 *   has no nesting), and a blank line always closes the item (no "loose list" tolerance
 *   for a blank line between an item and its own continuation).
 * - Sentences are derived from paragraphs AND listItems (never headings), via
 *   `splitSentences` run on each segment's already-marker-stripped text, then mapped
 *   back to absolute offsets. They never span a paragraph/listItem boundary.
 * - Fenced code blocks are excluded from all four entirely.
 */
export function segmentDocument(source: string): Segment[] {
  const segments: Segment[] = [];
  const lines = getLines(source);
  const codeSpans = findCodeSpans(source);

  let bufStart = -1;
  let bufEnd = -1;
  const flushParagraph = () => {
    if (bufStart === -1) return;
    segments.push({
      kind: "paragraph",
      start: bufStart,
      end: bufEnd,
      text: source.slice(bufStart, bufEnd),
    });
    bufStart = -1;
    bufEnd = -1;
  };

  let itemStart = -1;
  let itemEnd = -1;
  let itemMarkerIndent = -1;
  const flushListItem = () => {
    if (itemStart === -1) return;
    const trimmed = trimSpan(source, itemStart, itemEnd);
    if (trimmed.start < trimmed.end) {
      segments.push({
        kind: "listItem",
        start: trimmed.start,
        end: trimmed.end,
        text: source.slice(trimmed.start, trimmed.end),
      });
    }
    itemStart = -1;
    itemEnd = -1;
    itemMarkerIndent = -1;
  };

  for (const line of lines) {
    if (isInsideAny(line.start, codeSpans)) {
      flushParagraph();
      flushListItem();
      continue;
    }

    const lineText = source.slice(line.start, line.end);
    const headingMatch = HEADING_RE.exec(lineText);
    if (headingMatch) {
      flushParagraph();
      flushListItem();
      const hashes = headingMatch[1]!;
      const { start: hStart, end: hEnd } = trimSpan(
        source,
        line.start + hashes.length + 1,
        line.end,
      );
      segments.push({
        kind: "heading",
        start: hStart,
        end: hEnd,
        text: source.slice(hStart, hEnd),
        depth: hashes.length,
      });
      continue;
    }

    if (isBlankLine(source, line)) {
      flushParagraph();
      flushListItem();
      continue;
    }

    const listMatch = LIST_MARKER_RE.exec(lineText);
    if (listMatch) {
      flushParagraph();
      flushListItem();
      const [, indent, marker, gap] = listMatch;
      itemMarkerIndent = indent!.length;
      itemStart = line.start + indent!.length + marker!.length + gap!.length;
      itemEnd = line.end;
      continue;
    }

    // Plain line: a continuation of an open listItem if it's indented past the marker
    // that opened it, otherwise it closes the item and becomes/continues a paragraph.
    if (itemStart !== -1 && leadingWhitespaceCount(source, line) > itemMarkerIndent) {
      itemEnd = line.end;
      continue;
    }
    flushListItem();

    if (bufStart === -1) bufStart = line.start;
    bufEnd = line.end;
  }
  flushParagraph();
  flushListItem();

  const proseSegments = segments.filter((s) => s.kind === "paragraph" || s.kind === "listItem");
  for (const prose of proseSegments) {
    for (const rel of splitSentences(prose.text)) {
      const start = prose.start + rel.start;
      const end = prose.start + rel.end;
      segments.push({ kind: "sentence", start, end, text: source.slice(start, end) });
    }
  }

  segments.sort((a, b) => a.start - b.start || a.end - b.end);
  return segments;
}
