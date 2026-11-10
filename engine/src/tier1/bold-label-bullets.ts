import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { escapeRegExp, listItemsOf, proseOf } from "./util.js";
import {
  BOLD_LABEL_DOC_STAT_EXEMPT_TERMS,
  BOLD_LEADIN_RE,
  BOLD_SPAN_RE,
  LEAD_IN_CONTENT_WORD_MIN_LENGTH,
  LEAD_IN_MIN_RECURRING_WORDS,
  LEAD_IN_RESTATEMENT_THRESHOLD,
  LEAD_IN_STEM_PREFIX_LENGTH,
} from "./tells-lexicons.js";

function tokenizeWords(text: string): string[] {
  return text.match(/[A-Za-z']+/g) ?? [];
}

function stem(word: string): string {
  const lower = word.toLowerCase();
  return lower.slice(0, Math.min(lower.length, LEAD_IN_STEM_PREFIX_LENGTH));
}

/**
 * Does the text after the colon restate the label? See tells-lexicons.ts for why a
 * stem-prefix match, not an exact-word match. No content words in the label at all ->
 * nothing to judge restatement by, so it's treated as NOT a restatement (conservative:
 * don't flag what we can't assess).
 * F1b (2026-08-10, P3 eval): requires >= LEAD_IN_MIN_RECURRING_WORDS distinct recurring
 * words, on top of the ratio -- a single incidental topic-word overlap on a short label
 * used to clear the ratio alone and read as restatement when it was just topical
 * continuity.
 */
function isRestatement(label: string, afterColonText: string): boolean {
  const contentWords = tokenizeWords(label).filter(
    (w) => w.length >= LEAD_IN_CONTENT_WORD_MIN_LENGTH,
  );
  if (contentWords.length === 0) return false;
  const afterStems = new Set(tokenizeWords(afterColonText).map(stem));
  const recurring = contentWords.filter((w) => afterStems.has(stem(w))).length;
  return (
    recurring >= LEAD_IN_MIN_RECURRING_WORDS && recurring / contentWords.length >= LEAD_IN_RESTATEMENT_THRESHOLD
  );
}

/**
 * pat.bold-label-bullets (tells catalogue §17)
 * Two independent checks: (1) the "**Label:** sentence" lead-in shape on each list item
 * -- flagged only when the sentence RESTATES the label (see isRestatement above); (2) a
 * document-wide doc-stat -- a term bolded on every one of its occurrences (never
 * appearing plain) suggests mechanical over-bolding rather than first-use emphasis. The
 * doc-stat threshold (>=3 bolded occurrences, 0 plain) is our own conservative call --
 * the inventory names the pattern but not a minimum count. See report.
 * F1a (2026-08-10, P3 eval): the doc-stat half now exempts BOLD_LABEL_DOC_STAT_EXEMPT_TERMS
 * (Key features/Pros/Cons/Best for/Pricing) -- house template furniture that's SUPPOSED
 * to be bolded identically every time, not a mechanical-over-bolding tell.
 */
export const boldLabelBullets: PatternRule = {
  id: "pat.bold-label-bullets",
  title: "Bold-label-lead-in bullets",
  source: "tells catalogue §17",
  mechanism: "pattern",
  scope: "paragraph",
  severity: "info",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];

    for (const item of listItemsOf(segments)) {
      const m = BOLD_LEADIN_RE.exec(item.text);
      if (!m) continue;
      const label = m[1]!;
      const afterColonText = item.text.slice(m[0].length);
      if (!isRestatement(label, afterColonText)) continue;

      const start = item.start;
      const end = item.start + m[0].length;
      findings.push({
        ruleId: "pat.bold-label-bullets",
        severity: "info",
        scope: "paragraph",
        start,
        end,
        quote: input.text.slice(start, end),
        message: `"${m[0]}" bolds a label and then the sentence just restates it -- it adds nothing beyond the label itself.`,
        fix: "Either drop the bold label or rewrite the sentence to add information the label didn't already give.",
        confidence: 0.6,
      });
    }

    const prose = proseOf(segments);
    const boldCounts = new Map<string, number>();
    const firstOccurrence = new Map<string, { start: number; end: number }>();
    const boldRangesByTerm = new Map<string, Array<{ start: number; end: number }>>();

    for (const seg of prose) {
      const boldRe = new RegExp(BOLD_SPAN_RE.source, "g");
      let bm: RegExpExecArray | null;
      while ((bm = boldRe.exec(seg.text)) !== null) {
        const term = bm[1]!.trim().toLowerCase();
        if (!term) continue;
        boldCounts.set(term, (boldCounts.get(term) ?? 0) + 1);
        const absStart = seg.start + bm.index;
        const absEnd = absStart + bm[0].length;
        if (!firstOccurrence.has(term)) firstOccurrence.set(term, { start: absStart, end: absEnd });
        const ranges = boldRangesByTerm.get(term) ?? [];
        ranges.push({ start: absStart, end: absEnd });
        boldRangesByTerm.set(term, ranges);
      }
    }

    for (const [term, count] of boldCounts) {
      if (count < 3) continue;
      if (BOLD_LABEL_DOC_STAT_EXEMPT_TERMS.includes(term)) continue;
      const ranges = boldRangesByTerm.get(term) ?? [];
      const plainRe = new RegExp(`\\b${escapeRegExp(term)}\\b`, "gi");
      let hasPlain = false;
      for (const seg of prose) {
        plainRe.lastIndex = 0;
        let pm: RegExpExecArray | null;
        while ((pm = plainRe.exec(seg.text)) !== null) {
          const absStart = seg.start + pm.index;
          const insideBold = ranges.some((r) => absStart >= r.start && absStart < r.end);
          if (!insideBold) {
            hasPlain = true;
            break;
          }
        }
        if (hasPlain) break;
      }
      if (!hasPlain) {
        const first = firstOccurrence.get(term)!;
        findings.push({
          ruleId: "pat.bold-label-bullets",
          severity: "info",
          scope: "paragraph",
          start: first.start,
          end: first.end,
          quote: input.text.slice(first.start, first.end),
          message: `"${term}" is bolded on all ${count} of its occurrences -- bold defined terms once, on first use, not every time.`,
          fix: "Keep the bold on first use only; unbold the rest.",
          confidence: 0.6,
        });
      }
    }
    return findings;
  },
};
