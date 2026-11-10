import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { escapeRegExp, headingsOf } from "./util.js";

/**
 * pat.title-conventions (positioning skill, client-aware)
 * Two independent clauses on the H1: (a) ends with "?" needs no client data at all, so
 * it always runs even without a client config; (b) begins with a productAlias needs
 * ClientConfig.productAliases, so it only runs when a client is present. This is a
 * deliberate split from the usual "client-aware = skip the whole rule without config"
 * convention (used elsewhere for animate-product/client-banned-phrases/etc., where
 * every clause genuinely needs client data) -- (a) has real standalone value and
 * withholding it when there's no client config on file would just be a needless gap.
 * See report.
 */
export const titleConventions: PatternRule = {
  id: "pat.title-conventions",
  title: "Title conventions (rhetorical question / brand-name lead)",
  source: "positioning skill",
  mechanism: "pattern",
  scope: "document",
  severity: "warn",
  clientAware: true,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    const h1 = headingsOf(segments).find((h) => h.depth === 1);
    if (!h1) return findings;

    if (h1.text.trim().endsWith("?")) {
      findings.push({
        ruleId: "pat.title-conventions",
        severity: "warn",
        scope: "document",
        start: h1.start,
        end: h1.end,
        quote: input.text.slice(h1.start, h1.end),
        message: "Title ends with a rhetorical question instead of stating the claim.",
        fix: "Rewrite as a direct statement or a specific, answerable how/why.",
        confidence: 1.0,
      });
    }

    const aliases = input.client?.productAliases ?? [];
    for (const alias of aliases) {
      const re = new RegExp(`^${escapeRegExp(alias)}\\b`);
      if (re.test(h1.text)) {
        findings.push({
          ruleId: "pat.title-conventions",
          severity: "warn",
          scope: "document",
          start: h1.start,
          end: h1.end,
          quote: input.text.slice(h1.start, h1.end),
          message: `Title leads with the product name ("${alias}") instead of the reader's problem or query.`,
          fix: "Lead with the reader's problem/query; the product name doesn't need to open the title.",
          confidence: 1.0,
        });
        break;
      }
    }
    return findings;
  },
};
