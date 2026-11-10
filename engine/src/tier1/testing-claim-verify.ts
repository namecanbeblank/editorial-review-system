import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { findPhraseMatches, sentencesOf } from "./util.js";
import { TESTING_CLAIM_PHRASES } from "./lexicons.js";

export const testingClaimVerify: PatternRule = {
  id: "pat.testing-claim-verify",
  title: "Unverified first-person testing claim",
  source: "core-voice §4",
  mechanism: "pattern",
  scope: "sentence",
  severity: "info",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    for (const sent of sentencesOf(segments)) {
      for (const m of findPhraseMatches(sent.text, TESTING_CLAIM_PHRASES)) {
        const start = sent.start + m.start;
        const end = sent.start + m.end;
        findings.push({
          ruleId: "pat.testing-claim-verify",
          severity: "info",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message:
            "Verify this testing narrative is real and attributed -- invented first-person testing is banned (anti-fabrication). The linter can't tell real from invented; it only flags for verification.",
          confidence: 1.0,
        });
      }
    }
    return findings;
  },
};
