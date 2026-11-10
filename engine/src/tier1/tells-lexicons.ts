/**
 * Word/phrase lists and regexes for the Wave 3 ("AI-tell") pattern group, in the same
 * data-module-separate-from-logic spirit as lexicons.ts. Content is copied in (per
 * rules/inventory.md's own instruction for this group) from the house tells-catalogue
 * reference material -- never read at runtime, no path to it recorded anywhere in this
 * repo. Every list below is attributed only to rules/inventory.md's own section
 * references ("tells catalogue §N"), never to any third party or person, per the
 * attribution policy in PLAN.md.
 */

// ---- pat.ai-vocab (tells catalogue §13) -------------------------------------------

/**
 * Era-clustered AI vocabulary, merged from the inventory's own seed list (port the full
 * catalogue list, per its own instruction) with the fuller reference lexicon. Where the
 * two disagreed on inflection (e.g. inventory names "underscore(s/d)" specifically,
 * including the past tense) the union of both is kept.
 */
export const AI_VOCAB_LEXICON: readonly string[] = [
  // core 2023-mid2024 cluster
  "delve",
  "delves",
  "delving",
  "tapestry",
  "intricate",
  "intricacies",
  "meticulous",
  "meticulously",
  "interplay",
  "garner",
  "garnered",
  "bolstered",
  "boasts",
  "testament",
  "testament to",
  "vibrant",
  "enduring",
  "pivotal",
  "underscore",
  "underscores",
  "underscored",
  "underscoring",
  "valuable",
  "invaluable",
  "crucial",
  "vital",
  // mid2024-mid2025 cluster
  "align with",
  "aligns with",
  "fostering",
  "foster",
  "enhance",
  "enhances",
  "enhancing",
  "showcasing",
  "showcase",
  "showcases",
  "highlighting",
  "emphasizing",
  "seamless",
  "robust",
  "leverage",
  "leveraging",
  "landscape",
  "realm",
  "myriad",
  "navigate",
  "navigating",
  // mid2025-on cluster
  "independent coverage",
  "profiled in",
  "featured in",
  "active social media presence",
  "digital presence",
  "leading expert",
  "prominent media",
  "media outlets",
  // inventory seed entries not otherwise covered above
  "ever-evolving",
  "in the world of",
  "holistic",
  "multifaceted",
];

// ---- pat.significance-puffery (tells catalogue §1) --------------------------------

/** Exact, complete list as given in the inventory (not the broader catalogue list --
 *  no "port the full list" instruction for this rule). */
export const SIGNIFICANCE_PUFFERY_PHRASES: readonly string[] = [
  "marking a pivotal moment",
  "a turning point in",
  "solidified its place",
  "cemented its",
  "testament to",
  "plays a vital role",
  "plays a crucial role",
  "rich history",
  "rich cultural heritage",
];

// ---- pat.vague-attribution (tells catalogue §2) -----------------------------------

export const VAGUE_ATTRIBUTION_PHRASES: readonly string[] = [
  "experts argue",
  "experts agree",
  "studies show",
  "research shows",
  "research suggests",
  "widely regarded as",
  "is considered by many",
  "has been described as",
];

/** A named, dated source ("a 2024 Gartner survey shows...") suppresses the flag. A bare
 *  4-digit year is used as the practical "this is dated/attributed" proxy -- named
 *  sources in this kind of copy are almost always accompanied by a year. */
export const YEAR_RE = /\b(19|20)\d{2}\b/;

// ---- pat.participial-tail (tells catalogue §3/§14) --------------------------------

/** Exact regex as given in the inventory. */
export const PARTICIPIAL_TAIL_RE =
  /,\s(contributing|highlighting|underscoring|reflecting|showcasing|demonstrating|emphasizing|solidifying|cementing|signaling|marking)\b[^.!?]{0,80}[.!?]/i;

// ---- pat.assistant-residue (tells catalogue §15/§23) ------------------------------

/**
 * RETUNED (2026-08-10, from P3 eval): "feel free to" and "Let me know if" removed --
 * 86 hits on live human-written pages ("feel free to contact us" is normal web copy,
 * not assistant residue).
 * F8 (2026-08-10, P3 eval): "Great question" removed from this plain phrase list too --
 * FP class was noun-phrase usage ("A great question paired with the right follow-up
 * can reveal a lot"), not the operator-directed exclamation. It's matched separately
 * below, anchored to sentence-start + terminal punctuation only.
 */
export const ASSISTANT_RESIDUE_PHRASES: readonly string[] = [
  "As an AI language model",
  "I hope this helps",
  "I hope this finds you well",
  "Certainly!",
  "Best regards",
];

/** "Great question" as its own standalone sentence -- the direct-response exclamation,
 *  not a noun phrase embedded in a longer sentence. */
export const GREAT_QUESTION_RE = /^Great question[.!]$/i;

// ---- pat.template-residue (tells catalogue §20) -----------------------------------

export const TEMPLATE_RESIDUE_ERROR_PHRASES: readonly string[] = ["lorem ipsum"];
export const TEMPLATE_RESIDUE_ERROR_RES: readonly RegExp[] = [
  /\[Insert[^\]\n]{0,60}\]?/i,
  /\[Company Name\]/i,
  /\[Year\]/i,
  /\[X\]/,
];

/** House gap-flags -- info, never error (anti-fabrication workflow, not unreviewed paste). */
export const TEMPLATE_GAP_FLAG_RE =
  /\[(STAT|SOURCE|CLIENT EXAMPLE|ADD EXAMPLE|SCREENSHOT|RESULT|COINED-TERM CHECK):[^\]\n]*\]/;

// ---- pat.title-case-headings (tells catalogue §18) --------------------------------

/** Small words excluded from the "is this word capitalized" count, so e.g. "Why the
 *  Case for Async Screening Fails" doesn't get penalized for a lowercase "the"/"for". */
export const TITLE_CASE_SMALL_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "from",
  "in",
  "into",
  "nor",
  "of",
  "on",
  "onto",
  "or",
  "over",
  "the",
  "to",
  "up",
  "via",
  "with",
]);

// ---- pat.bold-label-bullets (tells catalogue §17) ---------------------------------

/**
 * "**Label:** rest of the sentence" at the start of a list item -- both colon
 * placements count (ruled 2026-08-09: sources disagree on whether the colon sits
 * inside the bold markup, `**Label:**`, or outside it, `**Label**:`, and both shapes
 * occur in the wild).
 */
export const BOLD_LEADIN_RE = /^\*\*([^*\n]{2,58})(?::\*\*|\*\*:)/;
/** Any bolded span, for the doc-stat (same term bolded on every occurrence) sweep. */
export const BOLD_SPAN_RE = /\*\*([^*\n]{1,40})\*\*/g;

/**
 * RETUNED (2026-08-10, from P3 eval -- the house template legitimately prescribes
 * bold-label criteria bullets, so the shape alone isn't the tell): the lead-in only
 * flags when the text after the colon RESTATES the label -- >= this fraction of the
 * label's content words (length >= LEAD_IN_CONTENT_WORD_MIN_LENGTH) recur afterward.
 * "Recur" is a stem-prefix match (first LEAD_IN_STEM_PREFIX_LENGTH chars, lowercased),
 * not an exact-word match: the inventory's own restating example pairs "scheduling"
 * with "schedule" and "automated" with "automatically", different inflections of the
 * same word that an exact match would miss entirely.
 */
export const LEAD_IN_CONTENT_WORD_MIN_LENGTH = 4;
export const LEAD_IN_STEM_PREFIX_LENGTH = 5;
export const LEAD_IN_RESTATEMENT_THRESHOLD = 0.5;
/**
 * F1b (2026-08-10, P3 eval): restatement ALSO needs at least this many distinct
 * recurring content words, on top of the ratio threshold above -- a 2-word label with
 * one incidental topic-word overlap ("scale" in "Response scale:" recurring inside
 * "...on a Likert scale") already clears 50% on its own, which read as restatement when
 * it was really just topical continuity. Requiring >=2 recurring words means a single
 * shared word is never enough by itself.
 */
export const LEAD_IN_MIN_RECURRING_WORDS = 2;

/**
 * F1a (2026-08-10, P3 eval): these bolded labels are the house template's own
 * prescribed criteria-bullet furniture (Key features / Pros / Cons / Best for /
 * Pricing) -- exempt from the doc-stat ("same term bolded on every occurrence") half
 * of this rule specifically, regardless of the lead-in/restatement check above.
 */
export const BOLD_LABEL_DOC_STAT_EXEMPT_TERMS: readonly string[] = [
  "key features",
  "pros",
  "cons",
  "best for",
  "pricing",
];

// ---- pat.emoji-structural (tells catalogue §21) -----------------------------------

/** Common emoji blocks (not walking the full Unicode emoji-data table, which is
 *  overkill for "does this heading/bullet start with an emoji"). Requires the `u` flag
 *  for the astral-plane ranges. */
export const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}]/u;

// ---- pat.unicode-residue (tells catalogue §19) ------------------------------------

export const CURLY_QUOTE_CHARS = "‘’“”";
export const NBSP = " ";

// ---- pat.media-padding (tells catalogue §4) ---------------------------------------

export const MEDIA_PADDING_PHRASES: readonly string[] = [
  "has been featured in",
  "and other prominent media outlets",
  "and other prominent outlets",
];

// ---- pat.gap-speculation (tells catalogue §6) -------------------------------------

export const GAP_DISCLOSURE_PHRASES: readonly string[] = [
  "specific details are unavailable",
  "little is known about",
];
export const SPECULATION_PHRASES: readonly string[] = ["it is likely that", "presumably"];

// ---- pat.challenges-template (tells catalogue §12) --------------------------------

/** Exact regex as given in the inventory. */
export const CHALLENGES_RE =
  /Despite (its|their) [^,]{3,50}, [^.]{0,80}(faces?|encounters?) (several )?challenges/i;
export const VAGUE_OPTIMISM_PHRASES: readonly string[] = [
  "continues to thrive",
  "poised for",
  "the future looks bright",
  "ongoing initiatives",
];

// ---- pat.triad-filler (tells catalogue §9) ----------------------------------------

/** Comma-triad shape, adapted from the reference scanner: three tokens (optionally
 *  "-ly" adverbs), "X, Y(,) and Z". */
export const TRIAD_RE = /\b(\w+(?:ly)?),\s+(\w+(?:ly)?),?\s+and\s+(\w+(?:ly)?)\b/g;

// ---- pat.false-range (tells catalogue §10) ----------------------------------------

/** "from X to Y", stopping at the next clause boundary -- adapted from the reference
 *  scanner. High-FP heuristic by design (info severity, confidence 0.6). */
export const FALSE_RANGE_RE =
  /\bfrom\s+([\w\s'-]{2,45}?)\s+to\s+([\w\s'-]{2,45}?)(?=[,.;:]|\s+and\s|\s*$)/gim;
