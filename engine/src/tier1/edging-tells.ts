import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { findPhraseMatches, sentencesOf } from "./util.js";
import { EDGING_TELLS_PHRASES } from "./lexicons.js";

export const edgingTells: PatternRule = {
  id: "pat.edging-tells",
  title: "Edging tell",
  source: "doctrine §10.3/§10.13",
  mechanism: "pattern",
  scope: "sentence",
  severity: "warn",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    for (const sent of sentencesOf(segments)) {
      for (const m of findPhraseMatches(sent.text, EDGING_TELLS_PHRASES)) {
        const start = sent.start + m.start;
        const end = sent.start + m.end;
        findings.push({
          ruleId: "pat.edging-tells",
          severity: "warn",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m.text}" teases a fact instead of stating it.`,
          fix: "Say the thing the tease is gesturing at, in this sentence.",
          confidence: 1.0,
        });
      }
    }
    return findings;
  },
};
