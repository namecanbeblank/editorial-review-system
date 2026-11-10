import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { findPhraseMatches, sentencesOf } from "./util.js";
import { STRUCTURE_PREVIEW_PHRASES } from "./lexicons.js";

/**
 * pat.structure-preview (positioning skill hook criteria)
 * Coexists with pat.jump-link-contract: list articles still preview the category list
 * WITH jump links; the ban here is the meta "we'll cover..." framing itself, never a
 * linked preview. No special-casing needed -- this rule only ever matches the literal
 * meta phrases, so a jump-link intro with no "we'll cover" text never trips it.
 */
export const structurePreview: PatternRule = {
  id: "pat.structure-preview",
  title: "Meta structure-preview opener",
  source: "positioning skill hook criteria",
  mechanism: "pattern",
  scope: "sentence",
  severity: "error",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    for (const sent of sentencesOf(segments)) {
      for (const m of findPhraseMatches(sent.text, STRUCTURE_PREVIEW_PHRASES)) {
        const start = sent.start + m.start;
        const end = sent.start + m.end;
        findings.push({
          ruleId: "pat.structure-preview",
          severity: "error",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m.text}" previews the article's structure instead of starting the argument. A linked category preview is fine; this meta framing isn't.`,
          fix: "Cut it and start with the actual content.",
          confidence: 1.0,
        });
      }
    }
    return findings;
  },
};
