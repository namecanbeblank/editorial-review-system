import type { Finding } from "../../engine/dist/schema.js";

/**
 * Wave 2 (PLAN.md P6): pure, CodeMirror-agnostic helpers for llmp settle detection.
 * Kept separate from Editor.tsx so the block/hash/remap logic is easy to read (and
 * reason about) independent of the view-wiring code that calls it.
 */

/** A blank-line-delimited block of the current doc: a light CLIENT-side approximation
 *  of paragraph boundaries, used only to drive settle detection (dedupe hashing, "did
 *  the cursor leave this block"). The server's own segmentDocument (engine/src/
 *  segment.ts) is authoritative -- whatever offset we send as targetStart, the server
 *  resolves the real (heading/listItem-aware) paragraph around it, so this never needs
 *  that nuance. `end` is the last non-blank line's own end offset (no trailing blank
 *  line folded in). */
export interface Block {
  start: number;
  end: number;
}

/** One settled llmp result, keyed by the SERVER's own resolved paragraph span. */
export interface LlmpEntry {
  start: number;
  end: number;
  findings: Finding[];
}

/**
 * Blank-line-delimited blocks of `text`. A "blank line" is a line containing only
 * whitespace. Mirrors segment.ts's paragraph-flushing shape (buffer start/end, flush on
 * blank) without its heading/list/code special-casing -- "approximation is fine" per
 * spec, since the server re-segments for real around whatever offset we send.
 */
export function computeBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let start = -1;
  let end = -1;
  let pos = 0;
  while (pos <= text.length) {
    const nl = text.indexOf("\n", pos);
    const lineEnd = nl === -1 ? text.length : nl;
    const blank = text.slice(pos, lineEnd).trim().length === 0;
    if (blank) {
      if (start !== -1) blocks.push({ start, end });
      start = -1;
    } else {
      if (start === -1) start = pos;
      end = lineEnd;
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  if (start !== -1) blocks.push({ start, end });
  return blocks;
}

/** The block containing char offset `pos`, inclusive of both ends -- a cursor sitting
 *  exactly at a block's first/last character still counts as "in" it. */
export function blockAt(blocks: Block[], pos: number): Block | undefined {
  return blocks.find((b) => pos >= b.start && pos <= b.end);
}

/** djb2 string hash -> base36. Client-side settle dedupe only ("has this block's text
 *  changed since we last checked it") -- never sent to the server, nothing security-
 *  sensitive. Hand-rolled per the wave-2 constraint: no new dependency for something
 *  this small. `>>> 0` forces an unsigned 32-bit value before the base36 conversion so
 *  the result never carries a leading minus sign. */
export function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = (h * 33 + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** Structural subset of CodeMirror's ChangeSet this module needs -- kept as a local
 *  interface (rather than importing @codemirror/state) so this file stays free of any
 *  CodeMirror dependency; ChangeSet satisfies this shape structurally. */
export interface ChangeMapper {
  mapPos(pos: number, assoc?: number): number;
  touchesRange(from: number, to: number): boolean | "cover";
}

/**
 * Drops any llmp entry whose paragraph span was touched by this transaction's edits
 * (spec: "drop a paragraph's llmp findings the moment its text is edited again"), and
 * remaps the survivors' (and their findings') offsets through the transaction so they
 * stay correctly positioned when an edit EARLIER in the doc shifts everything after it.
 */
export function remapLlmpEntries(entries: LlmpEntry[], changes: ChangeMapper): LlmpEntry[] {
  const next: LlmpEntry[] = [];
  for (const entry of entries) {
    if (changes.touchesRange(entry.start, entry.end) !== false) continue; // true or "cover" -> edited, drop
    const start = changes.mapPos(entry.start, -1);
    const end = changes.mapPos(entry.end, 1);
    const findings = entry.findings.map((f) => ({
      ...f,
      start: changes.mapPos(f.start, -1),
      end: changes.mapPos(f.end, 1),
    }));
    next.push({ start, end, findings });
  }
  return next;
}
