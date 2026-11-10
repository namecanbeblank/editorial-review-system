import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { findPhraseMatches, sentencesOf } from "./util.js";
import { AUDIENCE_META_PHRASES, WHETHER_YOURE_RE } from "./lexicons.js";

export const audienceMeta: PatternRule = {
  id: "pat.audience-meta",
  title: "Audience-announcement sentence",
  source: "doctrine §10.10",
  mechanism: "pattern",
  scope: "sentence",
  severity: "error",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    for (const sent of sentencesOf(segments)) {
      for (const m of findPhraseMatches(sent.text, AUDIENCE_META_PHRASES)) {
        const start = sent.start + m.start;
        const end = sent.start + m.end;
        findings.push({
          ruleId: "pat.audience-meta",
          severity: "error",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m.text}" announces the audience instead of just writing for them.`,
          fix: "Cut the announcement; write the next sentence directly for that reader.",
          confidence: 1.0,
        });
      }

      const m2 = WHETHER_YOURE_RE.exec(sent.text);
      if (m2) {
        const start = sent.start + m2.index;
        const end = start + m2[0].length;
        findings.push({
          ruleId: "pat.audience-meta",
          severity: "error",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m2[0]}" hedges across multiple audiences instead of committing to one reader.`,
          fix: "Pick the one reader this piece is for and cut the hedge.",
          confidence: 1.0,
        });
      }
    }
    return findings;
  },
};
