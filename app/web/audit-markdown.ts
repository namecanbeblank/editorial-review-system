import type { PersistedAudit } from "./api.js";

const label = (id: string) => id.replace(/^llmd\./, "").replace(/-/g, " ");
const quoteBlock = (quote: string) => quote.replace(/\r\n?/g, "\n").split("\n").map((line) => `> ${line}`).join("\n");

export function auditMarkdown(audit: PersistedAudit, client: string, article: string): string {
  const lines = [
    `# Editorial audit: ${article}`,
    "",
    `Client: ${client}`,
    `Audit date: ${audit.runAt}`,
    "",
    "Feedback refers to the saved draft reviewed at the time of this audit.",
    "",
  ];
  if (audit.meta.parseFailed) {
    lines.push("**Incomplete audit:** the response could not be fully read. Missing findings do not indicate a pass.", "");
  }
  lines.push("## Priority fixes", "");
  const fixes = [...audit.priorityFixes].sort((a, b) => a.rank - b.rank);
  if (!fixes.length) lines.push("No priority fixes returned.", "");
  fixes.forEach((fix, index) => {
    lines.push(`### ${index + 1}. ${label(fix.dimensionId)}`, "", fix.action, "");
    if (fix.quote) lines.push(quoteBlock(fix.quote), "");
  });
  lines.push("## Full review", "");
  const order = { fail: 0, flag: 1, pass: 2 };
  for (const dimension of [...audit.dimensions].sort((a, b) => order[a.verdict] - order[b.verdict])) {
    lines.push(`### ${label(dimension.id)} — ${dimension.verdict.toUpperCase()}`, "");
    if (dimension.note) lines.push(dimension.note, "");
    for (const quote of dimension.quotes) lines.push(quoteBlock(quote), "");
  }
  return lines.join("\n");
}
