import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ArticleBrief, ClientConfig } from "../../engine/dist/schema.js";

/** Slugs become directory/file path segments; restricting to lowercase letters, digits,
 *  and hyphens means a slug can never contain `..`, `/`, or `\` and so can never escape
 *  its parent directory under app/data/. Every store function and API route validates
 *  through this before touching the filesystem. */
const SLUG_RE = /^[a-z0-9-]+$/;
export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

const DATA_DIR = resolve(import.meta.dirname, "../data");
const CLIENTS_DIR = join(DATA_DIR, "clients");

// Fictional examples, kept separate from real client workspaces.
const SEED_CLIENT_CONFIG = resolve(import.meta.dirname, "../examples/client.json");
const SEED_ARTICLE_MD = resolve(import.meta.dirname, "../examples/draft.md");
const SEED_ARTICLE_SLUG = "content-review";

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

function clientDir(slug: string): string {
  return join(CLIENTS_DIR, slug);
}
function clientConfigPath(slug: string): string {
  return join(clientDir(slug), "client.json");
}
function articleDir(clientSlug: string, articleSlug: string): string {
  return join(clientDir(clientSlug), "articles", articleSlug);
}
function draftPath(clientSlug: string, articleSlug: string): string {
  return join(articleDir(clientSlug, articleSlug), "draft.md");
}
function briefPath(clientSlug: string, articleSlug: string): string {
  return join(articleDir(clientSlug, articleSlug), "brief.json");
}
function auditPath(clientSlug: string, articleSlug: string): string {
  return join(articleDir(clientSlug, articleSlug), "audit.json");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isFeatureGlossary(value: unknown): value is { canonical: string; banned: string[] }[] {
  if (!Array.isArray(value)) return false;
  return value.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const e = entry as Record<string, unknown>;
    return typeof e.canonical === "string" && isStringArray(e.banned);
  });
}

/** Loose structural validation (Wave 3 spec 1a): required string / string[] fields
 *  present with the right JS types, matching ClientConfig's shape (engine/src/
 *  schema.ts) -- not a full schema validator (no length/format constraints, no check
 *  that arrays are non-empty), just enough to reject an obviously-wrong body before
 *  PUT /api/clients/:slug writes it to disk as client.json. */
export function isValidClientConfig(value: unknown): value is ClientConfig {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === "string" &&
    isStringArray(v.productAliases) &&
    typeof v.icp === "string" &&
    typeof v.positioning === "string" &&
    isStringArray(v.differentiators) &&
    isStringArray(v.competitors) &&
    isStringArray(v.proofBank) &&
    isStringArray(v.bannedPhrases) &&
    (v.requiredVocabulary === undefined || isStringArray(v.requiredVocabulary)) &&
    (v.featureGlossary === undefined || isFeatureGlossary(v.featureGlossary))
  );
}

const ARTICLE_TYPES = new Set(["category", "alternatives", "comparison", "review", "use-case", "other"]);

/** Same "loose, not over-engineered" posture as isValidClientConfig, for ArticleBrief
 *  (engine/src/schema.ts). articleType is checked against the schema's literal union;
 *  everything else is a type-only check. */
export function isValidArticleBrief(value: unknown): value is ArticleBrief {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.keyword === "string" &&
    typeof v.articleType === "string" &&
    ARTICLE_TYPES.has(v.articleType) &&
    typeof v.reader === "string" &&
    typeof v.angle === "string" &&
    (v.serpNotes === undefined || typeof v.serpNotes === "string") &&
    (v.queryFamilies === undefined || isStringArray(v.queryFamilies))
  );
}

/**
 * First-boot seed with fictional client and article data. Never overwrites an
 * existing example workspace or saved draft.
 */
export function ensureSeedData(): void {
  if (existsSync(clientConfigPath("example"))) return;

  mkdirSync(clientDir("example"), { recursive: true });
  const clientConfigRaw = readFileSync(SEED_CLIENT_CONFIG, "utf8");
  writeFileSync(clientConfigPath("example"), clientConfigRaw);

  const clientConfig = JSON.parse(clientConfigRaw) as ClientConfig;
  mkdirSync(articleDir("example", SEED_ARTICLE_SLUG), { recursive: true });
  writeFileSync(draftPath("example", SEED_ARTICLE_SLUG), readFileSync(SEED_ARTICLE_MD, "utf8"));

  const brief: ArticleBrief = {
    keyword: "content review workflow",
    articleType: "other",
    reader: clientConfig.icp,
    angle: "General coverage of the topic for the reader described above.",
  };
  writeFileSync(briefPath("example", SEED_ARTICLE_SLUG), JSON.stringify(brief, null, 2));
}

export function listClients(): ClientSummary[] {
  if (!existsSync(CLIENTS_DIR)) return [];
  return readdirSync(CLIENTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((slug) => existsSync(clientConfigPath(slug)))
    .map((slug) => {
      const config = JSON.parse(readFileSync(clientConfigPath(slug), "utf8")) as ClientConfig;
      return { slug, name: config.name };
    });
}

/** undefined = invalid slug or unknown client (caller maps both to 404/400). */
export function getClient(slug: string): ClientConfig | undefined {
  if (!isValidSlug(slug) || !existsSync(clientConfigPath(slug))) return undefined;
  return JSON.parse(readFileSync(clientConfigPath(slug), "utf8")) as ClientConfig;
}

export function listArticles(clientSlug: string): ArticleSummary[] | undefined {
  if (!isValidSlug(clientSlug) || !existsSync(clientConfigPath(clientSlug))) return undefined;
  const articlesRoot = join(clientDir(clientSlug), "articles");
  if (!existsSync(articlesRoot)) return [];
  return readdirSync(articlesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((slug) => existsSync(draftPath(clientSlug, slug)))
    .map((slug) => {
      const bPath = briefPath(clientSlug, slug);
      const keyword = existsSync(bPath)
        ? (JSON.parse(readFileSync(bPath, "utf8")) as ArticleBrief).keyword
        : undefined;
      return { slug, keyword };
    });
}

export function getArticle(clientSlug: string, articleSlug: string): LoadedArticle | undefined {
  if (!isValidSlug(clientSlug) || !isValidSlug(articleSlug)) return undefined;
  const dPath = draftPath(clientSlug, articleSlug);
  const bPath = briefPath(clientSlug, articleSlug);
  if (!existsSync(dPath) || !existsSync(bPath)) return undefined;
  return {
    draft: readFileSync(dPath, "utf8"),
    brief: JSON.parse(readFileSync(bPath, "utf8")) as ArticleBrief,
  };
}

/** Writes draft.md for an EXISTING article only -- PUT does not create new articles this
 *  wave. Returns false (caller -> 404) if the slug pair doesn't already resolve to one. */
export function putDraft(clientSlug: string, articleSlug: string, draft: string): boolean {
  if (!isValidSlug(clientSlug) || !isValidSlug(articleSlug)) return false;
  const dPath = draftPath(clientSlug, articleSlug);
  if (!existsSync(dPath)) return false;
  writeFileSync(dPath, draft);
  return true;
}

/** Writes brief.json for an EXISTING article only (Wave 3, PLAN.md P6 1c) -- same
 *  existence guard as putDraft, keyed off draft.md so an article missing only its brief
 *  (shouldn't happen via this module, but cheap to check consistently) still 404s rather
 *  than silently creating a brief with no draft. */
export function putBrief(clientSlug: string, articleSlug: string, brief: ArticleBrief): boolean {
  if (!isValidSlug(clientSlug) || !isValidSlug(articleSlug)) return false;
  if (!existsSync(draftPath(clientSlug, articleSlug))) return false;
  writeFileSync(briefPath(clientSlug, articleSlug), JSON.stringify(brief, null, 2));
  return true;
}

/** Overwrites an EXISTING client's client.json wholesale (Wave 3 1a). Returns false
 *  (caller -> 404) for an invalid slug or a client that hasn't been created yet -- this
 *  never creates a new client, only edits one seeded/created some other way. */
export function putClient(slug: string, config: ClientConfig): boolean {
  if (!isValidSlug(slug) || !existsSync(clientConfigPath(slug))) return false;
  writeFileSync(clientConfigPath(slug), JSON.stringify(config, null, 2));
  return true;
}

export type CreateArticleError = "unknown-client" | "exists";

/**
 * Creates a new article under an EXISTING client (Wave 3 1b): an empty draft.md plus a
 * brief.json derived the same way ensureSeedData's boot-seed brief is (keyword falls
 * back to the slug with dashes turned to spaces; reader = the client's own ICP; a fixed
 * generic angle placeholder the writer is expected to replace via the brief form).
 * Returns an error tag instead of throwing so the caller (api.ts) maps it to the right
 * HTTP status (404 vs 409) without parsing a message string; `undefined` = created.
 */
export function createArticle(
  clientSlug: string,
  articleSlug: string,
  keyword: string | undefined,
): CreateArticleError | undefined {
  if (!existsSync(clientConfigPath(clientSlug))) return "unknown-client";
  if (existsSync(draftPath(clientSlug, articleSlug))) return "exists";

  const client = JSON.parse(readFileSync(clientConfigPath(clientSlug), "utf8")) as ClientConfig;
  mkdirSync(articleDir(clientSlug, articleSlug), { recursive: true });
  writeFileSync(draftPath(clientSlug, articleSlug), "");

  const brief: ArticleBrief = {
    keyword: keyword && keyword.trim().length > 0 ? keyword.trim() : articleSlug.replace(/-/g, " "),
    articleType: "other",
    reader: client.icp,
    angle: "General coverage of the topic for the reader described above.",
  };
  writeFileSync(briefPath(clientSlug, articleSlug), JSON.stringify(brief, null, 2));
  return undefined;
}

/**
 * Persisted on-demand document audit (Wave 3 1d/1e): the tier3 AuditResult plus a runAt
 * ISO timestamp and a cost estimate, exactly as returned to the client by POST
 * /api/audit. Typed as `unknown` here deliberately -- store.ts (the disk-I/O layer)
 * must not import engine/tier3's AuditResult type just to pass it through unread;
 * server/audit.ts owns the real shape on both the write and read side.
 */
export function getPersistedAudit(clientSlug: string, articleSlug: string): unknown | undefined {
  if (!isValidSlug(clientSlug) || !isValidSlug(articleSlug)) return undefined;
  const aPath = auditPath(clientSlug, articleSlug);
  if (!existsSync(aPath)) return undefined;
  return JSON.parse(readFileSync(aPath, "utf8"));
}

/** Writes audit.json for an EXISTING article only -- same existence guard as putDraft/
 *  putBrief. Returns false (caller -> 404) if the article doesn't exist. */
export function putPersistedAudit(clientSlug: string, articleSlug: string, audit: unknown): boolean {
  if (!isValidSlug(clientSlug) || !isValidSlug(articleSlug)) return false;
  if (!existsSync(draftPath(clientSlug, articleSlug))) return false;
  writeFileSync(auditPath(clientSlug, articleSlug), JSON.stringify(audit, null, 2));
  return true;
}
