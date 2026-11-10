import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { headingsOf } from "./util.js";
import { TITLE_CASE_SMALL_WORDS } from "./tells-lexicons.js";

/** Ported from the reference scanner's is_title_case: >=3 words, and every "main" word
 *  (not the first, not a small word) is capitalized. */
function isTitleCase(text: string): boolean {
  const words = text.match(/[A-Za-z][\w'-]*/g) ?? [];
  if (words.length < 3) return false;
  const eligible = words.slice(1).filter((w) => !TITLE_CASE_SMALL_WORDS.has(w.toLowerCase()));
  const capped = eligible.filter((w) => /[A-Z]/.test(w[0]!));
  return eligible.length >= 2 && capped.length === eligible.length;
}

/**
 * F5 (2026-08-10, P3 eval): depth-1 headings (H1/title) are excluded entirely -- not
 * just exempted from being COUNTED as title-cased, but dropped from the denominator
 * too. Published titles are Title Case by convention; that's a different grammar from
 * body headings, and it shouldn't even factor into the inconsistency ratio.
 */
export const titleCaseHeadings: PatternRule = {
  id: "pat.title-case-headings",
  title: "Title-case headings",
  source: "tells catalogue §18",
  mechanism: "pattern",
  scope: "document",
  severity: "info",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const headings = headingsOf(segments).filter((h) => h.depth !== 1);
    if (headings.length === 0) return [];
    const titleCased = headings.filter((h) => isTitleCase(h.text));
    if (titleCased.length === 0) return [];

    const inconsistent = titleCased.length !== headings.length;
    const anchor = titleCased[0]!;
    return [
      {
        ruleId: "pat.title-case-headings",
        severity: "info",
        scope: "document",
        start: anchor.start,
        end: anchor.end,
        quote: input.text.slice(anchor.start, anchor.end),
        message: inconsistent
          ? `${titleCased.length}/${headings.length} headings are Title Case and the rest aren't -- the inconsistency is a stronger signal than the case choice itself.`
          : `All ${headings.length} heading(s) are Title Case; house style is sentence case.`,
        fix: "Match house sentence-case style across all headings.",
        confidence: 1.0,
      },
    ];
  },
};
