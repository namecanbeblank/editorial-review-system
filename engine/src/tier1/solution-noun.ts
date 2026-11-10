import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { sentencesOf } from "./util.js";
import { SOLUTION_NOUN_RE } from "./lexicons.js";

export const solutionNoun: PatternRule = {
  id: "pat.solution-noun",
  title: '"Solution" as standalone product noun',
  source: "rewriter",
  mechanism: "pattern",
  scope: "sentence",
  severity: "warn",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    const re = new RegExp(SOLUTION_NOUN_RE.source, "gi");
    for (const sent of sentencesOf(segments)) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sent.text)) !== null) {
        const start = sent.start + m.index;
        const end = start + m[0].length;
        findings.push({
          ruleId: "pat.solution-noun",
          severity: "warn",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m[0]}" uses "solution" as a vague standalone product noun.`,
          fix: "Name what it actually is: software, tool, system, or platform.",
          confidence: 0.75,
        });
      }
    }
    return findings;
  },
};
