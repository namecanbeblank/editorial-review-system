import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { mean, paragraphsOf, sentencesOf, stdevPopulation, wordCount } from "./util.js";

const MIN_RUN = 4;
const STDEV_MAX = 3.5;
const MEAN_MIN = 10;
const MEAN_MAX = 30;

/**
 * pat.uniform-rhythm (core-voice §2)
 * Machine-signature stat: a run of >=4 consecutive sentences (within one paragraph,
 * since the rule is paragraph-scoped) whose word counts barely vary. Info only -- the
 * fix is alternation, not a rewrite the linter can prescribe.
 */
export const uniformRhythm: PatternRule = {
  id: "pat.uniform-rhythm",
  title: "Uniform sentence rhythm",
  source: "core-voice §2",
  mechanism: "pattern",
  scope: "paragraph",
  severity: "info",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    const allSentences = sentencesOf(segments);

    for (const para of paragraphsOf(segments)) {
      const paraSentences = allSentences
        .filter((s) => s.start >= para.start && s.end <= para.end)
        .sort((a, b) => a.start - b.start);
      const counts = paraSentences.map((s) => wordCount(s.text));

      const qualifies = (startIdx: number, len: number): boolean => {
        const slice = counts.slice(startIdx, startIdx + len);
        const m = mean(slice);
        const sd = stdevPopulation(slice);
        return sd < STDEV_MAX && m >= MEAN_MIN && m <= MEAN_MAX;
      };

      let i = 0;
      while (i + MIN_RUN <= paraSentences.length) {
        if (!qualifies(i, MIN_RUN)) {
          i++;
          continue;
        }
        let windowLen = MIN_RUN;
        while (i + windowLen + 1 <= paraSentences.length && qualifies(i, windowLen + 1)) {
          windowLen++;
        }

        const runStart = paraSentences[i]!.start;
        const runEnd = paraSentences[i + windowLen - 1]!.end;
        findings.push({
          ruleId: "pat.uniform-rhythm",
          severity: "info",
          scope: "paragraph",
          start: runStart,
          end: runEnd,
          quote: input.text.slice(runStart, runEnd),
          message: `${windowLen} sentences in a row run the same length (word-count stdev under ${STDEV_MAX}, mean ${MEAN_MIN}-${MEAN_MAX} words) -- a machine-signature rhythm.`,
          fix: "Vary sentence length: alternate principle, detail, and consequence instead of matching cadence.",
          confidence: 1.0,
        });
        i += windowLen;
      }
    }
    return findings;
  },
};
