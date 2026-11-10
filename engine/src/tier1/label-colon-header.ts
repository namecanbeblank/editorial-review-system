import type { CheckInput, Finding, PatternRule, Segment } from "../schema.js";
import { headingsOf, wordCount } from "./util.js";
import {
  ABSTRACT_LABEL_RE,
  APPROVED_HEADER_LABELS,
  FAQ_ENDING_RE,
  LABEL_COLON_RE,
  NUMBERED_TOOL_ENTRY_RE,
  SUBTITLE_LABEL_Y_MAX_WORDS,
  SUBTITLE_LEADING_ARTICLE_RE,
} from "./lexicons.js";

/** The label text before the heading's first colon (empty string if there's no colon). */
function labelBeforeColon(headingText: string): string {
  const colonIndex = headingText.indexOf(":");
  if (colonIndex === -1) return "";
  return headingText.slice(0, colonIndex).trim();
}

/** The subtitle text after the heading's first colon (empty string if there's no colon). */
function subtitleAfterColon(headingText: string): string {
  const colonIndex = headingText.indexOf(":");
  if (colonIndex === -1) return "";
  return headingText.slice(colonIndex + 1).trim();
}

/**
 * Exact approved-label match (before the colon), the heading text ends in "FAQ(s)", or
 * -- RULED-3 R1, 2026-08-10 -- the heading is a numbered tool-entry ("1. Example Studio: best
 * for screening at scale").
 */
function isApprovedHeading(headingText: string): boolean {
  const label = labelBeforeColon(headingText).toLowerCase();
  if (APPROVED_HEADER_LABELS.includes(label)) return true;
  if (FAQ_ENDING_RE.test(headingText.trim())) return true;
  return NUMBERED_TOOL_ENTRY_RE.test(headingText);
}

/**
 * RULED-3 R2 (2026-08-10): is the post-colon subtitle "label-y" -- i.e. should THIS
 * heading flag? Begins with a/an/the, or is <=3 words. A subtitle carrying a claim
 * (no leading article, >3 words) is not label-y and passes.
 */
function hasLabelYSubtitle(headingText: string): boolean {
  const subtitle = subtitleAfterColon(headingText);
  if (SUBTITLE_LEADING_ARTICLE_RE.test(subtitle)) return true;
  return wordCount(subtitle) <= SUBTITLE_LABEL_Y_MAX_WORDS;
}

/**
 * RETUNED-2 scrape-artifact guard: a colon-header whose label is empty never flags.
 * Given segment.ts always trims heading text (no leading whitespace survives into
 * heading.text), this reduces to "heading text starts with ':'" -- and LABEL_COLON_RE's
 * own `{2,40}` minimum before the colon already can't match that shape, so this guard
 * is provably redundant with the current segmenter. Implemented anyway per the ruling:
 * it's cheap, it's exactly what was asked for, and it stops this rule depending on that
 * segmenter detail holding forever. See report.
 */
function hasEmptyColonLabel(headingText: string): boolean {
  const trimmed = headingText.trim();
  if (trimmed.startsWith(":")) return true;
  return trimmed.includes(":") && labelBeforeColon(headingText).length === 0;
}

/**
 * pat.label-colon-header (doctrine §10.11, HARD RULE)
 * Walks headings; each heading gets at most one finding (clause (a) colon label, then
 * clause (b) the narrow abstract-label template). Approved headers (FAQ family, "Best
 * for"/"Pricing", numbered tool-entries [R1], an empty colon-label, or -- F4, 2026-08-10
 * -- any depth-1 heading, since title grammar differs from body-heading grammar) are
 * skipped entirely, before either clause runs -- checked first so an approved heading
 * can never fall through into a clause it happens to also match. Same ordering
 * discipline as every prior ruling on this rule.
 *
 * RULED-3 R2 (2026-08-10): clause (a) no longer fires on every "Label: subtitle" shape
 * -- only when the subtitle itself is label-y (see hasLabelYSubtitle above). A
 * claim-carrying subtitle passes clause (a) entirely; it's NOT re-tested against clause
 * (b) either, since (b) is a completely different shape ("^The ... argument$" with no
 * colon) that a colon-header essentially can't also match.
 *
 * Confidence: (a) is a hard mechanical pattern (a literal colon plus the label-y
 * subtitle check), so it stays at the 1.0 default. (b) is confidence 0.9 (RETUNED-2,
 * 2026-08-10) -- the narrowed template is precise enough that the old 0.7
 * heuristic-hedge no longer applies.
 */
export const labelColonHeader: PatternRule = {
  id: "pat.label-colon-header",
  title: "Label-style or abstract heading",
  source: "doctrine §10.11 (HARD RULE)",
  mechanism: "pattern",
  scope: "document",
  severity: "error",
  clientAware: false,
  check(input: CheckInput, segments: Segment[]): Finding[] {
    const findings: Finding[] = [];
    for (const h of headingsOf(segments)) {
      if (h.depth === 1) continue;
      if (isApprovedHeading(h.text) || hasEmptyColonLabel(h.text)) continue;

      if (LABEL_COLON_RE.test(h.text) && hasLabelYSubtitle(h.text)) {
        findings.push({
          ruleId: "pat.label-colon-header",
          severity: "error",
          scope: "document",
          start: h.start,
          end: h.end,
          quote: input.text.slice(h.start, h.end),
          message: `"${h.text}" is a "Label: subtitle" header -- the subtitle doesn't tell a skimming reader what the section gives them. Headers must read as a claim or a query, never a label.`,
          fix: 'Rewrite as a question or a claim the section proves (e.g. "Why X isn\'t Y").',
          confidence: 1.0,
        });
        continue;
      }

      if (ABSTRACT_LABEL_RE.test(h.text)) {
        findings.push({
          ruleId: "pat.label-colon-header",
          severity: "error",
          scope: "document",
          start: h.start,
          end: h.end,
          quote: input.text.slice(h.start, h.end),
          message: `"${h.text}" is an abstract label header ("The X argument/problem/case/..."). Headers must read as a claim or a query.`,
          fix: "Rewrite as a question or a claim the section proves.",
          confidence: 0.9,
        });
      }
    }
    return findings;
  },
};
