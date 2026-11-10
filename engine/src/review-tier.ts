import type { RuleMeta } from "./schema.js";

/**
 * Integrity-class overrides (design note 2026-08-10; PLAN.md P6): these two
 * pattern rules check factual/claim integrity rather than mechanical hygiene, so they
 * belong in the "core" review group despite being `mechanism: "pattern"`. Exported so
 * the UI (or anything else) can display the override list without re-deriving it.
 */
export const REVIEW_TIER_OVERRIDES: Record<string, "core" | "secondary"> = {
  "pat.unknown-trademark-feature": "core",
  "pat.unsourced-stat": "core",
};

/**
 * Derives which editor sidebar group a rule's findings belong in.
 * Precedence: an explicit `rule.reviewTier` always wins; otherwise an id listed in
 * REVIEW_TIER_OVERRIDES wins; otherwise it falls out of `mechanism` -- "llm" (covers
 * both the llmp and llmd lanes; schema.ts's Mechanism type has no separate paragraph
 * vs document split at the mechanism level, scope carries that) -> "core", "pattern"
 * -> "secondary".
 */
export function reviewTierOf(
  rule: Pick<RuleMeta, "id" | "mechanism" | "reviewTier">,
): "core" | "secondary" {
  if (rule.reviewTier) return rule.reviewTier;
  const override = REVIEW_TIER_OVERRIDES[rule.id];
  if (override) return override;
  return rule.mechanism === "llm" ? "core" : "secondary";
}
