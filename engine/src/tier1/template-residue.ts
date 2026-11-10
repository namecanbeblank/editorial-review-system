import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { findPhraseMatches, proseOf } from "./util.js";
import {
  TEMPLATE_GAP_FLAG_RE,
  TEMPLATE_RESIDUE_ERROR_PHRASES,
  TEMPLATE_RESIDUE_ERROR_RES,
} from "./tells-lexicons.js";

interface Span {
  start: number;
  end: number;
}

/** Inline code spans (single backtick, e.g. `[Company Name]` used as a literal Boolean-
 *  search example) -- F7, 2026-08-10, P3 eval. A placeholder-shaped string inside one of
 *  these is a code example, not unreviewed template residue. */
function findInlineCodeSpans(text: string): Span[] {
  const spans: Span[] = [];
  const re = /`[^`\n]+`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

function isInsideAny(pos: number, spans: Span[]): boolean {
  return spans.some((s) => pos >= s.start && pos < s.end);
}

/**
 * pat.template-residue (tells catalogue §20)
 * Generic unresolved placeholders are an error (unreviewed paste). HOUSE gap-flags
 * ([STAT: ...], [SOURCE: ...], etc.) are info -- that grammar IS the anti-fabrication
 * workflow, never an error at draft stage. Scanned over paragraph/listItem text
 * directly (not per-sentence) since a bracketed placeholder isn't reliably inside one
 * naive sentence boundary. F7 (2026-08-10, P3 eval): matches inside inline code spans
 * are skipped entirely.
 */
export const templateResidue: PatternRule = {
  id: "pat.template-residue",
  title: "Template/placeholder residue",
  source: "tells catalogue §20",
  mechanism: "pattern",
  scope: "sentence",
  severity: "error",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    for (const prose of proseOf(segments)) {
      const codeSpans = findInlineCodeSpans(prose.text);

      for (const m of findPhraseMatches(prose.text, TEMPLATE_RESIDUE_ERROR_PHRASES)) {
        if (isInsideAny(m.start, codeSpans)) continue;
        const start = prose.start + m.start;
        const end = prose.start + m.end;
        findings.push({
          ruleId: "pat.template-residue",
          severity: "error",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${m.text}" is unresolved template residue -- evidence of an unreviewed paste.`,
          fix: "Resolve or remove before this ships.",
          confidence: 1.0,
        });
      }

      for (const re of TEMPLATE_RESIDUE_ERROR_RES) {
        const rr = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
        rr.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = rr.exec(prose.text)) !== null) {
          if (isInsideAny(m.index, codeSpans)) {
            if (m[0].length === 0) rr.lastIndex += 1;
            continue;
          }
          const start = prose.start + m.index;
          const end = start + m[0].length;
          findings.push({
            ruleId: "pat.template-residue",
            severity: "error",
            scope: "sentence",
            start,
            end,
            quote: input.text.slice(start, end),
            message: `"${m[0]}" is an unresolved placeholder -- evidence of an unreviewed paste.`,
            fix: "Resolve or remove before this ships.",
            confidence: 1.0,
          });
          if (m[0].length === 0) rr.lastIndex += 1;
        }
      }

      const gapRe = new RegExp(TEMPLATE_GAP_FLAG_RE.source, "g");
      let gm: RegExpExecArray | null;
      while ((gm = gapRe.exec(prose.text)) !== null) {
        if (isInsideAny(gm.index, codeSpans)) continue;
        const start = prose.start + gm.index;
        const end = start + gm[0].length;
        findings.push({
          ruleId: "pat.template-residue",
          severity: "info",
          scope: "sentence",
          start,
          end,
          quote: input.text.slice(start, end),
          message: `"${gm[0]}" is an unresolved gap-flag -- resolve before publish.`,
          fix: "Fill in the flagged gap (stat, source, example, etc.) before publishing.",
          confidence: 1.0,
        });
      }
    }
    return findings;
  },
};
