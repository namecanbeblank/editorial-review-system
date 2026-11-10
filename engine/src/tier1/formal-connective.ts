import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { sentencesOf } from "./util.js";
import { FORMAL_CONNECTIVE_RE } from "./lexicons.js";

export const formalConnective: PatternRule = {
  id: "pat.formal-connective",
  title: "Formal sentence-initial connective",
  source: "core-voice §2",
  mechanism: "pattern",
  scope: "sentence",
  severity: "warn",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    for (const sent of sentencesOf(segments)) {
      const m = FORMAL_CONNECTIVE_RE.exec(sent.text);
      if (!m) continue;
      const start = sent.start;
      const end = sent.start + m[0].length;
      findings.push({
        ruleId: "pat.formal-connective",
        severity: "warn",
        scope: "sentence",
        start,
        end,
        quote: input.text.slice(start, end),
        message: `"${m[0]}" opens the sentence in a register more formal than the rest of the piece.`,
        fix: 'Cut it, or replace with a plain connective ("And", "So", "But").',
        confidence: 1.0,
      });
    }
    return findings;
  },
};
