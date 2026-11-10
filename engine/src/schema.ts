export type Mechanism = "pattern" | "llm";
export type Scope = "sentence" | "paragraph" | "document";
export type Severity = "error" | "warn" | "info";

/** UI lane, derived: pattern → instant; llm+paragraph → on-pause; llm+document → on-demand audit. */
export type Lane = "instant" | "paused" | "audit";

export interface RuleMeta {
  /** Stable id: "pat.x-not-y-it-is-z", "llmp.generic-pain", "llmd.pain-pitch-arc". */
  id: string;
  title: string;
  /** Provenance, e.g. "doctrine §10.3", "bofu-editor dim 2". */
  source: string;
  mechanism: Mechanism;
  scope: Scope;
  severity: Severity;
  /** True if the rule reads ClientConfig/ArticleBrief (product name, ICP, banned framings…). */
  clientAware: boolean;
  /** Rule pack. "core" (default) always runs; "tpl-article" = house article-template
   *  conventions, opt-in per article. */
  pack?: "core" | "tpl-article";
  /** Editor UI review grouping. "core" = conversion/copywriting substance review
   *  (SERP intent, positioning, pain->pitch arc, the doctrine construction bans);
   *  "secondary" = mechanical hygiene (lexicons, formatting, density stats). Distinct
   *  from `pack`, which controls whether a rule RUNS -- this only controls which
   *  sidebar group a rule's findings land in. Usually left unset; see review-tier.ts
   *  for the derivation default and its two integrity-class overrides. */
  reviewTier?: "core" | "secondary";
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  scope: Scope;
  /** Absolute char offsets into the source markdown. For document-scope verdicts with no
   *  single anchor, use the span of the most representative quote. */
  start: number;
  end: number;
  /** Exact text at [start, end). LLM findings whose quote is not present verbatim are dropped. */
  quote: string;
  /** Why this is flagged — reader-facing, specific, no vague advice. */
  message: string;
  /** Fix direction (not an auto-rewrite). */
  fix?: string;
  /** 1.0 for exact patterns; <1 for heuristics; model-reported for LLM lanes. */
  confidence: number;
}

/** Client-level workspace assets. Populated from existing engine files (positioning brief, ICP, proof bank). */
export interface ClientConfig {
  name: string;
  /** Product name + aliases as they appear in prose ("Example Studio", "the platform"). */
  productAliases: string[];
  icp: string;
  positioning: string;
  differentiators: string[];
  competitors: string[];
  /** Verified first-party claims/data usable as evidence. Anything specific NOT traceable here is suspect. */
  proofBank: string[];
  /** Client-specific banned framings (e.g. Example Studio: "one-way video interview platform"). */
  bannedPhrases: string[];
  /** Positioning vocabulary that should carry the argument, if the client defines one. */
  requiredVocabulary?: string[];
  /** Canonical product feature names + paraphrases that must not replace them
   *  (e.g. canonical "scorecard", banned ["rating form"]). */
  featureGlossary?: { canonical: string; banned: string[] }[];
}

/** Per-article strategy context. */
export interface ArticleBrief {
  keyword: string;
  articleType: "category" | "alternatives" | "comparison" | "review" | "use-case" | "other";
  reader: string;
  angle: string;
  serpNotes?: string;
  /** GSC / research query families headers must cover (doctrine §10.11 amendment). */
  queryFamilies?: string[];
}

export interface CheckInput {
  /** Source markdown. All offsets refer to this string. */
  text: string;
  client?: ClientConfig;
  brief?: ArticleBrief;
}

export interface PatternRule extends RuleMeta {
  mechanism: "pattern";
  /** Runner segments the document once and hands the same segments to every rule. */
  check(input: CheckInput, segments: Segment[]): Finding[];
}

/** Segmentation units share the offset convention so every lane anchors identically. */
export interface Segment {
  kind: "paragraph" | "sentence" | "heading" | "listItem";
  start: number;
  end: number;
  text: string;
  /** Heading depth (1–6) when kind === "heading". */
  depth?: number;
}
/*
 * listItem semantics (added for Wave 2/3): a bullet/numbered line (-, *, +, or "1." marker,
 * with indented continuation lines) is emitted as a listItem segment INSTEAD of joining a
 * paragraph. Sentences are derived from paragraphs AND listItems, so sentence-scope rules
 * still see bullet text. Rules that mean "prose only" filter to kind === "paragraph".
 */

export function laneOf(rule: RuleMeta): Lane {
  if (rule.mechanism === "pattern") return "instant";
  return rule.scope === "document" ? "audit" : "paused";
}
