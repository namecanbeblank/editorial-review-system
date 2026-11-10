import type { ArticleBrief } from "../../engine/dist/schema.js";
import { Router } from "express";
import { handleAudit, handleGetAudit } from "./audit.js";
import { handleLlmp } from "./llmp.js";
import {
  createArticle,
  getArticle,
  getClient,
  isValidArticleBrief,
  isValidClientConfig,
  isValidSlug,
  listArticles,
  listClients,
  putBrief,
  putClient,
  putDraft,
} from "./store.js";

export const apiRouter = Router();

// Wave 2 (PLAN.md P6): paragraph LLM lane. Body {clientSlug, articleSlug, text,
// targetStart} -- see llmp.ts for validation, job resolution, mock mode, and caching.
apiRouter.post("/llmp", handleLlmp);

// Wave 3 (PLAN.md P6): on-demand whole-document audit lane. Body {clientSlug,
// articleSlug} -- see audit.ts for validation, mock mode, and persistence.
apiRouter.post("/audit", handleAudit);

apiRouter.get("/clients", (_req, res) => {
  res.json(listClients());
});

apiRouter.get("/clients/:slug", (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) return res.status(400).json({ error: "invalid client slug" });
  const client = getClient(slug);
  if (!client) return res.status(404).json({ error: `unknown client "${slug}"` });
  res.json(client);
});

// Wave 3 (PLAN.md P6 1a): full client-config overwrite. Body is a whole ClientConfig,
// validated loosely (isValidClientConfig -- required fields present with the right JS
// types, not a full schema check) before it ever touches disk.
apiRouter.put("/clients/:slug", (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) return res.status(400).json({ error: "invalid client slug" });
  const body: unknown = req.body;
  if (!isValidClientConfig(body)) {
    return res.status(400).json({ error: "body must be a valid ClientConfig" });
  }
  const ok = putClient(slug, body);
  if (!ok) return res.status(404).json({ error: `unknown client "${slug}"` });
  res.json({ ok: true, savedAt: new Date().toISOString() });
});

apiRouter.get("/clients/:slug/articles", (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) return res.status(400).json({ error: "invalid client slug" });
  const articles = listArticles(slug);
  if (!articles) return res.status(404).json({ error: `unknown client "${slug}"` });
  res.json(articles);
});

// Wave 3 (PLAN.md P6 1b): create a new article. Body {slug, keyword?} -- `slug` here is
// the NEW ARTICLE's slug (distinct from the :slug route param, which is the client's).
apiRouter.post("/clients/:slug/articles", (req, res) => {
  const { slug: clientSlug } = req.params;
  if (!isValidSlug(clientSlug)) return res.status(400).json({ error: "invalid client slug" });

  const body: unknown = req.body;
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const rawSlug = b.slug;
  const rawKeyword = b.keyword;

  // Ternaries (rather than a bare `if (!isValidSlug(articleSlug)) return` narrowing
  // pattern) so the narrowed value is captured in one expression -- safer than relying
  // on control-flow narrowing to survive from an early-return guard to a later,
  // separately-written usage site.
  const articleSlug: string | undefined =
    typeof rawSlug === "string" && isValidSlug(rawSlug) ? rawSlug : undefined;
  if (articleSlug === undefined) {
    return res.status(400).json({ error: "body must include a valid slug" });
  }
  if (rawKeyword !== undefined && typeof rawKeyword !== "string") {
    return res.status(400).json({ error: "keyword must be a string" });
  }
  const keyword: string | undefined = typeof rawKeyword === "string" ? rawKeyword : undefined;

  const result = createArticle(clientSlug, articleSlug, keyword);
  if (result === "unknown-client") return res.status(404).json({ error: `unknown client "${clientSlug}"` });
  if (result === "exists") {
    return res.status(409).json({ error: `article "${clientSlug}/${articleSlug}" already exists` });
  }
  res.status(201).json({ ok: true, slug: articleSlug });
});

apiRouter.get("/clients/:slug/articles/:article", (req, res) => {
  const { slug, article } = req.params;
  if (!isValidSlug(slug) || !isValidSlug(article)) {
    return res.status(400).json({ error: "invalid slug" });
  }
  const loaded = getArticle(slug, article);
  if (!loaded) return res.status(404).json({ error: `unknown article "${slug}/${article}"` });
  res.json(loaded);
});

// Wave 3 (PLAN.md P6 1e): the persisted on-demand audit for an article, or 404 if none
// has ever been run. Registered before the generic PUT below only for readability --
// the differing HTTP method and the trailing /audit segment mean there is no route
// overlap either way.
apiRouter.get("/clients/:slug/articles/:article/audit", handleGetAudit);

// Wave 1: draft.md only. Wave 3 (PLAN.md P6 1c) extends this to accept an optional
// `brief` alongside (or instead of) `draft` -- either or both may be present; whichever
// is present gets validated and written, brief.json via isValidArticleBrief/putBrief.
apiRouter.put("/clients/:slug/articles/:article", (req, res) => {
  const { slug, article } = req.params;
  if (!isValidSlug(slug) || !isValidSlug(article)) {
    return res.status(400).json({ error: "invalid slug" });
  }
  const body: unknown = req.body;
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const rawDraft = b.draft;
  const rawBrief = b.brief;

  if (rawDraft === undefined && rawBrief === undefined) {
    return res.status(400).json({ error: "body must include draft and/or brief" });
  }
  if (rawDraft !== undefined && typeof rawDraft !== "string") {
    return res.status(400).json({ error: "draft must be a string" });
  }
  if (rawBrief !== undefined && !isValidArticleBrief(rawBrief)) {
    return res.status(400).json({ error: "brief must be a valid ArticleBrief" });
  }

  // Ternaries (not a bare narrowing guard) for the same reason as the POST handler
  // above: each captures its predicate's narrowed value in one expression rather than
  // leaning on control-flow narrowing to carry across the separate `let ok = ...` usage
  // below.
  const draft: string | undefined = typeof rawDraft === "string" ? rawDraft : undefined;
  const brief: ArticleBrief | undefined =
    rawBrief !== undefined && isValidArticleBrief(rawBrief) ? rawBrief : undefined;

  let ok = true;
  if (draft !== undefined) ok = putDraft(slug, article, draft) && ok;
  if (brief !== undefined) ok = putBrief(slug, article, brief) && ok;

  if (!ok) return res.status(404).json({ error: `unknown article "${slug}/${article}"` });
  res.json({ ok: true, savedAt: new Date().toISOString() });
});
