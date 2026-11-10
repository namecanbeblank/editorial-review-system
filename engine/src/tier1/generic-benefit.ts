import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { findPhraseMatches, sentencesOf } from "./util.js";
import { GENERIC_BENEFIT_PHRASES, TAKE_TO_NEXT_LEVEL_RE } from "./lexicons.js";

const GENERIC_BENEFIT_MESSAGE = (phrase: string): string =>
  `"${phrase}" is a generic benefit claim -- a named competitor could paste it into their own copy unchanged.`;

export const genericBenefit: PatternRule = {
  id: "pat.generic-benefit",
  title: "Generic benefit phrase",
  source: "bofu-editor dim 2",
  mechanism: "pattern",
  scope: "sentence",
  severity: "error",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    for (const sent of sentencesOf(segments)) {
      for (const m of findPhraseMatches(sent.text, GENERIC_BENEFIT_PHRASES)) {
        const start = sent.start + m.start;
        const end = sent.start + m.end;
        findings.push({
          ruleId: "pat.generic-benefit",
          severity: "error",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: GENERIC_BENEFIT_MESSAGE(m.text),
          fix: "Replace with the specific mechanism or number that produces the benefit.",
          confidence: 1.0,
        });
      }

      const m2 = TAKE_TO_NEXT_LEVEL_RE.exec(sent.text);
      if (m2) {
        const start = sent.start + m2.index;
        const end = start + m2[0].length;
        findings.push({
          ruleId: "pat.generic-benefit",
          severity: "error",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: GENERIC_BENEFIT_MESSAGE(m2[0]),
          fix: "Replace with the specific mechanism or number that produces the benefit.",
          confidence: 1.0,
        });
      }
    }
    return findings;
  },
};
