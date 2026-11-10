import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { escapeRegExp, findPhraseMatches, headingsOf, sentencesOf } from "./util.js";
import { COMPETITOR_DISPARAGEMENT_PHRASES } from "./lexicons.js";

interface SectionSpan {
  start: number;
  end: number;
}

/** A "competitor section" is the span from a heading naming a competitor through the
 *  next heading of the same or shallower depth (or end of document) -- the same
 *  H2-section convention the inventory uses elsewhere (llmd.positioning-depth's
 *  word-share-per-H2-section assist). */
function competitorSectionSpans(
  segments: Segment[],
  competitors: readonly string[],
): SectionSpan[] {
  const headings = headingsOf(segments);
  const spans: SectionSpan[] = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]!;
    const namesCompetitor = competitors.some((c) =>
      h.text.toLowerCase().includes(c.toLowerCase()),
    );
    if (!namesCompetitor) continue;
    let end = Number.MAX_SAFE_INTEGER;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j]!.depth! <= h.depth!) {
        end = headings[j]!.start;
        break;
      }
    }
    spans.push({ start: h.end, end });
  }
  return spans;
}

/**
 * pat.competitor-disparagement (rewriter, client-aware)
 * The three literal phrases are checked anywhere (they're a flat ban); "unlike
 * {productAlias}" is checked only inside a detected competitor section, since it's
 * specifically risky there (implicitly dinging the section's subject).
 */
export const competitorDisparagement: PatternRule = {
  id: "pat.competitor-disparagement",
  title: "Competitor disparagement",
  source: "rewriter",
  mechanism: "pattern",
  scope: "sentence",
  severity: "error",
  clientAware: true,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    for (const sent of sentencesOf(segments)) {
      for (const m of findPhraseMatches(sent.text, COMPETITOR_DISPARAGEMENT_PHRASES)) {
        const start = sent.start + m.start;
        const end = sent.start + m.end;
        findings.push({
          ruleId: "pat.competitor-disparagement",
          severity: "error",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m.text}" dings an alternative instead of staying neutral. The selling happens in the product section.`,
          fix: "State the fact neutrally; sell the product in its own section.",
          confidence: 1.0,
        });
      }
    }

    const competitors = input.client?.competitors ?? [];
    const aliases = input.client?.productAliases ?? [];
    if (competitors.length === 0 || aliases.length === 0) return findings;

    const aliasPattern = aliases.map((a) => escapeRegExp(a)).join("|");
    const unlikeRe = new RegExp(`\\bunlike\\s+(${aliasPattern})\\b`, "gi");
    for (const span of competitorSectionSpans(segments, competitors)) {
      const spanText = input.text.slice(span.start, span.end);
      unlikeRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = unlikeRe.exec(spanText)) !== null) {
        const start = span.start + m.index;
        const end = start + m[0].length;
        findings.push({
          ruleId: "pat.competitor-disparagement",
          severity: "error",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m[0]}" contrasts against the product inside a competitor's own section instead of describing it neutrally.`,
          fix: "Describe the competitor factually here; make the case for the product in the product section.",
          confidence: 1.0,
        });
      }
    }
    return findings;
  },
};
