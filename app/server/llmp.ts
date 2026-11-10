import type { Request, Response } from "express";
import { createHash } from "node:crypto";
import {
  buildJobs,
  buildPanelRequestBody,
  buildRequestParams,
  gatePanelFindings,
  parsePanelResponse,
  type CallJob,
  type RawPanelFinding,
} from "../../engine/dist/tier2/caller.js";
import { defaultClient, type CreateMessageResult } from "../../engine/dist/llm-client.js";
import type { CheckInput, ClientConfig, Finding } from "../../engine/dist/schema.js";
import { getArticle, getClient, isValidSlug } from "./store.js";

/**
 * Wave 2 (PLAN.md P6): POST /api/llmp -- the paragraph LLM lane. Body
 * {clientSlug, articleSlug, text, targetStart}: `text` is the editor's CURRENT live doc
 * (not necessarily saved), `targetStart` a char offset the client believes falls inside
 * the paragraph that just "settled." This module re-derives the real paragraph and runs
 * only the panel(s) covering it, reusing engine/src/tier2/caller.ts's own job-building/
 * request-building/gate exports so the live editor path is byte-for-byte the same
 * pipeline runTier2 (the eval/full-document path) uses -- never a second, drifting
 * reimplementation of panel wiring or the quote-verbatim gate.
 *
 * The API key never reaches the browser: everything in this file runs server-side only,
 * and the only thing sent to the client is findings + resolved paragraph span + usage.
 */

/** Sonnet 5 live pricing, USD per token: $2/$10 per 1M in/out (confirmed against the
 *  platform pricing page 2026-08-30 — the launch pricing was made permanent; the once-
 *  scheduled $3/$15 increase was cancelled). Cache-read/write token charges (~10x cheaper
 *  reads) aren't itemized here, so the meter slightly UNDERCOUNTS once the 1h prompt cache
 *  warms — acceptable for a session estimate. */
const INPUT_COST_PER_TOKEN = 2 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 10 / 1_000_000;

/** Internal cost-accounting shape (per-job/per-request token totals + $ estimate). The
 *  HTTP response adds one more field (cacheHits) on top of this -- see handleLlmp's
 *  res.json() call and its comment for why. */
export interface LlmpUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

/** Exported (Wave 3, PLAN.md P6 1f) so server/audit.ts can compute its own cost-estimate
 *  line at the same $2/$10-per-1M pricing without duplicating the constants above --
 *  the audit lane also calls Sonnet 5, so the same per-token rate applies unchanged. */
export const ZERO_USAGE: LlmpUsage = { inputTokens: 0, outputTokens: 0, estimatedCost: 0 };

export function usageFrom(inputTokens: number, outputTokens: number): LlmpUsage {
  return {
    inputTokens,
    outputTokens,
    estimatedCost: inputTokens * INPUT_COST_PER_TOKEN + outputTokens * OUTPUT_COST_PER_TOKEN,
  };
}

function sumUsage(a: LlmpUsage, b: LlmpUsage): LlmpUsage {
  return usageFrom(a.inputTokens + b.inputTokens, a.outputTokens + b.outputTokens);
}

interface CacheEntry {
  findings: Finding[];
  usage: LlmpUsage;
}

/**
 * In-memory, per-server-process cache: re-settling an unchanged paragraph (same panel,
 * same exact paragraph text, same client) never re-spends tokens -- a cache hit returns
 * the previously-gated findings with usage:zero. Keyed `${clientSlug}:${sha256(panelId +
 * NUL + targetText)}` per spec (a NUL separator, not a literal string, so no legal panel
 * id or paragraph text could ever collide across the join); the client slug rides along
 * because the same paragraph text can legitimately gate differently under a different
 * client's workspace (ICP/positioning/proof bank change what a panel is told). Bounded to
 * MAX_CACHE_ENTRIES (Wave 4 polish item 4) via cacheSet below, not inserted into directly.
 */
const cache = new Map<string, CacheEntry>();

/** Wave 4 polish item 4: cap the cache at 500 entries so a long-running server process
 *  can't grow it unboundedly. Map iteration order is insertion order, so the first key
 *  from .keys() is the oldest entry -- evict it before inserting once the cap is hit. */
const MAX_CACHE_ENTRIES = 500;

function cacheSet(key: string, entry: CacheEntry): void {
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(key)) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, entry);
}

function cacheKeyFor(clientSlug: string, panelId: string, targetText: string): string {
  // NUL-separated per spec, built via fromCharCode rather than a string-literal escape
  // so the character is unambiguous in source (see the block comment above).
  const hash = createHash("sha256")
    .update(panelId + String.fromCharCode(0) + targetText)
    .digest("hex");
  return `${clientSlug}:${hash}`;
}

function isMockMode(): boolean {
  return process.env.BOFU_MOCK_LLM === "1";
}

/** Dev-only marker string (see PLAN.md P6 Wave 2 spec): a paragraph containing this
 *  literal produces exactly one canned finding in mock mode, so the whole llmp wire path
 *  (validation -> job resolution -> gate -> cache -> response shape) can be exercised
 *  with zero spend and no network. Never checked for outside isMockMode(). */
const MOCK_MARKER = "MOCKFLAG";

export function checkedPanelResponse(response: CreateMessageResult): RawPanelFinding[] {
  const responseText = response.content.find((block) => block.type === "text")?.text;
  if (response.stop_reason === "max_tokens" || !responseText) throw new Error("Incomplete core review response. Retry this check.");
  const parsed: unknown = JSON.parse(responseText);
  if (!parsed || typeof parsed !== "object" || !("findings" in parsed) || !Array.isArray(parsed.findings)) {
    throw new Error("Invalid core review response. Retry this check.");
  }
  const raw = parsePanelResponse(response);
  if (raw.length !== parsed.findings.length) throw new Error("Malformed core finding. Retry this check.");
  return raw;
}

/** Finds the sentence containing MOCK_MARKER via a naive sentence split, falling back to
 *  the paragraph's first 40 characters if that split can't isolate one -- dev-only, never
 *  runs against a real model response. Mirrors (loosely; this is intentionally simpler
 *  than engine/src/segment.ts's real sentence splitter) "quote = the sentence containing
 *  MOCKFLAG or the first 40 chars of the paragraph" from the spec. */
function mockQuoteFor(paragraphText: string): string {
  const sentences = paragraphText.split(/(?<=[.!?])\s+/);
  const withMarker = sentences.find((s) => s.includes(MOCK_MARKER))?.trim();
  return withMarker && withMarker.length > 0 ? withMarker : paragraphText.slice(0, 40);
}

/** The jobs whose target paragraph CONTAINS targetStart -- the 3 body-panel jobs for
 *  that paragraph (or the 1 TITLE_PANEL job if targetStart falls in the H1). All matches
 *  share the same targetStart/targetText (buildJobs emits one job per panel per
 *  paragraph, all against the identical paragraph span), so matched[0] is a valid
 *  representative for resolving "the" paragraph. */
function matchJobs(jobs: CallJob[], targetStart: number): CallJob[] {
  return jobs.filter(
    (job) => job.targetStart <= targetStart && targetStart < job.targetStart + job.targetText.length,
  );
}

/** The resolved paragraph span to report back to the client. Falls back to a zero-width
 *  span at targetStart itself when nothing matched (targetStart landed in a heading,
 *  listItem, or blank/code span the panels don't cover) -- there's no paragraph to key
 *  findings against, but that is not an error: it just means nothing to check here. */
function resolveParagraph(matched: CallJob[], targetStart: number): { start: number; end: number } {
  if (matched.length === 0) return { start: targetStart, end: targetStart };
  const job = matched[0]!;
  return { start: job.targetStart, end: job.targetStart + job.targetText.length };
}

interface RunResult {
  findings: Finding[];
  usage: LlmpUsage;
  cacheHits: number;
  /** How many cache lookups this run actually performed -- the log's cacheHits/N
   *  denominator. Equal to matched.length in live mode (one lookup per matched panel
   *  job); in mock mode it's 0 or 1, since mock mode collapses the panel fan-out into a
   *  single representative check (see runMock) -- reporting matched.length there would
   *  misleadingly suggest 3 independent checks ran when only 1 did. */
  jobsConsidered: number;
}

/**
 * MOCK MODE: skips the SDK (and the per-panel fan-out) entirely. Per spec this is "one
 * canned finding per request," not one per panel, so it operates once against a single
 * representative job (matched[0]) rather than iterating every matched panel job the live
 * path would call separately. Still runs through the SAME cache Map and the SAME
 * gatePanelFindings gate as the live path, so the wire contract and the cache mechanism
 * are exercised for real, not stubbed a second way.
 */
function runMock(clientSlug: string, matched: CallJob[], client: ClientConfig | undefined): RunResult {
  if (matched.length === 0) return { findings: [], usage: ZERO_USAGE, cacheHits: 0, jobsConsidered: 0 };

  const primary = matched[0]!;
  const key = cacheKeyFor(clientSlug, primary.panel.id, JSON.stringify({ primary, client }));
  const cached = cache.get(key);
  if (cached) {
    return { findings: cached.findings, usage: ZERO_USAGE, cacheHits: 1, jobsConsidered: 1 };
  }

  let findings: Finding[] = [];
  if (primary.targetText.includes(MOCK_MARKER)) {
    const raw: RawPanelFinding = {
      ruleId: "llmp.flat-value-prop",
      quote: mockQuoteFor(primary.targetText),
      message: "Mock finding for development",
      fix: "n/a",
      confidence: 0.9,
    };
    findings = gatePanelFindings([raw], {
      panelId: primary.panel.id,
      targetText: primary.targetText,
      targetStart: primary.targetStart,
      client,
      inCompetitorSpan: primary.inCompetitorSpan,
      inFaqSpan: primary.inFaqSpan,
    });
  }
  cacheSet(key, { findings, usage: ZERO_USAGE });
  return { findings, usage: ZERO_USAGE, cacheHits: 0, jobsConsidered: 1 };
}

/**
 * LIVE MODE: one buildPanelRequestBody/buildRequestParams/messages.create/
 * parsePanelResponse/gatePanelFindings round trip per matched job, run concurrently
 * (Promise.all) per spec. A per-job cache hit costs nothing (findings reused, usage
 * zero); a miss is gated and cached for next time under that exact (client, panel,
 * paragraph-text) key.
 */
async function runLive(clientSlug: string, input: CheckInput, matched: CallJob[]): Promise<RunResult> {
  const sdkClient = defaultClient();
  let cacheHits = 0;

  const perJob = await Promise.all(
    matched.map(async (job): Promise<CacheEntry> => {
      const key = cacheKeyFor(clientSlug, job.panel.id, JSON.stringify({ job, client: input.client, brief: input.brief }));
      const cached = cache.get(key);
      if (cached) {
        cacheHits += 1;
        return { ...cached, usage: ZERO_USAGE };
      }

      const body = buildPanelRequestBody(job.panel, input, job.targetText, job.contextText, job.followingText);
      const response = await sdkClient.messages.create(buildRequestParams(job, body));
      // A malformed or truncated response is a failed check, never a clean paragraph.
      const raw = checkedPanelResponse(response);
      const findings = gatePanelFindings(raw, {
        panelId: job.panel.id,
        targetText: job.targetText,
        targetStart: job.targetStart,
        client: input.client,
        inCompetitorSpan: job.inCompetitorSpan,
        inFaqSpan: job.inFaqSpan,
      });
      const usage = usageFrom(response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0);
      const entry: CacheEntry = { findings, usage };
      cacheSet(key, entry);
      return entry;
    }),
  );

  const findings = perJob.flatMap((e) => e.findings);
  const usage = perJob.reduce((acc, e) => sumUsage(acc, e.usage), ZERO_USAGE);
  return { findings, usage, cacheHits, jobsConsidered: matched.length };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function handleLlmp(req: Request, res: Response): Promise<void> {
  const body: unknown = req.body;
  const b = isRecord(body) ? body : {};
  const { clientSlug, articleSlug, text, targetStart } = b as Record<string, unknown>;

  if (typeof clientSlug !== "string" || !isValidSlug(clientSlug)) {
    res.status(400).json({ error: "invalid clientSlug" });
    return;
  }
  if (typeof articleSlug !== "string" || !isValidSlug(articleSlug)) {
    res.status(400).json({ error: "invalid articleSlug" });
    return;
  }
  if (typeof text !== "string") {
    res.status(400).json({ error: "body must include text: string" });
    return;
  }
  if (
    typeof targetStart !== "number" ||
    !Number.isInteger(targetStart) ||
    targetStart < 0 ||
    targetStart > text.length
  ) {
    res.status(400).json({ error: "targetStart must be an integer within text bounds" });
    return;
  }

  const client = getClient(clientSlug);
  if (!client) {
    res.status(404).json({ error: `unknown client "${clientSlug}"` });
    return;
  }
  // brief.json comes from the stored article; the draft it's paired with is NOT used --
  // `text` above (the editor's current, possibly-unsaved content) is authoritative.
  const article = getArticle(clientSlug, articleSlug);
  if (!article) {
    res.status(404).json({ error: `unknown article "${clientSlug}/${articleSlug}"` });
    return;
  }

  const input: CheckInput = { text, client, brief: article.brief };

  try {
    const jobs = buildJobs(input);
    const matched = matchJobs(jobs, targetStart);
    const paragraph = resolveParagraph(matched, targetStart);
    const panelIds = matched.map((j) => j.panel.id);

    const startedAt = Date.now();
    const { findings, usage, cacheHits, jobsConsidered } = isMockMode()
      ? runMock(clientSlug, matched, client)
      : await runLive(clientSlug, input, matched);
    const ms = Date.now() - startedAt;

    console.log(
      `[llmp] ${clientSlug}/${articleSlug} offset=${targetStart} panels=[${panelIds.join(",")}] ` +
        `cacheHits=${cacheHits}/${jobsConsidered} tokens=${usage.inputTokens}in/${usage.outputTokens}out ${ms}ms`,
    );

    // Wire shape is the spec's {inputTokens,outputTokens,estimatedCost} PLUS cacheHits
    // (how many of this call's matched panel jobs were served from cache). That extra
    // field is additive/backward-compatible -- a consumer reading only the three spec
    // fields is unaffected -- and it's necessary, not cosmetic: mock mode's usage is
    // {0,0,0} on BOTH a cache hit and a fresh mock computation (no SDK call either way,
    // so token counts alone can't distinguish them), which a browser smoke test caught
    // showing every mock-mode call as a false "cache hit" under a zero-usage-implies-
    // cache-hit heuristic on the front end. See the wave report.
    res.json({ findings, paragraph, usage: { ...usage, cacheHits } });
  } catch (err) {
    console.error(`[llmp] ${clientSlug}/${articleSlug} offset=${targetStart} FAILED:`, err);
    res.status(502).json({ error: err instanceof Error ? err.message : "llmp call failed" });
  }
}
