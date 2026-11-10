import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { findPhraseMatches, sentencesOf } from "./util.js";
import { THROAT_CLEARING_PHRASES } from "./lexicons.js";

export const throatClearing: PatternRule = {
  id: "pat.throat-clearing",
  title: "Throat-clearing aside",
  source: "rewriter phrase bans",
  mechanism: "pattern",
  scope: "sentence",
  severity: "error",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    for (const sent of sentencesOf(segments)) {
      for (const m of findPhraseMatches(sent.text, THROAT_CLEARING_PHRASES)) {
        const start = sent.start + m.start;
        const end = sent.start + m.end;
        findings.push({
          ruleId: "pat.throat-clearing",
          severity: "error",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m.text}" is an editorializing aside -- it tells the reader what to think instead of just saying the thing.`,
          fix: "Cut the frame; state the content directly.",
          confidence: 1.0,
        });
      }
    }
    return findings;
  },
};
