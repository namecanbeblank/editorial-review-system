import type { Finding } from "../../engine/dist/schema.js";

/** Wave 2: session-wide llmp spend totals (persists across article/client switches --
 *  see App.tsx, which owns this state independent of the per-document Editor instance).
 *  `calls` counts settle-triggered POSTs (one per request); `cacheHits` counts
 *  cache-served PANEL JOBS across those calls (server/llmp.ts's own per-job cache, up
 *  to 3 per call in live mode) -- NOT bounded by `calls`, so it is deliberately not
 *  rendered as "(N cached)" below (that phrasing would wrongly imply cacheHits <= calls). */
export interface CostMeter {
  calls: number;
  cacheHits: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

interface StatusStripProps {
  wordCount: number;
  findings: Finding[];
  timingMs: number;
  costMeter: CostMeter;
}

/** Bottom status strip: word count, finding counts by severity, pattern-lane timing,
 *  and (Wave 2) the session llmp cost meter. */
export default function StatusStrip({ wordCount, findings, timingMs, costMeter }: StatusStripProps) {
  const counts = { error: 0, warn: 0, info: 0 };
  for (const finding of findings) counts[finding.severity]++;

  return (
    <footer className="status-strip">
      <span>{wordCount} words</span>
      <span className="status-sep" aria-hidden="true" />
      <span className="status-count status-count-error">{counts.error} errors</span>
      <span className="status-count status-count-warn">{counts.warn} warnings</span>
      <span className="status-count status-count-info">{counts.info} info</span>
      <span className="status-sep" aria-hidden="true" />
      <span>pattern lane: {timingMs.toFixed(1)}ms</span>
      <span className="status-sep" aria-hidden="true" />
      <span title="Session paragraph-LLM spend">
        llmp: {costMeter.calls} calls &middot; {costMeter.cacheHits} cache hits &middot;{" "}
        {costMeter.inputTokens}/{costMeter.outputTokens} tok &middot; $
        {costMeter.estimatedCost.toFixed(4)}
      </span>
    </footer>
  );
}
