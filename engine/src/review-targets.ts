import { segmentDocument } from "./segment.js";
import type { Segment } from "./schema.js";

/** Browser-safe target enumeration shared by the editor and paragraph caller. */
export function reviewTargets(text: string): Segment[] {
  let titleSeen = false;
  return segmentDocument(text).flatMap((segment): Segment[] => {
    if (segment.kind === "paragraph") return [segment];
    if (segment.kind === "listItem") {
      // Include the list marker so reasoning-in-bullets can apply its scope gate.
      const start = text.lastIndexOf("\n", segment.start - 1) + 1;
      return [{ ...segment, start, text: text.slice(start, segment.end) }];
    }
    if (segment.kind === "heading" && segment.depth === 1 && !titleSeen) {
      titleSeen = true;
      return [segment];
    }
    return [];
  });
}
