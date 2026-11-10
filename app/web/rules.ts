/**
 * Rule-metadata lookup for the findings sidebar. `allRules` is a RUNTIME import (not
 * type-only) because we need the actual `.title` strings, not just their type; tier1 is
 * zero-dependency and browser-safe so this is a normal bundle import, same as
 * `runTier1` itself in Editor.tsx.
 */
import { allRules } from "../../engine/dist/tier1/index.js";
import { reviewTierOf } from "../../engine/dist/review-tier.js";
import type { RuleMeta } from "../../engine/dist/schema.js";

const RULES_BY_ID = new Map<string, RuleMeta>(allRules.map((rule) => [rule.id, rule]));

/** Rule title for a finding's ruleId, falling back to the raw id per spec ("rule title
 *  if available (else ruleId)") -- relevant once llmp and llmd findings exist and a
 *  ruleId might not resolve against tier1's own rule table. */
export function titleFor(ruleId: string): string {
  const coreLabels: Record<string, string> = {
    "llmp.generic-pain": "Generic pain point",
    "llmp.flat-value-prop": "Benefit without mechanism or differentiation",
    "llmp.feature-dump": "Feature without reader relevance",
  };
  if (coreLabels[ruleId]) return coreLabels[ruleId]!;
  return RULES_BY_ID.get(ruleId)?.title ?? ruleId.replace(/^llm[pd]\./, "").replace(/-/g, " ");
}

/** Sidebar grouping for a finding's ruleId. `RULES_BY_ID` only ever holds tier1 (pat.*)
 *  rules -- allRules is tier1's own table -- so an id absent from it is, by PLAN.md
 *  decision #7's id-family convention (`pat.*` / `llmp.*` / `llmd.*`), an llmp or llmd
 *  finding (Wave 2 wires the first of those in). Falling back to `mechanism: "pattern"`
 *  for those would wrongly sink every llmp/llmd finding into "secondary"; deriving
 *  mechanism from the id prefix instead lets reviewTierOf's own "llm" -> "core" default
 *  apply, same as it would if a real llmp/llmd RuleMeta were registered here. An id
 *  matching neither family (unlikely, but not impossible from a stale/renamed rule)
 *  still falls back to "pattern", matching the prior behavior for that case. */
export function reviewTierFor(ruleId: string): "core" | "secondary" {
  const rule = RULES_BY_ID.get(ruleId);
  if (rule) return reviewTierOf(rule);
  const mechanism: "pattern" | "llm" = isLlmFinding(ruleId) ? "llm" : "pattern";
  return reviewTierOf({ id: ruleId, mechanism });
}

/** True for an llmp/llmd ruleId (Finding carries no `mechanism` field of its own -- only
 *  RuleMeta does -- so the front end tells an LLM-lane finding apart from a pattern one
 *  by its id prefix, per PLAN.md decision #7). Used for the sidebar's "LLM" chip and by
 *  reviewTierFor's fallback above. */
export function isLlmFinding(ruleId: string): boolean {
  return ruleId.startsWith("llmp.") || ruleId.startsWith("llmd.");
}
