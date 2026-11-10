import { useEffect, useRef, useState } from "react";
import type { AuditDimension, AuditPriorityFix, AuditVerdict } from "../../engine/dist/tier3/caller.js";
import { getAudit, runAudit as runAuditRequest, type PersistedAudit } from "./api.js";
import { auditMarkdown } from "./audit-markdown.js";

interface AuditPanelProps {
  onAuditChange?: (audit: PersistedAudit | null) => void;
  clientSlug: string | null;
  articleSlug: string | null;
  /** Live editor text (App.tsx keeps this synced to the debounced tier1 pass -- see its
   *  onStats wiring). Used ONLY to decide, locally, whether a persisted quote still
   *  resolves in the CURRENT draft (spec 3: "if the text is not found -- the draft
   *  changed since the audit -- show the snippet greyed with a 'stale' hint"). Never
   *  sent anywhere. */
  docText: string;
  onScrollToSpan: (start: number, end: number) => void;
  /** Wave 4 (P6 polish spec 3b): true when the editor text differs from the last-saved
   *  draft. An audit always runs against what's on disk (see runAuditRequest's own doc
   *  comment in api.ts), so a dirty doc means "this audit would not reflect your latest
   *  edits" -- shown as a one-line notice with a save-then-run shortcut. */
  dirty: boolean;
  /** Saves the current draft; resolves true on success. */
  onSaveDraft: () => Promise<boolean>;
}

const VERDICT_ORDER: Record<AuditVerdict, number> = { fail: 0, flag: 1, pass: 2 };
const VERDICT_LABEL: Record<AuditVerdict, string> = { fail: "Fail", flag: "Flag", pass: "Pass" };

/** A quote pinned by the audit, rendered as a clickable snippet that scrolls the editor
 *  to its position -- located by a plain substring search against the CURRENT doc text
 *  (spec: "locate via text search in the current doc"). When the draft has since
 *  changed enough that the quote no longer resolves, it renders greyed and inert with a
 *  "stale" hint instead of a dead/misleading link. */
function QuoteSnippet({
  quote,
  docText,
  onScrollToSpan,
}: {
  quote: string;
  docText: string;
  onScrollToSpan: (start: number, end: number) => void;
}) {
  const start = docText.indexOf(quote);
  const resolved = start !== -1;
  return (
    <button
      type="button"
      className={resolved ? "audit-quote" : "audit-quote audit-quote-stale"}
      disabled={!resolved}
      title={resolved ? "Jump to this text in the editor" : "This text has changed since the audit ran"}
      onClick={() => resolved && onScrollToSpan(start, start + quote.length)}
    >
      &ldquo;{quote}&rdquo;
      {!resolved && <span className="stale-hint"> (stale)</span>}
    </button>
  );
}

function DimensionCard({
  dimension,
  docText,
  onScrollToSpan,
}: {
  dimension: AuditDimension;
  docText: string;
  onScrollToSpan: (start: number, end: number) => void;
}) {
  return (
    <div className="audit-dimension-card">
      <div className="audit-dimension-head">
        <span className={`verdict-chip verdict-chip-${dimension.verdict}`}>
          {VERDICT_LABEL[dimension.verdict]}
        </span>
        <span className="audit-dimension-id">{dimension.id}</span>
      </div>
      {dimension.note && <p className="audit-dimension-note">{dimension.note}</p>}
      {dimension.quotes.length > 0 && (
        <div className="audit-quotes">
          {dimension.quotes.map((q, i) => (
            <QuoteSnippet key={i} quote={q} docText={docText} onScrollToSpan={onScrollToSpan} />
          ))}
        </div>
      )}
    </div>
  );
}

function PriorityFixRow({
  fix,
  docText,
  onScrollToSpan,
}: {
  fix: AuditPriorityFix;
  docText: string;
  onScrollToSpan: (start: number, end: number) => void;
}) {
  return (
    <li className="priority-fix-row">
      <span className="priority-fix-rank">#{fix.rank}</span>
      <span className="priority-fix-dimension">{fix.dimensionId}</span>
      <p className="priority-fix-action">{fix.action}</p>
      <QuoteSnippet quote={fix.quote} docText={docText} onScrollToSpan={onScrollToSpan} />
    </li>
  );
}

/**
 * RIGHT pane, "Audit" tab (Wave 3, PLAN.md P6 3): the on-demand whole-document audit.
 * Fetches the persisted audit.json for the current article on load/switch (internal
 * effect keyed on clientSlug/articleSlug -- this component stays mounted across tab
 * flips, see RightPane.tsx, so its state survives a glance at Findings and back), runs
 * a fresh one via POST /api/audit on demand, and renders the 15-dimension rubric
 * ordered fail -> flag -> pass plus the ranked priority fixes on top.
 */
export default function AuditPanel({
  clientSlug,
  articleSlug,
  docText,
  onScrollToSpan,
  dirty,
  onSaveDraft,
  onAuditChange,
}: AuditPanelProps) {
  const [audit, setAudit] = useState<PersistedAudit | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const changeRef = useRef(onAuditChange);
  changeRef.current = onAuditChange;
  useEffect(() => { changeRef.current?.(audit); }, [audit]);

  // Persisted audit for THIS article, refetched on every client/article switch. Wiped
  // to null immediately on switch so a stale audit from the PREVIOUS article never
  // flashes while the new one loads.
  useEffect(() => {
    setAudit(null);
    setError(null);
    if (!clientSlug || !articleSlug) return;
    let active = true;
    getAudit(clientSlug, articleSlug)
      .then((result) => { if (active) setAudit(result); })
      .catch((e: unknown) => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [clientSlug, articleSlug]);

  useEffect(() => () => window.clearInterval(timerRef.current), []);

  async function handleRun() {
    if (!clientSlug || !articleSlug || running) return;
    setRunning(true);
    setError(null);
    setElapsed(0);
    const startedAt = Date.now();
    timerRef.current = window.setInterval(() => {
      setElapsed(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    try {
      const result = await runAuditRequest(clientSlug, articleSlug);
      setAudit(result);
    } catch (e) {
      setError(String(e));
    } finally {
      window.clearInterval(timerRef.current);
      setRunning(false);
    }
  }

  /** Wave 4 (P6 polish spec 3b): saves the draft first, then runs -- only if the save
   *  actually succeeded (onSaveDraft resolves false on a failed save, which already
   *  surfaces its own error via App.tsx's error banner, so there's nothing more to
   *  report here). */
  async function handleSaveAndRun() {
    const saved = await onSaveDraft();
    if (saved) await handleRun();
  }

  function handleDownload() {
    if (!audit || !clientSlug || !articleSlug) return;
    const blob = new Blob([auditMarkdown(audit, clientSlug, articleSlug)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${articleSlug}-audit-${audit.runAt.slice(0, 10)}.md`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (!clientSlug || !articleSlug) {
    return <div className="audit-panel audit-empty">Select an article to audit it.</div>;
  }

  const failedRun = audit?.meta.parseFailed === true;
  const orderedDimensions =
    audit && !failedRun
      ? [...audit.dimensions].sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict])
      : [];
  const orderedFixes = audit ? [...audit.priorityFixes].sort((a, b) => a.rank - b.rank) : [];

  return (
    <div className="audit-panel">
      <button type="button" className="audit-run-button" onClick={handleRun} disabled={running}>
        {running ? `Running… ${elapsed}s` : audit ? "Re-run audit" : "Run audit"}
      </button>
      {error && <p className="form-error">{error}</p>}
      {audit && (
        <>
          <button type="button" className="audit-run-button" onClick={handleDownload}>Download Markdown</button>
          <p className="audit-meta">Audit saved automatically. It stays available after refreshing.</p>
        </>
      )}

      {dirty && (
        <div className="audit-dirty-notice">
          <p>Unsaved changes — the audit runs on the last saved draft</p>
          <button type="button" className="audit-run-button" onClick={handleSaveAndRun} disabled={running}>
            {running ? `Running… ${elapsed}s` : "Save & run audit"}
          </button>
        </div>
      )}

      {audit && (
        <div className="audit-meta">
          <span>Ran {new Date(audit.runAt).toLocaleString()}</span>
          <span> &middot; ${audit.usage.estimatedCost.toFixed(4)}</span>
        </div>
      )}

      {failedRun && (
        <div className="audit-failed-state">
          <p>Audit output was truncated — run again.</p>
        </div>
      )}

      {audit && !failedRun && orderedFixes.length > 0 && (
        <section className="priority-fixes">
          <h3>Priority fixes</h3>
          <ol>
            {orderedFixes.map((fix) => (
              <PriorityFixRow key={fix.rank} fix={fix} docText={docText} onScrollToSpan={onScrollToSpan} />
            ))}
          </ol>
        </section>
      )}

      {audit && !failedRun && (
        <section className="audit-dimensions">
          {orderedDimensions.map((d) => (
            <DimensionCard key={d.id} dimension={d} docText={docText} onScrollToSpan={onScrollToSpan} />
          ))}
        </section>
      )}

      {!audit && !running && <p className="empty">No audit yet for this article.</p>}
    </div>
  );
}
