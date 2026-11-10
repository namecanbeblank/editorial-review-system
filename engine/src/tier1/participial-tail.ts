import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { sentencesOf } from "./util.js";
import { PARTICIPIAL_TAIL_RE } from "./tells-lexicons.js";

export const participialTail: PatternRule = {
  id: "pat.participial-tail",
  title: "Participial-tail interpretation",
  source: "tells catalogue §3/§14",
  mechanism: "pattern",
  scope: "sentence",
  severity: "warn",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    const re = new RegExp(PARTICIPIAL_TAIL_RE.source, "gi");
    for (const sent of sentencesOf(segments)) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sent.text)) !== null) {
        const start = sent.start + m.index;
        const end = start + m[0].length;
        findings.push({
          ruleId: "pat.participial-tail",
          severity: "warn",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m[0]}" is a sentence-final -ing clause doing interpretive work the fact itself never earned.`,
          fix: "Sever the tail and keep the fact. If the interpretation is worth making, make it as its own attributed sentence with evidence.",
          confidence: 0.8,
        });
      }
    }
    return findings;
  },
};
