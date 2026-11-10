import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { sentencesOf } from "./util.js";
import { NOMINALIZATION_RE } from "./lexicons.js";

export const nominalization: PatternRule = {
  id: "pat.nominalization",
  title: "Nominalized verb ('the elimination of')",
  source: "rewriter",
  mechanism: "pattern",
  scope: "sentence",
  severity: "warn",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    const re = new RegExp(NOMINALIZATION_RE.source, "gi");
    for (const sent of sentencesOf(segments)) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sent.text)) !== null) {
        const start = sent.start + m.index;
        const end = start + m[0].length;
        findings.push({
          ruleId: "pat.nominalization",
          severity: "warn",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m[0]}" turns a verb into a noun phrase, adding words without adding meaning.`,
          fix: "Use the verb directly (e.g. \"eliminating\" instead of \"the elimination of\").",
          confidence: 1.0,
        });
      }
    }
    return findings;
  },
};
