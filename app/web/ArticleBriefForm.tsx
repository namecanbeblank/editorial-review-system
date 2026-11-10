import { useEffect, useState } from "react";
import type { ArticleBrief } from "../../engine/dist/schema.js";

type SaveState = "idle" | "saving" | "saved" | "error";

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "Save brief",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed – retry",
};

/** Exact values of ArticleBrief["articleType"] (engine/src/schema.ts) -- there is no
 *  runtime enum to import (it's a bare literal union), so the six options are hard-coded
 *  here and must be kept in sync with that type by hand. */
const ARTICLE_TYPES: ArticleBrief["articleType"][] = [
  "category",
  "alternatives",
  "comparison",
  "review",
  "use-case",
  "other",
];

interface ArticleBriefFormProps {
  brief: ArticleBrief;
  onSave: (brief: ArticleBrief) => Promise<void>;
}

/**
 * LEFT pane, "Article brief" section (Wave 3, PLAN.md P6 2b; articleType promoted to a
 * closed <select> Wave 4 polish item 2): keyword as a plain text field, articleType
 * constrained to ARTICLE_TYPES above, reader/angle as textareas. Saved independently of
 * the draft's own Save button, via the article PUT's `{brief}` path (server/api.ts).
 */
export default function ArticleBriefForm({ brief, onSave }: ArticleBriefFormProps) {
  const [form, setForm] = useState<ArticleBrief>(brief);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  useEffect(() => {
    setForm(brief);
  }, [brief]);

  async function handleSave() {
    setSaveState("saving");
    try {
      await onSave(form);
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1500);
    } catch {
      setSaveState("error");
    }
  }

  return (
    <details className="collapsible" open>
      <summary>Article brief</summary>
      <div className="collapsible-body">
        <div className="field">
          <label htmlFor="brief-keyword">Keyword</label>
          <input
            id="brief-keyword"
            type="text"
            value={form.keyword}
            onChange={(e) => setForm({ ...form, keyword: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="brief-type">Article type</label>
          <select
            id="brief-type"
            value={form.articleType}
            onChange={(e) =>
              setForm({ ...form, articleType: e.target.value as ArticleBrief["articleType"] })
            }
          >
            {ARTICLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="brief-reader">Reader</label>
          <textarea id="brief-reader" value={form.reader} onChange={(e) => setForm({ ...form, reader: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="brief-angle">Angle</label>
          <textarea id="brief-angle" value={form.angle} onChange={(e) => setForm({ ...form, angle: e.target.value })} />
        </div>
        <button type="button" className="brief-form-save" onClick={handleSave} disabled={saveState === "saving"}>
          {SAVE_LABEL[saveState]}
        </button>
      </div>
    </details>
  );
}

interface NewArticleFormProps {
  onCreate: (slug: string, keyword: string) => Promise<void>;
}

/** LEFT pane, "New article" affordance (Wave 3, PLAN.md P6 2c): slug + optional keyword,
 *  POSTs via onCreate (App.tsx), then clears itself on success -- App.tsx is
 *  responsible for switching the selection to the new article. */
export function NewArticleForm({ onCreate }: NewArticleFormProps) {
  const [slug, setSlug] = useState("");
  const [keyword, setKeyword] = useState("");
  const [state, setState] = useState<SaveState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleCreate() {
    if (!slug.trim()) return;
    setState("saving");
    setErrorMsg(null);
    try {
      await onCreate(slug.trim(), keyword.trim());
      setSlug("");
      setKeyword("");
      setState("idle");
    } catch (e) {
      setState("error");
      setErrorMsg(String(e));
    }
  }

  return (
    <div className="new-article-form">
      <div className="field">
        <label htmlFor="new-article-slug">New article slug</label>
        <input
          id="new-article-slug"
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="my-new-article"
        />
      </div>
      <div className="field">
        <label htmlFor="new-article-keyword">Keyword (optional)</label>
        <input
          id="new-article-keyword"
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>
      <button type="button" onClick={handleCreate} disabled={state === "saving" || !slug.trim()}>
        {state === "saving" ? "Creating…" : "New article"}
      </button>
      {state === "error" && <p className="form-error">{errorMsg ?? "Could not create article."}</p>}
    </div>
  );
}
