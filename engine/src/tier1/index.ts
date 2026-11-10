import type { CheckInput, Finding, PatternRule } from "../schema.js";
import { segmentDocument } from "../segment.js";

// ---- core 21-rule build --------------------------------------------------------
import { xNotYItIsZ, notJustXButY, contrastDefinition } from "./negation-contrast.js";
import { emDashAside, emDashDensity } from "./em-dash.js";
import { fillerLexicon } from "./filler-lexicon.js";
import { genericBenefit } from "./generic-benefit.js";
import { bannedOpener } from "./banned-opener.js";
import { weaselQualifier } from "./weasel-qualifier.js";
import { vaguePraise } from "./vague-praise.js";
import { formalConnective } from "./formal-connective.js";
import { labelColonHeader } from "./label-colon-header.js";
import { audienceMeta } from "./audience-meta.js";
import { uniformRhythm } from "./uniform-rhythm.js";
import { animateProduct } from "./animate-product.js";
import { testingClaimVerify } from "./testing-claim-verify.js";
import { unsourcedStat } from "./unsourced-stat.js";
import { clientBannedPhrases } from "./client-banned-phrases.js";
import { jumpLinkContract } from "./jump-link-contract.js";
import { edgingTells } from "./edging-tells.js";
import { contractionDeficit } from "./contraction-deficit.js";

// ---- Wave 2 --------------------------------------------------------------------
import { throatClearing } from "./throat-clearing.js";
import { structurePreview } from "./structure-preview.js";
import { solutionNoun } from "./solution-noun.js";
import { passiveByAgent } from "./passive-by-agent.js";
import { nominalization } from "./nominalization.js";
import { competitorDisparagement } from "./competitor-disparagement.js";
import { featureNameDrift } from "./feature-name-drift.js";
import { productNameParagraphOpener } from "./product-name-paragraph-opener.js";
import { titleConventions } from "./title-conventions.js";
import { paragraphLength } from "./paragraph-length.js";

// ---- Wave 3 ----------------------------------------------------------------------
// pat.competing-ctas KILLED 2026-08-10 (P3 eval: 0/4 sample precision, flagged vendor-
// pricing DESCRIPTIONS rather than article CTAs). Module and tests deleted; inventory.md
// keeps the rule's spec for a possible link-anchor-only rework later.
import { aiVocab, computeAiVocabDensityVerdict, WAVE_3_RULE_IDS } from "./ai-vocab.js";
import { significancePuffery } from "./significance-puffery.js";
import { vagueAttribution } from "./vague-attribution.js";
import { participialTail } from "./participial-tail.js";
import { assistantResidue } from "./assistant-residue.js";
import { templateResidue } from "./template-residue.js";
import { titleCaseHeadings } from "./title-case-headings.js";
import { boldLabelBullets } from "./bold-label-bullets.js";
import { emojiStructural } from "./emoji-structural.js";
import { unicodeResidue } from "./unicode-residue.js";
import { mediaPadding } from "./media-padding.js";
import { gapSpeculation } from "./gap-speculation.js";
import { challengesTemplate } from "./challenges-template.js";
import { triadFiller } from "./triad-filler.js";
import { falseRange } from "./false-range.js";
// pat.unknown-trademark-feature (P5.4, round-2 eval): the "Showcase(TM)" miss -- a
// trademark-styled feature name absent from the client's glossary. Registered in
// wave3Rules and WAVE_3_RULE_IDS (see ai-vocab.ts) per the inventory ruling.
import { unknownTrademarkFeature } from "./unknown-trademark-feature.js";

/** The core 21-rule build from rules/inventory.md's "Pattern lane" section. */
export const coreRules: PatternRule[] = [
  xNotYItIsZ,
  notJustXButY,
  contrastDefinition,
  emDashAside,
  emDashDensity,
  fillerLexicon,
  genericBenefit,
  bannedOpener,
  weaselQualifier,
  vaguePraise,
  formalConnective,
  labelColonHeader,
  audienceMeta,
  uniformRhythm,
  animateProduct,
  testingClaimVerify,
  unsourcedStat,
  clientBannedPhrases,
  jumpLinkContract,
  edgingTells,
  contractionDeficit,
];

/** The 10 "Wave 2 pattern rules". */
export const wave2Rules: PatternRule[] = [
  throatClearing,
  structurePreview,
  solutionNoun,
  passiveByAgent,
  nominalization,
  competitorDisparagement,
  featureNameDrift,
  productNameParagraphOpener,
  titleConventions,
  paragraphLength,
];

/** The Wave 3 pattern rules (AI-tell group), 16 after the pat.competing-ctas KILL and
 *  the P5.4 addition of pat.unknown-trademark-feature. */
export const wave3Rules: PatternRule[] = [
  aiVocab,
  significancePuffery,
  vagueAttribution,
  participialTail,
  assistantResidue,
  templateResidue,
  titleCaseHeadings,
  boldLabelBullets,
  emojiStructural,
  unicodeResidue,
  mediaPadding,
  gapSpeculation,
  challengesTemplate,
  triadFiller,
  falseRange,
  unknownTrademarkFeature,
];

/** All pat.* rules: core 21 + Wave 2 (10) + Wave 3 (16) = 47. */
export const allRules: PatternRule[] = [...coreRules, ...wave2Rules, ...wave3Rules];

/**
 * Non-"core" rule packs a caller can opt into. RuleMeta.pack is `"core" | "tpl-article"
 * | undefined` (schema.ts); "core" (or no pack at all) always runs, so the only thing
 * there IS to opt into today is "tpl-article". Kept as an array (not a single boolean)
 * so this doesn't need a shape change if the pack union grows later.
 */
export interface RunTier1Options {
  packs?: Array<"tpl-article">;
}

/**
 * Segments the document once and runs every ENABLED Tier 1 rule against the shared
 * segments. "core"-pack rules (the default for any rule with no `pack` set) always run;
 * a rule tagged with a non-core pack only runs when the caller opts that pack in via
 * `options.packs`. pat.paragraph-length is the first such rule (RECLASSIFIED to
 * "tpl-article" 2026-08-10, P3 eval -- its source is the rewriter TEMPLATE's own
 * paragraph-length convention, not core doctrine, so it shouldn't fire by default on
 * every draft). See paragraph-length.ts.
 *
 * pat.ai-vocab's document-level density verdict is a post-processing step, not part of
 * the normal per-rule loop: it counts findings across the whole Wave 3 group, which no
 * single PatternRule.check(input, segments) call can see (rules don't see each other's
 * output by design) -- see ai-vocab.ts. It only counts findings from rules that actually
 * ran (pack-filtered), which is the correct behavior: an opted-out pack's rules
 * shouldn't contribute to a density verdict either.
 */
export function runTier1(input: CheckInput, options: RunTier1Options = {}): Finding[] {
  const enabledPacks = new Set<string>(["core", ...(options.packs ?? [])]);
  const activeRules = allRules.filter((r) => enabledPacks.has(r.pack ?? "core"));

  const segments = segmentDocument(input.text);
  const findings: Finding[] = [];
  for (const rule of activeRules) {
    findings.push(...rule.check(input, segments));
  }
  findings.push(...computeAiVocabDensityVerdict(input, segments, findings));
  findings.sort((a, b) => a.start - b.start || a.end - b.end || a.ruleId.localeCompare(b.ruleId));
  return findings;
}

export {
  xNotYItIsZ,
  notJustXButY,
  contrastDefinition,
  emDashAside,
  emDashDensity,
  fillerLexicon,
  genericBenefit,
  bannedOpener,
  weaselQualifier,
  vaguePraise,
  formalConnective,
  labelColonHeader,
  audienceMeta,
  uniformRhythm,
  animateProduct,
  testingClaimVerify,
  unsourcedStat,
  clientBannedPhrases,
  jumpLinkContract,
  edgingTells,
  contractionDeficit,
  throatClearing,
  structurePreview,
  solutionNoun,
  passiveByAgent,
  nominalization,
  competitorDisparagement,
  featureNameDrift,
  productNameParagraphOpener,
  titleConventions,
  paragraphLength,
  aiVocab,
  computeAiVocabDensityVerdict,
  WAVE_3_RULE_IDS,
  significancePuffery,
  vagueAttribution,
  participialTail,
  assistantResidue,
  templateResidue,
  titleCaseHeadings,
  boldLabelBullets,
  emojiStructural,
  unicodeResidue,
  mediaPadding,
  gapSpeculation,
  challengesTemplate,
  triadFiller,
  falseRange,
  unknownTrademarkFeature,
};
