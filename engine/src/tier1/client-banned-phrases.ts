import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { findPhraseMatches, sentencesOf } from "./util.js";

/**
 * pat.client-banned-phrases (client config)
 * Client-aware: reads ClientConfig.bannedPhrases directly (no static lexicon), so it
 * skips cleanly when input.client is undefined or defines no banned phrases.
 */
export const clientBannedPhrases: PatternRule = {
  id: "pat.client-banned-phrases",
  title: "Client-banned phrase",
  source: "client config",
  mechanism: "pattern",
  scope: "sentence",
  severity: "error",
  clientAware: true,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    const banned = input.client?.bannedPhrases ?? [];
    if (banned.length === 0) return findings;

    const clientName = input.client?.name ?? "this client";
    for (const sent of sentencesOf(segments)) {
      for (const m of findPhraseMatches(sent.text, banned)) {
        const start = sent.start + m.start;
        const end = sent.start + m.end;
        findings.push({
          ruleId: "pat.client-banned-phrases",
          severity: "error",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m.text}" is a banned framing for ${clientName}.`,
          fix: "Replace with the client's approved framing.",
          confidence: 1.0,
        });
      }
    }
    return findings;
  },
};
