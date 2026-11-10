import type { ArticleBrief, CheckInput, ClientConfig } from "../schema.js";
import { AUDIT_OUTPUT_SCHEMA, AUDIT_SYSTEM } from "./prompt.js";
import {
  defaultClient,
  type AnthropicMessagesClient,
  type CreateMessageResult,
} from "../llm-client.js";

/**
 * Tier 3 (llmd) caller -- one whole-document audit call via Claude Sonnet. Node-side only,
 * same isolation contract as tier2/caller.ts (see that file's header comment and the
 * report accompanying this change).
 *
 * `AuditResult` is defined here, not in schema.ts: it is not a `Finding[]` (no offsets --
 * the rubric is document-scope, and a per-dimension quote array has no single anchor
 * span) and the coordinator's spec is explicit that these types live in the tier3 module.
 *
 * P5.2: user-message construction and the parse+gate pipeline are exported as pure
 * functions (`buildUserMessage`, `parseAndGateAudit`) so eval/llm-batch.mjs (batch
 * submit) and eval/llm-batch-collect.mjs (batch collect) reuse exactly what `runAudit`
 * uses, rather than re-deriving the workspace rendering or quote gate a second time.
 * `runAudit` itself is now a thin orchestrator over these exports -- no behavior change.
 */

export const MODEL = "claude-sonnet-5";
/** Sonnet 5 thinks by default and thinking shares this cap with the response text; 8192
 *  truncated the structured output mid-JSON on the first live run (93s of thinking, then
 *  a silent empty audit). 16000 is the largest budget the SDK allows non-streaming (it
 *  hard-errors above ~16K: "Streaming is required for operations that may take longer
 *  than 10 minutes"). If audits ever truncate at 16000, the fix is switching this call
 *  to the streaming API, not raising the number. */
export const MAX_TOKENS = 16000;

export type AuditVerdict = "pass" | "flag" | "fail";

export interface AuditDimension {
  id: string;
  verdict: AuditVerdict;
  note: string;
  /** Only quotes that resolved verbatim in the draft survive the quote gate; the
   *  dimension's verdict and note are kept regardless (see runAudit's doc comment). */
  quotes: string[];
}

export interface AuditPriorityFix {
  rank: 1 | 2 | 3;
  dimensionId: string;
  action: string;
  quote: string;
}

export interface AuditResult {
  dimensions: AuditDimension[];
  priorityFixes: AuditPriorityFix[];
  meta: {
    /** Count of individual quotes dropped by the quote gate: unresolvable entries in a
     *  dimension's `quotes` array, plus whole priorityFixes entries dropped because their
     *  one required quote didn't resolve (see runAudit's doc comment for why
     *  priorityFixes are dropped whole rather than emitted with a blanked-out quote). */
    droppedQuotes: number;
    /** P5.3 E7: true when the response text never parsed as JSON (including an empty/
     *  missing text block) OR parsed but yielded zero dimensions. Both look identical to
     *  "the audit ran and found nothing to flag" unless this flag exists to tell them
     *  apart from a genuine clean audit -- eliminates the silent-empty failure the P5.2
     *  batch eval caught on article 007 (a truncated tier3 response that produced an
     *  empty-looking audit with no signal anything had gone wrong: 1 of 8 audits with
     *  zero coverage). */
    parseFailed: boolean;
    /** Wave 3 (PLAN.md P6, app/server/audit.ts): token usage from the SDK response, when
     *  available. Populated by `runAudit` only, straight off `CreateMessageResult.usage`
     *  -- `parseAndGateAudit` (called standalone by eval/llm-batch-collect.mjs against a
     *  batch result's already-extracted text) has no response object to read usage from,
     *  so a direct caller of that function does not get this field for free. Optional so
     *  every hand-built `AuditResult` expectation in this file's existing test suite
     *  (none of which mention usage) keeps matching unchanged -- `toEqual` treats an
     *  absent property and an explicit `undefined` the same way. */
    usage?: { inputTokens: number; outputTokens: number };
  };
}

export interface RunAuditOptions {
  /** Injected client for tests / alternate transports. Defaults to the real SDK client
   *  (`defaultClient()`); never constructed unless this option is omitted. */
  client?: AnthropicMessagesClient;
}

function renderList(label: string, items: string[] | undefined): string | undefined {
  if (!items || items.length === 0) return undefined;
  return `${label}:\n${items.map((v) => `- ${v}`).join("\n")}`;
}

function renderText(label: string, value: string | undefined): string | undefined {
  if (!value || value.trim().length === 0) return undefined;
  return `${label}: ${value}`;
}

function renderClientConfig(client: ClientConfig | undefined): string {
  if (!client) return "None provided.";
  const glossary =
    client.featureGlossary && client.featureGlossary.length > 0
      ? `Feature glossary:\n${client.featureGlossary
          .map((g) => `- ${g.canonical} (never: ${g.banned.join(", ")})`)
          .join("\n")}`
      : undefined;
  const parts = [
    renderText("Name", client.name),
    renderList("Product aliases", client.productAliases),
    renderText("ICP", client.icp),
    renderText("Positioning", client.positioning),
    renderList("Differentiators", client.differentiators),
    renderList("Competitors", client.competitors),
    renderList("Proof bank", client.proofBank),
    renderList("Banned phrases", client.bannedPhrases),
    renderList("Required vocabulary", client.requiredVocabulary),
    glossary,
  ].filter((p): p is string => p !== undefined);
  return parts.length > 0 ? parts.join("\n\n") : "None provided.";
}

function renderBrief(brief: ArticleBrief | undefined): string {
  if (!brief) return "None provided.";
  const parts = [
    renderText("Target keyword", brief.keyword),
    renderText("Article type", brief.articleType),
    renderText("Reader", brief.reader),
    renderText("Angle", brief.angle),
    renderText("SERP notes", brief.serpNotes),
    renderList("Query families", brief.queryFamilies),
  ].filter((p): p is string => p !== undefined);
  return parts.length > 0 ? parts.join("\n\n") : "None provided.";
}

/** Client config + brief + full draft, draft LAST. No cache_control anywhere in this
 *  module: Tier 3 is one call per document, so there is nothing within a single call for
 *  a cache breakpoint to be read back by -- caching only pays off across repeated calls
 *  sharing a prefix, which is Tier 2's shape, not Tier 3's. Considered and declined, not
 *  an oversight. */
export function buildUserMessage(input: CheckInput): string {
  return [
    `CLIENT WORKSPACE:\n${renderClientConfig(input.client)}`,
    `ARTICLE BRIEF:\n${renderBrief(input.brief)}`,
    `DRAFT:\n${input.text}`,
  ].join("\n\n");
}

interface RawAuditDimension {
  id: string;
  verdict: string;
  note: string;
  quotes: string[];
}

interface RawPriorityFix {
  rank: number;
  dimensionId: string;
  action: string;
  quote: string;
}

interface RawAudit {
  dimensions: RawAuditDimension[];
  priorityFixes: RawPriorityFix[];
  /** True only when JSON.parse itself threw (or there was no text to parse) -- kept
   *  separate from "parsed but empty" so gate() can compute AuditResult.meta.parseFailed
   *  as parse-failed OR zero-dimensions, per E7, without conflating the two causes here. */
  parseFailed: boolean;
}

function isRawAuditDimension(value: unknown): value is RawAuditDimension {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["id"] === "string" &&
    typeof v["verdict"] === "string" &&
    typeof v["note"] === "string" &&
    Array.isArray(v["quotes"]) &&
    (v["quotes"] as unknown[]).every((q) => typeof q === "string")
  );
}

function isRawPriorityFix(value: unknown): value is RawPriorityFix {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["rank"] === "number" &&
    typeof v["dimensionId"] === "string" &&
    typeof v["action"] === "string" &&
    typeof v["quote"] === "string"
  );
}

/** Malformed or truncated responses degrade to an empty audit (zero dimensions, zero
 *  fixes) rather than throwing -- same robustness posture as tier2/caller.ts. Takes the
 *  already-extracted response text (not a `CreateMessageResult`): the live path
 *  extracts it from a `messages.create` response, the batch collector extracts it from
 *  a batch result's `message.content` -- pulling the shared boundary at "the JSON
 *  string" rather than "the response object" means neither caller needs to reshape its
 *  own response into a `CreateMessageResult` just to reuse this. */
function parseRawAudit(responseText: string): RawAudit {
  if (!responseText) return { dimensions: [], priorityFixes: [], parseFailed: true };
  try {
    const parsed = JSON.parse(responseText) as { dimensions?: unknown; priorityFixes?: unknown };
    const dimensions = Array.isArray(parsed.dimensions)
      ? parsed.dimensions.filter(isRawAuditDimension)
      : [];
    const priorityFixes = Array.isArray(parsed.priorityFixes)
      ? parsed.priorityFixes.filter(isRawPriorityFix)
      : [];
    return { dimensions, priorityFixes, parseFailed: false };
  } catch {
    return { dimensions: [], priorityFixes: [], parseFailed: true };
  }
}

const VALID_VERDICTS = new Set<string>(["pass", "flag", "fail"]);

/**
 * Quote gate: a quote survives only if it is a verbatim substring of the draft. Per the
 * spec, dropping a quote never suppresses the dimension it belongs to -- verdict and note
 * are always kept, exactly as returned, even if every one of that dimension's quotes gets
 * filtered out. priorityFixes are different: `quote` is a single REQUIRED field there (not
 * an array), so there is no partial-filter available the way there is for a dimension's
 * `quotes` array. Resolved by treating an unverifiable priorityFix quote the same way
 * Finding.quote is treated everywhere else in this engine (schema.ts: "LLM findings whose
 * quote is not present verbatim are dropped") -- the whole priorityFix entry is dropped
 * rather than kept with a blanked-out quote. This is a judgment call the spec didn't pin
 * down explicitly; see the report.
 */
function gate(raw: RawAudit, draft: string): AuditResult {
  let droppedQuotes = 0;

  const dimensions: AuditDimension[] = raw.dimensions.map((d) => {
    const verifiedQuotes = d.quotes.filter((q) => {
      const ok = q.length > 0 && draft.includes(q);
      if (!ok) droppedQuotes++;
      return ok;
    });
    return {
      id: d.id,
      verdict: VALID_VERDICTS.has(d.verdict) ? (d.verdict as AuditVerdict) : "flag",
      note: d.note,
      quotes: verifiedQuotes,
    };
  });

  const priorityFixes: AuditPriorityFix[] = [];
  for (const pf of raw.priorityFixes) {
    if (pf.quote.length === 0 || !draft.includes(pf.quote)) {
      droppedQuotes++;
      continue;
    }
    const rank = pf.rank === 1 || pf.rank === 2 || pf.rank === 3 ? pf.rank : 1;
    priorityFixes.push({ rank, dimensionId: pf.dimensionId, action: pf.action, quote: pf.quote });
  }

  const parseFailed = raw.parseFailed || dimensions.length === 0;
  return { dimensions, priorityFixes, meta: { droppedQuotes, parseFailed } };
}

/** The full parse+gate pipeline: response text in, gated `AuditResult` out. This is the
 *  one function eval/llm-batch-collect.mjs needs per tier3 result -- extract the text
 *  from whatever response shape it has, read the original draft off disk, call this. */
export function parseAndGateAudit(responseText: string, draft: string): AuditResult {
  return gate(parseRawAudit(responseText), draft);
}

function extractText(result: CreateMessageResult): string {
  const block = result.content.find((b) => b.type === "text" && typeof b.text === "string");
  return block?.text ?? "";
}

export async function runAudit(input: CheckInput, opts: RunAuditOptions = {}): Promise<AuditResult> {
  const client = opts.client ?? defaultClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: AUDIT_SYSTEM,
    messages: [{ role: "user", content: buildUserMessage(input) }],
    output_config: { format: { type: "json_schema", schema: AUDIT_OUTPUT_SCHEMA } },
  });
  const result = parseAndGateAudit(extractText(response), input.text);
  // Wave 3: attach token usage when the response carries it (CreateMessageResult.usage
  // is optional -- see llm-client.ts -- so hand-built test fixtures without it are fine;
  // this simply doesn't populate the field in that case, same "absent, not zeroed" stance
  // as the rest of this engine's optional-usage handling).
  if (response.usage) {
    result.meta.usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
  return result;
}
