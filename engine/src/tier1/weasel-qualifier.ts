import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { findPhraseMatches, sentencesOf } from "./util.js";
import { WEASEL_MODAL_RE, WEASEL_PHRASES } from "./lexicons.js";

const WEASEL_MESSAGE =
  'Hedges whether the effect exists at all. Plain frequency hedges ("tends to", "hit-or-miss") are the approved register -- this is a different move: stacking two hedges on one claim.';

export const weaselQualifier: PatternRule = {
  id: "pat.weasel-qualifier",
  title: "Weasel qualifier stack",
  source: "core-voice §6",
  mechanism: "pattern",
  scope: "sentence",
  severity: "error",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    const modalRe = new RegExp(WEASEL_MODAL_RE.source, "gi");
    for (const sent of sentencesOf(segments)) {
      modalRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = modalRe.exec(sent.text)) !== null) {
        const start = sent.start + m.index;
        const end = start + m[0].length;
        findings.push({
          ruleId: "pat.weasel-qualifier",
          severity: "error",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: WEASEL_MESSAGE,
          fix: "State what actually happens, or name the specific condition that changes the outcome.",
          confidence: 1.0,
        });
      }

      for (const pm of findPhraseMatches(sent.text, WEASEL_PHRASES)) {
        const start = sent.start + pm.start;
        const end = sent.start + pm.end;
        findings.push({
          ruleId: "pat.weasel-qualifier",
          severity: "error",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: WEASEL_MESSAGE,
          fix: "State what actually happens, or name the specific condition that changes the outcome.",
          confidence: 1.0,
        });
      }
    }
    return findings;
  },
};
