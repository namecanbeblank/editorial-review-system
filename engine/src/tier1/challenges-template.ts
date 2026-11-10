import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { findPhraseMatches, sentencesOf } from "./util.js";
import { CHALLENGES_RE, VAGUE_OPTIMISM_PHRASES } from "./tells-lexicons.js";

/**
 * pat.challenges-template (tells catalogue §12)
 * Document scope: the outline-shaped ending PAIR. Fires only when both the
 * "Despite its X, Y faces challenges" shape AND a vague-optimism close appear
 * somewhere in the document -- either half alone is common enough prose to flag on
 * its own.
 */
export const challengesTemplate: PatternRule = {
  id: "pat.challenges-template",
  title: "Challenges/future-prospects outline template",
  source: "tells catalogue §12",
  mechanism: "pattern",
  scope: "document",
  severity: "warn",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    let challengeMatch: { start: number; end: number; text: string } | null = null;
    let optimismMatch: { start: number; end: number; text: string } | null = null;

    for (const sent of sentencesOf(segments)) {
      if (!challengeMatch) {
        const m = CHALLENGES_RE.exec(sent.text);
        if (m) {
          const start = sent.start + m.index;
          challengeMatch = { start, end: start + m[0].length, text: m[0] };
        }
      }
      if (!optimismMatch) {
        const hits = findPhraseMatches(sent.text, VAGUE_OPTIMISM_PHRASES);
        if (hits.length > 0) {
          const h = hits[0]!;
          optimismMatch = { start: sent.start + h.start, end: sent.start + h.end, text: h.text };
        }
      }
      if (challengeMatch && optimismMatch) break;
    }

    if (!challengeMatch || !optimismMatch) return [];

    return [
      {
        ruleId: "pat.challenges-template",
        severity: "warn",
        scope: "document",
        start: challengeMatch.start,
        end: challengeMatch.end,
        quote: input.text.slice(challengeMatch.start, challengeMatch.end),
        message: `"${challengeMatch.text}" pairs with a vague-optimism close ("${optimismMatch.text}") elsewhere in the piece -- the outline-shaped challenges/future-prospects template, not reporting.`,
        fix: "Keep only challenges that are specific, sourced, and consequential; end on the last real thing the piece has to say.",
        confidence: 0.7,
      },
    ];
  },
};
