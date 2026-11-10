import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { sentencesOf } from "./util.js";
import { PASSIVE_BY_AGENT_RE } from "./lexicons.js";

export const passiveByAgent: PatternRule = {
  id: "pat.passive-by-agent",
  title: "Passive voice with explicit agent",
  source: "rewriter",
  mechanism: "pattern",
  scope: "sentence",
  severity: "warn",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    const re = new RegExp(PASSIVE_BY_AGENT_RE.source, "gi");
    for (const sent of sentencesOf(segments)) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sent.text)) !== null) {
        const start = sent.start + m.index;
        const end = start + m[0].length;
        findings.push({
          ruleId: "pat.passive-by-agent",
          severity: "warn",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m[0]}" is passive with an explicit agent -- the agent should be the subject.`,
          fix: "Rewrite active: the agent does the verb.",
          confidence: 0.8,
        });
      }
    }
    return findings;
  },
};
