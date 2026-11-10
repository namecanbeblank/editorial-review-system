import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { sentencesOf } from "./util.js";
import { FALSE_RANGE_RE } from "./tells-lexicons.js";

export const falseRange: PatternRule = {
  id: "pat.false-range",
  title: 'False range ("from X to Y")',
  source: "tells catalogue §10",
  mechanism: "pattern",
  scope: "sentence",
  severity: "info",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    const re = new RegExp(FALSE_RANGE_RE.source, "gi");
    for (const sent of sentencesOf(segments)) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sent.text)) !== null) {
        const start = sent.start + m.index;
        const end = start + m[0].length;
        findings.push({
          ruleId: "pat.false-range",
          severity: "info",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m[0]}" implies a scale. Apply the middle test: can you name one thing between the endpoints?`,
          fix: "If you can't name a middle, replace with the actual list or the one example that matters.",
          confidence: 0.6,
        });
        if (m[0].length === 0) re.lastIndex += 1;
      }
    }
    return findings;
  },
};
