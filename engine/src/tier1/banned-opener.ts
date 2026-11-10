import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { findPhraseMatches, paragraphsOf, sentencesOf } from "./util.js";
import {
  AS_A_YOU_KNOW_RE,
  BANNED_OPENER_PHRASES,
  EFFECTIVE_X_IS_CRITICAL_RE,
  YOUVE_SPENT_PARAGRAPH_RE,
} from "./lexicons.js";

/**
 * pat.banned-opener (bofu-editor dim 1 + doctrine §10.1)
 * Detected anywhere in the document, per the inventory's own "phrase list anywhere"
 * wording -- the "weighted to first 3 paragraphs" note isn't a documented scoring
 * mechanism (no differential threshold/severity is given), so it's treated as guidance
 * for a future eval-phase confidence pass rather than implemented as a position-based
 * cutoff here. See final report.
 */
export const bannedOpener: PatternRule = {
  id: "pat.banned-opener",
  title: "Banned cinematic/hype opener",
  source: "bofu-editor dim 1 + doctrine §10.1",
  mechanism: "pattern",
  scope: "sentence",
  severity: "error",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    for (const sent of sentencesOf(segments)) {
      for (const m of findPhraseMatches(sent.text, BANNED_OPENER_PHRASES)) {
        const start = sent.start + m.start;
        const end = sent.start + m.end;
        findings.push({
          ruleId: "pat.banned-opener",
          severity: "error",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m.text}" is a banned opener -- it stalls on scene-setting instead of starting where the reader already is. Recognition framing ("If you've ever...") is fine; visualization is not.`,
          fix: 'Replace with a recognition-framed opener ("If you\'ve ever needed to...") or cut straight to the point.',
          confidence: 1.0,
        });
      }

      const m2 = EFFECTIVE_X_IS_CRITICAL_RE.exec(sent.text);
      if (m2) {
        const start = sent.start + m2.index;
        const end = start + m2[0].length;
        findings.push({
          ruleId: "pat.banned-opener",
          severity: "error",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m2[0]}" is the "Effective X is critical/essential/crucial" throat-clearing opener.`,
          fix: "Cut the throat-clearing; start with the concrete claim.",
          confidence: 1.0,
        });
      }

      const m3 = AS_A_YOU_KNOW_RE.exec(sent.text);
      if (m3) {
        const start = sent.start + m3.index;
        const end = start + m3[0].length;
        findings.push({
          ruleId: "pat.banned-opener",
          severity: "error",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m3[0]}" is the "As a X, you know" throat-clearing opener.`,
          fix: "Cut the throat-clearing; start with the concrete claim.",
          confidence: 1.0,
        });
      }
    }

    for (const para of paragraphsOf(segments)) {
      const m4 = YOUVE_SPENT_PARAGRAPH_RE.exec(para.text);
      if (m4) {
        const start = para.start + m4.index;
        const end = start + m4[0].length;
        findings.push({
          ruleId: "pat.banned-opener",
          severity: "error",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m4[0]}" is a second-person scene-setting paragraph opener.`,
          fix: "Cut straight to the point instead of staging the reader's day.",
          confidence: 0.8,
        });
      }
    }
    return findings;
  },
};
