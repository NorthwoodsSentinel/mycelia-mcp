/**
 * The account this sweep's own issues and comments are written by.
 *
 * ⚠️ **This repository is PUBLIC, so a marker is not evidence of anything on its
 * own.** Anyone can open an issue or write a comment whose body starts with any
 * string they like, and every marker here is load-bearing for automation
 * (Copilot). Left untrusted, an outsider could:
 *
 *  * file an issue carrying the current target's marker — and close it — to
 *    suppress the real upgrade issue indefinitely;
 *  * post `<!-- sdk-watch:analysis -->` as a comment to suppress analysis
 *    retries forever;
 *  * forge a supersession marker so the genuine note is never posted.
 *
 * So a marker counts only when the thing carrying it was written by this
 * automation.
 *
 * ⚠️ **The same account has THREE spellings, and normalizing only some of them
 * disables suppression silently.** That is not hypothetical — it shipped, and
 * cost three identical issues on three consecutive nights (#2377):
 *
 * | Source | Spelling |
 * | --- | --- |
 * | REST comments endpoint | `github-actions[bot]`, `type: "Bot"` |
 * | older `gh issue list --json author` | `github-actions`, `is_bot: true` |
 * | newer `gh issue list --json author` | **`app/github-actions`** |
 *
 * `normalizeLogin` therefore strips an `app/` **prefix** as well as a `[bot]`
 * suffix. Stripping the prefix widens nothing an outsider can claim: `/` is not
 * a legal character in a GitHub username, so no human account can normalize
 * onto `github-actions` — and the labels half of `isSweepAuthored` is an
 * independent check regardless.
 *
 * A fourth spelling would break it again, and the failure mode is silence. So
 * `sweepIssues` also reports any issue that carries this sweep's marker and its
 * labels but fails the author check — see `warnOnUnrecognizedAuthors`.
 */
export const AUTOMATION_LOGIN = "github-actions";

/** Labels every issue this sweep files carries; an outsider cannot set them. */
export const SWEEP_LABELS = ["chore", "dependencies"];

const normalizeLogin = (login) =>
  String(login ?? "")
    .toLowerCase()
    .replace(/^app\//, "")
    .replace(/\[bot\]$/, "");

/**
 * Was this issue actually filed by the sweep, rather than merely shaped like it?
 *
 * Requires BOTH the automation author and the labels the sweep applies. The
 * labels are the stronger half in practice: the issue forms in
 * `.github/ISSUE_TEMPLATE/` apply `bug`/`enhancement` and `v2`, and setting
 * `chore` or `dependencies` needs write access, so a drive-by cannot fake one
 * even from an account named to look official.
 *
 * @param {{author?: {login?: string, is_bot?: boolean}, labels?: Array<{name?: string}>}} issue
 * @returns {boolean}
 */
export function isSweepAuthored(issue) {
  return hasSweepAuthor(issue) && hasSweepLabels(issue);
}

/**
 * The author half of `isSweepAuthored`, on its own.
 *
 * Split out so `warnOnUnrecognizedAuthors` can distinguish the two ways an
 * issue fails the check. "Wrong labels" is the ordinary case — somebody else's
 * issue that mentions the sweep. "Right labels, unrecognized author" is the
 * signature of a login spelling this script does not know about, which is a
 * defect in `normalizeLogin` rather than anything about the issue.
 *
 * @param {{author?: {login?: string, is_bot?: boolean}}} issue
 * @returns {boolean}
 */
export function hasSweepAuthor(issue) {
  if (normalizeLogin(issue?.author?.login) !== AUTOMATION_LOGIN) return false;
  // `is_bot` is absent on some `gh` versions; only an explicit `false` — a human
  // account that happens to carry the name — is disqualifying.
  return issue?.author?.is_bot !== false;
}

/**
 * The labels half of `isSweepAuthored`, on its own.
 *
 * This is the half an outsider cannot forge: `chore` and `dependencies` both
 * need write access on the repo.
 *
 * @param {{labels?: Array<{name?: string}>}} issue
 * @returns {boolean}
 */
export function hasSweepLabels(issue) {
  const names = new Set((issue?.labels ?? []).map((l) => l?.name));
  return SWEEP_LABELS.every((label) => names.has(label));
}

/**
 * Report issues that look like this sweep's own but whose author it does not
 * recognize.
 *
 * ⚠️ **This is the guard against the whole class of #2377, not just its
 * instance.** Suppression, analysis-retry suppression and supersession notes
 * all gate on `isSweepAuthored`, and when a login spelling stops normalizing
 * they do not fail — they quietly decide the sweep has never filed anything,
 * and the sweep refiles the same issue every night forever. Nothing goes red,
 * so the only way anyone finds out is by noticing the duplicates by hand, which
 * took three nights last time.
 *
 * An issue carrying a valid marker **and** both write-access-only labels, whose
 * author does not normalize onto `AUTOMATION_LOGIN`, is that signature. It
 * cannot be produced by an outsider, because it needs the labels.
 *
 * Reporting rather than throwing is deliberate: a hard failure here would take
 * the nightly sweep down over a cosmetic upstream rename, and the sweep's job —
 * noticing an SDK release — is still worth doing while the spelling is fixed.
 *
 * @param {Array<{author?: {login?: string}, body?: string, labels?: Array<{name?: string}>}>} issues
 * @param {(msg: string) => void} [warn]
 * @returns {string[]} the unrecognized logins, deduplicated
 */
export function warnOnUnrecognizedAuthors(issues, warn = console.warn) {
  const unrecognized = [
    ...new Set(
      (issues ?? [])
        .filter(
          (issue) =>
            !hasSweepAuthor(issue) &&
            hasSweepLabels(issue) &&
            parseMarker(issue?.body) !== null,
        )
        .map((issue) => String(issue?.author?.login ?? "")),
    ),
  ];
  if (unrecognized.length > 0) {
    warn(
      `sdk-watch: ⚠️ ${unrecognized.length} author spelling(s) carry this sweep's marker AND its ` +
        `labels but do not normalize onto "${AUTOMATION_LOGIN}": ${unrecognized.map((l) => JSON.stringify(l)).join(", ")}. ` +
        "Suppression, analysis retries and supersession notes are all disabled for those issues — " +
        "teach `normalizeLogin` the spelling (see #2377).",
    );
  }
  return unrecognized;
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
