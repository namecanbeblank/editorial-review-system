import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { findPhraseMatches, sentencesOf } from "./util.js";
import { GAP_DISCLOSURE_PHRASES, SPECULATION_PHRASES } from "./tells-lexicons.js";

/**
 * pat.gap-speculation (tells catalogue §6)
 * Fires only when a gap-disclosure phrase and a speculation phrase co-occur in the same
 * sentence -- "disclosing a gap, then speculating into it" in one breath. Speculation
 * language alone ("it is likely that...") is a plain hedge, not this tell -- the
 * "adjacent to a disclosed unknown" qualifier in the inventory is read as same-sentence
 * co-occurrence. See report.
 */
export const gapSpeculation: PatternRule = {
  id: "pat.gap-speculation",
  title: "Gap disclosure + speculation",
  source: "tells catalogue §6",
  mechanism: "pattern",
  scope: "sentence",
  severity: "warn",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    for (const sent of sentencesOf(segments)) {
      const gapHits = findPhraseMatches(sent.text, GAP_DISCLOSURE_PHRASES);
      if (gapHits.length === 0) continue;
      const specHits = findPhraseMatches(sent.text, SPECULATION_PHRASES);
      if (specHits.length === 0) continue;

      for (const m of [...gapHits, ...specHits]) {
        const start = sent.start + m.start;
        const end = sent.start + m.end;
        findings.push({
          ruleId: "pat.gap-speculation",
          severity: "warn",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: "Discloses a gap and speculates into it in the same breath.",
          fix: "Delete the disclosure and the speculation together, or state the gap honestly with no guess attached.",
          confidence: 1.0,
        });
      }
    }
    return findings;
  },
};
