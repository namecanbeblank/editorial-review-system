import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { findPhraseMatches, sentencesOf } from "./util.js";

/**
 * pat.feature-name-drift (rewriter, client-aware)
 * Reads ClientConfig.featureGlossary directly (no static lexicon) -- skips cleanly
 * when there's no client config or an empty glossary.
 */
export const featureNameDrift: PatternRule = {
  id: "pat.feature-name-drift",
  title: "Feature name drift",
  source: "rewriter",
  mechanism: "pattern",
  scope: "sentence",
  severity: "error",
  clientAware: true,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    const glossary = input.client?.featureGlossary ?? [];
    if (glossary.length === 0) return findings;

    for (const sent of sentencesOf(segments)) {
      for (const entry of glossary) {
        for (const m of findPhraseMatches(sent.text, entry.banned)) {
          const start = sent.start + m.start;
          const end = sent.start + m.end;
          findings.push({
            ruleId: "pat.feature-name-drift",
            severity: "error",
            scope: "sentence",
            start,
            end,
            quote: input.text.slice(start, end),
            message: `"${m.text}" paraphrases the canonical feature name -- use "${entry.canonical}".`,
            fix: `Replace with "${entry.canonical}".`,
            confidence: 1.0,
          });
        }
      }
    }
    return findings;
  },
};
