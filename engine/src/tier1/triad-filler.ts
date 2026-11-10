import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { sentencesOf } from "./util.js";
import { AI_VOCAB_LEXICON, SIGNIFICANCE_PUFFERY_PHRASES, TRIAD_RE } from "./tells-lexicons.js";

/** "Drawn from the puffery/AI-vocab lexicons" -- the combined set from both Wave 3
 *  lexicons, single words only (multi-word phrases can't be one triad slot). */
const FILLER_WORDS: ReadonlySet<string> = new Set(
  [...AI_VOCAB_LEXICON, ...SIGNIFICANCE_PUFFERY_PHRASES]
    .filter((w) => !w.includes(" "))
    .map((w) => w.toLowerCase()),
);

function isFillerWord(word: string): boolean {
  const lower = word.toLowerCase();
  if (FILLER_WORDS.has(lower)) return true;
  if (lower.endsWith("ly") && FILLER_WORDS.has(lower.slice(0, -2))) return true;
  return false;
}

export const triadFiller: PatternRule = {
  id: "pat.triad-filler",
  title: "Rule-of-three filler triad",
  source: "tells catalogue §9",
  mechanism: "pattern",
  scope: "sentence",
  severity: "warn",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    const re = new RegExp(TRIAD_RE.source, "g");
    for (const sent of sentencesOf(segments)) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sent.text)) !== null) {
        const words = [m[1]!, m[2]!, m[3]!];
        if (!words.some((w) => isFillerWord(w))) continue;
        const start = sent.start + m.index;
        const end = start + m[0].length;
        findings.push({
          ruleId: "pat.triad-filler",
          severity: "warn",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m[0]}" is a rhythm-default triad drawing on puffery/AI-vocab words. Count the real items -- if one is a near-synonym of another, it's filler.`,
          fix: "Cut the filler item, or replace it with a load-bearing third thing.",
          confidence: 0.6,
        });
      }
    }
    return findings;
  },
};
