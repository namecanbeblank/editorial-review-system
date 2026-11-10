import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { escapeRegExp, findPhraseMatches, headingsOf, paragraphsOf } from "./util.js";
import { PRODUCT_DISCLOSURE_PHRASES } from "./lexicons.js";

/** The most recent heading (any depth) that starts before `paragraphStart`, or null if
 *  the paragraph has no preceding heading at all. */
function nearestPrecedingHeading(headings: Segment[], paragraphStart: number): Segment | null {
  let nearest: Segment | null = null;
  for (const h of headings) {
    if (h.start < paragraphStart && (!nearest || h.start > nearest.start)) {
      nearest = h;
    }
  }
  return nearest;
}

/**
 * pat.product-name-paragraph-opener (rewriter, client-aware)
 * Non-heading paragraph whose first word is a productAlias (possessive "'s" allowed,
 * e.g. "Example Studio's dashboard..." still counts as leading with the product).
 *
 * RETUNED (2026-08-10, from P3 eval -- fired exactly in the predicted FP zone): SKIP a
 * paragraph whose nearest preceding heading (any depth) contains a productAlias --
 * inside the product's own section, opening with the product name is natural. A
 * paragraph with no preceding heading at all still gets the full check (nothing to
 * exempt it).
 *
 * F3 (2026-08-10, P3 eval): ALSO skip a paragraph containing an honest-disclosure
 * phrase ("Example Studio is ours..."), and demote severity error -> warn -- a mild style
 * preference once the two false-positive zones (product's own section, disclosure
 * paragraphs) are excluded, not a hard doctrine violation.
 */
export const productNameParagraphOpener: PatternRule = {
  id: "pat.product-name-paragraph-opener",
  title: "Product name opens the paragraph",
  source: "rewriter",
  mechanism: "pattern",
  scope: "paragraph",
  severity: "warn",
  clientAware: true,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    const aliases = input.client?.productAliases ?? [];
    if (aliases.length === 0) return findings;

    const headings = headingsOf(segments);

    for (const para of paragraphsOf(segments)) {
      const heading = nearestPrecedingHeading(headings, para.start);
      if (heading && aliases.some((a) => heading.text.toLowerCase().includes(a.toLowerCase()))) {
        continue;
      }
      if (findPhraseMatches(para.text, PRODUCT_DISCLOSURE_PHRASES).length > 0) continue;

      for (const alias of aliases) {
        const re = new RegExp(`^${escapeRegExp(alias)}(?:'s)?\\b`);
        const m = re.exec(para.text);
        if (!m) continue;
        const start = para.start + m.index;
        const end = start + m[0].length;
        findings.push({
          ruleId: "pat.product-name-paragraph-opener",
          severity: "warn",
          scope: "paragraph",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `Paragraph opens with "${m[0]}" -- lead with reader context, problem, or outcome, then the product.`,
          fix: "Rewrite the opening sentence to start from the reader's situation, not the product name.",
          confidence: 0.9,
        });
        break;
      }
    }
    return findings;
  },
};
