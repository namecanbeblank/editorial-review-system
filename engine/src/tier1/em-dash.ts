import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { paragraphsOf, sentencesOf } from "./util.js";

const EM_DASH = "—";

/**
 * pat.em-dash-aside (doctrine §10.3)
 * Paired em dashes wrapping an aside, with the clause resuming after. A single em dash
 * used as a connective/turn-of-thought is legal and must not match this -- the pattern
 * requires two dashes with 4-80 non-terminator chars between them, so a lone dash never
 * satisfies it.
 */
const ASIDE_RE = /—[^—.!?]{4,80}—\s*\w/g;

export const emDashAside: PatternRule = {
  id: "pat.em-dash-aside",
  title: "Paired em-dash aside",
  source: "doctrine §10.3",
  mechanism: "pattern",
  scope: "sentence",
  severity: "warn",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    for (const sent of sentencesOf(segments)) {
      ASIDE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = ASIDE_RE.exec(sent.text)) !== null) {
        const start = sent.start + m.index;
        const end = start + m[0].length;
        findings.push({
          ruleId: "pat.em-dash-aside",
          severity: "warn",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message:
            "Paired em dashes wrap an aside inside the sentence instead of just cutting it to two sentences. A single connective em dash is fine -- this is the paired-aside form.",
          fix: "Split into two sentences, or cut the aside entirely.",
          confidence: 0.8,
        });
      }
    }
    return findings;
  },
};

/**
 * pat.em-dash-density (doctrine §10.13)
 * Budget rule: each individual em dash may be legal on its own; the density across the
 * document is the tell. One document-scope finding, anchored to the paragraph with the
 * highest local em-dash-per-sentence ratio.
 */
export const emDashDensity: PatternRule = {
  id: "pat.em-dash-density",
  title: "Em dash density budget",
  source: "doctrine §10.13",
  mechanism: "pattern",
  scope: "document",
  severity: "warn",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const sentences = sentencesOf(segments);
    if (sentences.length === 0) return [];

    const totalWithDash = sentences.filter((s) => s.text.includes(EM_DASH)).length;
    const ratio = totalWithDash / sentences.length;
    if (ratio <= 1 / 6) return [];

    let best: Segment | null = null;
    let bestRatio = -1;
    let bestCount = -1;
    for (const para of paragraphsOf(segments)) {
      const paraSentences = sentences.filter((s) => s.start >= para.start && s.end <= para.end);
      if (paraSentences.length === 0) continue;
      const withDash = paraSentences.filter((s) => s.text.includes(EM_DASH)).length;
      if (withDash === 0) continue;
      const localRatio = withDash / paraSentences.length;
      if (localRatio > bestRatio || (localRatio === bestRatio && withDash > bestCount)) {
        best = para;
        bestRatio = localRatio;
        bestCount = withDash;
      }
    }

    const anchor = best ?? sentences[0]!;
    return [
      {
        ruleId: "pat.em-dash-density",
        severity: "warn",
        scope: "document",
        start: anchor.start,
        end: anchor.end,
        quote: input.text.slice(anchor.start, anchor.end),
        message: `Em dash appears in ${totalWithDash}/${sentences.length} sentences, over the 1-in-6 budget. Each individual use may be legal -- the density is the tell.`,
        fix: "Convert some em-dash sentences to plain periods or commas.",
        confidence: 1.0,
      },
    ];
  },
};
