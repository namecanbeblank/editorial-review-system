import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { sentencesOf } from "./util.js";

/**
 * A capitalized phrase (1-4 words, each starting with an uppercase letter) immediately
 * followed by (R) or (TM) -- no space, matching the inventory's own worked examples
 * ("Showcase(TM)", "Example Studio Verified(TM)"). `\b` before the first capital anchors on a real
 * word boundary, not a mid-camelCase transition.
 */
const TRADEMARK_PHRASE_RE = /\b((?:[A-Z][a-zA-Z0-9'-]*\s+){0,3}[A-Z][a-zA-Z0-9'-]*)([™®])/g;

/**
 * pat.unknown-trademark-feature (P5.2 round-2 eval -- the "Showcase(TM)" miss)
 *
 * A trademark-styled name is a checkable, falsifiable claim about the vendor's own
 * product -- more serious than an invented anecdote, because it reads as an official
 * feature name rather than editorial color. Flags when the captured phrase, checked
 * BOTH with and without the mark (glossary authors may or may not include the symbol in
 * their own canonical entries -- see rules/inventory.md), matches no
 * ClientConfig.featureGlossary canonical and isn't a listed competitor name either.
 * Client-aware: skipped entirely when there's no featureGlossary to check against, since
 * an empty glossary can't distinguish a real feature from an invented one.
 */
export const unknownTrademarkFeature: PatternRule = {
  id: "pat.unknown-trademark-feature",
  title: "Unrecognized trademarked feature name",
  source: 'P5.2 round-2 eval (the "Showcase™" miss)',
  mechanism: "pattern",
  scope: "sentence",
  severity: "error",
  clientAware: true,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const glossary = input.client?.featureGlossary;
    if (!glossary || glossary.length === 0) return [];

    const canonicalsLower = new Set(glossary.map((entry) => entry.canonical.toLowerCase()));
    const competitorsLower = (input.client?.competitors ?? [])
      .map((c) => c.trim().toLowerCase())
      .filter((c) => c.length > 0);

    const findings: Finding[] = [];
    for (const sent of sentencesOf(segments)) {
      TRADEMARK_PHRASE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TRADEMARK_PHRASE_RE.exec(sent.text)) !== null) {
        const phrase = m[1]!;
        const mark = m[2]!;
        const withoutMark = phrase.toLowerCase();
        const withMark = (phrase + mark).toLowerCase();

        if (canonicalsLower.has(withoutMark) || canonicalsLower.has(withMark)) continue;
        if (competitorsLower.some((c) => withoutMark === c || withoutMark.includes(c))) continue;

        const start = sent.start + m.index;
        const end = start + phrase.length + mark.length;
        findings.push({
          ruleId: "pat.unknown-trademark-feature",
          severity: "error",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${phrase}${mark}" is styled as a trademarked feature name but isn't in the client's feature glossary -- verify it's a real, current feature before publishing.`,
          fix: "Confirm the feature name against the glossary, or correct/remove it if it doesn't exist.",
          confidence: 1.0,
        });
      }
    }
    return findings;
  },
};
