import type { Segment } from "../schema.js";

/** Escape a literal string for safe interpolation into a RegExp source. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sentencesOf(segments: Segment[]): Segment[] {
  return segments.filter((s): s is Segment & { kind: "sentence" } => s.kind === "sentence");
}

export function paragraphsOf(segments: Segment[]): Segment[] {
  return segments.filter((s): s is Segment & { kind: "paragraph" } => s.kind === "paragraph");
}

export function headingsOf(segments: Segment[]): Segment[] {
  return segments.filter((s): s is Segment & { kind: "heading" } => s.kind === "heading");
}

export function listItemsOf(segments: Segment[]): Segment[] {
  return segments.filter((s): s is Segment & { kind: "listItem" } => s.kind === "listItem");
}

/** Paragraphs AND listItems -- the "prose" segments sentence-derived rules read from by
 *  default. Rules that mean "flowing prose only" use paragraphsOf() instead. */
export function proseOf(segments: Segment[]): Segment[] {
  return segments.filter((s) => s.kind === "paragraph" || s.kind === "listItem");
}

export interface PhraseMatch {
  start: number;
  end: number;
  text: string;
}

/**
 * `\b` only asserts at a word<->non-word transition. A phrase edge that is ITSELF a
 * non-word character (e.g. "Certainly!" or "[Insert") has no such transition when
 * followed/preceded by more punctuation or whitespace, so blindly wrapping every phrase
 * in `\b...\b` silently fails to match those. Only add the assertion on a side whose
 * edge character is a word character; a non-word edge is already unambiguous without it.
 */
function edgeBoundary(char: string | undefined): string {
  return char !== undefined && /\w/.test(char) ? "\\b" : "";
}

/**
 * Find every non-overlapping match of any literal phrase in `phrases` within `text`.
 * Phrases are escaped and matched case-insensitively, word-bounded only on edges that
 * are word characters (see edgeBoundary). Internal spaces in a phrase match one-or-more
 * whitespace (including a newline), so a multi-word phrase still matches when it
 * straddles a soft line-wrap inside a paragraph (paragraph/sentence text keeps the
 * source's internal newlines verbatim). Offsets are relative to `text`.
 */
export function findPhraseMatches(text: string, phrases: readonly string[]): PhraseMatch[] {
  // Empty alternatives match at every character boundary, flooding the findings list.
  const meaningfulPhrases = phrases.filter((phrase) => phrase.trim().length > 0);
  if (meaningfulPhrases.length === 0) return [];
  const pattern = meaningfulPhrases
    .map((p) => {
      const escaped = escapeRegExp(p).replace(/ /g, "\\s+");
      return `${edgeBoundary(p[0])}${escaped}${edgeBoundary(p[p.length - 1])}`;
    })
    .join("|");
  const re = new RegExp(pattern, "gi");
  const matches: PhraseMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return matches;
}

/** Word count via whitespace splitting, ignoring empty tokens. */
export function wordCount(text: string): number {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  return tokens.length;
}

export function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Population standard deviation (divide by N). */
export function stdevPopulation(nums: number[]): number {
  if (nums.length === 0) return 0;
  const m = mean(nums);
  const variance = nums.reduce((sum, n) => sum + (n - m) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}
