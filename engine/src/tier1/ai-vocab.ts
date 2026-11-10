import type { CheckInput, ClientConfig, Finding, PatternRule, Segment } from "../schema.js";
import { findPhraseMatches, sentencesOf, wordCount } from "./util.js";
import { AI_VOCAB_LEXICON } from "./tells-lexicons.js";

/**
 * Every ruleId in the Wave 3 ("AI-tell") group, including pat.ai-vocab's own per-hit
 * findings -- the set the document-level density verdict counts across. Defined here
 * since pat.ai-vocab is the rule that consumes it, imported by index.ts for the
 * post-processing step (see computeAiVocabDensityVerdict below).
 * pat.competing-ctas KILLED 2026-08-10 (P3 eval, 0/4 sample precision) -- removed here too.
 */
export const WAVE_3_RULE_IDS: readonly string[] = [
  "pat.ai-vocab",
  "pat.significance-puffery",
  "pat.vague-attribution",
  "pat.participial-tail",
  "pat.assistant-residue",
  "pat.template-residue",
  "pat.title-case-headings",
  "pat.bold-label-bullets",
  "pat.emoji-structural",
  "pat.unicode-residue",
  "pat.media-padding",
  "pat.gap-speculation",
  "pat.challenges-template",
  "pat.triad-filler",
  "pat.false-range",
  "pat.unknown-trademark-feature",
];

const DENSITY_LIGHT = 5;
const DENSITY_MODERATE = 12;
const DENSITY_HEAVY = 25;

/**
 * T5 (2026-08-10, P3 eval): a lexicon match is skipped when it looks like a
 * trademarked/capitalized feature name rather than organic AI-vocabulary usage --
 * FP class was "Showcase™", a real Example Studio feature name that happens to collide with the
 * lexicon's "showcase". Three independent tells, any one of which is enough to skip:
 * (a) immediately followed by ™/®; (b) matches a ClientConfig.featureGlossary canonical
 * name; (c) capitalized but NOT at the sentence's own start (sentence-initial capitals
 * are just normal capitalization, not a proper-noun signal).
 */
function isSkippableFeatureName(
  matchText: string,
  matchStart: number,
  matchEnd: number,
  sentText: string,
  client: ClientConfig | undefined,
): boolean {
  const afterChar = sentText[matchEnd];
  if (afterChar === "™" || afterChar === "®") return true;

  if (
    client?.featureGlossary?.some((f) => f.canonical.toLowerCase() === matchText.toLowerCase())
  ) {
    return true;
  }

  if (matchStart > 0 && /^[A-Z]/.test(matchText)) return true;

  return false;
}

/**
 * pat.ai-vocab (tells catalogue §13)
 * "info per hit, document verdict by density · sentence + document" -- the per-hit half
 * is an ordinary sentence-scope lexicon rule (this PatternRule). The document-verdict
 * half needs to see every OTHER Wave 3 rule's findings too, which the
 * PatternRule.check(input, segments) signature can't provide -- rules don't see each
 * other's output, by design. So the verdict is computed separately by
 * computeAiVocabDensityVerdict() below, called from runTier1() as a post-processing
 * step after every rule (including this one) has already run. See tier1/index.ts.
 */
export const aiVocab: PatternRule = {
  id: "pat.ai-vocab",
  title: "AI-vocabulary word (per hit)",
  source: "tells catalogue §13",
  mechanism: "pattern",
  scope: "sentence",
  severity: "info",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    for (const sent of sentencesOf(segments)) {
      for (const m of findPhraseMatches(sent.text, AI_VOCAB_LEXICON)) {
        if (isSkippableFeatureName(m.text, m.start, m.end, sent.text, input.client)) continue;
        const start = sent.start + m.start;
        const end = sent.start + m.end;
        findings.push({
          ruleId: "pat.ai-vocab",
          severity: "info",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m.text}" is AI-vocabulary. One or two occurrences are coincidence -- density and co-occurrence are the real signal (see the document-level verdict).`,
          confidence: 1.0,
        });
      }
    }
    return findings;
  },
};

/**
 * Document-scope density verdict across the whole Wave 3 group. Word count is over the
 * raw source (input.text), per "per 1,000 words of source". Below the LIGHT threshold
 * nothing is reported -- density and co-occurrence are the signal, not a handful of
 * incidental hits. Anchored to the paragraph/listItem/heading with the most Wave-3 hits
 * (same "densest passage" convention as pat.em-dash-density).
 */
export function computeAiVocabDensityVerdict(
  input: CheckInput,
  segments: Segment[],
  allFindings: readonly Finding[],
): Finding[] {
  const wordTotal = wordCount(input.text);
  if (wordTotal === 0) return [];

  const wave3Findings = allFindings.filter((f) => WAVE_3_RULE_IDS.includes(f.ruleId));
  const total = wave3Findings.length;
  const density = (total * 1000) / wordTotal;
  if (density < DENSITY_LIGHT) return [];

  const tier =
    density >= DENSITY_HEAVY ? "HEAVY" : density >= DENSITY_MODERATE ? "MODERATE" : "LIGHT";

  const containers = segments.filter((s) => s.kind !== "sentence");
  let best: Segment | null = null;
  let bestCount = -1;
  for (const seg of containers) {
    const count = wave3Findings.filter((f) => f.start >= seg.start && f.end <= seg.end).length;
    if (count > bestCount) {
      best = seg;
      bestCount = count;
    }
  }
  const anchor: Pick<Segment, "start" | "end"> =
    best ?? { start: 0, end: Math.min(1, input.text.length) };

  const roundedDensity = Math.round(density * 10) / 10;
  let message = `AI-vocabulary density is ${tier} (${roundedDensity}/1,000 words across ${total} Wave 3 hits).`;
  if (tier === "HEAVY") {
    message +=
      " Expect substance failure, not just surface tells -- run the substance audit (llmd.substance-test), not a longer edit list.";
  }

  return [
    {
      ruleId: "pat.ai-vocab",
      severity: "info",
      scope: "document",
      start: anchor.start,
      end: anchor.end,
      quote: input.text.slice(anchor.start, anchor.end),
      message,
      confidence: 1.0,
    },
  ];
}
