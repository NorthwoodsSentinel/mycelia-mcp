#!/usr/bin/env node
// The monthly dependency sweep: once a month it lists every npm package and
// every workflow action that is behind, in ONE GitHub issue it files or edits.
//
// In this repo: the MCP Inspector's script (modelcontextprotocol/inspector at
// commit 7df76f6eea9ea425891289333837878ebb31ae6a,
// scripts/dependency-refresh.mjs, blob
// cd04280227e82f8416c1218e842a1e3723181415), by copy then edit: the unchanged
// file is this file's first commit here. The source's header follows this
// block unchanged, so its "#NNNN" numbers are the source repository's issues,
// and what it says of clients, a Dockerfile, `curl` and a milestone describes
// the source, not this file. Comments further down that cite "(Copilot)" or
// "five installs" are the source's too. Record: PROVENANCE.md, "Sweeps".
// Design: docs/DESIGN-nor-673-sweeps.md, section 2.
//
// What differs from the source, and why:
//
//   1. ONE install. `INSTALLS` is the root only: this repository is one
//      package, with no `clients/*`.
//   2. The Docker half is removed (`DOCKERFILE`, `BASE_IMAGE_ARG`,
//      `INDEX_MEDIA_TYPES`, `parseDockerBaseImage`, `parseDigestHeader`,
//      `shortDigest`, `currentImageDigest`, `staleBaseImage`, and the base-image
//      section of both issue bodies). There is no Dockerfile here, and
//      `parseDockerBaseImage` throws without one. With it goes the script's only
//      `curl` call: this file starts `npm` and `gh` and nothing else.
//   3. The milestone lookup is removed (`currentMilestone`, the `--milestone`
//      argument and the line logged without one). This repository has no
//      milestones.
//   4. The issue's labels are `factory`, `chore` and `dependabot`; the source's
//      first label is `v2`. `factory` is this repository's process label.
//   5. The issue text names this repository: its one branch, its rule and its
//      `AGENTS.md`. The source's issue numbers are gone from it, because in an
//      issue here `#NNNN` would point at this repository's own numbers. The
//      text no longer says the alerts are swept daily: that sweep is not in this
//      repository yet. The cleared body's sentence on SHA pins is corrected: a
//      SHA pin with a `# vX.Y.Z` comment IS ranked (`parseActionRefs`), and
//      every action here is pinned that way.
//   6. ADDITION A1 — a marker is trusted only on what the automation wrote
//      (`AGENTS.md`: "the sweep trusts a marker only on something the
//      automation wrote"). The source's `findExistingIssue` takes any open
//      issue whose body starts with the marker, found by issue search and
//      capped at 10. Here it lists every open issue labelled `dependabot`
//      through the REST listing, read to the last page (`ghPaginatedList`),
//      drops pull requests, and keeps the issue that `isSweepAuthored` accepts
//      (written by `github-actions[bot]`, carrying `SWEEP_LABELS`) and whose
//      body starts with the marker. Search can lag an issue that was just
//      created; the listing does not, and it is not capped.
//   7. ADDITION A3 — every issue write goes through `pacedWrites`, which waits
//      one second before any write after the first (`AGENTS.md`: "Pace bulk
//      GitHub writes"). A run makes one write today, so the wait does not
//      fire; see `scripts/lib/paced-writes.mjs`. `main` takes the writer as its
//      third parameter, so a test can pass one whose pause is a recorder, or
//      one that records which calls went through it.
//
//   8. A FAILED `npm outdated` is recognised by what it printed, as well as by
//      its exit status. The source accepts exit 0 and exit 1 and parses
//      whatever came out, on the understanding that a registry error exits 2.
//      Measured for this change (npm 11.20.0, 2026-11-21, the registry made
//      unreachable): exit **1**, the same status as "something is outdated",
//      with `{"error": {"code": …, "summary": …}}` on standard output. Parsed
//      the source's way that is one outdated package called `error`, and the
//      sweep would have replaced a real table with that row. So `parseOutdated`
//      throws on npm's error report, and on JSON that is not an object of
//      packages (an array reads as "nothing outdated", a string as a package
//      called `0`), and `runOutdated` throws on exit 1 with nothing printed
//      (exit 1 says something is outdated; an empty answer is a short read).
//      The last three are the review model's attack cases 2, 3 and 4
//      (`scripts/dependency-refresh-attack.test.mjs`). With nothing outdated
//      npm prints `{}` and exits 0 (measured the same day), so a clean run is
//      untouched.
//
// Unchanged: that `npm outdated --json` is what is asked (measured over a tree
// installed by Bun: docs/DESIGN-nor-673-sweeps.md, section 3) and that only
// exit 0 and exit 1 can be successes, the action half, the marker, the title,
// and "never closes an issue, never opens a pull request". (Addition A2, a
// `concurrency` block, is in the workflow file.)
//
// What this file can write: one issue's body, or one new issue, in the
// repository `GITHUB_REPOSITORY` names, with the token `gh` finds in its
// environment. It reads this checkout's workflow files, the npm registry
// (through `npm outdated`) and the public release lists of the actions used.
//
// ---- the source's header, unchanged ----
// Monthly dependency sweep (#2229), replacing Dependabot's VERSION-UPDATE PRs.
//
// A Dependabot version-update PR carries no issue and no board card — the same
// carve-out from "every PR references an issue" that the security-update flow
// had (that half is `dependabot-alerts.mjs`, #2233, which turned those PRs off
// as well and files an issue per bump from the alerts they leave behind — so
// between them Dependabot opens no PRs against this repo at all, though its
// security ALERTS stay on, since that sweep is what consumes them).
// #2235 removed `.github/dependabot.yml` outright, so Dependabot opens
// no version-update PRs against this repo at all and this script is what
// replaced them.
//
// Once a month it runs `npm outdated` across the root install and every client
// under `clients/*` (each has its own package.json + lockfile — v2 is not a
// workspace), checks every `uses:` ref under `.github/workflows` against that
// action's highest released version, and files or updates ONE tracking issue
// listing everything behind. A maintainer picks what to bump and opens a
// normal PR against `v2/main`; there is no auto-generated PR here at all.
//
// The actions half is here rather than left on Dependabot because the
// `github-actions` entry had exactly the property #2229 exists to remove: it
// opened a grouped monthly PR carrying no `Closes #N` and no board card.
// Deleting that entry without replacing it would have left action versions
// unwatched, and `npm outdated` says nothing about actions — hence the
// separate release lookup below.
//
// The third half is the Dockerfile's base image (#2885). #2833 pinned it by
// its multi-arch index digest through `ARG NODE_IMAGE=<tag>@sha256:…`, which
// makes a rebuild reproducible and also makes the image stop receiving the
// Node patch releases and Debian security fixes that land under that tag. The
// sweep resolves the tag's CURRENT index digest from the Docker Hub registry
// and lists the pin when the two differ. No Docker daemon and no credential is
// involved: an anonymous pull token from `auth.docker.io`, then a `HEAD` on the
// manifest. Nothing else watches it — the daily alerts sweep skips non-npm
// ecosystems on purpose, and Dependabot's version updates are off (#2235).
//
// Idempotent by design: the issue body starts with a fixed HTML marker
// (ISSUE_MARKER below), which is how a second run in the same month finds and
// updates the existing open issue instead of filing a duplicate.
//
// `parseOutdated`, `parseActionRefs`, `parseVersionRef`, `isActionStale`,
// `staleActions`, `highestVersionTag`, `parseDockerBaseImage`,
// `parseDigestHeader`, `buildIssueBody` and `buildClearedBody` are pure.
// `main()` shells out to `npm outdated`, `gh` and `curl`, so it takes its
// spawn function as a parameter (defaulting to the real one) and
// `dependency-refresh.test.mjs` drives it with a fake — covering npm failure,
// create vs. edit, the milestone lookup, the registry lookup's failures and
// both no-op paths. `workflow_dispatch` is a production trigger,
// not a substitute for that (Copilot): the helper-only tests it replaced let a
// non-zero `npm outdated` exit report a clean sweep.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ghPaginatedList, REPO_SLUG } from "./lib/gh.mjs";
import { isMainModule } from "./lib/main-module.mjs";
import { pacedWrites } from "./lib/paced-writes.mjs";
import { isSweepAuthored } from "./lib/sweep-author.mjs";

export const ISSUE_MARKER = "<!-- dependency-refresh:monthly-sweep -->";

/** Installs to check, relative to the repo root, and their npm-outdated label. */
export const INSTALLS = [{ dir: ".", label: "root" }];

/** Where the `uses:` refs this sweep checks live, relative to the repo root. */
export const WORKFLOW_DIR = ".github/workflows";

/** The labels the tracking issue is filed with. */
export const ISSUE_LABELS = ["factory", "chore", "dependabot"];

/**
 * The labels an open issue must carry, besides its author, before this sweep
 * takes it for its own (addition A1). They are the two the source's own
 * author check names for its upstream watch, in this sweep's spelling: the
 * type label and the sweep's label. The process label is left out, as the
 * source leaves its own out of that check: two labels already need write
 * access to set, and each further one is one more way a relabel by a
 * maintainer would make the sweep stop recognising its own issue.
 */
export const SWEEP_LABELS = ["chore", "dependabot"];

/** Where the issue text points for the rule on where a dependency goes. */
export const PLACEMENT_DOC = `https://github.com/${REPO_SLUG}/blob/main/AGENTS.md#dependency-placement`;

/**
 * Normalize one install's `npm outdated --json` output.
 *
 * Throws on an answer that is not a list of packages (edit 8 in the header):
 * JSON that is not an object, and npm's own error report, which it prints on
 * standard output with exit status 1 — the status that otherwise means
 * "something is outdated".
 *
 * @param {string} json raw stdout from `npm outdated --json` (may be `""` or `"{}"`)
 * @returns {Array<{name: string, current: string, wanted: string, latest: string}>}
 * @throws on JSON that is not an object of packages, and on npm's error report
 */
export function parseOutdated(json) {
  const trimmed = json.trim();
  if (trimmed === "") return [];
  const parsed = JSON.parse(trimmed);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "npm outdated printed JSON that is not an object of packages",
    );
  }
  // npm's error report is `{"error": {"code", "summary", "detail"}}`. A real
  // package named `error` would be an entry like any other, with at least one
  // of the three version fields, so the two cannot be confused.
  const failure = parsed.error;
  if (
    failure !== null &&
    typeof failure === "object" &&
    !Array.isArray(failure) &&
    !("current" in failure) &&
    !("wanted" in failure) &&
    !("latest" in failure)
  ) {
    throw new Error(
      `npm outdated reported an error instead of a list (${String(failure.code ?? "no code")}): ${String(failure.summary ?? "").trim()}`,
    );
  }
  return Object.entries(parsed)
    .map(([name, info]) => ({
      name,
      current: info.current ?? "(missing)",
      wanted: info.wanted ?? info.current ?? "?",
      latest: info.latest ?? "?",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A full-length commit SHA, the only immutable form a `uses:` ref can take. */
export const SHA_REF = /^[0-9a-f]{40}$/;

/**
 * Pull every action reference out of one workflow file.
 *
 * Deliberately a line regex rather than a YAML parse: `uses:` is always a
 * scalar on its own line in this repo's workflows, and a real parser would be
 * this script's only dependency. Local (`./…`) and container (`docker://…`)
 * steps are skipped — neither has a releases feed to compare against — as is
 * an unpinned `uses:` with no `@ref` at all.
 *
 * A SHA-pinned ref (#2484) carries the release it was resolved from as a
 * trailing comment — `uses: actions/checkout@<sha> # v7.0.1` — and that comment
 * is returned as `version`. It is the only thing that makes a SHA pin
 * comparable at all: without it `isActionStale` cannot rank the ref, and a
 * pinned action would silently drop out of the sweep that is meant to watch it.
 * The comment is read on a SHA ref only; on a tag ref the tag already says it.
 *
 * @param {string} yaml raw contents of a workflow file
 * @returns {Array<{action: string, ref: string, version?: string}>} in file order, duplicates kept
 */
export function parseActionRefs(yaml) {
  const refs = [];
  for (const line of yaml.split("\n")) {
    const match = /^\s*(?:-\s+)?uses:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/.exec(
      line,
    );
    if (!match) continue;
    const uses = match[1] ?? match[2] ?? match[3];
    if (uses.startsWith("./") || uses.startsWith("docker://")) continue;
    const at = uses.lastIndexOf("@");
    if (at === -1) continue;
    const entry = { action: uses.slice(0, at), ref: uses.slice(at + 1) };
    const comment = /#\s*(v?\d+(?:\.\d+){0,2})\s*$/.exec(line);
    if (SHA_REF.test(entry.ref) && comment) entry.version = comment[1];
    refs.push(entry);
  }
  return refs;
}

/**
 * Split a `v`-prefixed numeric ref into its components, or `null` when it is
 * not one — a SHA pin or a branch name, which a tag comparison cannot rank.
 *
 * @param {string} ref e.g. `v7`, `v7.0`, `7.0.1`
 * @returns {number[] | null}
 */
export function parseVersionRef(ref) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(ref);
  if (!match) return null;
  return match
    .slice(1)
    .filter((part) => part !== undefined)
    .map(Number);
}

/**
 * Is `current` behind `latest`?
 *
 * Compared only to the precision `current` actually specifies, because that is
 * what pinning to it means: `v7` is a moving major tag that GitHub repoints at
 * every `v7.x` release, so `v7` against a latest of `v7.0.1` is up to date and
 * only `v8` makes it stale. An exactly-pinned `v7.0.0` *is* behind `v7.0.1`.
 *
 * @param {string} current the `uses:` ref
 * @param {string} latest the action's latest release tag
 * @returns {boolean} `false` when either side is not a numeric ref
 */
export function isActionStale(current, latest) {
  const from = parseVersionRef(current);
  const to = parseVersionRef(latest);
  if (from === null || to === null) return false;
  for (let i = 0; i < from.length; i++) {
    const other = to[i] ?? 0;
    if (other !== from[i]) return other > from[i];
  }
  return false;
}

/**
 * A SHA pin is compared by the release its comment names, so it is reported as
 * soon as ANY newer release ships — pinning a SHA pins the patch, and a comment
 * of `v7.0.1` says exactly that. It is shown as that release plus the short
 * SHA, which is what a maintainer re-resolves when bumping it.
 *
 * @param {ReturnType<typeof parseActionRefs>} refs every ref found across the workflows
 * @param {Record<string, string | null>} latestByAction latest release tag per action, `null` when unknown
 * @returns {Array<{action: string, current: string, latest: string}>} the stale ones, deduped and sorted
 */
export function staleActions(refs, latestByAction) {
  const stale = new Map();
  for (const { action, ref, version } of refs) {
    const latest = latestByAction[action];
    if (!latest || !isActionStale(version ?? ref, latest)) continue;
    const current = version ? `${version} (\`${ref.slice(0, 7)}\`)` : ref;
    stale.set(`${action}@${ref}`, { action, current, latest });
  }
  return [...stale.values()].sort(
    (a, b) =>
      a.action.localeCompare(b.action) || a.current.localeCompare(b.current),
  );
}

/**
 * @param {Array<{label: string, packages: ReturnType<typeof parseOutdated>}>} installs
 * @param {ReturnType<typeof staleActions>} actions
 * @returns {string | null} the issue body, or `null` when nothing is behind anywhere
 */
export function buildIssueBody(installs, actions = []) {
  const withPackages = installs.filter((i) => i.packages.length > 0);
  if (withPackages.length === 0 && actions.length === 0) return null;

  const sections = withPackages.map(({ label, packages }) => {
    const rows = packages
      .map(
        (p) => `| \`${p.name}\` | ${p.current} | ${p.wanted} | ${p.latest} |`,
      )
      .join("\n");
    return `### \`${label}\`\n\n| Package | Current | Wanted | Latest |\n| --- | --- | --- | --- |\n${rows}`;
  });

  if (actions.length > 0) {
    const rows = actions
      .map((a) => `| \`${a.action}\` | ${a.current} | ${a.latest} |`)
      .join("\n");
    sections.push(
      `### GitHub Actions\n\n| Action | Current | Latest |\n| --- | --- | --- |\n${rows}`,
    );
  }

  return [
    ISSUE_MARKER,
    "Routine dependency refresh — `npm outdated` and a workflow `uses:` check, run against `main` on a monthly schedule. Dependabot opens no pull requests in this repository; this sweep is what reports a package or an action that is behind.",
    "",
    `This is a tracking issue, not a diff: pick what's worth bumping (\`wanted\` is the safe default; \`latest\` may cross a major and needs its own judgment call; see [Dependency placement](${PLACEMENT_DOC})). A bump then goes the way every change here does, to a pull request against \`main\`.`,
    "",
    ...sections,
    "",
    "A second run of this sweep before this issue closes updates this body in place rather than filing a duplicate.",
  ].join("\n");
}

/**
 * The body a still-open tracking issue is rewritten to once every install AND
 * every workflow action is current again. Without it the issue keeps its last
 * table forever and reads as live work that no longer exists (Copilot).
 *
 * It has to speak for both halves of the sweep: once actions are in scope
 * (#2235), npm-only wording here would assert a clean bill of health the sweep
 * never checked, which is the same silent-all-clear shape the rest of this
 * file guards against.
 *
 * The sweep rewrites rather than closes: closing says the work shipped, which
 * this script cannot verify. A maintainer closes it. (The source's reason was
 * its project board, which this repository does not have; the rule is kept.)
 *
 * @param {string} isoDate the sweep date, as `YYYY-MM-DD`
 * @returns {string}
 */
export function buildClearedBody(isoDate) {
  return [
    ISSUE_MARKER,
    `Everything this sweep can check is current as of ${isoDate} — no npm package is outdated at the root, and no workflow \`uses:\` ref that names its version is behind its action's highest release.`,
    "",
    "A ref names its version when it is a version tag, or a commit SHA followed by a `# vX.Y.Z` comment. A commit SHA with no such comment, or a branch, is deliberately **not** covered by that statement: neither can be ranked against a release tag, so this sweep says nothing about them either way.",
    "",
    "This issue was filed by an earlier run of the monthly sweep and its tables are gone because nothing they listed is behind any more. Either it was bumped or the ranges caught up; nothing here is outstanding.",
    "",
    "Safe to close. A later sweep that finds something behind will refile this body with fresh tables rather than open a duplicate.",
  ].join("\n");
}

function runOutdated(dir, spawn) {
  const result = spawn("npm", ["outdated", "--json"], {
    cwd: dir,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  // `npm outdated` exits 0 when everything is current and 1 when it finds
  // something outdated — both are successful runs. Every other status is a
  // real failure (a registry or config error exits 2), and it MUST throw
  // rather than fall through: a failed run also prints nothing to stdout, so
  // accepting it parses to an empty package list and reports a clean no-op.
  // With five installs swept in a loop, that turns a total outage into a
  // silent "nothing to do" (Copilot).
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `npm outdated failed in ${dir} (exit ${result.status}): ${(result.stderr ?? "").trim()}`,
    );
  }
  const stdout = result.stdout ?? "";
  // Exit 1 says "something is outdated", so it comes with a list. With
  // nothing printed it is a short read, and read as a list it would be an
  // empty one: "nothing is behind", and an open issue's table cleared (edit 8
  // in the header).
  if (result.status === 1 && stdout.trim() === "") {
    throw new Error(
      `npm outdated in ${dir} exited 1, which says something is outdated, and printed nothing: ${(result.stderr ?? "").trim()}`,
    );
  }
  return stdout;
}

function collectActionRefs() {
  return readdirSync(WORKFLOW_DIR)
    .filter((file) => /\.ya?ml$/.test(file))
    .flatMap((file) =>
      parseActionRefs(readFileSync(join(WORKFLOW_DIR, file), "utf8")),
    );
}

/**
 * The highest parseable version among these tags, or `null` if none parse.
 *
 * Deliberately NOT `releases/latest`, which is GitHub's *designated* most
 * recent release rather than the greatest version: an action that ships a
 * maintenance release for an older major (a `v6.9.1` cut after `v8.0.0`) makes
 * `releases/latest` report `v6.9.1`, and a workflow pinned to `v7` would then
 * compare against v6 and read as current — silently missing a whole major
 * upgrade, which is the one thing this check exists to catch (Copilot).
 *
 * @param {string[]} tags release tag names, in any order
 * @returns {string | null}
 */
export function highestVersionTag(tags) {
  let best = null;
  let bestParts = null;
  for (const tag of tags) {
    const parts = parseVersionRef(tag);
    if (parts === null) continue;
    if (bestParts === null || comparePadded(parts, bestParts) > 0) {
      best = tag;
      bestParts = parts;
    }
  }
  return best;
}

/** Compare two version component arrays, padding the shorter with zeroes. */
function comparePadded(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The action's highest released version tag.
 *
 * Reads the release *list* rather than `releases/latest`, for the reason on
 * `highestVersionTag`. Drafts and prereleases are excluded — neither is
 * something a workflow should be told to move to.
 *
 * EVERY page is fetched, not just the newest 100. The list comes back
 * newest-first, which is ordering by release date and not by version: an
 * action that keeps cutting maintenance releases on lower majors pushes the
 * genuine maximum off page 1, and ranking what remains would report a lower
 * major as highest — recreating the exact false-current result that dropping
 * `releases/latest` was meant to prevent (Copilot). Paginating is the only
 * way the "highest released version" this function promises is actually that.
 *
 * @returns {string | null} `null` ONLY for a successful response carrying no
 *   usable release — an action that has never cut one, or whose tags are all
 *   unparseable. A failed lookup is never `null`; see below.
 * @throws on any non-zero status, 404 included
 */
function latestReleaseTag(action, spawn) {
  // `owner/repo/subpath@ref` is a valid `uses:`; releases live on `owner/repo`.
  const repo = action.split("/").slice(0, 2).join("/");
  const result = spawn(
    "gh",
    [
      "api",
      "--paginate",
      `repos/${repo}/releases?per_page=100`,
      "--jq",
      '[.[] | select(.draft == false and .prerelease == false) | .tag_name] | join("\\n")',
    ],
    { encoding: "utf8" },
  );
  if (result.error) throw result.error;
  // EVERY non-zero status is fatal, 404 included. This is the release *list*
  // endpoint, which answers "no releases" with a successful empty array — so a
  // 404 here does not mean "this action cuts no releases", it means the
  // repository is missing or inaccessible, i.e. a `uses:` ref this sweep
  // cannot check at all. Converting that to `null` would silently drop a
  // broken or renamed action from the sweep that replaced Dependabot
  // (Copilot). The empty-array case is already handled by the parse below.
  if (result.status !== 0) {
    throw new Error(
      `release lookup for ${repo} failed (exit ${result.status}): ${(result.stderr ?? "").trim()}`,
    );
  }
  const tags = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return highestVersionTag(tags);
}

/**
 * The open tracking issue an earlier run of this sweep filed, or `null`.
 *
 * Addition A1 (see the header): the source searches issues for the marker and
 * takes the first open one whose body starts with it, whoever wrote it. A
 * marker is not evidence in a public repository: anyone can open an issue
 * whose body starts with any text. So this lists every open issue labelled
 * `dependabot` through the REST listing, to the last page, drops pull requests
 * (the issues endpoint returns those too) and keeps the first that this
 * automation wrote, carries `SWEEP_LABELS`, and starts with the marker.
 *
 * The listing is the one the source's daily alert sweep already uses. It is
 * not issue search, which can lag behind an issue created a moment ago, and it
 * has no cap. `ghPaginatedList` throws on a failed call and on an answer that
 * is not a list of pages; it does not check a total, which this endpoint does
 * not give (design, accepted limitations).
 *
 * @returns {{number: number, body: string} | null}
 */
function findExistingIssue(repo, spawn) {
  const issues = ghPaginatedList(
    spawn,
    `repos/${repo}/issues?state=open&labels=dependabot&per_page=100`,
  );
  return (
    issues.find(
      (issue) =>
        !issue?.pull_request &&
        isSweepAuthored(issue, SWEEP_LABELS) &&
        typeof issue.body === "string" &&
        issue.body.startsWith(ISSUE_MARKER),
    ) ?? null
  );
}

function editIssue(repo, number, body, spawn, write) {
  const edit = write(() =>
    spawn(
      "gh",
      ["issue", "edit", String(number), "--repo", repo, "--body", body],
      { encoding: "utf8" },
    ),
  );
  if (edit.status !== 0)
    throw new Error(`gh issue edit failed: ${edit.stderr}`);
}

/**
 * @param {string} [repo] `owner/name`; defaults to `GITHUB_REPOSITORY`
 * @param {typeof spawnSync} [spawn] every `npm` and `gh` call goes through it
 * @param {<T>(write: () => T) => T} [write] what every issue write goes
 *   through (addition A3); defaults to `pacedWrites()`, which waits a real
 *   second before any write after the first (`lib/paced-writes.mjs`)
 */
export function main(
  repo = process.env.GITHUB_REPOSITORY,
  spawn = spawnSync,
  write = pacedWrites(),
) {
  if (!repo) throw new Error("repo not specified (GITHUB_REPOSITORY unset)");

  const installs = INSTALLS.map(({ dir, label }) => ({
    label,
    packages: parseOutdated(runOutdated(dir, spawn)),
  }));

  const refs = collectActionRefs();
  const latestByAction = Object.fromEntries(
    [...new Set(refs.map((r) => r.action))].map((action) => [
      action,
      latestReleaseTag(action, spawn),
    ]),
  );
  const actions = staleActions(refs, latestByAction);

  // Look the existing issue up BEFORE branching on `body`: the nothing-
  // behind case still has to reach an open issue to clear it.
  const existing = findExistingIssue(repo, spawn);
  const body = buildIssueBody(installs, actions);

  if (body === null) {
    if (!existing) {
      console.log(
        "dependency-refresh: nothing outdated, no stale actions — no-op",
      );
      return;
    }
    editIssue(
      repo,
      existing.number,
      buildClearedBody(new Date().toISOString().slice(0, 10)),
      spawn,
      write,
    );
    console.log(
      `dependency-refresh: nothing behind — cleared stale list on #${existing.number}`,
    );
    return;
  }

  if (existing) {
    editIssue(repo, existing.number, body, spawn, write);
    console.log(`dependency-refresh: updated existing #${existing.number}`);
    return;
  }

  const args = [
    "issue",
    "create",
    "--repo",
    repo,
    "--title",
    "chore(deps): monthly dependency refresh",
    ...ISSUE_LABELS.flatMap((label) => ["--label", label]),
    "--body",
    body,
  ];

  const create = write(() => spawn("gh", args, { encoding: "utf8" }));
  if (create.status !== 0)
    throw new Error(`gh issue create failed: ${create.stderr}`);
  console.log(`dependency-refresh: filed ${create.stdout.trim()}`);
}

if (isMainModule(import.meta.url)) {
  main();
}
