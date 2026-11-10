/**
 * Word/phrase lists and small standalone regexes for the pattern lane, kept separate
 * from rule logic (rules/inventory.md, "Word/phrase lists live in a data module") so
 * they're editable without touching detection code.
 *
 * Every list is the literal set named in rules/inventory.md -- no stemming/inflection
 * expansion beyond what's explicitly spelled out there. E.g. the filler lexicon lists
 * both "streamline" and "streamlined" but not "streamlining"/"streamlines": the
 * inventory author already chose which inflections to catch, so only those forms are
 * matched, word-boundary, case-insensitive, everywhere below unless noted otherwise.
 */

// ---- pat.filler-lexicon (core-voice §7 + bofu-editor dim 1) ----------------------

/**
 * Plain word/phrase matches, severity "error" (the whole list except "robust").
 * Includes the Wave-3-merge additions (comprehensive, intuitive, industry-leading,
 * world-class, state-of-the-art, unparalleled, renowned, nestled, vibrant,
 * utilize/utilizes/utilizing). "Utilized" (past tense) is deliberately NOT listed --
 * the inventory names only utilize/utilizes/utilizing, and per the file's own
 * exact-forms-only convention we don't extend it.
 *
 * "nestled" and "vibrant" carry a "(place-praise)" qualifier in the inventory, same
 * shape as "leverage (verb)"/"elevate (marketing sense)" -- but unlike those, a
 * reliable "is this describing a place" syntactic test doesn't exist (no adjacent
 * determiner/copula tell the way verb-sense does), and both words are rare enough in
 * B2B SaaS copy that a non-place use ("a vibrant company culture") is still filler-ish
 * praise worth flagging. Matched plainly rather than sense-restricted; see report.
 */
export const FILLER_ERROR_PHRASES: readonly string[] = [
  "seamless",
  "seamlessly",
  "empower",
  "unlock",
  "best-in-class",
  "game-changer",
  "game-changing",
  "cutting-edge",
  "synergy",
  "solutioning",
  "revolutionize",
  "revolutionary",
  "supercharge",
  "streamline",
  "streamlined",
  "comprehensive",
  "intuitive",
  "industry-leading",
  "world-class",
  "state-of-the-art",
  "unparalleled",
  "renowned",
  "nestled",
  "vibrant",
  "utilize",
  "utilizes",
  "utilizing",
];

/** The one entry the inventory downgrades: "robust" stays in the lexicon but at warn. */
export const FILLER_WARN_PHRASES: readonly string[] = ["robust"];

/**
 * "leverage" and "elevate" both carry a sense qualifier in the inventory
 * ("leverage (verb)", "elevate (marketing sense)") because each has a legitimate
 * non-filler sense (leverage-the-noun; elevate-physically/medically). There's no POS
 * tagger here, so both are matched only in the marketing-verb shape
 * "{word} your/our/the/... {noun}" -- the dominant real-world pattern for the filler
 * use, and a narrow, low-false-positive proxy for "used as a verb, marketing sense".
 * See final report for the tradeoff (this narrows recall on bare "Leverage AI to...").
 */
export const FILLER_VERB_SENSE_WORDS: readonly string[] = ["leverage", "elevate"];
export const FILLER_VERB_SENSE_DETERMINERS: readonly string[] = [
  "your",
  "our",
  "its",
  "their",
  "this",
  "these",
  "those",
  "the",
  "a",
  "an",
];

/**
 * "powerful (product-praise sense)" -- same no-POS-tagger problem as leverage/elevate,
 * but the disambiguating context sits BEFORE the word (a copula/article), not after:
 * "is/are/a/an powerful" is the classic product-praise shape ("Example Studio is powerful",
 * "a powerful platform"). Other senses ("a powerful argument", "powerful emotions")
 * don't reliably share that immediate-preceding shape, so this stays narrow by design.
 */
export const POWERFUL_PRODUCT_PRAISE_RE = /\b(is|are|a|an)\s+powerful\b/i;

// ---- pat.generic-benefit (bofu-editor dim 2) --------------------------------------

export const GENERIC_BENEFIT_PHRASES: readonly string[] = [
  "manage labor costs",
  "streamline operations",
  "maximize profitability",
  "improve efficiency",
  "boost productivity",
  "save time and money",
  "seamless supply chain",
  "focus on what matters",
  "work smarter, not harder",
];

/** "take your X to the next level" -- X is a free slot in the inventory's own example. */
export const TAKE_TO_NEXT_LEVEL_RE = /\btake your [^.!?,]{1,40} to the next level\b/i;

// ---- pat.banned-opener (bofu-editor dim 1 + doctrine §10.1) -----------------------

export const BANNED_OPENER_PHRASES: readonly string[] = [
  "in today's fast-paced",
  "in today's world",
  "in today's competitive",
  "in today's fast-paced business environment",
  "in the modern workplace",
  "more than ever, companies",
  "it's no secret that",
  "are you ready to",
  "are you looking to",
  "picture the moment",
  "picture this",
  "imagine you're",
  "imagine a world",
  "it's monday morning",
];

/** Applied per-sentence, so `^` already anchors to the sentence start (no /m needed). */
export const EFFECTIVE_X_IS_CRITICAL_RE =
  /^Effective [^.!?]{3,50} is (critical|essential|crucial)/i;

/** Applied per-sentence, same anchoring convention as EFFECTIVE_X_IS_CRITICAL_RE. */
export const AS_A_YOU_KNOW_RE = /^As an? [^,]{2,40}, you know\b/i;

/**
 * Paragraph-opener specifically (per the inventory's own label) -- applied to the start
 * of a PARAGRAPH, not any sentence, so a mid-paragraph "You've spent..." doesn't count.
 * Confidence 0.8, as stated for this specific regex.
 */
export const YOUVE_SPENT_PARAGRAPH_RE = /^You've (spent|just finished|been)\b/i;

// ---- pat.weasel-qualifier (core-voice §6) -----------------------------------------

export const WEASEL_MODAL_RE = /\b(may|might|could|can) (potentially|possibly|conceivably)\b/i;
export const WEASEL_PHRASES: readonly string[] = ["has the potential to"];

// ---- pat.vague-praise (core-voice §6) ---------------------------------------------

export const VAGUE_PRAISE_PHRASES: readonly string[] = [
  "significantly",
  "dramatically",
  "substantially",
  "drastically",
  "exponentially",
  "a lot faster",
  "much better",
];

// ---- pat.formal-connective (core-voice §2) ----------------------------------------

/**
 * Sentence-initial only; applied per-sentence text so `^` anchors correctly. Includes
 * the summary-opener family (In summary/In conclusion/Overall/Ultimately) -- restating
 * what was just said, same formality problem as the original connective list.
 */
export const FORMAL_CONNECTIVE_RE =
  /^(Furthermore|Moreover|In addition|Additionally|Consequently|Thus|In summary|In conclusion|Overall|Ultimately),/;

// ---- pat.audience-meta (doctrine §10.10) ------------------------------------------

export const AUDIENCE_META_PHRASES: readonly string[] = [
  "this guide is written for",
  "this article is for",
  "this post is for",
  "this isn't for you",
  "if you're a candidate, this",
  "we wrote this for",
];

export const WHETHER_YOURE_RE = /\bwhether you'?re an? [^,]{2,30},? or an? /i;

// ---- pat.animate-product (house rule, 2026-08-09 + core-voice §8 anti-hype) -----

export const ANIMATE_PRODUCT_VERBS: readonly string[] = [
  "believes",
  "thinks",
  "wants",
  "loves",
  "hopes",
  "cares about",
  "is passionate about",
  "is committed to",
  "is on a mission",
  "understands your",
];

// ---- pat.testing-claim-verify (core-voice §4) -------------------------------------

export const TESTING_CLAIM_PHRASES: readonly string[] = [
  "I tested",
  "I tried",
  "when I tried",
  "we tested",
  "put it through its paces",
  "hands-on with",
  "in my testing",
];

// ---- pat.unsourced-stat (core-voice §4 anti-fabrication) --------------------------

export const STAT_PERCENT_RE = /\b\d+(\.\d+)?%/;
export const STAT_OUT_OF_RE = /\b\d+ (out of|in) \d+\b/i;
export const SOURCE_MARKER_RE =
  /(according to|source|report|study|survey|research|our data|data from|\[|\()/i;

/** T6 (2026-08-10, P3 eval): a hypothetical frame -- sentence OR its paragraph opens
 *  with one of these -- doesn't need a source; it's explicitly not a factual claim. */
export const HYPOTHETICAL_OPENER_RE = /^(Say|Suppose|Imagine a|For example)\b/i;

/** T7 (2026-08-10, P3 eval): "N out of 5/10" is the common rating-scale idiom, not an
 *  unsourced statistic -- exempted specifically (not "N out of <anything>"). */
export const RATING_SCALE_RE = /\b\d+ out of (5|10)\b/i;

// ---- pat.edging-tells (doctrine §10.3/§10.13) -------------------------------------

/**
 * Literal phrases only -- deliberately NOT a generic "that's where ... comes in"
 * pattern, so "That's where Example Studio comes in" (the endorsed pitch transition the
 * inventory explicitly excludes) never matches in the first place.
 */
export const EDGING_TELLS_PHRASES: readonly string[] = [
  "that's where things get interesting",
  "here's where it gets interesting",
  "here's the kicker",
  "here's the thing",
  "is where the difference is",
  "than you'd think",
  "than you might expect",
  "but that's not the whole story",
];

// ---- pat.contraction-deficit (core-voice §2) --------------------------------------

export interface ContractionPair {
  long: string;
  contraction: string;
}

/** Standard, unambiguous contraction for each long form the inventory names. */
export const CONTRACTION_PAIRS: readonly ContractionPair[] = [
  { long: "do not", contraction: "don't" },
  { long: "does not", contraction: "doesn't" },
  { long: "it is", contraction: "it's" },
  { long: "you will", contraction: "you'll" },
  { long: "cannot", contraction: "can't" },
  { long: "there is", contraction: "there's" },
  { long: "we are", contraction: "we're" },
];

/**
 * F6 (2026-08-10, P3 eval): "it is"/"that is" specifically -- not the other five pairs
 * -- get a clause-final guard. A stranded copula at the end of a clause ("...what it
 * is.") can't grammatically contract ("...what it's." is ungrammatical), so counting it
 * as an avoidable long-form overstated the deficit. "Followed by punctuation or a
 * conjunction" is the operational definition of "clause-final" here.
 */
export const CLAUSE_FINAL_GUARDED_LONG_FORMS: readonly string[] = ["it is", "that is"];
export const CLAUSE_FINAL_FOLLOW_RE =
  /^\s*(?:[.,;:!?]|and\b|but\b|or\b|nor\b|so\b|yet\b|because\b|since\b|while\b|though\b|although\b|if\b|unless\b)/i;

// ---- pat.label-colon-header (doctrine §10.11, HARD RULE) --------------------------

export const LABEL_COLON_RE = /^[^:\n]{2,40}: .+$/;

/**
 * RETUNED-2 (2026-08-10, clean-corpus + example data): clause (b) narrowed to ONLY this
 * template. The old ≤4-word/no-verb heuristic (and its signal-word list) is deleted
 * entirely -- it false-positived at scale on imperative CTA headings ("Speak to an
 * expert", 156x), step furniture ("Step 1..5", ~220x), and short named-entity headings
 * ("ROI calculator"), because its verb check missed imperatives. Confidence for a match
 * against this template rises to 0.9 (the template itself is precise; nothing left to
 * hedge against). Adds "paradox"/"gap" to the tail alternation and widens the middle
 * from a single lowercase word (`[a-z]+`) to any 2-40 chars, per the updated inventory.
 */
export const ABSTRACT_LABEL_RE =
  /^The .{2,40} (argument|problem|case|question|point|principle|paradox|gap)$/i;

/**
 * Approved listicle tool-entry colon-labels: exempt from clause (a) regardless of
 * heading depth. Case-insensitive match of the label text BEFORE the colon.
 * RULED (2026-08-10): "best for", "pricing". RETUNED-2 (2026-08-10) adds the FAQ family
 * -- "faq", "faqs", "frequently asked questions" -- approval derived from doctrine
 * §10.12 itself, which places commodity content in FAQ sections. Extensible only by
 * explicit ruling -- "Pros"/"Cons"/"Key features" etc. are NOT yet ruled and must keep
 * flagging until a follow-up ruling adds them.
 */
export const APPROVED_HEADER_LABELS: readonly string[] = [
  "best for",
  "pricing",
  "faq",
  "faqs",
  "frequently asked questions",
];

/**
 * RETUNED-2 (2026-08-10): a heading whose text ENDS in "FAQ"/"FAQs" is exempt too, not
 * just an exact pre-colon label match -- catches headings like "Asynchronous interview
 * FAQs" where "FAQ(s)" is the tail of a longer heading rather than the whole label.
 */
export const FAQ_ENDING_RE = /\bFAQs?$/i;

/**
 * RULED-3 R1 (2026-08-10, delegated -- "trust your instinct"): numbered
 * tool-entry colon headings are APPROVED -- the "N. Name: claim" listicle entry shape
 * ("1. Example Studio: best for screening at scale"). Exact regex as given in the ruling.
 */
export const NUMBERED_TOOL_ENTRY_RE = /^\d+\.\s+.+:/;

/**
 * RULED-3 R2 (2026-08-10): the colon-form clause narrows to the LABEL-y case only.
 * A post-colon subtitle is "label-y" (flag) when it begins with a/an/the OR is <=3
 * words; a subtitle carrying a claim (no leading article, >3 words) passes. Doctrine
 * §10.11's own skim test is the rationale -- a recruiter skimming "Culture fit vs
 * culture add: assess contribution, not sameness" already knows what the section gives
 * them, which "Async screening: a primer" never tells them at all.
 */
export const SUBTITLE_LEADING_ARTICLE_RE = /^(a|an|the)\b/i;
export const SUBTITLE_LABEL_Y_MAX_WORDS = 3;

// ---- pat.jump-link-contract (doctrine §10.14) -------------------------------------

export const TITLE_PROMISES_N_RES: readonly RegExp[] = [
  /^\d+ /,
  /\b(top|best) \d+\b/i,
  /\b\d+ (best|top|tools|platforms|alternatives|ways)\b/i,
];
export const JUMP_LINK_MARKER = "](#";
export const JUMP_LINK_MIN_COUNT = 3;

// ==== Wave 2 pattern rules (rules/inventory.md, "Wave 2 pattern rules") ============

// ---- pat.throat-clearing (rewriter phrase bans) -----------------------------------

export const THROAT_CLEARING_PHRASES: readonly string[] = [
  "it's worth noting that",
  "it is worth noting",
  "at the end of the day",
  "it goes without saying",
  "it's important to note",
  "it is important to note",
  "it's worth mentioning",
  "it should be noted",
];

// ---- pat.structure-preview (positioning skill hook criteria) ----------------------

export const STRUCTURE_PREVIEW_PHRASES: readonly string[] = [
  "in this post, we'll",
  "in this article, we'll",
  "this article will cover",
  "we'll cover",
  "this post covers",
  "below, we'll walk",
];

// ---- pat.solution-noun (rewriter) --------------------------------------------------

/**
 * Exact regex as given in the inventory, plus T8 (2026-08-10, P3 eval): also skip
 * "solution(s) you/we/they [verb]" ("the solution you choose") -- an abstract-sense
 * relative clause, not the standalone-product-noun usage this rule targets.
 */
export const SOLUTION_NOUN_RE =
  /\b(a|an|the|our|this|your) solutions?\b(?!\s+to\b)(?!\s+(?:you|we|they)\s+\w)/i;

// ---- pat.passive-by-agent (rewriter) -----------------------------------------------

/**
 * Exact regex as given in the inventory (updated 2026-08-09: one optional -ly adverb
 * allowed between the participle and "by" -- the source skill's own example is "Data is
 * entered manually by the team", which needs the gap to match at all). Passive WITH an
 * explicit agent only.
 * F2 (2026-08-10, P3 eval): "being" dropped from the auxiliary list -- FP class was
 * research-condition passives ("candidates dislike being evaluated by an algorithm"),
 * describing a condition rather than a sentence that should be rewritten active.
 */
export const PASSIVE_BY_AGENT_RE =
  /\b(is|are|was|were|been|be) \w+(ed|en)( \w+ly)? by (the|a|an|your|our)\b/i;

// ---- pat.nominalization (rewriter) -------------------------------------------------

/** Exact regex as given in the inventory. */
export const NOMINALIZATION_RE =
  /\bthe (elimination|reduction|creation|implementation|optimization|utilization|automation|facilitation|simplification) of\b/i;

// ---- pat.competitor-disparagement (rewriter, client-aware) ------------------------

export const COMPETITOR_DISPARAGEMENT_PHRASES: readonly string[] = [
  "falls short of",
  "lacks the depth of",
  "only offers basic",
];

// ---- pat.paragraph-length (rewriter) -----------------------------------------------

export const PARAGRAPH_LENGTH_MAX_SENTENCES = 4;

// ---- pat.product-name-paragraph-opener (rewriter, client-aware) --------------------

/**
 * F3 (2026-08-10, P3 eval): a paragraph containing one of these honest-disclosure
 * phrases is skipped -- FP class was disclosure paragraphs ("Example Studio is ours, so take
 * this section with that in mind...") where opening with the product name is the
 * point, not an accident of drafting.
 */
export const PRODUCT_DISCLOSURE_PHRASES: readonly string[] = [
  "is ours",
  "is our product",
  "our product",
];
