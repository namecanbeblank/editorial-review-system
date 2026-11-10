import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { proseOf } from "./util.js";
import { CURLY_QUOTE_CHARS, NBSP } from "./tells-lexicons.js";

export const unicodeResidue: PatternRule = {
  id: "pat.unicode-residue",
  title: "Mixed Unicode / curly-quote residue",
  source: "tells catalogue §19",
  mechanism: "pattern",
  scope: "document",
  severity: "info",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    const prose = proseOf(segments);
    let curlyCount = 0;
    let straightCount = 0;
    let firstCurly: { start: number; end: number } | null = null;
    let firstNbsp: { start: number; end: number } | null = null;

    for (const seg of prose) {
      for (let i = 0; i < seg.text.length; i++) {
        const ch = seg.text[i]!;
        if (CURLY_QUOTE_CHARS.includes(ch)) {
          curlyCount++;
          if (!firstCurly) firstCurly = { start: seg.start + i, end: seg.start + i + 1 };
        } else if (ch === '"' || ch === "'") {
          straightCount++;
        } else if (ch === NBSP && !firstNbsp) {
          firstNbsp = { start: seg.start + i, end: seg.start + i + 1 };
        }
      }
    }

    if (curlyCount > 0 && straightCount > 0 && firstCurly) {
      findings.push({
        ruleId: "pat.unicode-residue",
        severity: "info",
        scope: "document",
        start: firstCurly.start,
        end: firstCurly.end,
        quote: input.text.slice(firstCurly.start, firstCurly.end),
        message: `Mixed quote styles: ${curlyCount} curly, ${straightCount} straight -- the inconsistency, not the curly style itself, is the signal.`,
        fix: "Normalize to one quote convention throughout.",
        confidence: 1.0,
      });
    }
    if (firstNbsp) {
      findings.push({
        ruleId: "pat.unicode-residue",
        severity: "info",
        scope: "document",
        start: firstNbsp.start,
        end: firstNbsp.end,
        quote: input.text.slice(firstNbsp.start, firstNbsp.end),
        message: "Non-breaking space found mid-prose.",
        fix: "Replace with a normal space unless it's deliberately preventing a line break.",
        confidence: 1.0,
      });
    }
    return findings;
  },
};
