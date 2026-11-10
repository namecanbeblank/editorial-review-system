import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { findPhraseMatches, paragraphsOf } from "./util.js";
import {
  CLAUSE_FINAL_FOLLOW_RE,
  CLAUSE_FINAL_GUARDED_LONG_FORMS,
  CONTRACTION_PAIRS,
} from "./lexicons.js";

/** True if the text right after a match is clause-final (punctuation or conjunction). */
function isClauseFinal(text: string, matchEnd: number): boolean {
  return CLAUSE_FINAL_FOLLOW_RE.test(text.slice(matchEnd, matchEnd + 20));
}

/**
 * pat.contraction-deficit (core-voice §2)
 * Document-scope aggregate: counts long forms vs. contractions across all paragraph
 * text (code blocks are already excluded by segmentation). Anchors the single finding
 * to the first long-form occurrence in reading order.
 *
 * F6 (2026-08-10, P3 eval): "it is"/"that is" long-form matches that are clause-final
 * (immediately followed by punctuation or a conjunction) are excluded entirely -- they
 * can't grammatically contract, so they're not evidence of an avoidable deficit. See
 * CLAUSE_FINAL_FOLLOW_RE in lexicons.ts.
 */
export const contractionDeficit: PatternRule = {
  id: "pat.contraction-deficit",
  title: "Contraction deficit",
  source: "core-voice §2",
  mechanism: "pattern",
  scope: "document",
  severity: "info",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const paragraphs = paragraphsOf(segments);
    let longTotal = 0;
    let combinedTotal = 0;
    let firstLong: { start: number; end: number } | null = null;

    for (const para of paragraphs) {
      for (const pair of CONTRACTION_PAIRS) {
        let longHits = findPhraseMatches(para.text, [pair.long]);
        if (CLAUSE_FINAL_GUARDED_LONG_FORMS.includes(pair.long)) {
          longHits = longHits.filter((h) => !isClauseFinal(para.text, h.end));
        }
        const contractionHits = findPhraseMatches(para.text, [pair.contraction]);
        longTotal += longHits.length;
        combinedTotal += longHits.length + contractionHits.length;
        if (longHits.length > 0 && !firstLong) {
          const first = longHits[0]!;
          firstLong = { start: para.start + first.start, end: para.start + first.end };
        }
      }
    }

    if (combinedTotal < 10) return [];
    if (longTotal / combinedTotal <= 0.4) return [];

    const anchor = firstLong ?? { start: 0, end: Math.min(1, input.text.length) };
    return [
      {
        ruleId: "pat.contraction-deficit",
        severity: "info",
        scope: "document",
        start: anchor.start,
        end: anchor.end,
        quote: input.text.slice(anchor.start, anchor.end),
        message: `Long forms outnumber contractions ${longTotal}/${combinedTotal} (over 40% across ${combinedTotal} tracked instances) -- reads more formal than the target register.`,
        fix: "Contract do not/does not/it is/you will/cannot/there is/we are where the sentence allows it.",
        confidence: 1.0,
      },
    ];
  },
};
