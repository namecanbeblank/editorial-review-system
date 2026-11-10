import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { escapeRegExp, sentencesOf } from "./util.js";
import { ANIMATE_PRODUCT_VERBS } from "./lexicons.js";

/**
 * pat.animate-product (house rule, 2026-08-09 + core-voice §8 anti-hype)
 * Client-aware: needs ClientConfig.productAliases to build the pattern, so it skips
 * cleanly (returns no findings) when input.client is undefined or has no aliases.
 */
export const animateProduct: PatternRule = {
  id: "pat.animate-product",
  title: "Animated product (product as agent with feelings)",
  source: "house rule (2026-08-09) + core-voice §8 anti-hype",
  mechanism: "pattern",
  scope: "sentence",
  severity: "warn",
  clientAware: true,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    const aliases = input.client?.productAliases ?? [];
    if (aliases.length === 0) return findings;

    const aliasPattern = aliases.map((a) => escapeRegExp(a)).join("|");
    const verbPattern = ANIMATE_PRODUCT_VERBS.join("|");
    const re = new RegExp(`\\b(${aliasPattern})\\s+(${verbPattern})\\b`, "gi");

    for (const sent of sentencesOf(segments)) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sent.text)) !== null) {
        const start = sent.start + m.index;
        const end = start + m[0].length;
        findings.push({
          ruleId: "pat.animate-product",
          severity: "warn",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m[0]}" gives the product beliefs or feelings it can't have.`,
          fix: `Rewrite with "we" as the subject (e.g. "We built ${m[1]} so...").`,
          confidence: 1.0,
        });
      }
    }
    return findings;
  },
};
