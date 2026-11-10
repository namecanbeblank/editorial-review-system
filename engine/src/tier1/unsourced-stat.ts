import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { paragraphsOf, sentencesOf } from "./util.js";
import {
  HYPOTHETICAL_OPENER_RE,
  RATING_SCALE_RE,
  SOURCE_MARKER_RE,
  STAT_OUT_OF_RE,
  STAT_PERCENT_RE,
} from "./lexicons.js";

/**
 * pat.unsourced-stat (core-voice §4 anti-fabrication)
 * T6 (2026-08-10, P3 eval): skipped when the sentence OR its containing paragraph opens
 * with a hypothetical frame ("Say...", "Suppose...", "Imagine a...", "For example...")
 * -- not a factual claim needing a source.
 * T7 (2026-08-10, P3 eval): "N out of 5/10" (the rating-scale idiom) doesn't by itself
 * count as a qualifying stat -- a percent stat in the same sentence still qualifies.
 */
export const unsourcedStat: PatternRule = {
  id: "pat.unsourced-stat",
  title: "Unsourced statistic",
  source: "core-voice §4 anti-fabrication",
  mechanism: "pattern",
  scope: "sentence",
  severity: "info",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    const paragraphs = paragraphsOf(segments);

    for (const sent of sentencesOf(segments)) {
      const hasPercent = STAT_PERCENT_RE.test(sent.text);
      const outOfMatch = STAT_OUT_OF_RE.exec(sent.text);
      const hasQualifyingOutOf = outOfMatch !== null && !RATING_SCALE_RE.test(outOfMatch[0]);
      if (!hasPercent && !hasQualifyingOutOf) continue;

      if (SOURCE_MARKER_RE.test(sent.text)) continue;

      if (HYPOTHETICAL_OPENER_RE.test(sent.text)) continue;
      const parentPara = paragraphs.find((p) => sent.start >= p.start && sent.end <= p.end);
      if (parentPara && HYPOTHETICAL_OPENER_RE.test(parentPara.text)) continue;

      findings.push({
        ruleId: "pat.unsourced-stat",
        severity: "info",
        scope: "sentence",
        start: sent.start,
        end: sent.end,
        quote: input.text.slice(sent.start, sent.end),
        message: "Stat with no visible source in the same sentence -- trace it or cut it.",
        confidence: 0.6,
      });
    }
    return findings;
  },
};
