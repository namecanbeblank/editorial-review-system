import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { findPhraseMatches, sentencesOf } from "./util.js";
import { ASSISTANT_RESIDUE_PHRASES, GREAT_QUESTION_RE } from "./tells-lexicons.js";

const RESIDUE_MESSAGE =
  "is operator-directed or correspondence register left inside an article. Text nobody read before publishing hasn't been checked for anything else either.";

/**
 * pat.assistant-residue (tells catalogue §15/§23)
 * F8 (2026-08-10, P3 eval): "Great question" is checked separately from the plain
 * phrase list, anchored to sentence-start AND terminal punctuation -- see
 * tells-lexicons.ts for why (FP class was the noun-phrase sense).
 */
export const assistantResidue: PatternRule = {
  id: "pat.assistant-residue",
  title: "Leftover assistant/correspondence chatter",
  source: "tells catalogue §15/§23",
  mechanism: "pattern",
  scope: "sentence",
  severity: "error",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    for (const sent of sentencesOf(segments)) {
      for (const m of findPhraseMatches(sent.text, ASSISTANT_RESIDUE_PHRASES)) {
        const start = sent.start + m.start;
        const end = sent.start + m.end;
        findings.push({
          ruleId: "pat.assistant-residue",
          severity: "error",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m.text}" ${RESIDUE_MESSAGE}`,
          fix: "Delete on sight.",
          confidence: 1.0,
        });
      }

      if (GREAT_QUESTION_RE.test(sent.text)) {
        findings.push({
          ruleId: "pat.assistant-residue",
          severity: "error",
          scope: "sentence",
          start: sent.start,
          end: sent.end,
          quote: input.text.slice(sent.start, sent.end),
          message: `"${sent.text}" ${RESIDUE_MESSAGE}`,
          fix: "Delete on sight.",
          confidence: 1.0,
        });
      }
    }
    return findings;
  },
};
