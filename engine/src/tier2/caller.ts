import type { CheckInput, ClientConfig, Finding, Segment, Severity } from "../schema.js";
import { segmentDocument } from "../segment.js";
import { reviewTargets } from "../review-targets.js";
import {
  PANELS,
  SHARED_FRAME,
  TITLE_PANEL,
  panelOutputSchema,
  type PanelSpec,
} from "./prompts.js";
import {
  defaultClient,
  type AnthropicMessagesClient,
  type CreateMessageParams,
  type CreateMessageResult,
  type OutputConfig,
  type SystemBlock,
  type ThinkingConfig,
  type UserMessage,
} from "../llm-client.js";
import { APPROVED_HEADER_LABELS, FAQ_ENDING_RE } from "../tier1/lexicons.js";

/**
 * Tier 2 (llmp) caller -- paragraph-scope LLM checks via Claude Haiku. Node-side only (the
 * SDK is a runtime dep of this module and tier3/caller.ts ONLY; tier1/segment.ts stay
 * zero-dep and browser-safe -- see PLAN.md P5 and the report accompanying this change).
 * (This module DOES import from tier1/lexicons.ts for the FAQ-span check below -- that's
 * the allowed direction: tier2 -> tier1 is fine, tier1 -> tier2/3/SDK is what's banned.)
 *
 * One call per paragraph segment per panel (3 panels x N paragraphs), plus one extra call
 * against the document's H1 (if one exists) using TITLE_PANEL exclusively (P5.3 E1 --
 * previously the H1 pass reused the "conversion" panel; llmp.title-check now lives ONLY
 * in TITLE_PANEL, imported from prompts.ts, and no body panel's ruleIds contain it, so
 * title-check is impossible on a body paragraph at the schema level, not just by
 * construction here).
 *
 * P5.2: the request-building, job-enumeration, response-parsing, and quote-gate/severity
 * pieces below are exported as pure functions so eval/llm-batch.mjs (P5.2 batch submit)
 * and eval/llm-batch-collect.mjs (P5.2 batch collect) can reuse EXACTLY what the live
 * path uses, rather than re-deriving paragraph/panel enumeration or gating logic a
 * second time and risking the two paths drifting apart. `runTier2` itself is now a thin
 * orchestrator over these exports -- no behavior change from the pre-P5.2 version.
 *
 * P5.3: precision fixes driven by the P5.2 batch-eval judging pass (llmp sample precision
 * 4.8%, systematic failure classes) -- see each numbered comment below (E1-E6, E8; E7 is
 * tier3-only, see tier3/caller.ts).
 *
 * P5.4: round-2 eval fixes -- structural (config-free) competitor-span detection widened
 * to 7 suppressed rules (see COMPETITOR_SPAN_RULES), and a per-panel model split
 * (PANEL_MODEL_CONFIG) replacing the old single MODEL/MAX_TOKENS constants.
 */

const DEFAULT_CONCURRENCY = 4;

/**
 * Per-panel model assignment (rules/inventory.md "Per-panel model assignment", ruled
 * 2026-08-11): conversion/prose/title run on Sonnet 5 -- round-2 judging showed Haiku
 * not applying explicit scope instructions (0/6 precision on five rules with the
 * disqualifying evidence inside the quoted span). integrity joined them after round-3
 * judging (ruled 2026-08-30): Haiku's integrity findings were 0-for-8 clean TPs, with
 * mechanical misses -- it flagged the prompt's own approved example phrase, a stat
 * adjacent to a [VERIFY] gap-flag, and a cited statistic, and misread the
 * claim-no-caveat subject-scope test. All four panels now share the Sonnet config.
 *
 * Sonnet 5 runs adaptive thinking BY DEFAULT and thinking shares max_tokens with the
 * response -- on a ~1024-token call the structured-output JSON would truncate silently
 * (the exact bug already hit once on tier3; see tier3/caller.ts's MAX_TOKENS comment).
 * Every Sonnet entry therefore disables thinking explicitly, sets effort "low", and
 * gives max_tokens more headroom (1500). Sonnet 5 rejects temperature/top_p/top_k
 * outright -- CreateMessageParams has no field for them at all, so there's nothing to
 * accidentally send.
 *
 * Exported as ONE per-panel map, keyed by PanelSpec.id, so the live caller (runTier2)
 * and the batch builder (eval/llm-batch.mjs) both read the same model/max_tokens/
 * thinking/effort values instead of each hardcoding them a second time -- the P5.3
 * lesson (a duplicated "16000" or "1024" is exactly how a silent-truncation bug
 * reappears) applies here just as much as it did to buildJobs/gatePanelFindings.
 */
export interface PanelModelConfig {
  model: string;
  max_tokens: number;
  thinking?: ThinkingConfig;
  output_config?: Pick<OutputConfig, "effort">;
}

export const PANEL_MODEL_CONFIG: Record<string, PanelModelConfig> = {
  conversion: {
    model: "claude-sonnet-5",
    max_tokens: 1500,
    thinking: { type: "disabled" },
    output_config: { effort: "low" },
  },
  prose: {
    model: "claude-sonnet-5",
    max_tokens: 1500,
    thinking: { type: "disabled" },
    output_config: { effort: "low" },
  },
  title: {
    model: "claude-sonnet-5",
    max_tokens: 1500,
    thinking: { type: "disabled" },
    output_config: { effort: "low" },
  },
  integrity: {
    model: "claude-sonnet-5",
    max_tokens: 1500,
    thinking: { type: "disabled" },
    output_config: { effort: "low" },
  },
};

/** E6: confidence floor. A finding below this is dropped (and counted as a drop) before
 *  any other gate runs -- eval-observed low-confidence findings were disproportionately
 *  false positives. */
export const MIN_CONFIDENCE = 0.7;

/** Severity-by-ruleId, exactly as specified for the 13 llmp rules across all three panels
 *  plus TITLE_PANEL's llmp.title-check. */
const RULE_SEVERITY: Record<string, Severity> = {
  "llmp.generic-pain": "error",
  "llmp.flat-value-prop": "error",
  "llmp.cinematic-opener": "error",
  "llmp.synthetic-specificity": "error",
  "llmp.edging": "error",
  "llmp.feature-dump": "warn",
  "llmp.defining-obvious": "warn",
  "llmp.person-drift": "warn",
  "llmp.reasoning-in-bullets": "warn",
  "llmp.claim-no-caveat": "warn",
  "llmp.title-check": "warn",
  "llmp.register-drift": "info",
  "llmp.soft-comparative": "info",
};

/** E2: reasoning-in-bullets fired 6/6 on plain prose in eval -- the rule only makes
 *  sense against a target that actually contains list markup. */
const LIST_MARKUP_RE = /^\s*([-*+]|\d+\.)\s/m;

/** E4 (P5.3, widened P5.4 round-2 eval per rules/inventory.md's "Structural competitor-
 *  span detection" ruling): the client-positioning llmp rules that systematically
 *  misfire inside a competitor section -- pattern-lane (pat.*) rules are unaffected,
 *  per that same ruling. */
const COMPETITOR_SPAN_RULES = new Set([
  "llmp.flat-value-prop",
  "llmp.feature-dump",
  "llmp.soft-comparative",
  "llmp.claim-no-caveat",
  "llmp.synthetic-specificity",
]);

/** P5.4 structural detection: a numbered tool-entry heading ("1. Name...", "2. Name...")
 *  at any depth. Captures everything after "N. " as the "name segment" to check for the
 *  client's own product aliases. */
const NUMBERED_TOOL_ENTRY_RE = /^\d+\.\s+(.+)/;

/** E8: the FAQ-specific subset of tier1's APPROVED_HEADER_LABELS -- that list also
 *  carries "best for"/"pricing" (approved for a different reason, pat.label-colon-header's
 *  own exemption), which are not FAQ and must NOT suppress llmp.defining-obvious. Deriving
 *  this by filtering the shared list (rather than hardcoding "faq"/"faqs"/"frequently
 *  asked questions" a second time) keeps it in sync with lexicons.ts if that list changes. */
const FAQ_LABELS = new Set(APPROVED_HEADER_LABELS.filter((label) => label.includes("faq")));

/** Where each PanelSpec.needs entry lives in CheckInput, and its label in the rendered
 *  workspace block. Arrays render as bullet lists, strings as a labeled paragraph; an
 *  undefined/empty value is omitted entirely (per spec: "empty fields omitted"). */
const WORKSPACE_FIELDS: Record<
  string,
  { label: string; get(input: CheckInput): string | string[] | undefined }
> = {
  icp: { label: "ICP", get: (i) => i.client?.icp },
  positioning: { label: "Positioning", get: (i) => i.client?.positioning },
  differentiators: { label: "Differentiators", get: (i) => i.client?.differentiators },
  competitors: { label: "Competitors", get: (i) => i.client?.competitors },
  reader: { label: "Target reader", get: (i) => i.brief?.reader },
  proofBank: { label: "Proof bank", get: (i) => i.client?.proofBank },
  productAliases: { label: "Product aliases", get: (i) => i.client?.productAliases },
  keyword: { label: "Article query", get: (i) => i.brief?.keyword },
  articleType: { label: "Article type", get: (i) => i.brief?.articleType },
  angle: { label: "Article strategy / intended argument", get: (i) => i.brief?.angle },
  serpNotes: { label: "Search intent research", get: (i) => i.brief?.serpNotes },
};

export interface DroppedTier2Finding {
  panelId: string;
  ruleId: string;
  quote: string;
  reason:
    | "quote-not-found"
    | "empty-quote"
    | "low-confidence" // E6
    | "no-list-markup" // E2
    | "no-vendor-context" // E3
    | "competitor-span" // E4
    | "faq-span"; // E8
}

export interface RunTier2Options {
  /** Injected client for tests / alternate transports. Defaults to the real SDK client
   *  (`defaultClient()`), which resolves credentials from the environment -- never
   *  constructed unless this option is omitted. */
  client?: AnthropicMessagesClient;
  /** Max in-flight calls. Default 4. */
  concurrency?: number;
  /** Called once per finding dropped by the quote-verbatim gate or a post-gate filter.
   *  The dropped COUNT (what the spec asks for) is trivially `let n = 0; onDrop: () =>
   *  n++` -- see the report for why a callback was chosen over a second return value. */
  onDrop?: (dropped: DroppedTier2Finding) => void;
}

/** Renders only the fields a panel actually needs, labeled, empty fields omitted. */
export function renderWorkspaceBlock(needs: string[], input: CheckInput): string {
  const sections: string[] = [];
  for (const need of needs) {
    const field = WORKSPACE_FIELDS[need];
    if (!field) continue; // defensive: an unrecognized need name renders nothing rather than throwing
    const value = field.get(input);
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      sections.push(`${field.label}:\n${value.map((v) => `- ${v}`).join("\n")}`);
    } else {
      if (value.trim().length === 0) continue;
      sections.push(`${field.label}:\n${value}`);
    }
  }
  return sections.join("\n\n");
}

/**
 * system = SHARED_FRAME + panel.instructions (static across every call of this panel) +
 * the rendered workspace (static per client, volatile across clients). cache_control goes
 * on the LAST stable block -- the workspace block -- per shared/prompt-caching.md's
 * placement guidance ("marker on the last cacheable block of the stable prefix"); the
 * volatile per-paragraph user message that follows is never part of the cached prefix.
 * If the workspace renders empty (no needs fields populated for this input), there is
 * nothing to put in a second block -- an empty text block is likely rejected by the API
 * outright, and even if not, there's no caching benefit to a block with no shared
 * content -- so the marker moves onto the frame block instead, still caching what IS
 * stable across calls of this panel.
 */
function buildSystem(panel: PanelSpec, input: CheckInput): SystemBlock[] {
  const frame = `${SHARED_FRAME}\n\n${panel.instructions}`;
  const workspace = renderWorkspaceBlock([...new Set([...panel.needs, "keyword", "articleType", "angle", "serpNotes"])], input);
  if (workspace.length === 0) {
    return [{ type: "text", text: frame, cache_control: { type: "ephemeral" } }];
  }
  return [
    { type: "text", text: frame },
    { type: "text", text: workspace, cache_control: { type: "ephemeral" } },
  ];
}

/**
 * E5: context BOTH sides. Eval found violations "resolved in the next sentence/
 * paragraph" were flagged anyway because forward context was invisible to the model --
 * SHARED_FRAME's own rule 3 ("RESOLVE AGAINST CONTEXT BEFORE FLAGGING... the same or
 * adjacent sentence/paragraph") already assumed this and was only half-true before this
 * fix. Preceding first, then following, target LAST (both in ordering and as the final
 * labeled section) -- matches the established "target last" convention and SHARED_FRAME
 * rule 6 ("the context paragraphs are never flagged"). Either side is omitted entirely
 * when there's nothing there (first paragraph has no preceding; last has no following;
 * the H1 pass has no preceding but does get the first body paragraph as following).
 */
function buildUserMessage(
  target: string,
  precedingText: string | undefined,
  followingText: string | undefined,
): string {
  const parts: string[] = [];
  if (precedingText !== undefined) {
    parts.push(
      `PRECEDING PARAGRAPH (do not flag anything here -- for flow only):\n${precedingText}`,
    );
  }
  if (followingText !== undefined) {
    parts.push(
      `FOLLOWING PARAGRAPH (do not flag anything here -- for flow only; if the target's issue is resolved or caveated here, do not flag it):\n${followingText}`,
    );
  }
  parts.push(`TARGET PARAGRAPH (evaluate this one):\n${target}`);
  return parts.join("\n\n");
}

/** Everything a `messages.create` call needs EXCEPT `model`/`max_tokens` -- those are
 *  cheap constants (`MODEL`/`MAX_TOKENS`, exported above) that the live caller and the
 *  batch builder each attach themselves, so neither has to duplicate this function's
 *  signature just to thread two scalars through it. */
export interface PanelRequestBody {
  system: SystemBlock[];
  messages: UserMessage[];
  output_config: { format: { type: "json_schema"; schema: Record<string, unknown> } };
}

export function buildPanelRequestBody(
  panel: PanelSpec,
  input: CheckInput,
  targetText: string,
  precedingText: string | undefined,
  followingText: string | undefined,
): PanelRequestBody {
  return {
    system: buildSystem(panel, input),
    messages: [
      { role: "user", content: buildUserMessage(targetText, precedingText, followingText) },
    ],
    output_config: { format: { type: "json_schema", schema: panelOutputSchema(panel.ruleIds) } },
  };
}

export interface RawPanelFinding {
  /** Optional for legacy stored responses; new schema requires a 1-based occurrence. */
  occurrence?: number;
  ruleId: string;
  quote: string;
  message: string;
  fix: string;
  confidence: number;
}

function isRawPanelFinding(value: unknown): value is RawPanelFinding {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["ruleId"] === "string" &&
    typeof v["quote"] === "string" &&
    typeof v["message"] === "string" &&
    typeof v["fix"] === "string" &&
      typeof v["confidence"] === "number" &&
      (v["occurrence"] === undefined || (Number.isInteger(v["occurrence"]) && Number(v["occurrence"]) >= 1))
  );
}

/** Malformed or truncated (max_tokens-cut) responses degrade to zero findings for that
 *  call rather than throwing -- a single flaky call shouldn't abort the whole run. This
 *  is a distinct failure mode from the quote gate below (there's no finding to drop when
 *  the response never parsed), so it is not counted via onDrop; see the report's Risks
 *  section. */
export function parsePanelResponse(result: CreateMessageResult): RawPanelFinding[] {
  const block = result.content.find((b) => b.type === "text" && typeof b.text === "string");
  if (!block || !block.text) return [];
  try {
    const parsed = JSON.parse(block.text) as { findings?: unknown };
    if (!Array.isArray(parsed.findings)) return [];
    return parsed.findings.filter(isRawPanelFinding);
  } catch {
    return [];
  }
}

/** A half-open character-offset span [start, end) into the source document. */
export interface Span {
  start: number;
  end: number;
}

/**
 * Shared span-walk for E4 (competitor sections) and E8 (FAQ sections): every heading
 * matching `matchesHeading` opens a span running from that heading's own start to the
 * next heading at the SAME OR SHALLOWER depth (or the document end) -- so a sub-heading
 * nested inside a matching section stays inside its span, but a sibling or ancestor-level
 * heading closes it. A document can have multiple, non-overlapping matching spans.
 */
function computeHeadingSpans(
  segments: Segment[],
  matchesHeading: (headingText: string) => boolean,
): Span[] {
  const headings = segments.filter((s) => s.kind === "heading");
  if (headings.length === 0) return [];
  const docEnd = Math.max(...segments.map((s) => s.end));
  const spans: Span[] = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]!;
    if (!matchesHeading(h.text)) continue;
    const depth = h.depth ?? 1;
    let end = docEnd;
    for (let j = i + 1; j < headings.length; j++) {
      if ((headings[j]!.depth ?? 1) <= depth) {
        end = headings[j]!.start;
        break;
      }
    }
    spans.push({ start: h.start, end });
  }
  return spans;
}

export function isWithinSpan(offset: number, spans: Span[]): boolean {
  return spans.some((s) => offset >= s.start && offset < s.end);
}

/**
 * E4, widened P5.4 (rules/inventory.md "Structural competitor-span detection"): a
 * heading opens a competitor span via EITHER of two independent checks --
 *
 *   (a) config-named: the heading text contains one of client.competitors
 *       (case-insensitive substring) -- unchanged from P5.3.
 *   (b) structural: the heading matches NUMBERED_TOOL_ENTRY_RE ("N. Name...", any
 *       depth -- a listicle tool-entry heading) AND its captured name segment does NOT
 *       mention one of the client's own productAliases. A numbered entry that isn't the
 *       client's own is presumed to be a competitor's, covering vendors the config never
 *       enumerated -- this is what makes it "structural" rather than "config-name-only".
 *
 * When there's no client/productAliases at all, check (b) can't tell the client's own
 * entry apart from anyone else's, so EVERY numbered heading opens a span -- the
 * conservative default (favor suppressing over false-flagging) when there isn't enough
 * information to be selective. "## 1. Example Studio: ..." must NOT open a span when "Example Studio" is a
 * productAlias; "## 2. HireVue: ..." opens one whether or not "HireVue" is also listed
 * in client.competitors.
 */
export function competitorSpansFor(segments: Segment[], client: ClientConfig | undefined): Span[] {
  const competitors = (client?.competitors ?? [])
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c.length > 0);
  const productAliases = (client?.productAliases ?? [])
    .map((a) => a.trim().toLowerCase())
    .filter((a) => a.length > 0);

  return computeHeadingSpans(segments, (text) => {
    const lower = text.toLowerCase();
    if (competitors.some((c) => lower.includes(c))) return true;

    const match = NUMBERED_TOOL_ENTRY_RE.exec(text.trim());
    if (!match) return false;
    const nameSegment = match[1]!.toLowerCase();
    const mentionsClient = productAliases.some((a) => nameSegment.includes(a));
    return !mentionsClient;
  });
}

/** E8: FAQ-family heading sections, reusing tier1's APPROVED_HEADER_LABELS (filtered to
 *  the FAQ subset -- see FAQ_LABELS above) and FAQ_ENDING_RE -- the same two primitives
 *  pat.label-colon-header's isApprovedHeading() checks against, applied here as a span
 *  (through the section) rather than a single-heading exemption. */
export function faqSpansFor(segments: Segment[]): Span[] {
  return computeHeadingSpans(segments, (text) => {
    const trimmed = text.trim();
    const colonIndex = trimmed.indexOf(":");
    const label = (colonIndex === -1 ? trimmed : trimmed.slice(0, colonIndex)).trim().toLowerCase();
    if (FAQ_LABELS.has(label)) return true;
    return FAQ_ENDING_RE.test(trimmed);
  });
}

function hasListMarkup(text: string): boolean {
  return LIST_MARKUP_RE.test(text);
}

/** E3: is there anything in the target that actually makes it a claim ABOUT THE CLIENT'S
 *  PRODUCT (a product alias, or vendor "we"/"our")? Per spec, this filter is skipped
 *  entirely when `client` is absent -- there's no product to check the claim against, so
 *  treat it as passing rather than dropping every claim-no-caveat finding by default. */
function hasVendorContext(text: string, client: ClientConfig | undefined): boolean {
  if (!client) return true;
  const lower = text.toLowerCase();
  const aliases = (client.productAliases ?? []).filter((a) => a.trim().length > 0);
  if (aliases.some((a) => lower.includes(a.toLowerCase()))) return true;
  return /\b(we|our)\b/i.test(text);
}

export interface CallJob {
  panel: PanelSpec;
  targetText: string;
  targetStart: number;
  contextText: string | undefined;
  /** E5: the immediately following paragraph's text, undefined for the last paragraph. */
  followingText: string | undefined;
  /** E4: precomputed once per document (see buildJobs) -- is this target inside a
   *  competitor span (config-named OR structural, see competitorSpansFor)? Always false
   *  for the H1 job (none of COMPETITOR_SPAN_RULES live in TITLE_PANEL, so it's inert
   *  there either way). */
  inCompetitorSpan: boolean;
  /** E8: same precomputation, for FAQ-family sections. */
  inFaqSpan: boolean;
}

/**
 * N paragraphs x 3 panels, plus one H1 pass (TITLE_PANEL only -- E1) if a depth-1
 * heading exists. Headings are a distinct Segment.kind from "paragraph" (see segment.ts),
 * so the main loop's paragraph filter already excludes them without extra logic.
 * Competitor/FAQ spans (E4/E8) are computed ONCE per document here, not per job, since
 * both only depend on the document's heading structure -- exported (competitorSpansFor/
 * faqSpansFor) so the batch collector, which doesn't get a walk-through-buildJobs, can
 * recompute the same spans from a re-segmented article. Exported (P5.2) so the batch
 * builder enumerates the exact same job list the live path would make for the same
 * input -- this is the piece that most needed to be shared: getting paragraph/H1
 * enumeration out of sync between live and batch would silently change what gets checked.
 */
export function buildJobs(input: CheckInput): CallJob[] {
  const segments = segmentDocument(input.text);
  const paragraphs = reviewTargets(input.text).filter((s) => s.kind !== "heading");
  const competitorSpans = competitorSpansFor(segments, input.client);
  const faqSpans = faqSpansFor(segments);
  const jobs: CallJob[] = [];

  for (const panel of PANELS) {
    for (let i = 0; i < paragraphs.length; i++) {
      const target = paragraphs[i]!;
      const contextText = i > 0 ? paragraphs[i - 1]!.text : undefined;
      const followingText = i < paragraphs.length - 1 ? paragraphs[i + 1]!.text : undefined;
      jobs.push({
        panel,
        targetText: target.text,
        targetStart: target.start,
        contextText,
        followingText,
        inCompetitorSpan: isWithinSpan(target.start, competitorSpans),
        inFaqSpan: isWithinSpan(target.start, faqSpans),
      });
    }
  }

  const h1 = segments.find((s) => s.kind === "heading" && s.depth === 1);
  if (h1) {
    jobs.push({
      panel: TITLE_PANEL,
      targetText: h1.text,
      targetStart: h1.start,
      contextText: undefined,
      followingText: paragraphs[0]?.text,
      inCompetitorSpan: false,
      inFaqSpan: false,
    });
  }

  return jobs;
}

/** The subset of a `CallJob` the gate actually needs. Deliberately NOT `CallJob` itself
 *  (which carries a full `PanelSpec`): the batch collector only has a `panelId` string
 *  recovered from its manifest (see eval/llm-batch-collect.mjs), never a `PanelSpec`
 *  object, so the gate's input shape has to be satisfiable from either caller. `client`/
 *  `inCompetitorSpan`/`inFaqSpan` are optional so a caller that genuinely has none of
 *  them (client absent, or the rules those checks apply to are irrelevant) doesn't have
 *  to synthesize placeholder values. */
export interface GateContext {
  panelId: string;
  targetText: string;
  targetStart: number;
  client?: ClientConfig;
  inCompetitorSpan?: boolean;
  inFaqSpan?: boolean;
}

/**
 * Quote-verbatim gate PLUS the P5.3 post-gate precision filters, applied in this order:
 *
 * 1. E6 confidence floor -- cheapest, most universal check, runs before any text work.
 * 2. Empty-quote / quote-not-found (unchanged from P5.2) -- resolves the finding to
 *    absolute offsets; nothing past this point can run without a resolved quote anyway.
 * 3. E2 no-list-markup -- llmp.reasoning-in-bullets only, target has no list markup.
 * 4. E3 no-vendor-context -- llmp.claim-no-caveat only, target names no product alias
 *    and uses no vendor "we"/"our" (skipped when ctx.client is absent).
 * 5. E4 competitor-span -- the seven COMPETITOR_SPAN_RULES, only inside a competitor
 *    span (config-named or structural).
 * 6. E8 faq-span -- llmp.defining-obvious only, inside a FAQ-family heading section.
 *
 * Structural/universal checks first, then rule-specific checks in the E-numbered order
 * they were specified -- a finding is dropped by whichever check it hits first and
 * reports exactly that reason (a finding is never double-counted against onDrop).
 *
 * The H1 pass now uses TITLE_PANEL exclusively (E1), whose only rule is
 * llmp.title-check -- none of E2/E3/E4/E8's rule sets overlap it, so those checks are
 * simply inert for an H1 job; they were never scoped to "conversion" specifically.
 */
export function gatePanelFindings(
  raw: RawPanelFinding[],
  ctx: GateContext,
  onDrop?: (dropped: DroppedTier2Finding) => void,
): Finding[] {
  const out: Finding[] = [];
  for (const f of raw) {
    const drop = (reason: DroppedTier2Finding["reason"]): void => {
      onDrop?.({ panelId: ctx.panelId, ruleId: f.ruleId, quote: f.quote, reason });
    };

    if (f.confidence < MIN_CONFIDENCE) {
      drop("low-confidence");
      continue;
    }

    if (f.quote.length === 0) {
      drop("empty-quote");
      continue;
    }
    let localIndex = -1;
    const occurrence = f.occurrence ?? 1;
    for (let index = 0; index < occurrence; index++) {
      localIndex = ctx.targetText.indexOf(f.quote, localIndex + 1);
      if (localIndex === -1) break;
    }
    if (localIndex === -1) {
      drop("quote-not-found");
      continue;
    }

    if (f.ruleId === "llmp.reasoning-in-bullets" && !hasListMarkup(ctx.targetText)) {
      drop("no-list-markup");
      continue;
    }

    if (f.ruleId === "llmp.claim-no-caveat" && !hasVendorContext(ctx.targetText, ctx.client)) {
      drop("no-vendor-context");
      continue;
    }

    if (COMPETITOR_SPAN_RULES.has(f.ruleId) && ctx.inCompetitorSpan === true) {
      drop("competitor-span");
      continue;
    }

    if (f.ruleId === "llmp.defining-obvious" && ctx.inFaqSpan === true) {
      drop("faq-span");
      continue;
    }

    const start = ctx.targetStart + localIndex;
    const end = start + f.quote.length;
    if (out.some(existing => existing.ruleId === f.ruleId && existing.start === start && existing.end === end)) continue;
    out.push({
      ruleId: f.ruleId,
      severity: RULE_SEVERITY[f.ruleId] ?? "warn",
      scope: "paragraph",
      start,
      end,
      quote: ctx.targetText.slice(localIndex, localIndex + f.quote.length),
      message: f.message,
      fix: f.fix,
      confidence: f.confidence,
    });
  }
  return out;
}

/** N workers pulling from a shared index counter until the item list is exhausted -- no
 *  extra dependency for a bounded-concurrency map; the SDK is the only runtime dep this
 *  wave is permitted to add. */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function runNext(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await worker(items[currentIndex]!);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runNext()));
  return results;
}

/** Looks up job.panel.id's PANEL_MODEL_CONFIG entry and merges it onto a PanelRequestBody
 *  to form the final request -- shared by runTier2 and (indirectly, via the exported
 *  PANEL_MODEL_CONFIG itself) eval/llm-batch.mjs, so model/max_tokens/thinking/effort
 *  are assembled identically on both paths. Throws on an unknown panel id rather than
 *  silently falling back to some default -- every panel actually in use (conversion/
 *  prose/title/integrity) must have an entry, and a missing one means PANEL_MODEL_CONFIG
 *  fell out of sync with prompts.ts, which is a bug worth failing loudly on. */
export function buildRequestParams(job: CallJob, body: PanelRequestBody): CreateMessageParams {
  const config = PANEL_MODEL_CONFIG[job.panel.id];
  if (!config) {
    throw new Error(`No PANEL_MODEL_CONFIG entry for panel id "${job.panel.id}"`);
  }
  return {
    model: config.model,
    // Occurrence-level output needs room for multiple findings in dense paragraphs.
    // This is a ceiling, not a requested output length; truncation remains a failure.
    max_tokens: Math.min(12000, Math.max(config.max_tokens, Math.ceil(job.targetText.length / 200) * 600)),
    ...(config.thinking ? { thinking: config.thinking } : {}),
    system: body.system,
    messages: body.messages,
    output_config: { ...body.output_config, ...(config.output_config ?? {}) },
  };
}

export async function runTier2(input: CheckInput, opts: RunTier2Options = {}): Promise<Finding[]> {
  const client = opts.client ?? defaultClient();
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const jobs = buildJobs(input);

  const perJobFindings = await runWithConcurrency(jobs, concurrency, async (job) => {
    const body = buildPanelRequestBody(
      job.panel,
      input,
      job.targetText,
      job.contextText,
      job.followingText,
    );
    const response = await client.messages.create(buildRequestParams(job, body));
    const raw = parsePanelResponse(response);
    return gatePanelFindings(
      raw,
      {
        panelId: job.panel.id,
        targetText: job.targetText,
        targetStart: job.targetStart,
        client: input.client,
        inCompetitorSpan: job.inCompetitorSpan,
        inFaqSpan: job.inFaqSpan,
      },
      opts.onDrop,
    );
  });

  const findings = perJobFindings.flat();
  findings.sort((a, b) => a.start - b.start || a.end - b.end || a.ruleId.localeCompare(b.ruleId));
  return findings;
}
