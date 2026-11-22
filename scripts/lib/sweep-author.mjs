// "Did the automation write this?": the author checks the scheduled sweeps
// apply before they trust a marker.
//
// In this repo: lines 133 to 289 of the MCP Inspector's `scripts/sdk-watch.mjs`
// (modelcontextprotocol/inspector at commit
// 7df76f6eea9ea425891289333837878ebb31ae6a, blob
// 39222ca6b8cfa0c7a279e2c830666c21916b39f5), by copy then edit: the unchanged
// excerpt is this file's first commit here. The source keeps these helpers
// inside its upstream-watch script; that script is not in this repository, and
// the helpers are wanted by the monthly dependency sweep
// (`scripts/dependency-refresh.mjs`) and by the daily alert sweep
// (`scripts/dependabot-alerts.mjs`), so they live on their own here. The
// "#NNNN" numbers below are the source repository's issues. Record:
// PROVENANCE.md, "Sweeps". Design: docs/DESIGN-nor-673-sweeps.md, addition A1.
//
// Edits, each with its reason:
//
//   1. The label list is a PARAMETER (`isSweepAuthored(issue, labels)`,
//      `hasSweepLabels(issue, labels)`); the source's `SWEEP_LABELS` constant is
//      gone. Each sweep applies its own labels, so each caller names them. An
//      empty or malformed list throws: "every one of no labels is present" is
//      true of any issue, and an author check that passes on nothing is the
//      silent pass this file exists to prevent.
//   2. `hasSweepAuthor` reads the REST issue shape, `user.login` and
//      `user.type`, where the source reads `author.login` and `author.is_bot`
//      from `gh issue list --json author`. The sweep here lists its issues
//      through the REST endpoint (the reason is on `findExistingIssue` in
//      `scripts/dependency-refresh.mjs`). REST always states `type`, so the
//      check requires `"Bot"` exactly; the source's tolerance for a missing
//      `is_bot` answered `gh` versions that left the field out, which is not
//      this endpoint's case. A missing or other `type` is "not ours": the cost
//      of that side is a second issue someone can see, where the other side
//      would let an issue this automation did not write steer it.
//   3. `warnOnUnrecognizedAuthors` is not brought in: it calls a marker parser
//      of the upstream-watch script, and the design names six helpers, of which
//      it is not one. What it guarded against is stated under "Known limit".
//   4. This header. The doc comments below are the source's, reworded only
//      where they named the source's labels, its issue forms or its sweep.
//
// `isAutomationComment` is the source's, unchanged. Its caller is the daily
// alert sweep, which reads each comment's author and account type from the
// REST comments listing and hands them over as `author` and `isBot`, the way
// the source's upstream watch does.
//
// Known limit, the source's and kept: the login is matched after normalising
// the spellings listed below. A spelling this file does not know makes the
// sweep decide it has never filed anything, and it files again. Nothing goes
// red when that happens.

/**
 * The account a sweep's own issues and comments are written by.
 *
 * ⚠️ **This repository is PUBLIC, so a marker is not evidence of anything on its
 * own.** Anyone can open an issue or write a comment whose body starts with any
 * string they like, and every marker here is load-bearing for automation
 * (Copilot). Left untrusted, an outsider could file an issue carrying a sweep's
 * marker and have the sweep treat it as its own: edit it, and never file the
 * real one.
 *
 * So a marker counts only when the thing carrying it was written by this
 * automation.
 *
 * ⚠️ **The same account has THREE spellings, and normalizing only some of them
 * disables suppression silently.** That is not hypothetical — it shipped in the
 * source, and cost three identical issues on three consecutive nights (#2377):
 *
 * | Source | Spelling |
 * | --- | --- |
 * | REST issues and comments endpoints | `github-actions[bot]`, `type: "Bot"` |
 * | older `gh issue list --json author` | `github-actions`, `is_bot: true` |
 * | newer `gh issue list --json author` | **`app/github-actions`** |
 *
 * `normalizeLogin` therefore strips an `app/` **prefix** as well as a `[bot]`
 * suffix. Stripping the prefix widens nothing an outsider can claim: `/` is not
 * a legal character in a GitHub username, so no human account can normalize
 * onto `github-actions` — and the labels half of `isSweepAuthored` is an
 * independent check regardless.
 */
export const AUTOMATION_LOGIN = "github-actions";

const normalizeLogin = (login) =>
  String(login ?? "")
    .toLowerCase()
    .replace(/^app\//, "")
    .replace(/\[bot\]$/, "");

/**
 * The labels a caller passed, checked: a non-empty list of non-empty strings.
 *
 * @param {unknown} labels
 * @returns {string[]}
 */
function requireLabels(labels) {
  if (
    !Array.isArray(labels) ||
    labels.length === 0 ||
    labels.some((label) => typeof label !== "string" || label === "")
  ) {
    throw new Error(
      "sweep-author: the sweep's labels must be a non-empty list of label names",
    );
  }
  return labels;
}

/**
 * Was this issue actually filed by the sweep, rather than merely shaped like it?
 *
 * Requires BOTH the automation author and the labels the sweep applies. The
 * labels are the stronger half in practice: the issue forms in
 * `.github/ISSUE_TEMPLATE/` apply `bug` or `enhancement` and nothing else, and
 * setting any other label needs write access, so a drive-by cannot fake one
 * even from an account named to look official.
 *
 * @param {{user?: {login?: string, type?: string}, labels?: Array<{name?: string}>}} issue
 *   an issue as the REST issues endpoint returns it
 * @param {string[]} labels the labels the calling sweep applies
 * @returns {boolean}
 */
export function isSweepAuthored(issue, labels) {
  requireLabels(labels);
  return hasSweepAuthor(issue) && hasSweepLabels(issue, labels);
}

/**
 * The author half of `isSweepAuthored`, on its own.
 *
 * "Wrong labels" is the ordinary way an issue fails the whole check — somebody
 * else's issue that mentions the sweep. "Right labels, unrecognized author" is
 * the signature of a login spelling this file does not know about, which is a
 * defect in `normalizeLogin` rather than anything about the issue.
 *
 * @param {{user?: {login?: string, type?: string}}} issue
 * @returns {boolean}
 */
export function hasSweepAuthor(issue) {
  if (normalizeLogin(issue?.user?.login) !== AUTOMATION_LOGIN) return false;
  // REST always states the account type. Anything but a bot — a human account
  // that happens to carry the name, or an answer with no type at all — is not
  // this automation.
  return issue?.user?.type === "Bot";
}

/**
 * The labels half of `isSweepAuthored`, on its own.
 *
 * This is the half an outsider cannot forge: every label the sweeps apply
 * needs write access on the repo.
 *
 * @param {{labels?: Array<{name?: string}>}} issue
 * @param {string[]} labels the labels the calling sweep applies
 * @returns {boolean}
 */
export function hasSweepLabels(issue, labels) {
  const required = requireLabels(labels);
  const issueLabels = Array.isArray(issue?.labels) ? issue.labels : [];
  const names = new Set(issueLabels.map((l) => l?.name));
  return required.every((label) => names.has(label));
}

/**
 * Was this comment written by the automation?
 *
 * @param {{author?: string, isBot?: boolean}} comment
 * @returns {boolean}
 */
export function isAutomationComment(comment) {
  return (
    normalizeLogin(comment?.author) === AUTOMATION_LOGIN &&
    comment?.isBot !== false
  );
}
