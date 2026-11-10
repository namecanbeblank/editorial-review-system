import type { ArticleBrief, ClientConfig } from "../../engine/dist/schema.js";
import ArticleBriefForm, { NewArticleForm } from "./ArticleBriefForm.js";
import WorkspaceForm from "./WorkspaceForm.js";
import type { ArticleSummary, ClientSummary } from "./api.js";

export type SaveState = "idle" | "saving" | "saved" | "error";

interface ClientPickerProps {
  clients: ClientSummary[];
  clientSlug: string | null;
  onSelectClient: (slug: string) => void;
  articles: ArticleSummary[];
  articleSlug: string | null;
  onSelectArticle: (slug: string) => void;
  client: ClientConfig | null;
  onSave: () => Promise<boolean>;
  saveState: SaveState;
  /** Wave 4 (P6 polish spec 3a): true when the editor text differs from the last-saved
   *  draft -- drives the Save button's dirty indicator and disabled-when-clean state. */
  dirty: boolean;
  /** Wave 3: the current article's brief (null until an article has loaded), and the
   *  three new editing actions -- see App.tsx for what each does. */
  brief: ArticleBrief | null;
  onSaveClientConfig: (config: ClientConfig) => Promise<void>;
  onSaveBrief: (brief: ArticleBrief) => Promise<void>;
  onCreateArticle: (slug: string, keyword: string) => Promise<void>;
}

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "Save",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed – retry",
};

/** Wave 4 (P6 polish spec 3a): the idle label picks up a dirty indicator ("Save •");
 *  every other state already has its own unambiguous label, so dirty doesn't change
 *  those. */
function saveLabel(state: SaveState, dirty: boolean): string {
  if (state === "idle" && dirty) return "Save •";
  return SAVE_LABEL[state];
}

/**
 * LEFT pane (Wave 3, PLAN.md P6 2): client + article pickers fed by the API, the draft
 * Save button, and (new this wave) the fully editable Workspace (client config) and
 * Article brief forms plus the New article affordance -- replacing Wave 1's read-only
 * workspace-facts snippet, which is now redundant next to a live editable form for the
 * same fields.
 */
export default function ClientPicker({
  clients,
  clientSlug,
  onSelectClient,
  articles,
  articleSlug,
  onSelectArticle,
  client,
  onSave,
  saveState,
  dirty,
  brief,
  onSaveClientConfig,
  onSaveBrief,
  onCreateArticle,
}: ClientPickerProps) {
  return (
    <aside className="client-picker">
      <div className="field">
        <label htmlFor="client-select">Client</label>
        <select
          id="client-select"
          value={clientSlug ?? ""}
          onChange={(e) => onSelectClient(e.target.value)}
        >
          {clients.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="article-select">Article</label>
        <select
          id="article-select"
          value={articleSlug ?? ""}
          onChange={(e) => onSelectArticle(e.target.value)}
          disabled={articles.length === 0}
        >
          {articles.map((a) => (
            <option key={a.slug} value={a.slug}>
              {a.keyword ?? a.slug}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        className="save-button"
        onClick={onSave}
        disabled={saveState === "saving" || !dirty}
        title={dirty ? undefined : "No unsaved changes"}
      >
        {saveLabel(saveState, dirty)}
      </button>

      {client && <WorkspaceForm client={client} onSave={onSaveClientConfig} />}
      {brief && <ArticleBriefForm brief={brief} onSave={onSaveBrief} />}
      {clientSlug && <NewArticleForm onCreate={onCreateArticle} />}
    </aside>
  );
}
