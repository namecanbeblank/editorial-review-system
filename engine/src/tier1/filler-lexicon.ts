import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { findPhraseMatches, sentencesOf } from "./util.js";
import {
  FILLER_ERROR_PHRASES,
  FILLER_VERB_SENSE_DETERMINERS,
  FILLER_VERB_SENSE_WORDS,
  FILLER_WARN_PHRASES,
  POWERFUL_PRODUCT_PRAISE_RE,
} from "./lexicons.js";

/**
 * "leverage"/"elevate" only fire in the marketing-verb shape "{word} your/our/the/...
 * {noun}" -- see lexicons.ts for why (no POS tagger; this is the low-false-positive
 * proxy for "used as a verb, marketing sense").
 */
const VERB_SENSE_RE = new RegExp(
  `\\b(${FILLER_VERB_SENSE_WORDS.join("|")})\\b\\s+(${FILLER_VERB_SENSE_DETERMINERS.join("|")})\\b`,
  "gi",
);

function fillerMessage(word: string): string {
  return `"${word}" is filler lexicon -- it names a quality instead of showing it.`;
}

export const fillerLexicon: PatternRule = {
  id: "pat.filler-lexicon",
  title: "Filler lexicon",
  source: "core-voice §7 (+ bofu-editor dim 1)",
  mechanism: "pattern",
  scope: "sentence",
  severity: "error",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    for (const sent of sentencesOf(segments)) {
      for (const m of findPhraseMatches(sent.text, FILLER_ERROR_PHRASES)) {
        const start = sent.start + m.start;
        const end = sent.start + m.end;
        findings.push({
          ruleId: "pat.filler-lexicon",
          severity: "error",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: fillerMessage(m.text),
          fix: "Cut it, or replace it with the concrete mechanism/number it's standing in for.",
          confidence: 1.0,
        });
      }

      for (const m of findPhraseMatches(sent.text, FILLER_WARN_PHRASES)) {
        const start = sent.start + m.start;
        const end = sent.start + m.end;
        findings.push({
          ruleId: "pat.filler-lexicon",
          severity: "warn",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m.text}" is allowed only when bolted to one concrete feature -- otherwise it's filler. Verify.`,
          fix: "Attach it to the one specific feature that earns it, or cut it.",
          confidence: 1.0,
        });
      }

      VERB_SENSE_RE.lastIndex = 0;
      let vm: RegExpExecArray | null;
      while ((vm = VERB_SENSE_RE.exec(sent.text)) !== null) {
        const start = sent.start + vm.index;
        const end = start + vm[0].length;
        findings.push({
          ruleId: "pat.filler-lexicon",
          severity: "error",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: fillerMessage(vm[1] ?? vm[0]),
          fix: "Cut it, or replace it with the concrete mechanism/number it's standing in for.",
          confidence: 1.0,
        });
      }

      const pm = POWERFUL_PRODUCT_PRAISE_RE.exec(sent.text);
      if (pm) {
        const start = sent.start + pm.index;
        const end = start + pm[0].length;
        findings.push({
          ruleId: "pat.filler-lexicon",
          severity: "error",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: fillerMessage("powerful"),
          fix: "Cut it, or replace it with the concrete mechanism/number it's standing in for.",
          confidence: 1.0,
        });
      }
    }
    return findings;
  },
};
