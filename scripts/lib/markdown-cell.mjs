// In this repo: copied unchanged below this note from
// modelcontextprotocol/inspector at commit
// 7df76f6eea9ea425891289333837878ebb31ae6a, scripts/lib/markdown-cell.mjs
// (blob c97d2d0a2d504d051368fe56e94b3c7ee1bb96db). Its `#N` references mean
// the source repo, and of the two scripts it names only
// `dependabot-alerts.mjs`, the daily alert sweep, is in this repository.
// Record: PROVENANCE.md, "Sweeps".

/**
 * Escape a value for a Markdown table cell (#2546).
 *
 * The issue-filing sweeps (`dependabot-alerts.mjs`, `sdk-watch.mjs`) build
 * table rows from text they do not control: advisory summaries and upstream
 * release data. A `|` in that text ends the cell early, so it is escaped as
 * `\|`. That alone is incomplete: a value that itself ends in a backslash,
 * such as `abc\`, would become `abc\\|`, where the backslash pair cancels and
 * the pipe is live again, breaking the row. So backslashes are escaped
 * **first**, then pipes (CodeQL js/incomplete-sanitization, alerts #74–#76).
 *
 * One helper for both scripts, so the order cannot drift between copies.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeTableCell(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}
