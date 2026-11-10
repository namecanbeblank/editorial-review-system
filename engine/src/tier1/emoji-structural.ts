import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { headingsOf, listItemsOf } from "./util.js";
import { EMOJI_RE } from "./tells-lexicons.js";

export const emojiStructural: PatternRule = {
  id: "pat.emoji-structural",
  title: "Emoji in a structural position",
  source: "tells catalogue §21",
  mechanism: "pattern",
  scope: "document",
  severity: "info",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    const candidates = [...headingsOf(segments), ...listItemsOf(segments)];
    for (const seg of candidates) {
      const trimmed = seg.text.trimStart();
      const leadOffset = seg.text.length - trimmed.length;
      const m = EMOJI_RE.exec(trimmed);
      if (!m || m.index !== 0) continue;
      const start = seg.start + leadOffset;
      const end = start + m[0].length;
      findings.push({
        ruleId: "pat.emoji-structural",
        severity: "info",
        scope: "document",
        start,
        end,
        quote: input.text.slice(start, end),
        message: `"${m[0]}" prefixes a ${seg.kind === "heading" ? "heading" : "bullet"} as a structural marker.`,
        fix: "Remove unless the channel genuinely calls for it and it's used deliberately elsewhere.",
        confidence: 1.0,
      });
    }
    return findings;
  },
};
