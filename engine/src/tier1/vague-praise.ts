import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { findPhraseMatches, sentencesOf } from "./util.js";
import { VAGUE_PRAISE_PHRASES } from "./lexicons.js";

export const vaguePraise: PatternRule = {
  id: "pat.vague-praise",
  title: "Vague praise / unquantified intensifier",
  source: "core-voice §6",
  mechanism: "pattern",
  scope: "sentence",
  severity: "warn",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    for (const sent of sentencesOf(segments)) {
      if (/\d/.test(sent.text)) continue; // a digit in the sentence suppresses the flag

      for (const m of findPhraseMatches(sent.text, VAGUE_PRAISE_PHRASES)) {
        const start = sent.start + m.start;
        const end = sent.start + m.end;
        findings.push({
          ruleId: "pat.vague-praise",
          severity: "warn",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m.text}" praises without a number attached.`,
          fix: "Replace with the number that makes the claim checkable.",
          confidence: 1.0,
        });
      }
    }
    return findings;
  },
};
