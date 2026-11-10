import type { Request, Response } from "express";
import { runAudit, type AuditResult, type AuditDimension, type AuditPriorityFix } from "../../engine/dist/tier3/caller.js";
import { getArticle, getClient, getPersistedAudit, isValidSlug, putPersistedAudit } from "./store.js";
import { usageFrom, ZERO_USAGE, type LlmpUsage } from "./llmp.js";

/**
 * Wave 3 (PLAN.md P6): the on-demand whole-document (llmd) audit lane.
 *
 * POST /api/audit -- body {clientSlug, articleSlug}. Unlike llmp (which takes the
 * editor's live, possibly-unsaved text), an audit call is expensive and runs against
 * whatever is currently SAVED on disk -- the web layer is expected to save before
 * triggering a run. Invokes engine/dist/tier3/caller.js's runAudit exactly the way
 * eval/llm-smoke.mjs does (same {text, client, brief} input shape), persists the
 * result under app/data/.../<article>/audit.json with an added ISO runAt + cost
 * estimate, and returns that same persisted object.
 *
 * GET /api/clients/:slug/articles/:article/audit -- returns the persisted audit.json,
 * or 404 if no audit has ever been run for that article.
 *
 * MOCK MODE (BOFU_MOCK_LLM=1, same env var llmp.ts checks): skips the SDK entirely.
 * Returns a canned, schema-shaped AuditResult so the UI (dimension cards, quote
 * click-to-scroll, priority fixes, the failed-audit state) is fully exercisable with
 * zero spend -- see mockAudit below for the exact shape.
 *
 * The API key never reaches the browser: this file runs server-side only, and nothing
 * it sends to the client carries anything beyond the audit result + usage.
 */

/** Wire shape persisted to audit.json and returned by both endpoints: the engine's own
 *  AuditResult, plus the two fields the spec asks for on top (1d: "an ISO runAt
 *  timestamp and usage"). Defined here (not in store.ts, which must stay ignorant of
 *  engine/tier3 types -- see store.ts's getPersistedAudit doc comment) and not in the
 *  engine (this is a wire/persistence concern of the app, not the audit lane itself). */
export interface PersistedAudit extends AuditResult {
  runAt: string;
  usage: LlmpUsage;
}

function isMockMode(): boolean {
  return process.env.BOFU_MOCK_LLM === "1";
}

/** Canonical 15 dimension ids, in rubric order (engine/src/tier3/prompt.ts). Kept here
 *  as a literal list rather than imported: prompt.ts exports only the ids baked into
 *  AUDIT_OUTPUT_SCHEMA's enum (a schema object, not a reusable id array), and pulling
 *  them back out of that structure would be more indirection than just listing them --
 *  this list is spec-frozen right alongside the rubric itself. */
const DIMENSION_IDS = [
  "serp-intent-match",
  "pain-specificity",
  "pain-pitch-arc",
  "positioning-depth",
  "argument-structure",
  "format-vs-serp",
  "conversion-mechanics",
  "collapse-test",
  "commodity-ordering",
  "header-intent-coverage",
  "section-repetition",
  "corroboration-pairing",
  "micro-yes-sequence",
  "gravity-audit",
  "substance-test",
] as const;

/** The draft's first non-empty (trimmed) line -- the mock audit's one quote source, so
 *  it is GUARANTEED to resolve verbatim against the real saved draft rather than risk
 *  being gated away like an invented quote would be (defeating the point of a mock mode
 *  meant to fully exercise the UI, including the click-to-scroll quote wiring). Falls
 *  back to the whole (trimmed) draft for the pathological case of an all-blank draft
 *  (e.g. a brand-new article nobody has written into yet). */
function firstNonEmptyLine(draft: string): string {
  for (const line of draft.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return draft.trim();
}

/**
 * MOCK MODE body (spec 1d): 13 dimensions pass; "positioning-depth" flags and
 * "micro-yes-sequence" fails, each with one note + one quote sourced per
 * firstNonEmptyLine above; 2 priorityFixes referencing those same two dimensions.
 * meta.usage is left unset (no SDK call happened) so handleAudit's cost line falls back
 * to ZERO_USAGE, same as llmp.ts's mock path.
 */
function mockAudit(draft: string): AuditResult {
  const quote = firstNonEmptyLine(draft);
  const quotes = quote.length > 0 ? [quote] : [];

  const dimensions: AuditDimension[] = DIMENSION_IDS.map((id) => {
    if (id === "positioning-depth") {
      return {
        id,
        verdict: "flag",
        note: "Mock finding for development: give the product its own section that outweighs any competitor's, with named features and measurable outcomes.",
        quotes,
      };
    }
    if (id === "micro-yes-sequence") {
      return {
        id,
        verdict: "fail",
        note: "Mock finding for development: the yes-chain never closes -- the category gets argued but the vendor choice is never won.",
        quotes,
      };
    }
    return { id, verdict: "pass", note: "", quotes: [] };
  });

  const priorityFixes: AuditPriorityFix[] =
    quotes.length > 0
      ? [
          {
            rank: 1,
            dimensionId: "micro-yes-sequence",
            action: "Mock fix for development: close the yes-chain with an explicit vendor recommendation.",
            quote: quote,
          },
          {
            rank: 2,
            dimensionId: "positioning-depth",
            action: "Mock fix for development: give the product its own dedicated section with named features and outcomes.",
            quote: quote,
          },
        ]
      : [];

  return { dimensions, priorityFixes, meta: { droppedQuotes: 0, parseFailed: false } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function handleAudit(req: Request, res: Response): Promise<void> {
  const body: unknown = req.body;
  const b = isRecord(body) ? body : {};
  const { clientSlug, articleSlug } = b as Record<string, unknown>;

  if (typeof clientSlug !== "string" || !isValidSlug(clientSlug)) {
    res.status(400).json({ error: "invalid clientSlug" });
    return;
  }
  if (typeof articleSlug !== "string" || !isValidSlug(articleSlug)) {
    res.status(400).json({ error: "invalid articleSlug" });
    return;
  }

  const client = getClient(clientSlug);
  if (!client) {
    res.status(404).json({ error: `unknown client "${clientSlug}"` });
    return;
  }
  const article = getArticle(clientSlug, articleSlug);
  if (!article) {
    res.status(404).json({ error: `unknown article "${clientSlug}/${articleSlug}"` });
    return;
  }

  try {
    const startedAt = Date.now();
    const result: AuditResult = isMockMode()
      ? mockAudit(article.draft)
      : await runAudit({ text: article.draft, client, brief: article.brief });
    const ms = Date.now() - startedAt;

    const usage: LlmpUsage = result.meta.usage
      ? usageFrom(result.meta.usage.inputTokens, result.meta.usage.outputTokens)
      : ZERO_USAGE;

    const persisted: PersistedAudit = { ...result, runAt: new Date().toISOString(), usage };

    // getArticle above already proved the article exists, so this should always
    // succeed; guarded anyway rather than assumed, consistent with this file's other
    // store calls (and with llmp.ts's own style).
    const ok = putPersistedAudit(clientSlug, articleSlug, persisted);
    if (!ok) {
      res.status(404).json({ error: `unknown article "${clientSlug}/${articleSlug}"` });
      return;
    }

    console.log(
      `[audit] ${clientSlug}/${articleSlug} dimensions=${result.dimensions.length} ` +
        `parseFailed=${result.meta.parseFailed} tokens=${usage.inputTokens}in/${usage.outputTokens}out ${ms}ms`,
    );

    res.json(persisted);
  } catch (err) {
    console.error(`[audit] ${clientSlug}/${articleSlug} FAILED:`, err);
    res.status(502).json({ error: err instanceof Error ? err.message : "audit call failed" });
  }
}

export function handleGetAudit(req: Request, res: Response): void {
  const { slug, article } = req.params as { slug: string; article: string };
  if (!isValidSlug(slug) || !isValidSlug(article)) {
    res.status(400).json({ error: "invalid slug" });
    return;
  }
  const audit = getPersistedAudit(slug, article);
  if (!audit) {
    res.status(404).json({ error: `no audit for "${slug}/${article}"` });
    return;
  }
  res.json(audit);
}
