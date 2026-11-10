import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { findPhraseMatches, sentencesOf } from "./util.js";
import { SIGNIFICANCE_PUFFERY_PHRASES } from "./tells-lexicons.js";

export const significancePuffery: PatternRule = {
  id: "pat.significance-puffery",
  title: "Significance puffery",
  source: "tells catalogue §1",
  mechanism: "pattern",
  scope: "sentence",
  severity: "warn",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    for (const sent of sentencesOf(segments)) {
      for (const m of findPhraseMatches(sent.text, SIGNIFICANCE_PUFFERY_PHRASES)) {
        const start = sent.start + m.start;
        const end = sent.start + m.end;
        findings.push({
          ruleId: "pat.significance-puffery",
          severity: "warn",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m.text}" asserts importance instead of showing it. If the significance clause were cut, does the sentence still say anything?`,
          fix: "Cut the significance clause, or replace it with the fact that would let a reader conclude it themselves.",
          confidence: 1.0,
        });
      }
    }
    return findings;
  },
};
