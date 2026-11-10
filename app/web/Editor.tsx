import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { minimalSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { runTier1 } from "../../engine/dist/tier1/index.js";
import type { ClientConfig, Finding } from "../../engine/dist/schema.js";
import { checkParagraph, type LlmpUsage } from "./api.js";
import { blockAt, hashText, type LlmpEntry } from "./llmp-settle.js";
import { reviewTargets } from "../../engine/dist/review-targets.js";

export interface CoreCoverage { total: number; checked: number; failed: number; running: boolean; error?: string }

export interface EditorStats {
  findings: Finding[];
  wordCount: number;
  timingMs: number;
  /** Wave 2: true while at least one /api/llmp request is in flight -- drives the
   *  sidebar's Core-review header spinner. */
  checking: boolean;
  coverage: CoreCoverage;
}

export interface EditorHandle {
  /** Current doc text, read live from CodeMirror (not a stale React-state copy). */
  getText: () => string;
  /** Scrolls the given absolute char span into view and briefly flashes it. */
  scrollToSpan: (start: number, end: number) => void;
  /** Wave 2: drops all llmp findings/decorations and settle-tracking bookkeeping (in-
   *  flight counter aside -- an already-in-flight request still resolves, but discards
   *  itself the moment it lands: see settleCheck's stale-response guard, which compares
   *  against the doc as it is when the response arrives). Called after a successful
   *  Save (spec: "The Save button + article/client switching must clear all llmp state
   *  cleanly"); article/client switching gets the same guarantee for free by remounting
   *  this whole component with a new `key` (see App.tsx), which discards every ref here. */
  clearLlmpState: () => void;
  reviewDraft: () => Promise<void>;
  stopReview: () => void;
}

interface EditorProps {
  initialText: string;
  client?: ClientConfig;
  /** Stable for this component instance's whole lifetime -- App.tsx remounts Editor via
   *  `key={docKey}` on any client/article change, so these never need ref-mirroring the
   *  way `client`/`onStats`/`onLlmpUsage` do below. */
  clientSlug: string;
  articleSlug: string;
  onStats: (stats: EditorStats) => void;
  /** Wave 2: fired once per completed /api/llmp response (whether or not its findings
   *  end up applied -- a stale-discarded response still reflects real spend/cache
   *  behavior server-side, so the session cost meter counts it regardless). */
  onLlmpUsage: (usage: LlmpUsage) => void;
}

/** Underline decorations for the latest combined (tier1 + llmp) findings. Replaced
 *  wholesale on every recompute (see applyCombinedFindings) rather than diffed. */
const setFindings = StateEffect.define<DecorationSet>();
const findingsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setFindings)) value = effect.value;
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Transient highlight for "click a finding card, see it in the editor." */
const setFlash = StateEffect.define<{ from: number; to: number } | null>();
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setFlash)) {
        value = effect.value
          ? Decoration.set([
              Decoration.mark({ class: "bofu-flash" }).range(effect.value.from, effect.value.to),
            ])
          : Decoration.none;
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Tier1 (pattern lane): wavy/dotted underlines. */
function severityClass(severity: Finding["severity"]): string {
  if (severity === "error") return "bofu-underline-error";
  if (severity === "warn") return "bofu-underline-warn";
  return "bofu-underline-info";
}

/** Wave 2: llmp (paragraph LLM lane): SOLID underlines, same severity colors, visually
 *  distinct from tier1's wavy/dotted style per spec. */
function llmSeverityClass(severity: Finding["severity"]): string {
  if (severity === "error") return "bofu-underline-llm-error";
  if (severity === "warn") return "bofu-underline-llm-warn";
  return "bofu-underline-llm-info";
}

function isLlmRuleId(ruleId: string): boolean {
  return ruleId.startsWith("llmp.") || ruleId.startsWith("llmd.");
}

function classFor(f: Finding): string {
  return isLlmRuleId(f.ruleId) ? llmSeverityClass(f.severity) : severityClass(f.severity);
}

function wordCountOf(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/** Writing-surface look: serif text, generous measure and line height, no code-editor
 *  chrome (minimalSetup carries no line-number gutter). */
const writingTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "16px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif",
    lineHeight: "1.75",
    padding: "2.5rem 3rem 6rem",
    overflow: "auto",
  },
  ".cm-content": {
    maxWidth: "760px",
    margin: "0 auto",
    caretColor: "#1a1a1a",
    padding: "0",
  },
  ".cm-line": { padding: "0" },
});

const DEBOUNCE_MS = 300;
/** Wave 2: "2500ms passed with no further edits" (spec) -- see handleSettleTracking. */
const SETTLE_MS = 2500;

/**
 * CENTER pane: CodeMirror 6 over the raw markdown, decorated with Tier 1 (pattern, in-
 * browser) + Wave 2's Tier 2 (llmp, paragraph-scope, server-side) findings. One
 * EditorView instance per mount -- callers switch articles by remounting with a new
 * React `key` (see App.tsx), not by pushing new props into a live instance, so a fresh
 * article always gets a fresh undo history, immediate (non-debounced) first tier1 pass,
 * and completely fresh llmp settle-tracking state (every ref below starts over).
 */
const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { initialText, client, clientSlug, articleSlug, onStats, onLlmpUsage },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  // `client`/`onStats`/`onLlmpUsage` may be new function/object identities on every App
  // render; keep the latest in a ref so debounced/async code always sees current data
  // without needing to tear down and recreate the CodeMirror view (which would drop
  // undo history and cursor position). clientSlug/articleSlug don't need this treatment
  // -- see the EditorProps comment above.
  const clientRef = useRef(client);
  clientRef.current = client;
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;
  const onLlmpUsageRef = useRef(onLlmpUsage);
  onLlmpUsageRef.current = onLlmpUsage;

  // ---- tier1 + llmp combined findings state ----
  const tier1FindingsRef = useRef<Finding[]>([]);
  const lastTimingMsRef = useRef(0);
  const llmpEntriesRef = useRef<LlmpEntry[]>([]);

  // ---- llmp settle-detection bookkeeping (Wave 2) ----
  /** Start-offset -> last-checked-text-hash, for the "skip the POST if unchanged since
   *  last check" dedupe. Approximate by design (keyed on a client-side Block start that
   *  can drift if earlier text shifts it) -- the server's own cache is the correctness
   *  backstop; this is purely a network-call-avoidance optimization. */
  const blockHashRef = useRef<Map<number, string>>(new Map());
  /** The block with an edit pending a settle-check, or null when nothing is dirty. Set
   *  ONLY by an actual edit (docChanged) -- pure cursor movement into an unedited block
   *  must never mark it dirty, since "its text changed since it was last checked" (the
   *  first half of the spec's settle condition) would then be false. */
  const activeBlockRef = useRef<{ start: number; end: number } | null>(null);
  const settleTimerRef = useRef<number | undefined>(undefined);
  const inFlightRef = useRef(0);
  /** Bumped by clearLlmpState() so an already-in-flight settle-check's response is
   *  discarded even if its [start,end) text still matches (see settleCheck's `.then()`
   *  guard) -- the text-match staleness check alone isn't enough here: Save can clear
   *  llmp state while a request from BEFORE the clear is still in flight, and that
   *  response's paragraph text can still legitimately match the (unedited) current
   *  doc, so it would otherwise silently resurrect a finding Save just cleared. Caught
   *  via a real browser smoke test (see wave report) -- not something the curl-only
   *  verification in the spec would have exercised. */
  const generationRef = useRef(0);
  const reviewedRef = useRef(new Set<number>());
  const failedRef = useRef(new Set<number>());
  const fullRunRef = useRef(false);
  const queueTokenRef = useRef(0);
  const errorRef = useRef<string>();

  useImperativeHandle(
    ref,
    () => ({
      getText: () => viewRef.current?.state.doc.toString() ?? "",
      reviewDraft: async () => {
        const view = viewRef.current;
        if (!view || fullRunRef.current || inFlightRef.current > 0) return;
        const token = ++queueTokenRef.current;
        const text = view.state.doc.toString();
        fullRunRef.current = true;
        errorRef.current = undefined;
        window.clearTimeout(settleTimerRef.current);
        activeBlockRef.current = null;
        applyCombinedFindings(view);
        try {
          for (const target of reviewTargets(text)) {
            if (token !== queueTokenRef.current || viewRef.current !== view || view.state.doc.toString() !== text) break;
            if (reviewedRef.current.has(target.start)) continue;
            const ok = await settleCheck(view, target.start, target.end);
            if (!ok) break; // stop on failure rather than spending across a broken API
          }
        } finally {
          if (token === queueTokenRef.current) fullRunRef.current = false;
          if (viewRef.current === view) applyCombinedFindings(view);
        }
      },
      stopReview: () => {
        queueTokenRef.current += 1;
        fullRunRef.current = false;
        errorRef.current = "Stopped. An already-sent paragraph may finish; unchecked text is not cleared.";
        if (viewRef.current) applyCombinedFindings(viewRef.current);
      },
      scrollToSpan: (start, end) => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
          effects: [
            setFlash.of({ from: start, to: end }),
            EditorView.scrollIntoView(start, { y: "center" }),
          ],
        });
        // Wave 4 polish item 5: re-read viewRef at fire time rather than closing over
        // `view` -- an article/client switch (Editor remount) destroys this view well
        // within the 1200ms window, and dispatching into a destroyed EditorView throws.
        window.setTimeout(() => {
          const current = viewRef.current;
          if (!current) return;
          current.dispatch({ effects: setFlash.of(null) });
        }, 1200);
      },
      clearLlmpState: () => {
        llmpEntriesRef.current = [];
        blockHashRef.current.clear();
        activeBlockRef.current = null;
        window.clearTimeout(settleTimerRef.current);
        inFlightRef.current = 0;
        generationRef.current += 1; // invalidate any settle-check already in flight
        queueTokenRef.current += 1;
        fullRunRef.current = false;
        reviewedRef.current.clear();
        failedRef.current.clear();
        errorRef.current = undefined;
        const view = viewRef.current;
        if (view) applyCombinedFindings(view);
      },
    }),
    [],
  );

  /** Merges tier1 + llmp findings, rebuilds decorations, and reports combined stats.
   *  The SINGLE place that dispatches `setFindings` -- both the tier1 debounce path and
   *  every llmp event (settle start/end, edit-drop, clear) funnel through this so the
   *  two decoration sources can never race or diverge. */
  function applyCombinedFindings(view: EditorView) {
    const merged: Finding[] = [
      ...tier1FindingsRef.current,
      ...llmpEntriesRef.current.flatMap((e) => e.findings),
    ];
    merged.sort((a, b) => a.start - b.start || a.end - b.end || a.ruleId.localeCompare(b.ruleId));

    const text = view.state.doc.toString();
    const decorations = merged
      .filter((f) => f.start >= 0 && f.end <= text.length && f.end > f.start)
      .map((f) => Decoration.mark({ class: classFor(f) }).range(f.start, f.end));
    // Two independently-sorted-by-start sources are merged above; a plain concat+sort
    // can leave equal-start ties in either source's original relative order, so (unlike
    // tier1-only wave 1) we do NOT pass `true` here -- let CodeMirror do its own sort
    // rather than assert one that isn't independently guaranteed.
    view.dispatch({ effects: setFindings.of(Decoration.set(decorations)) });

    onStatsRef.current({
      findings: merged,
      wordCount: wordCountOf(text),
      timingMs: lastTimingMsRef.current,
      checking: inFlightRef.current > 0,
      coverage: { total: reviewTargets(text).length, checked: reviewedRef.current.size,
        failed: failedRef.current.size, running: fullRunRef.current, error: errorRef.current },
    });
  }

  /** Fires the settle POST for [blockStart, blockEnd) unless its text is unchanged since
   *  the last check for that block (client-side dedupe). Handles the "checking…"
   *  indicator, the stale-response discard, and the "replace this paragraph's llmp
   *  findings" merge -- see PLAN.md P6 Wave 2 spec for each of these. */
  async function settleCheck(view: EditorView | null, blockStart: number, blockEnd: number): Promise<boolean> {
    if (!view) return false;
    const text = view.state.doc.toString();
    const blockText = text.slice(blockStart, blockEnd);
    const hash = hashText(blockText);
    if (blockHashRef.current.get(blockStart) === hash) return reviewedRef.current.has(blockStart);
    blockHashRef.current.set(blockStart, hash);

    inFlightRef.current += 1;
    applyCombinedFindings(view);

    const sentText = text;
    const generation = generationRef.current;
    return checkParagraph(clientSlug, articleSlug, sentText, blockStart)
      .then((resp) => {
        onLlmpUsageRef.current(resp.usage);
        // clearLlmpState() (Save) may have run while this request was in flight -- a
        // stale generation means discard unconditionally, even if the text-match check
        // below would otherwise have accepted it (Save doesn't change the doc, so an
        // unedited paragraph's text still matches trivially).
        if (generationRef.current !== generation) return false;
        const currentView = viewRef.current;
        if (!currentView) return false;
        const { start, end } = resp.paragraph;
        const nowText = currentView.state.doc.toString();
        if (sentText !== nowText || end <= start) return false;
        reviewedRef.current.add(start);
        failedRef.current.delete(start);
        errorRef.current = undefined;
        llmpEntriesRef.current = llmpEntriesRef.current.filter((e) => e.start !== start);
        if (resp.findings.length > 0) {
          llmpEntriesRef.current = [...llmpEntriesRef.current, { start, end, findings: resp.findings }];
        }
        applyCombinedFindings(currentView);
        return true;
      })
      .catch((err: unknown) => {
        console.error("bofu-linter: llmp check failed", err);
        if (generationRef.current === generation) {
          blockHashRef.current.delete(blockStart);
          failedRef.current.add(blockStart);
          errorRef.current = String(err);
        }
        return false;
      })
      .finally(() => {
        // clearLlmpState() already reset inFlightRef to 0 for its (new) generation --
        // an old generation's completion must not decrement that fresh count.
        if (generationRef.current !== generation) return;
        inFlightRef.current -= 1;
        const currentView = viewRef.current;
        if (currentView) applyCombinedFindings(currentView);
      });
  }

  /**
   * Settle detection (Wave 2 spec): a block "settles" when BOTH its text changed since
   * last checked AND (the cursor left it OR 2500ms passed with no further edit).
   *
   * - On docChanged: the block under the (post-edit) cursor becomes "active" (dirty,
   *   pending) and a fresh 2500ms timer is scheduled for it, replacing any prior one.
   * - On a selection-only change (no edit this transaction): if there's an active block
   *   and the cursor is no longer inside its span, settle it immediately and clear the
   *   active marker -- landing in some OTHER (unedited) block does NOT make that block
   *   active; only an actual edit does (see activeBlockRef's own comment above).
   */
  function handleSettleTracking(update: ViewUpdate) {
    if (update.docChanged) {
      const text = update.state.doc.toString();
      const blocks = reviewTargets(text);
      const head = update.state.selection.main.head;
      const current = blockAt(blocks, head);

      window.clearTimeout(settleTimerRef.current);
      if (current) {
        const { start, end } = current;
        activeBlockRef.current = { start, end };
        settleTimerRef.current = window.setTimeout(() => {
          settleCheck(viewRef.current, start, end);
          activeBlockRef.current = null;
        }, SETTLE_MS);
      } else {
        activeBlockRef.current = null;
      }
      return;
    }

    if (!update.selectionSet) return;
    const active = activeBlockRef.current;
    if (!active) return;

    const head = update.state.selection.main.head;
    if (head >= active.start && head <= active.end) return; // still inside, nothing to do

    window.clearTimeout(settleTimerRef.current);
    settleCheck(viewRef.current, active.start, active.end);
    activeBlockRef.current = null;
  }

  useEffect(() => {
    function runFindings(view: EditorView) {
      // Always read the doc at the moment this actually fires -- never a value
      // captured back when the debounce timer was scheduled -- so a burst of
      // keystrokes during the 300ms window can never leave stale decorations in place.
      const text = view.state.doc.toString();
      const startedAt = performance.now();
      const findings = runTier1({ text, client: clientRef.current });
      lastTimingMsRef.current = performance.now() - startedAt;
      tier1FindingsRef.current = findings;
      applyCombinedFindings(view);
    }

    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: initialText,
        extensions: [
          minimalSetup,
          markdown(),
          EditorView.lineWrapping,
          writingTheme,
          findingsField,
          flashField,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              window.clearTimeout(timerRef.current);
              timerRef.current = window.setTimeout(() => runFindings(update.view), DEBOUNCE_MS);

              // Drop any llmp findings whose paragraph this edit touched, right away --
              // do not wait for the debounced tier1 pass to reflect it.
              // Context can change even when a quoted paragraph survives verbatim.
              // Invalidate coverage and stop the snapshot queue on any draft edit.
              llmpEntriesRef.current = [];
              blockHashRef.current.clear();
              reviewedRef.current.clear();
              failedRef.current.clear();
              generationRef.current += 1;
              queueTokenRef.current += 1;
              inFlightRef.current = 0;
              fullRunRef.current = false;
              errorRef.current = "Draft changed. Re-run core review for complete coverage; edited text also checks on pause.";
              applyCombinedFindings(update.view);
            }
            handleSettleTracking(update);
          }),
        ],
      }),
    });
    viewRef.current = view;
    runFindings(view);

    return () => {
      queueTokenRef.current += 1;
      generationRef.current += 1;
      window.clearTimeout(timerRef.current);
      window.clearTimeout(settleTimerRef.current);
      view.destroy();
      viewRef.current = null;
    };
    // Intentionally mount-once: initialText/client/clientSlug/articleSlug seed THIS view
    // instance only -- a genuine change to any of them means a new article, which
    // App.tsx handles by remounting with a new `key`, not by updating a live instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="bofu-editor" ref={hostRef} />;
});

export default Editor;
