import type { ArticleBrief, ClientConfig, Finding } from "../../engine/dist/schema.js";
import type { AuditDimension, AuditPriorityFix } from "../../engine/dist/tier3/caller.js";

/** Matches server/store.ts's ClientSummary/ArticleSummary shapes (not imported directly --
 *  the web bundle must never reach into server/, only into the browser-safe engine dist). */
export interface ClientSummary {
  slug: string;
  name: string;
}

export interface ArticleSummary {
  slug: string;
  keyword?: string;
}

export interface LoadedArticle {
  draft: string;
  brief: ArticleBrief;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export function listClients(): Promise<ClientSummary[]> {
  return request("/clients");
}

export function getClient(slug: string): Promise<ClientConfig> {
  return request(`/clients/${slug}`);
}

export function listArticles(slug: string): Promise<ArticleSummary[]> {
  return request(`/clients/${slug}/articles`);
}

export function getArticle(clientSlug: string, articleSlug: string): Promise<LoadedArticle> {
  return request(`/clients/${clientSlug}/articles/${articleSlug}`);
}

export function saveDraft(
  clientSlug: string,
  articleSlug: string,
  draft: string,
): Promise<{ ok: true; savedAt: string }> {
  return request(`/clients/${clientSlug}/articles/${articleSlug}`, {
    method: "PUT",
    body: JSON.stringify({ draft }),
  });
}

/** Wave 2: paragraph LLM lane. Matches the wire shape server/llmp.ts's handleLlmp
 *  actually sends (not imported directly -- same reasoning as ClientSummary/
 *  ArticleSummary above: the web bundle only ever reaches into server/ through this
 *  typed wire boundary, never a direct import). `cacheHits` rides alongside the token/
 *  cost fields rather than being inferred client-side: mock mode reports {0,0,0}
 *  tokens on BOTH a cache hit and a fresh computation, so "zero usage" alone can't
 *  tell them apart -- the server is the only place that actually knows. */
export interface LlmpUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  cacheHits: number;
}

export interface LlmpResponse {
  findings: Finding[];
  paragraph: { start: number; end: number };
  usage: LlmpUsage;
}

/** POST /api/llmp: `text` is the editor's CURRENT full doc (may be unsaved), `targetStart`
 *  a char offset inside the paragraph that just settled -- the server resolves the real
 *  paragraph and returns findings scoped to it (see Editor.tsx's settle-detection logic
 *  and server/llmp.ts). */
export function checkParagraph(
  clientSlug: string,
  articleSlug: string,
  text: string,
  targetStart: number,
): Promise<LlmpResponse> {
  return request(`/llmp`, {
    method: "POST",
    body: JSON.stringify({ clientSlug, articleSlug, text, targetStart }),
  });
}

/** Wave 3: PUT /api/clients/:slug -- full client-config overwrite (the Workspace form's
 *  Save button). */
export function saveClient(slug: string, config: ClientConfig): Promise<{ ok: true; savedAt: string }> {
  return request(`/clients/${slug}`, {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

/** Wave 3: PUT .../articles/:article with `{brief}` only (not `draft`) -- the Article
 *  brief form's own Save button, independent of the main draft Save button. */
export function saveBrief(
  clientSlug: string,
  articleSlug: string,
  brief: ArticleBrief,
): Promise<{ ok: true; savedAt: string }> {
  return request(`/clients/${clientSlug}/articles/${articleSlug}`, {
    method: "PUT",
    body: JSON.stringify({ brief }),
  });
}

/** Wave 3: POST .../articles -- creates a new article (empty draft.md + a seeded
 *  brief.json; see server/store.ts's createArticle). `keyword` is optional; the server
 *  derives one from the slug when omitted. */
export function createArticle(
  clientSlug: string,
  articleSlug: string,
  keyword?: string,
): Promise<{ ok: true; slug: string }> {
  return request(`/clients/${clientSlug}/articles`, {
    method: "POST",
    body: JSON.stringify({ slug: articleSlug, keyword }),
  });
}

/** Wave 3: the on-demand whole-document (llmd) audit lane. Matches the wire shape
 *  server/audit.ts actually sends -- the engine's own AuditDimension/AuditPriorityFix
 *  types are reused directly (type-only import, so nothing from tier3/caller.js's
 *  runtime module -- which does reach the Anthropic SDK -- is ever bundled into the
 *  browser build), but `meta`/`runAt`/`usage` are the app's own wire addition on top
 *  of the engine's bare AuditResult, so they're declared locally here rather than
 *  imported (same reasoning as LlmpUsage/LlmpResponse above). */
export interface AuditUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

export interface PersistedAudit {
  dimensions: AuditDimension[];
  priorityFixes: AuditPriorityFix[];
  meta: {
    droppedQuotes: number;
    parseFailed: boolean;
    usage?: { inputTokens: number; outputTokens: number };
  };
  runAt: string;
  usage: AuditUsage;
}

/** GET .../audit -- the persisted audit, or `null` if none has been run yet for this
 *  article (a fresh article, or one that predates Wave 3). A 404 here is an expected,
 *  non-error state, so this bypasses the shared `request` helper (which throws on any
 *  non-ok status) rather than trying to distinguish "no audit yet" from a real failure
 *  by pattern-matching the thrown error's message. */
export async function getAudit(clientSlug: string, articleSlug: string): Promise<PersistedAudit | null> {
  const res = await fetch(`/api/clients/${clientSlug}/articles/${articleSlug}/audit`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as PersistedAudit;
}

/** POST /api/audit -- runs a fresh audit against the CURRENTLY SAVED draft (not the
 *  editor's live text -- an audit is expensive enough that "save, then audit" is the
 *  expected flow) and returns the newly-persisted result. */
export function runAudit(clientSlug: string, articleSlug: string): Promise<PersistedAudit> {
  return request(`/audit`, {
    method: "POST",
    body: JSON.stringify({ clientSlug, articleSlug }),
  });
}
