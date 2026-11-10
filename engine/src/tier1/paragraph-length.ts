import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { paragraphsOf, sentencesOf } from "./util.js";
import { PARAGRAPH_LENGTH_MAX_SENTENCES } from "./lexicons.js";

/**
 * pat.paragraph-length (rewriter)
 * Prose paragraphs only (kind === "paragraph") -- a long listItem doesn't count, and a
 * list block never joins a paragraph in the first place post-segmenter-extension.
 *
 * RECLASSIFIED 2026-08-10 (P3 eval, self-ruled): `pack: "tpl-article"`. The 4-sentence
 * ceiling is the rewriter TEMPLATE's own convention, not core doctrine -- it was
 * misfiled into the core (always-on) rule set originally. tier1/index.ts's runTier1()
 * now filters rules by pack: "core" (the default for any rule with no `pack`) always
 * runs; a non-core pack only runs when the caller opts in via
 * `runTier1(input, { packs: ["tpl-article"] })`. Architecture choice: the pack toggle
 * lives on runTier1's own options parameter, not on CheckInput -- CheckInput flows into
 * every individual rule's check(input, segments) and represents "what's being checked"
 * (the article + client/brief context); which rule PACKS run is an orchestration
 * concern that belongs with the orchestrator (runTier1), not mixed into the per-rule
 * input contract. See tier1/index.ts and the final report.
 */
export const paragraphLength: PatternRule = {
  id: "pat.paragraph-length",
  title: "Long prose paragraph",
  source: "rewriter",
  mechanism: "pattern",
  scope: "paragraph",
  severity: "info",
  clientAware: false,
  pack: "tpl-article",
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    const allSentences = sentencesOf(segments);
    for (const para of paragraphsOf(segments)) {
      const count = allSentences.filter(
        (s) => s.start >= para.start && s.end <= para.end,
      ).length;
      if (count <= PARAGRAPH_LENGTH_MAX_SENTENCES) continue;
      findings.push({
        ruleId: "pat.paragraph-length",
        severity: "info",
        scope: "paragraph",
        start: para.start,
        end: para.end,
        quote: input.text.slice(para.start, para.end),
        message: `Paragraph runs ${count} sentences (over ${PARAGRAPH_LENGTH_MAX_SENTENCES}). Operational-scenario buildups are a legitimate exception -- info only, verify before cutting.`,
        fix: "Split into shorter paragraphs, or confirm this is a deliberate scenario buildup.",
        confidence: 1.0,
      });
    }
    return findings;
  },
};
