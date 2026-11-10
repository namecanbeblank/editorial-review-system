import { useEffect, useRef, useState } from "react";
import type { ArticleBrief, ClientConfig, Finding } from "../../engine/dist/schema.js";
import ClientPicker, { type SaveState } from "./ClientPicker.js";
import Editor, { type EditorHandle, type EditorStats } from "./Editor.js";
import RightPane from "./RightPane.js";
import StatusStrip, { type CostMeter } from "./StatusStrip.js";
import {
  type ArticleSummary,
  type ClientSummary,
  type LlmpUsage,
  createArticle,
  getArticle,
  getClient,
  listArticles,
  listClients,
  saveBrief,
  saveClient,
  saveDraft,
} from "./api.js";

type Stats = EditorStats;

const EMPTY_STATS: Stats = { findings: [], wordCount: 0, timingMs: 0, checking: false,
  coverage: { total: 0, checked: 0, failed: 0, running: false } };

/** Wave 2: session llmp spend totals. Deliberately NOT reset by article/client
 *  switching -- it's a SESSION meter (PLAN.md P6 Wave 2 goal: "a session cost meter
 *  tracks spend"), spanning every article/client visited in this page load. Contrast
 *  with EditorHandle.clearLlmpState, which resets the PER-DOCUMENT findings/decorations
 *  and (as of Wave 3) fires only on an article/client switch (a full Editor remount),
 *  never on Save -- see handleSave's comment below. */
const EMPTY_COST_METER: CostMeter = {
  calls: 0,
  cacheHits: 0,
  inputTokens: 0,
  outputTokens: 0,
  estimatedCost: 0,
};

interface LoadedArticleState {
  draft: string;
  brief: ArticleBrief;
}

/** CodeMirror's Text model normalizes CRLF/CR line endings to bare LF internally --
 *  `view.state.doc.toString()` (what `getText()`/`liveText` always return) never contains
 *  "\r", even when the file on disk does. Wave 4's dirty-tracking compares `liveText`
 *  against the raw file content loaded from the API, so that raw content needs the same
 *  normalization first -- otherwise a CRLF draft.md (e.g. the seeded Example Studio article) reads
 *  as "dirty" the instant it loads, before any real edit happens. */
function toLF(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export default function App() {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [clientSlug, setClientSlug] = useState<string | null>(null);
  const [client, setClient] = useState<ClientConfig | null>(null);

  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [articleSlug, setArticleSlug] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedArticleState | null>(null);
  /** Wave 4 (P6 polish spec 3): the exact text last written to disk via the Save button
   *  -- null until an article has finished loading. Kept separate from `loaded.draft`,
   *  which handleSaveClientConfig also overwrites (with the CURRENT, possibly-unsaved
   *  editor text) purely to seed the Editor's remount after a workspace-config save;
   *  reusing that field for dirty-tracking would wrongly read "clean" the moment a
   *  workspace edit is saved, even though the draft itself was never written to disk. */
  const [lastSavedDraft, setLastSavedDraft] = useState<string | null>(null);

  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [liveText, setLiveText] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [costMeter, setCostMeter] = useState<CostMeter>(EMPTY_COST_METER);
  /** Wave 3 (spec 2d): bumped on every successful client-config save so the Editor's
   *  `key` changes, forcing a remount -- the simplest correct way to make tier1 re-run
   *  with the new config (tier1 only runs on doc-changed events; editing the config
   *  alone doesn't produce one). `docKey` alone already guarantees a fresh key across
   *  client/article switches, so this counter only needs to change WITHIN the same
   *  client/article pair. */
  const [clientVersion, setClientVersion] = useState(0);

  const editorRef = useRef<EditorHandle>(null);

  // Initial client list.
  useEffect(() => {
    listClients()
      .then(setClients)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  // Auto-select the first client once the list arrives.
  useEffect(() => {
    if (!clientSlug && clients.length > 0) setClientSlug(clients[0]!.slug);
  }, [clients, clientSlug]);

  // Selected client -> its config + article list.
  useEffect(() => {
    if (!clientSlug) return;
    setClient(null);
    setArticles([]);
    setArticleSlug(null);
    getClient(clientSlug)
      .then(setClient)
      .catch((e: unknown) => setError(String(e)));
    listArticles(clientSlug)
      .then((list) => {
        setArticles(list);
        setArticleSlug(list[0]?.slug ?? null);
      })
      .catch((e: unknown) => setError(String(e)));
  }, [clientSlug]);

  // Selected article -> its draft + brief.
  useEffect(() => {
    if (!clientSlug || !articleSlug) return;
    setLoaded(null);
    setLastSavedDraft(null);
    getArticle(clientSlug, articleSlug)
      .then((data) => {
        setLoaded(data);
        setLastSavedDraft(toLF(data.draft));
      })
      .catch((e: unknown) => setError(String(e)));
  }, [clientSlug, articleSlug]);

  const docKey = clientSlug && articleSlug ? `${clientSlug}/${articleSlug}` : null;

  /** Wave 4 (P6 polish spec 3): true once the live editor text (mirrored into `liveText`
   *  on every keystroke -- see handleStats below) diverges from the last text actually
   *  saved to disk. Drives the Save button's dirty indicator/disabled state (ClientPicker)
   *  and the Audit tab's "unsaved changes" notice (RightPane -> AuditPanel). */
  const dirty = lastSavedDraft !== null && liveText !== lastSavedDraft;

  /** Returns whether the save succeeded, so a caller that needs to sequence work after it
   *  (AuditPanel's "Save & run audit") can tell a failed save apart from a successful one
   *  rather than assuming success. */
  async function handleSave(): Promise<boolean> {
    if (!clientSlug || !articleSlug || !editorRef.current) return false;
    setSaveState("saving");
    try {
      const text = editorRef.current.getText();
      await saveDraft(clientSlug, articleSlug, text);
      // Wave 3 fix (architect-approved wave-2 follow-up): Save must NOT clear llmp
      // findings/decorations -- only an article/client switch (a full Editor remount)
      // does that. Wave 2 called editorRef.current.clearLlmpState() here; removed.
      setLastSavedDraft(text); // Wave 4: clears the dirty flag -- see `dirty` above.
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1500);
      return true;
    } catch (e) {
      setError(String(e));
      setSaveState("error");
      return false;
    }
  }

  function handleSelectFinding(start: number, end: number) {
    editorRef.current?.scrollToSpan(start, end);
  }

  /** Wave 2: accumulates every /api/llmp response's usage into the session cost meter.
   *  `calls` counts settle-triggered POSTs (one per request, matching "llmp calls made"
   *  in the spec); `cacheHits` comes straight from the server's own count (see api.ts's
   *  LlmpUsage comment for why that can't be inferred client-side from token counts
   *  alone in mock mode). */
  function handleLlmpUsage(usage: LlmpUsage) {
    setCostMeter((prev) => ({
      calls: prev.calls + 1,
      cacheHits: prev.cacheHits + usage.cacheHits,
      inputTokens: prev.inputTokens + usage.inputTokens,
      outputTokens: prev.outputTokens + usage.outputTokens,
      estimatedCost: prev.estimatedCost + usage.estimatedCost,
    }));
  }

  /** Wave 3: mirrors every debounced tier1 pass's stats into `liveText` too -- the
   *  Audit tab (RightPane -> AuditPanel) uses this to decide, via a plain substring
   *  search, whether a persisted audit quote still resolves in the current draft (spec
   *  3: "if the text is not found ... show the snippet greyed"). Reuses the exact same
   *  update cadence `stats` already gets (see Editor.tsx's applyCombinedFindings)
   *  rather than adding a second, independently-timed text-tracking mechanism. */
  function handleStats(next: Stats) {
    setStats(next);
    setLiveText(editorRef.current?.getText() ?? "");
  }

  /** Wave 3 (spec 2d): persists the edited client config, then forces the Editor to
   *  remount with the new config so tier1 re-runs under it -- see clientVersion's own
   *  comment above. Captures the editor's CURRENT (possibly unsaved) text first so the
   *  remount never loses in-progress edits; the remount does clear llmp state as a side
   *  effect (a fresh Editor instance), which is correct here (unlike Save) since llmp
   *  findings computed under the OLD client config -- e.g. against its old proof bank
   *  or banned phrases -- are no longer trustworthy anyway. */
  async function handleSaveClientConfig(config: ClientConfig) {
    if (!clientSlug) return;
    await saveClient(clientSlug, config);
    setClient(config);
    setLoaded((prev) => (prev ? { ...prev, draft: editorRef.current?.getText() ?? prev.draft } : prev));
    setClientVersion((v) => v + 1);
  }

  /** Wave 3 (spec 2b): brief edits only affect server-side llmp/llmd prompts (both
   *  re-read the stored brief fresh on every call) -- tier1 never consumes `brief`, so
   *  no remount or tier1 re-run is needed here, unlike the client-config save above. */
  async function handleSaveBrief(brief: ArticleBrief) {
    if (!clientSlug || !articleSlug) return;
    await saveBrief(clientSlug, articleSlug, brief);
    editorRef.current?.clearLlmpState();
    setLoaded((prev) => (prev ? { ...prev, brief } : prev));
  }

  /** Wave 3 (spec 2c): creates the article, then switches the app's selection to it --
   *  the existing clientSlug/articleSlug effects take it from there (GET the new
   *  article, remount the Editor via docKey). */
  async function handleCreateArticle(slug: string, keyword: string) {
    if (!clientSlug) return;
    await createArticle(clientSlug, slug, keyword || undefined);
    const list = await listArticles(clientSlug);
    setArticles(list);
    setArticleSlug(slug);
  }

  return (
    <div className="app-shell">
      {error && (
        <div className="error-banner" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      <div className="app-main">
        <ClientPicker
          clients={clients}
          clientSlug={clientSlug}
          onSelectClient={setClientSlug}
          articles={articles}
          articleSlug={articleSlug}
          onSelectArticle={setArticleSlug}
          client={client}
          onSave={handleSave}
          saveState={saveState}
          dirty={dirty}
          brief={loaded?.brief ?? null}
          onSaveClientConfig={handleSaveClientConfig}
          onSaveBrief={handleSaveBrief}
          onCreateArticle={handleCreateArticle}
        />

        <main className="editor-pane">
          {docKey && clientSlug && articleSlug && client && loaded ? (
            <Editor
              key={`${docKey}:${clientVersion}`}
              ref={editorRef}
              initialText={loaded.draft}
              client={client}
              clientSlug={clientSlug}
              articleSlug={articleSlug}
              onStats={handleStats}
              onLlmpUsage={handleLlmpUsage}
            />
          ) : (
            <div className="editor-empty">Select an article to begin.</div>
          )}
        </main>

        <RightPane
          key={docKey}
          coverage={stats.coverage}
          onReviewDraft={() => { void editorRef.current?.reviewDraft(); }}
          onStopReview={() => editorRef.current?.stopReview()}
          findings={stats.findings}
          onSelectFinding={handleSelectFinding}
          checking={stats.checking}
          clientSlug={clientSlug}
          articleSlug={articleSlug}
          docText={liveText}
          dirty={dirty}
          onSaveDraft={handleSave}
        />
      </div>

      <StatusStrip
        wordCount={stats.wordCount}
        findings={stats.findings}
        timingMs={stats.timingMs}
        costMeter={costMeter}
      />
    </div>
  );
}
