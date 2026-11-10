import type { Finding } from "../../engine/dist/schema.js";
import { useState } from "react";
import { isLlmFinding, reviewTierFor, titleFor } from "./rules.js";

interface SidebarProps {
  findings: Finding[];
  onSelectFinding: (start: number, end: number) => void;
  /** Wave 2: true while at least one /api/llmp request is in flight. Shown as a small
   *  spinner on the Core review header (the group llmp findings land in). */
  checking?: boolean;
}

/** findings arrives pre-sorted by document position (runTier1's own sort); partitioning
 *  with a plain filter/push preserves that order within each group, so no re-sort here. */
function groupByReviewTier(findings: Finding[]): { core: Finding[]; secondary: Finding[] } {
  const core: Finding[] = [];
  const secondary: Finding[] = [];
  for (const finding of findings) {
    (reviewTierFor(finding.ruleId) === "core" ? core : secondary).push(finding);
  }
  return { core, secondary };
}

function FindingCard({ finding, onSelect }: { finding: Finding; onSelect: () => void }) {
  return (
    <button type="button" className="finding-card" onClick={onSelect}>
      <div className="finding-card-head">
        <span className="finding-title">{titleFor(finding.ruleId)}</span>
        <span className="finding-card-chips">
          {isLlmFinding(finding.ruleId) && <span className="chip chip-llm">LLM</span>}
          <span className={`chip chip-${finding.severity}`}>{finding.severity}</span>
        </span>
      </div>
      <p className="finding-message">{finding.message}</p>
      {finding.quote && <p className="finding-fix">“{finding.quote}”</p>}
      {finding.fix && <p className="finding-fix">Fix: {finding.fix}</p>}
    </button>
  );
}

function ReviewGroup({
  title,
  findings,
  onSelectFinding,
  checking,
}: {
  title: string;
  findings: Finding[];
  onSelectFinding: (start: number, end: number) => void;
  checking?: boolean;
}) {
  return (
    <section className="review-group">
      <h3>
        {title} <span className="count">{findings.length}</span>
        {checking && <span className="checking-indicator" title="Checking…" />}
      </h3>
      {findings.length === 0 ? (
        <p className="empty">No {title === "Core review" ? "passage-level findings yet. See coverage above; unchecked text is not a pass" : "secondary findings"}.</p>
      ) : (
        findings.map((finding, i) => (
          <FindingCard
            key={`${finding.ruleId}-${finding.start}-${i}`}
            finding={finding}
            onSelect={() => onSelectFinding(finding.start, finding.end)}
          />
        ))
      )}
    </section>
  );
}

/** RIGHT pane: findings grouped into "Core review" / "Secondary review" via
 *  reviewTierOf, each sorted by document position, with per-group counts in the
 *  headers. Clicking a card scrolls the editor to that span (see App.tsx wiring).
 *  Wave 2: Core review (where llmp findings land, per reviewTierFor) also shows a
 *  "checking…" spinner while a paragraph LLM check is in flight. */
export default function Sidebar({ findings, onSelectFinding, checking }: SidebarProps) {
  const [ruleFilter, setRuleFilter] = useState("");
  const ruleIds = [...new Set(["llmp.generic-pain", "llmp.flat-value-prop", "llmp.feature-dump", "pat.x-not-y-it-is-z", ...findings.map(f => f.ruleId)])];
  const { core, secondary } = groupByReviewTier(ruleFilter ? findings.filter(f => f.ruleId === ruleFilter) : findings);
  return (
    <aside className="sidebar">
      <label htmlFor="finding-rule-filter">Issue type</label>
      <select id="finding-rule-filter" value={ruleFilter} onChange={e => setRuleFilter(e.target.value)} style={{ width: "100%", marginBottom: "1rem" }}>
        <option value="">All occurrences ({findings.length})</option>
        {ruleIds.map(id => <option key={id} value={id}>{titleFor(id)} ({findings.filter(f => f.ruleId === id).length})</option>)}
      </select>
      <ReviewGroup
        title="Core review"
        findings={core}
        onSelectFinding={onSelectFinding}
        checking={checking}
      />
      <ReviewGroup
        title="Secondary review"
        findings={secondary}
        onSelectFinding={onSelectFinding}
      />
    </aside>
  );
}
