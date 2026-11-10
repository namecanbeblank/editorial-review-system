import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { headingsOf } from "./util.js";
import { JUMP_LINK_MARKER, JUMP_LINK_MIN_COUNT, TITLE_PROMISES_N_RES } from "./lexicons.js";

function countMarker(text: string, marker: string): number {
  let count = 0;
  let idx = text.indexOf(marker);
  while (idx !== -1) {
    count++;
    idx = text.indexOf(marker, idx + marker.length);
  }
  return count;
}

/**
 * pat.jump-link-contract (doctrine §10.14)
 * "H1/title" is read as the document's H1 heading specifically. If there's no H1 at
 * all, we can't determine whether the title promises N items, so the rule is silent
 * rather than guessing from some other heading -- the conservative call.
 */
export const jumpLinkContract: PatternRule = {
  id: "pat.jump-link-contract",
  title: "List article missing jump-link contract",
  source: "doctrine §10.14",
  mechanism: "pattern",
  scope: "document",
  severity: "warn",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const headings = headingsOf(segments);
    const h1 = headings.find((h) => h.depth === 1);
    if (!h1) return [];

    const promisesN = TITLE_PROMISES_N_RES.some((re) => re.test(h1.text));
    if (!promisesN) return [];

    const firstH2 = headings.find((h) => h.depth === 2 && h.start > h1.end);
    const introEnd = firstH2 ? firstH2.start : input.text.length;
    const introRaw = input.text.slice(h1.end, introEnd);
    const linkCount = countMarker(introRaw, JUMP_LINK_MARKER);
    if (linkCount >= JUMP_LINK_MIN_COUNT) return [];

    // Trim the intro span for the quote; fall back to the H1 itself if there's no body
    // between the title and the first H2 (or end of document) to point at.
    let start = h1.end;
    let end = introEnd;
    while (start < end && /\s/.test(input.text[start]!)) start++;
    while (end > start && /\s/.test(input.text[end - 1]!)) end--;
    if (start >= end) {
      start = h1.start;
      end = h1.end;
    }

    return [
      {
        ruleId: "pat.jump-link-contract",
        severity: "warn",
        scope: "document",
        start,
        end,
        quote: input.text.slice(start, end),
        message: `Title promises a list ("${h1.text}") but the intro has only ${linkCount} jump link(s) before the first H2 -- needs ${JUMP_LINK_MIN_COUNT}+. Reader scrolls blind.`,
        fix: "Add a category preview with markdown anchor links to each section before the first H2.",
        confidence: 1.0,
      },
    ];
  },
};
