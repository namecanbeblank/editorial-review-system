import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { findPhraseMatches, sentencesOf } from "./util.js";
import { VAGUE_ATTRIBUTION_PHRASES, YEAR_RE } from "./tells-lexicons.js";

/**
 * pat.vague-attribution (tells catalogue §2)
 * Sibling of pat.unsourced-stat (numbers) -- this one catches unattributed OPINION.
 * A named, dated source in the same sentence suppresses the flag ("a 2024 Gartner
 * survey shows..." passes); see tells-lexicons.ts for why a bare year is the proxy.
 */
export const vagueAttribution: PatternRule = {
  id: "pat.vague-attribution",
  title: "Vague attribution",
  source: "tells catalogue §2",
  mechanism: "pattern",
  scope: "sentence",
  severity: "warn",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    for (const sent of sentencesOf(segments)) {
      if (YEAR_RE.test(sent.text)) continue;
      for (const m of findPhraseMatches(sent.text, VAGUE_ATTRIBUTION_PHRASES)) {
        const start = sent.start + m.start;
        const end = sent.start + m.end;
        findings.push({
          ruleId: "pat.vague-attribution",
          severity: "warn",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m.text}" attributes a claim to an unnamed authority. Name the source, or cut the claim.`,
          fix: "Name the specific source (with a date), or cut the claim.",
          confidence: 1.0,
        });
      }
    }
    return findings;
  },
};
