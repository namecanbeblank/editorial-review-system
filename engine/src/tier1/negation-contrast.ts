import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { proseOf, sentencesOf } from "./util.js";

/**
 * pat.x-not-y-it-is-z (doctrine §10.3)
 * "Structure doesn't make hiring robotic. It makes decisions consistent." -- denies
 * something nobody claimed, then reasserts it as if it were new information.
 *
 * The inventory's regex spans a real sentence terminator (`[.!?]\s+` sits in the middle
 * of the pattern), so it has to run over paragraph text rather than a single pre-split
 * sentence -- splitSentences() would already have cut the string at that terminator.
 * The inventory also names a single-sentence variant joined by ";" or " -- "; that one
 * is fully contained in one sentence, so it runs per-sentence instead.
 */
const CROSS_SENTENCE_RE =
  /\b(is not|isn['’]t|are not|aren['’]t|does not make|doesn['’]t make|won['’]t make)\b[^.!?]{0,80}[.!?]\s+(It|That|They|This)(['’]s|['’]re| is| are| makes| means)\b/g;

/**
 * Single-sentence variant with ";" or " -- " as the joint. The inventory describes this
 * variant in prose only (no literal regex given), so this pattern is our own
 * construction, mirroring the cross-sentence form. Lowercase pronoun because a
 * mid-sentence continuation after ";"/"--" isn't capitalized the way a new sentence is.
 */
const SEMI_OR_DASH_RE =
  /\b(is not|isn['’]t|are not|aren['’]t|does not make|doesn['’]t make|won['’]t make)\b[^;.!?—]{0,80}(;|—)\s*(it|that|they|this)(['’]s|['’]re| is| are| makes| means)\b/gi;

/**
 * Staccato negative-parallelism variant: "No X. No Y. Just Z." asserts by eliminating
 * two things nobody claimed instead of stating the positive directly. Spans two real
 * terminators, so -- like CROSS_SENTENCE_RE -- it runs over paragraph text.
 */
const STACCATO_RE = /\bNo [^.!?]{2,30}\. No [^.!?]{2,30}\. Just [^.!?]{2,40}[.!?]/g;

const X_NOT_Y_MESSAGE =
  "Negates something no one claimed, then reasserts it as new information. Say the true thing once.";
const X_NOT_Y_FIX = "Cut the denial; state the positive claim directly.";

const STACCATO_MESSAGE =
  '"No X. No Y. Just Z." asserts by elimination instead of stating the positive claim directly.';

function pushXNotY(
  findings: Finding[],
  input: CheckInput,
  start: number,
  end: number,
  message: string = X_NOT_Y_MESSAGE,
): void {
  findings.push({
    ruleId: "pat.x-not-y-it-is-z",
    severity: "error",
    scope: "sentence",
    start,
    end,
    quote: input.text.slice(start, end),
    message,
    fix: X_NOT_Y_FIX,
    confidence: 0.85,
  });
}

export const xNotYItIsZ: PatternRule = {
  id: "pat.x-not-y-it-is-z",
  title: "X doesn't make Y. It makes Z.",
  source: "doctrine §10.3",
  mechanism: "pattern",
  scope: "sentence",
  severity: "error",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];

    for (const para of proseOf(segments)) {
      CROSS_SENTENCE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CROSS_SENTENCE_RE.exec(para.text)) !== null) {
        const start = para.start + m.index;
        pushXNotY(findings, input, start, start + m[0].length);
      }

      STACCATO_RE.lastIndex = 0;
      let sm: RegExpExecArray | null;
      while ((sm = STACCATO_RE.exec(para.text)) !== null) {
        const start = para.start + sm.index;
        pushXNotY(findings, input, start, start + sm[0].length, STACCATO_MESSAGE);
      }
    }

    for (const sent of sentencesOf(segments)) {
      SEMI_OR_DASH_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = SEMI_OR_DASH_RE.exec(sent.text)) !== null) {
        const start = sent.start + m.index;
        pushXNotY(findings, input, start, start + m[0].length);
      }
    }

    return findings;
  },
};

/**
 * pat.not-just-x-but-y (doctrine §10.3)
 * Flags the opener itself even without a "but" completion -- the inventory is explicit
 * that the tic is the opener, not the full construction.
 */
const NOT_JUST_OPENER_RE = /\b(not just|isn't just|aren't just|not only|isn't merely)\b/i;

export const notJustXButY: PatternRule = {
  id: "pat.not-just-x-but-y",
  title: "Not just X, but Y",
  source: "doctrine §10.3",
  mechanism: "pattern",
  scope: "sentence",
  severity: "error",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    for (const sent of sentencesOf(segments)) {
      const m = NOT_JUST_OPENER_RE.exec(sent.text);
      if (!m) continue;
      const start = sent.start + m.index;
      const end = start + m[0].length;
      findings.push({
        ruleId: "pat.not-just-x-but-y",
        severity: "error",
        scope: "sentence",
        start,
        end,
        quote: input.text.slice(start, end),
        message:
          'The "not just X, but Y" opener inflates a claim by knocking down a strawman first. Flagged even without a "but" completion -- the opener alone is the tic.',
        fix: "State the real claim directly, without the not-just/but scaffold.",
        confidence: 1.0,
      });
    }
    return findings;
  },
};

/**
 * pat.contrast-definition (doctrine §10.13)
 * Defines by negation ("is a X, not a Y") instead of stating what the thing does.
 */
const CONTRAST_DEFINITION_RE = /\bis (a|an) [^,.!?]{2,40}, not (a|an) \b/i;

export const contrastDefinition: PatternRule = {
  id: "pat.contrast-definition",
  title: "Is a X, not a Y",
  source: "doctrine §10.13",
  mechanism: "pattern",
  scope: "sentence",
  severity: "warn",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    for (const sent of sentencesOf(segments)) {
      const m = CONTRAST_DEFINITION_RE.exec(sent.text);
      if (!m) continue;
      const start = sent.start + m.index;
      const end = start + m[0].length;
      findings.push({
        ruleId: "pat.contrast-definition",
        severity: "warn",
        scope: "sentence",
        start,
        end,
        quote: input.text.slice(start, end),
        message:
          'Defines by negation ("is a X, not a Y") instead of saying what the thing actually does. Legitimate causal contrasts exist, so this stays a warn, not an error.',
        fix: "Replace the negated half with the concrete detail it's gesturing at.",
        confidence: 0.7,
      });
    }
    return findings;
  },
};
