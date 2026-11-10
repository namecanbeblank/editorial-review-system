import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { findPhraseMatches, sentencesOf } from "./util.js";
import { MEDIA_PADDING_PHRASES } from "./tells-lexicons.js";

export const mediaPadding: PatternRule = {
  id: "pat.media-padding",
  title: "Media-coverage padding",
  source: "tells catalogue §4",
  mechanism: "pattern",
  scope: "sentence",
  severity: "info",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    for (const sent of sentencesOf(segments)) {
      for (const m of findPhraseMatches(sent.text, MEDIA_PADDING_PHRASES)) {
        const start = sent.start + m.start;
        const end = sent.start + m.end;
        findings.push({
          ruleId: "pat.media-padding",
          severity: "info",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m.text}" claims coverage exists instead of summarizing what it said. Coverage is evidence, not content.`,
          fix: "Summarize what the coverage actually said, or cite it as a footnote/link.",
          confidence: 1.0,
        });
      }
    }
    return findings;
  },
};
