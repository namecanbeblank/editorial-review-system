import { useState } from "react";
import type { Finding } from "../../engine/dist/schema.js";
import AuditPanel from "./AuditPanel.js";
import Sidebar from "./Sidebar.js";
import type { CoreCoverage } from "./Editor.js";

type Tab = "findings" | "audit";

interface RightPaneProps {
  coverage: CoreCoverage;
  onReviewDraft: () => void;
  onStopReview: () => void;
  findings: Finding[];
  onSelectFinding: (start: number, end: number) => void;
  checking?: boolean;
  clientSlug: string | null;
  articleSlug: string | null;
  docText: string;
  /** Wave 4 (P6 polish spec 3b): true when the editor text differs from the last-saved
   *  draft -- passed straight through to AuditPanel, which runs against the SAVED draft
   *  and so needs to warn when that's stale. */
  dirty: boolean;
  /** Saves the current draft; resolves true on success. Same function as the left pane's
   *  own Save button (App.tsx's handleSave) -- AuditPanel's "Save & run audit" reuses it
   *  rather than duplicating the save logic. */
  onSaveDraft: () => Promise<boolean>;
}

/**
 * RIGHT pane container (Wave 3, PLAN.md P6 3): tabs between the existing findings
 * sidebar and the new on-demand audit panel. Both stay mounted at all times (the
 * inactive one hidden via `display:none`) rather than being conditionally rendered, so
 * AuditPanel's own state -- the fetched/run audit, its running/elapsed bookkeeping --
 * survives a tab flip instead of re-fetching every time the user glances at Findings
 * and back.
 */
export default function RightPane({
  findings,
  onSelectFinding,
  checking,
  clientSlug,
  articleSlug,
  docText,
  dirty,
  onSaveDraft,
  coverage,
  onReviewDraft,
  onStopReview,
}: RightPaneProps) {
  const [tab, setTab] = useState<Tab>("findings");

  return (
    <div className="right-pane">
      <div className="right-pane-tabs">
        <button
          type="button"
          className={tab === "findings" ? "tab-button tab-active" : "tab-button"}
          onClick={() => setTab("findings")}
        >
          Findings
        </button>
        <button
          type="button"
          className={tab === "audit" ? "tab-button tab-active" : "tab-button"}
          onClick={() => setTab("audit")}
        >
          Audit
        </button>
      </div>
      <div className="right-pane-body" style={{ display: tab === "findings" ? "block" : "none" }}>
        <div className="audit-panel">
          <button type="button" className="audit-run-button" disabled={!coverage.total || checking || coverage.running}
            onClick={() => {
              if (window.confirm(`Review ${coverage.total - coverage.checked} remaining text blocks using the paid API? Each body block uses up to 3 model calls. Cached checks are reused. You can stop between blocks.`)) onReviewDraft();
            }}>Review entire draft</button>
          {coverage.running && <button type="button" className="audit-run-button" onClick={onStopReview}>Stop review</button>}
          <p className="audit-meta" role="status">Core passage coverage: {coverage.checked}/{coverage.total} blocks checked · {coverage.failed} failed{coverage.running ? " · Reviewing…" : ""}</p>
          <p className="audit-meta">Includes paragraphs, list items and the first Markdown H1. Section headings and whole-article structure are assessed by the audit. Coverage resets after editing or refreshing.</p>
          {coverage.error && <p className="form-error">{coverage.error}</p>}
        </div>
        <Sidebar findings={findings} onSelectFinding={onSelectFinding} checking={checking} />
      </div>
      <div className="right-pane-body" style={{ display: tab === "audit" ? "block" : "none" }}>
        <AuditPanel
          clientSlug={clientSlug}
          articleSlug={articleSlug}
          docText={docText}
          onScrollToSpan={onSelectFinding}
          dirty={dirty}
          onSaveDraft={onSaveDraft}
        />
      </div>
    </div>
  );
}
