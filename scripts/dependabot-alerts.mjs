#!/usr/bin/env node
// The daily alert sweep: once a day it reads this repository's open Dependabot
// alerts and files ONE GitHub issue per bump, or edits the one it filed before.
//
// In this repo: the MCP Inspector's script (modelcontextprotocol/inspector at
// commit 7df76f6eea9ea425891289333837878ebb31ae6a,
// scripts/dependabot-alerts.mjs, blob
// 3df0252a61d81e5cde610f0fc76cc88f656704af), by copy then edit: the unchanged
// file is this file's first commit here. The source's header follows this
// block unchanged, so its "#NNNN" numbers are the source repository's issues,
// and what it says of a board, a milestone, a second token, five lockfiles and
// a second branch describes the source, not this file. Comments further down
// that cite "(Copilot)" or a "#NNNN" are the source's too, and the doc
// comments of the functions kept unchanged still say `package-lock.json`:
// here their `lock` is the shape `readLockfile` builds from `bun.lock`.
// Record: PROVENANCE.md, "Sweeps".
// Design: docs/DESIGN-nor-673-sweeps.md, section 2.
//
// What differs from the source, and why:
//
//   1. The board write is removed (`PROJECT_ID`, both field ids,
//      `BOARD_STATUS`, `BOARD_PRIORITY`, `optionId`, `addToBoard`, and the
//      end-of-run failure on a half-placed card). This repository has no
//      project board, and the second token that write used is not passed to
//      the job.
//   2. The milestone lookup is removed (`currentMilestone`, `pickMilestone`,
//      the `--milestone` argument). This repository has no milestones.
//   3. `TARGET_BRANCH` is `main`, this repository's one branch. The source's
//      reason for re-checking an alert (alerts computed from one branch,
//      shipping from another) does not exist here. The re-check stays for a
//      reason of this repository's own: GitHub's dependency graph for it is
//      built from `package.json` (measured for the design, section 5), which
//      holds ranges, so an alert says nothing of which version is installed.
//      Only `bun.lock` says that.
//   4. The lockfile is `bun.lock`, read through the existing reader,
//      `scripts/lib/bun-lock.mjs`. `readLockfile` hands the source's functions
//      the shape they already read: `packages[""]` is the root workspace, and
//      `packages[<dir>]` is `{version}`, where `<dir>` is the reader's
//      `node_modules/a/node_modules/b` form. So `lockfileEntries`,
//      `isDirectDependency`, `narrowToApplicable` and `remediation` are the
//      source's, unchanged. One check is added on what the lockfile holds: a
//      copy of the alerted package whose version is not a semver version
//      cannot be compared with a range, so that bump is left alone this run
//      (the source's lockfile holds only versions; a `bun.lock` entry can
//      name a git or file source).
//   5. The alert's `manifest_path` is NEVER opened as a file. The source hands
//      it to `readFileSync`. Here it is compared with a fixed list
//      (`KNOWN_MANIFESTS`: `package.json` and `bun.lock`), and the one file
//      read is this checkout's own `bun.lock`, by a constant name. A path
//      outside the list is `indeterminate`: logged for a person, and an issue
//      that tracks it is left exactly as it is. With that the source's
//      "manifest is gone" case is gone too: it cleared an issue on the
//      strength of a missing file, and here a `bun.lock` that is missing or
//      will not parse is a failed read, never evidence.
//   6. `checkSecurityPrsStillDisabled` makes its one call with the job's own
//      token; the source could hand it a second one. With the job's token the
//      setting cannot be read, so the run logs UNVERIFIED and carries on
//      (`AGENTS.md`, "Dependency updates are issue-driven"). Added here: an
//      answer that IS readable must be an object with a true-or-false
//      `enabled`. The source reads an empty answer as "still off".
//   7. An issue's labels are `factory`, `chore` and `dependabot`; the source's
//      first label is `v2`. `factory` is this repository's process label.
//   8. The issue text names this repository: its one branch and its
//      `AGENTS.md`. The source's issue number is gone from it, because in an
//      issue here `#NNNN` would point at this repository's own numbers. The
//      note on a board Priority is gone with the board, and the cleared body
//      no longer speaks of a board card. The declared range is always in
//      `package.json`.
//   9. The `overrides` advice is the top-level form only, and
//      `scopedOverrideExample` and `overrideAncestors`, which built a
//      parent-scoped example, are removed. Measured for this change with Bun
//      1.3.14, the version CI pins, in scratch projects: a nested entry is
//      ignored with the warning "Bun currently does not support nested
//      "overrides""; a top-level entry is applied; and a top-level entry
//      beside a direct dependency of the same name is accepted and decides
//      the version (npm refuses that with EOVERRIDE, which is why the source
//      reaches for the nested form).
//  10. ADDITION A1 — a marker is trusted only on what the automation wrote
//      (`AGENTS.md`: "the sweep trusts a marker only on something the
//      automation wrote"). The source takes every open issue labelled
//      `dependabot` whose body starts with its marker, and a marker in any
//      comment. Here an issue counts only if `isSweepAuthored` accepts it
//      (written by `github-actions[bot]`, account type `Bot`, carrying
//      `SWEEP_LABELS`), and a comment's marker only if `isAutomationComment`
//      accepts the comment. Comments are read from the REST endpoint, which
//      states each author's account type, as the source's upstream watch
//      reads them. A forged issue is neither edited nor cleared, and cannot
//      stop the real one being filed; a forged comment cannot stop an
//      advisory being announced.
//  11. ADDITION A3 — every issue write (a create, an edit, a comment) goes
//      through `pacedWrites`, which waits one second before any write after
//      the first (`AGENTS.md`: "Pace bulk GitHub writes"). This sweep can
//      make several writes in a run, so here the wait does fire. `main` takes
//      the writer as its fourth parameter, so a test passes one that does not
//      wait.
//  12. `gh` is called through this repository's `scripts/lib/gh.mjs` (`gh`,
//      `ghPaginatedList`); the source's private `gh` and `ghJson` are gone.
//      Without the second token they differed from the shared pair only by
//      lacking its stated output buffer.
//  13. What `gh` hands back is checked before it is acted on, and a failed
//      check throws. The alert listing: each entry must be an object that
//      names its package, its manifest and its advisory, because an issue is
//      cleared when its advisory is ABSENT from this listing, and an entry
//      that cannot be keyed is an open alert the run cannot account for. The
//      issue listing and each comment listing: no pages at all throws
//      (`ghPaginatedList`), and so does an entry that is not an object. An
//      issue this sweep takes for its own must have a positive integer
//      `number`: it is the one field of the listing that reaches `gh` as an
//      argument of its own. The setting, the alert listing and the issue
//      listing are all read before the first write, so a failure in any of
//      them leaves every issue as it was. A comment listing is read just
//      before the one comment it guards; a failure there stops the run with
//      that issue untouched, after whatever earlier bumps were written.
//
// Unchanged: the grouping by (package, manifest, patched version), the two
// markers, the title, the order "comment first, then the marker", the
// reconciliation of an issue whose alert has left the open listing, and
// "never closes an issue, never opens a pull request". (The `concurrency`
// block is in the workflow file, as in the source.)
//
// Known limits, each stated in the design note, section 5: GitHub's
// dependency graph holds only this repository's direct dependencies, so an
// advisory on a transitive package raises no alert and this sweep cannot see
// it. The `manifest_path` of an alert here is inferred to be `package.json`;
// no alert has existed to read it from. A listing is checked for its shape,
// not against a total, which neither endpoint gives. An alert the sweep
// cannot check (not npm, an unknown manifest, an unreadable lockfile) is
// logged, its issue is left alone, and the run stays green. (The workflow's
// install step reads the same `bun.lock` first and fails on one Bun cannot
// read; a lockfile version this reader does not know also fails the gate's
// install guard, which uses the same reader.)
//
// What this file can write: issues, issue edits and issue comments in the
// repository `GITHUB_REPOSITORY` names, with the token `gh` finds in its
// environment. It reads that repository's open Dependabot alerts, its open
// issues labelled `dependabot` and their comments, one repository setting,
// and this checkout's `bun.lock`.
//
// ---- the source's header, unchanged ----
// Dependabot alert sweep (#2233), the alert-consuming half of #2229.
//
// Dependabot's SECURITY-update PRs are turned off in repo settings; its alerts
// stay on. This script is what consumes them:
//
//   alert -> scheduled sweep -> issue (labeled, milestoned, boarded) -> maintainer PR -> v2/main
//
// A Dependabot-opened PR carries no `Closes #N` and no board card, which is the
// carve-out from "every PR references an issue" that #2229 exists to remove.
// The version-update half was removed outright in #2235 and replaced by
// `dependency-refresh.mjs`; this is the security half, and it files issues
// rather than PRs for the same reason.
//
// Three things shape the design, each verified against this repo before it was
// written:
//
//  1. There is no `dependabot_alert` WORKFLOW trigger — it is a webhook event
//     only — so this is a scheduled sweep, not event-driven. Daily is enough;
//     alerts are not minute-sensitive.
//  2. `GITHUB_TOKEN` can read alerts with `vulnerability-alerts: read`, so no
//     PAT is needed for the sweep itself. Two side steps DO need one, and both
//     degrade rather than block: writing the board card (an org project is
//     outside `GITHUB_TOKEN`'s reach — an unboarded-but-milestoned issue is
//     swept into Todo by the next `/issue-triage` pass), and reading back the
//     `automated-security-fixes` setting (`administration: read`, which
//     `permissions:` cannot grant at all — so that guard reports UNVERIFIED
//     rather than failing when the token cannot see it).
//  3. Alerts are per-ADVISORY but a fix is per-BUMP. Today's seven open alerts
//     are three `overrides` entries, so grouping by
//     `(package, manifest_path, first_patched_version)` is what keeps this from
//     filing seven issues for three pieces of work.
//
// ⚠️ GitHub computes the dependency graph — and therefore every alert — from
// the DEFAULT branch (`main`), while we ship from `v2/main`. So an alert is not
// trusted on its face: the vulnerable range is re-checked against `v2/main`'s
// own lockfile before anything is filed. The blind spot that leaves is stated
// plainly in the workflow header: a vulnerable dependency introduced on
// `v2/main` and not yet merged to `main` produces no alert at all, and no
// approach that consumes GitHub's alerts can see it. The release-time
// `npm audit --audit-level=high` report (#2231) is the partial second signal.
//
// Idempotency key is the marker comment at the top of each issue body, which
// names the package, the manifest and every GHSA the issue covers. A second run
// the same day is a complete no-op; a NEW advisory for a package that already
// has an open issue lands as a comment on it and rewrites the marker, rather
// than filing a second issue.
//
// Everything here is covered by `dependabot-alerts.test.mjs`: the pure halves
// directly, and `main()` through an injected spawn function, the same way
// `dependency-refresh.mjs` does it. `workflow_dispatch` is a production
// trigger, not a test, so the orchestration that handles API failures, lockfile
// filtering, issue idempotency and partial board writes is exercised here
// rather than left to a real run (Copilot).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import semver from "semver";
import { parseBunLock } from "./lib/bun-lock.mjs";
import { gh, ghPaginatedList, REPO_SLUG } from "./lib/gh.mjs";
import { escapeTableCell as cell } from "./lib/markdown-cell.mjs";
import { isMainModule } from "./lib/main-module.mjs";
import { pacedWrites } from "./lib/paced-writes.mjs";
import { isAutomationComment, isSweepAuthored } from "./lib/sweep-author.mjs";

/**
 * The branch the lockfile is read on, and the fix is written against: this
 * repository's one branch.
 *
 * The workflow checks it out, so `bun.lock` is read from the working tree.
 * Named here only so the issue body can say which branch the versions it
 * quotes came from.
 */
export const TARGET_BRANCH = "main";

/**
 * The one ecosystem this sweep can act on.
 *
 * ⚠️ Dependabot alerts are NOT npm-only. This repository has GitHub Actions
 * workflows, and an alert against an action arrives in the same feed.
 * Everything downstream reads the npm lockfile, so a non-npm alert is reported
 * and skipped rather than guessed at: filing it properly means knowing how to
 * fix it, which is different work per ecosystem.
 */
export const SUPPORTED_ECOSYSTEM = "npm";

/** The one file this sweep reads from the checkout, by this constant name. */
export const LOCKFILE = "bun.lock";

/**
 * The `manifest_path` values this sweep knows. Each means "check
 * `bun.lock`"; an alert that names any other path is not checked and not
 * cleared (the header, edit 5). The value is compared with this list and is
 * never used as a path.
 */
export const KNOWN_MANIFESTS = ["package.json", "bun.lock"];

/** Where a declared range lives: this repository has one manifest. */
const DECLARED_IN = "package.json";

/** The labels each issue is filed with. */
export const ISSUE_LABELS = ["factory", "chore", "dependabot"];

/**
 * The labels an open issue must carry, besides its author, before this sweep
 * takes it for its own (addition A1): the same two the monthly sweep asks for
 * (`scripts/dependency-refresh.mjs`, where the reason for leaving the process
 * label out is given).
 */
export const SWEEP_LABELS = ["chore", "dependabot"];

const MARKER_RE =
  /^<!-- dependabot-alerts: pkg=(.+?); manifest=(.+?); fixed=(.+?); ghsas=(.+?) -->/;

/** Marker on the comment that announces newly-seen advisories, keyed by GHSA. */
const COMMENT_MARKER_RE = /^<!-- dependabot-alerts:added (.+?) -->/;

/**
 * The issue body's first line: the idempotency key.
 *
 * It carries `fixedIn` as well as the package and manifest because that triple
 * IS the grouping key — two advisories on one package needing different patched
 * versions are different bumps and get different issues. Keyed on the pair
 * alone, a second bump would match the first issue and merge its GHSAs and its
 * target version into the wrong one (Copilot).
 *
 * @param {{package: string, manifestPath: string, fixedIn: string, ghsas: string[]}} group
 * @returns {string}
 */
export function buildMarker({ package: pkg, manifestPath, fixedIn, ghsas }) {
  return `<!-- dependabot-alerts: pkg=${pkg}; manifest=${manifestPath}; fixed=${fixedIn}; ghsas=${[...ghsas].sort().join(",")} -->`;
}

/**
 * Read a marker back off an issue body.
 *
 * @param {string | undefined} body
 * @returns {{package: string, manifestPath: string, fixedIn: string, ghsas: string[]} | null}
 */
export function parseMarker(body) {
  const match = MARKER_RE.exec(body ?? "");
  if (!match) return null;
  return {
    package: match[1],
    manifestPath: match[2],
    fixedIn: match[3],
    ghsas: match[4].split(",").filter(Boolean),
  };
}

/**
 * The GHSAs a previously-posted "new advisories" comment already announced.
 *
 * @param {string | undefined} body
 * @returns {string[] | null} `null` when the comment carries no marker
 */
export function parseCommentMarker(body) {
  const match = COMMENT_MARKER_RE.exec(body ?? "");
  if (!match) return null;
  return match[1].split(",").filter(Boolean);
}

/**
 * Which of `group`'s advisories the existing issue does not already name.
 *
 * @param {string[]} existing the marker's GHSA list
 * @param {string[]} incoming the GHSAs the sweep just saw
 * @returns {{merged: string[], added: string[]}} both sorted
 */
export function mergeGhsas(existing, incoming) {
  const known = new Set(existing);
  const added = [...new Set(incoming.filter((g) => !known.has(g)))].sort();
  const merged = [...new Set([...existing, ...incoming])].sort();
  return { merged, added };
}

/**
 * Translate a GitHub `vulnerable_version_range` into a range npm `semver`
 * understands.
 *
 * ⚠️ GitHub separates conjuncts with a COMMA (`>= 3.1.3, < 3.1.6`); node-semver
 * reads a comma as nothing at all and quietly returns `false` for a version
 * that is in fact in range. Space is semver's AND, so the fix is a split/join —
 * but the failure it prevents is silent, which is why this is its own tested
 * function rather than an inline `.replace`.
 *
 * @param {string} range
 * @returns {string}
 */
export function toSemverRange(range) {
  return range
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Every installed copy of `pkg` in an npm lockfile, with its tree path.
 *
 * A package can legitimately appear more than once — a hoisted
 * `node_modules/x` plus one or more nested `node_modules/y/node_modules/x` —
 * and the copies can be at DIFFERENT versions. The path is kept rather than
 * just the version because it is what distinguishes the copy the manifest
 * declares from a copy some dependency dragged in, and the fix for those two
 * is not the same (Copilot).
 *
 * @param {object} lock parsed `package-lock.json` (lockfileVersion 2 or 3)
 * @param {string} pkg
 * @returns {Array<{path: string, version: string, hoisted: boolean}>} sorted by version
 */
export function lockfileEntries(lock, pkg) {
  const hoistedPath = `node_modules/${pkg}`;
  const entries = [];
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (path !== hoistedPath && !path.endsWith(`/${hoistedPath}`)) continue;
    if (!entry?.version) continue;
    entries.push({
      path,
      version: entry.version,
      hoisted: path === hoistedPath,
    });
  }
  return entries.sort(
    (a, b) =>
      semver.compare(a.version, b.version) || a.path.localeCompare(b.path),
  );
}

/**
 * Every version of `pkg` installed anywhere in an npm lockfile.
 *
 * @param {object} lock parsed `package-lock.json` (lockfileVersion 2 or 3)
 * @param {string} pkg
 * @returns {string[]} sorted, deduped
 */
export function lockfileVersions(lock, pkg) {
  return [...new Set(lockfileEntries(lock, pkg).map((e) => e.version))].sort(
    semver.compare,
  );
}

/**
 * Is `pkg` declared by the manifest itself, rather than pulled in transitively?
 *
 * ⚠️ Being declared is NOT by itself the question the issue needs answered —
 * see `remediation` below. A manifest can declare a safe `pkg@^4` while some
 * dependency drags a vulnerable `pkg@3` into a nested folder, and telling the
 * maintainer to raise an already-safe range would leave the vulnerable copy
 * exactly where it is (Copilot).
 *
 * @param {object} lock parsed `package-lock.json`
 * @param {string} pkg
 * @returns {boolean}
 */
export function isDirectDependency(lock, pkg) {
  const root = lock.packages?.[""] ?? {};
  return Boolean(
    root.dependencies?.[pkg] ??
    root.devDependencies?.[pkg] ??
    root.optionalDependencies?.[pkg] ??
    root.peerDependencies?.[pkg],
  );
}

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, moderate: 2, low: 1 };

/**
 * The grouping key: one bump, i.e. one edit to one manifest.
 *
 * JSON rather than a delimited string, because the three fields are free-form
 * and any separator would have to be argued for — the one that was here was a
 * literal NUL, which classified the whole source file as binary and made
 * repository searches skip it (Copilot). Shared with the end-of-run
 * reconciliation, so a key built from a marker and a key built from an alert
 * cannot drift apart.
 *
 * @returns {string}
 */
export function groupKey(pkg, manifestPath, fixedIn) {
  return JSON.stringify([pkg, manifestPath, fixedIn]);
}

/**
 * One advisory as it applies to one manifest.
 *
 * ⚠️ A GHSA alone is not enough. Dependabot alerts are per MANIFEST, and this
 * repo has five lockfiles — so the same advisory legitimately appears for the
 * root install and for a client. Keying reconciliation on the GHSA alone lets
 * another manifest's still-filable alert vouch for this one, and an issue whose
 * own alert lost its patched version would be cleared on the strength of a
 * different lockfile's alert (Copilot).
 *
 * @returns {string}
 */
export function advisoryKey(pkg, manifestPath, ghsa) {
  return JSON.stringify([pkg, manifestPath, ghsa]);
}

/**
 * Collapse per-advisory alerts into one entry per BUMP.
 *
 * Grouped by `(package, manifest_path, first_patched_version)`: that triple is
 * one edit to one manifest, which is the unit a maintainer actually acts on.
 * Two advisories on the same package with different patched versions are
 * different bumps and stay apart.
 *
 * @param {object[]} alerts raw `GET /repos/{o}/{r}/dependabot/alerts` entries
 * @returns {Array<{key: string, package: string, manifestPath: string, fixedIn: string, scope: string, severity: string, ghsas: string[], advisories: Array<{ghsa: string, cve: string | null, severity: string, summary: string, range: string, url: string}>}>}
 */
export function groupAlerts(alerts) {
  const groups = new Map();
  for (const alert of alerts) {
    if (alert.state !== "open") continue;
    const pkg = alert.dependency?.package?.name;
    const ecosystem = alert.dependency?.package?.ecosystem ?? "unknown";
    const manifestPath = alert.dependency?.manifest_path;
    const fixedIn =
      alert.security_vulnerability?.first_patched_version?.identifier;
    // No patched version means there is nothing to bump TO — an issue asking
    // for an unavailable upgrade is noise, so it waits for one to be published.
    if (!pkg || !manifestPath || !fixedIn) continue;

    const key = groupKey(pkg, manifestPath, fixedIn);
    const advisory = {
      ghsa: alert.security_advisory?.ghsa_id ?? "",
      cve: alert.security_advisory?.cve_id ?? null,
      severity: alert.security_advisory?.severity ?? "unknown",
      summary: alert.security_advisory?.summary ?? "",
      range: alert.security_vulnerability?.vulnerable_version_range ?? "*",
      url: alert.html_url ?? "",
    };

    const existing = groups.get(key);
    if (existing) {
      existing.advisories.push(advisory);
      if (
        (SEVERITY_RANK[advisory.severity] ?? 0) >
        (SEVERITY_RANK[existing.severity] ?? 0)
      ) {
        existing.severity = advisory.severity;
      }
      continue;
    }
    groups.set(key, {
      key,
      package: pkg,
      ecosystem,
      manifestPath,
      fixedIn,
      scope: alert.dependency?.scope ?? "runtime",
      severity: advisory.severity,
      advisories: [advisory],
    });
  }

  return [...groups.values()]
    .map((group) => {
      group.advisories.sort((a, b) => a.ghsa.localeCompare(b.ghsa));
      group.ghsas = group.advisories.map((a) => a.ghsa);
      return group;
    })
    .sort(
      (a, b) =>
        a.package.localeCompare(b.package) ||
        a.manifestPath.localeCompare(b.manifestPath) ||
        a.fixedIn.localeCompare(b.fixedIn),
    );
}

/**
 * Narrow a group to the advisories that actually apply to what is installed.
 *
 * ⚠️ Grouping is by `(package, manifest, first_patched_version)`, and two
 * advisories sharing that triple can still have DIFFERENT vulnerable ranges —
 * `>= 3.1.3, < 3.1.6` and `>= 3.0.0, < 3.1.6` both patch at 3.1.6, and an
 * installed `3.1.0` matches only the second. Validating at the group level
 * ("does ANY advisory match?") keeps both, and the issue's marker, title,
 * severity, advisory table and later comments then all claim an advisory that
 * does not apply on this branch (Copilot).
 *
 * @param {ReturnType<typeof groupAlerts>[number]} group
 * @param {Array<{path: string, version: string, hoisted: boolean}>} entries every installed copy
 * @returns {{group: ReturnType<typeof groupAlerts>[number], affected: Array<{path: string, version: string, hoisted: boolean}>} | null}
 *   `null` when nothing installed is in range of any of the group's advisories
 */
export function narrowToApplicable(group, entries) {
  const applies = (advisory, entry) =>
    semver.satisfies(entry.version, toSemverRange(advisory.range));

  const advisories = group.advisories.filter((a) =>
    entries.some((e) => applies(a, e)),
  );
  if (advisories.length === 0) return null;

  const affected = entries.filter((e) => advisories.some((a) => applies(a, e)));
  const severity = advisories.reduce(
    (worst, a) =>
      (SEVERITY_RANK[a.severity] ?? 0) > (SEVERITY_RANK[worst] ?? 0)
        ? a.severity
        : worst,
    advisories[0].severity,
  );

  return {
    group: {
      ...group,
      advisories,
      ghsas: advisories.map((a) => a.ghsa),
      severity,
    },
    affected,
  };
}

/**
 * The title counts the advisories that APPLY, which is what the body shows —
 * so it tracks an issue that grows a new advisory and one whose exposure
 * shrinks alike. The marker's GHSA list is a different thing: it is monotonic,
 * because its job is to remember what has already been announced.
 *
 * @param {ReturnType<typeof groupAlerts>[number]} group narrowed to what applies
 * @returns {string}
 */
export function buildIssueTitle(group) {
  const n = group.advisories.length;
  return `chore(deps): bump \`${group.package}\` to \`${group.fixedIn}\` in \`${group.manifestPath}\` (${n} ${n === 1 ? "advisory" : "advisories"})`;
}

/** Where the issue text points for the rule on pinning a transitive dependency. */
export const PLACEMENT_DOC = `https://github.com/${REPO_SLUG}/blob/main/AGENTS.md#dependency-placement`;

/**
 * What the maintainer actually has to change, derived from WHICH copies are
 * vulnerable rather than from whether the package is declared.
 *
 * The three cases are genuinely different edits, and the mixed one is why this
 * is not a boolean (Copilot):
 *
 * | vulnerable copies | fix |
 * | --- | --- |
 * | the declared (hoisted) one | raise the declared range |
 * | nested ones only | an `overrides` pin |
 * | both | both, and neither alone is enough |
 *
 * A manifest declaring a safe `pkg@^4` alongside a dependency that drags in a
 * vulnerable nested `pkg@3` lands in the middle row: the declared range is
 * already correct, and raising it changes nothing.
 *
 * @param {Array<{path: string, version: string, hoisted: boolean}>} affected
 * @param {boolean} declared whether the manifest declares the package
 * @returns {{direct: boolean, transitive: boolean}}
 */
export function remediation(affected, declared) {
  const isDeclaredCopy = (entry) => declared && entry.hoisted;
  return {
    direct: affected.some(isDeclaredCopy),
    // Everything that is NOT the declared copy needs the override — nested
    // copies, and also a hoisted copy of a package this manifest never
    // declared, which got there transitively like any other.
    transitive: affected.some((entry) => !isDeclaredCopy(entry)),
  };
}

/**
 * @param {ReturnType<typeof groupAlerts>[number]} group
 * @param {{affected: Array<{path: string, version: string, hoisted: boolean}>, declared: boolean, ghsas?: string[]}} probe
 *   `ghsas` overrides the marker's list when an existing issue is being
 *   rewritten to cover advisories it did not originally name.
 * @returns {string}
 */
export function buildIssueBody(
  group,
  { affected, declared, ghsas, securityPrsOff = true },
) {
  const covered = ghsas ?? group.ghsas;
  const applying = group.advisories.length;
  // ⚠️ Every free-form cell is escaped, the RANGE included: a semver range is
  // allowed to contain `||`, so a disjoint advisory range like
  // `>= 1.0, < 2.0 || >= 3.0, < 3.5` would otherwise inject two extra column
  // separators and shear the table apart (Copilot).
  const rows = group.advisories
    .map(
      (a) =>
        `| [${a.ghsa}](${a.url}) | ${cell(a.cve ?? "—")} | ${cell(a.severity)} | ${cell(a.range)} | ${cell(a.summary)} |`,
    )
    .join("\n");

  const { direct, transitive } = remediation(affected, declared);
  const steps = [];
  if (direct) {
    steps.push(
      `**Raise the declared range in \`${DECLARED_IN}\`** so \`${group.package}\` can no longer resolve below \`${group.fixedIn}\`, keeping the operator the manifest already uses — widening it to a bare \`>=\` would drop the compatibility bound with it.`,
    );
  }
  if (transitive) {
    steps.push(
      // ⚠️ Top level only (the header, edit 9). The source reaches the nested
      // copies through their parents when the manifest also declares the
      // package, because npm refuses a package-wide override beside a direct
      // dependency. The pinned Bun does the opposite on both counts: it
      // ignores a nested entry, and it accepts a top-level one, which then
      // decides every copy.
      `**Add an [\`overrides\`](${PLACEMENT_DOC}) entry** in \`${DECLARED_IN}\` pinning \`${group.package}\` to \`${group.fixedIn}\`, for the copies below, which ${direct ? "the declared range does not reach" : "no declared range reaches"}. Write it at the top level of \`overrides\`: Bun ignores a nested (parent-scoped) entry, and a top-level one applies to every copy${direct ? ", the declared one included" : ""}. **Not** \`npm audit fix\`, which "resolves" an advisory with no upward escape by silently downgrading.`,
    );
  }
  const fix = [
    ...(steps.length === 2
      ? [
          "Both edits are needed: the range, so that the manifest itself no longer admits a vulnerable version, and the `overrides` entry, for the copies the range does not reach.",
          "",
        ]
      : []),
    ...steps.map((step, i) => (steps.length > 1 ? `${i + 1}. ${step}` : step)),
    "",
    "| Vulnerable copy | Version |",
    "| --- | --- |",
    ...affected.map((e) => `| \`${e.path}\` | \`${e.version}\` |`),
  ].join("\n");

  return [
    buildMarker({ ...group, ghsas: covered }),
    // Counts what APPLIES, like the title and the table — `covered` is the
    // marker's monotonic history and would keep counting an advisory that has
    // since closed (Copilot).
    // ⚠️ The security-PR claim is only made when the run actually READ the
    // setting. The guard degrades to UNVERIFIED when the token cannot see it,
    // and an issue asserting what the run explicitly could not confirm is worse
    // than one that says so (Copilot).
    `Filed automatically from ${applying} open Dependabot ${applying === 1 ? "alert" : "alerts"}. ${securityPrsOff ? "Dependabot opens no security-update PRs on this repo; the" : "The"} fix is written by hand against \`${TARGET_BRANCH}\`.`,
    "",
    "| | |",
    "| --- | --- |",
    `| Package | \`${group.package}\` |`,
    `| Manifest | \`${group.manifestPath}\` |`,
    `| Vulnerable on \`${TARGET_BRANCH}\` | ${[...new Set(affected.map((e) => e.version))].map((v) => `\`${v}\``).join(", ") || "—"} |`,
    `| Fixed in | \`${group.fixedIn}\` |`,
    `| Scope | ${group.scope} |`,
    `| Highest severity | ${group.severity} |`,
    "",
    "## Advisories",
    "",
    "| GHSA | CVE | Severity | Vulnerable range | Summary |",
    "| --- | --- | --- | --- | --- |",
    rows,
    "",
    "## Fix",
    "",
    fix,
    "",
    "> [!NOTE]",
    `> **Where each number comes from.** The GHSA, CVE, severity, vulnerable range and summary are the advisory's own, reported by Dependabot. What was verified independently against \`${TARGET_BRANCH}\` is the **installed versions, their paths, and whether each advisory's range still matches**, read from \`${LOCKFILE}\` — the alert itself says nothing of which version is installed, so an issue is filed here only after that re-check.`,
  ].join("\n");
}

/**
 * The body an issue is rewritten to once its exposure is gone.
 *
 * The marker is retained, so the sweep still recognises this issue and will not
 * file a fresh one if the same advisory comes back into range. The issue is NOT
 * closed automatically: whether the exposure went away because a PR fixed it or
 * because the dependency was dropped decides whether the issue is closed as
 * done or as not planned, and that is a judgement the sweep cannot make.
 *
 * @param {ReturnType<typeof groupAlerts>[number]} group
 * @param {{ghsas: string[], reason: string, today: string}} context
 * @returns {string}
 */
/**
 * The date an already-cleared body records, or `null` if it is not one.
 *
 * ⚠️ A cleared issue is deliberately left OPEN, so the sweep sees it again
 * tomorrow. With today's date baked into the rendered body, the regenerated
 * body would differ by the date alone and every cleared issue would be edited
 * once a day, forever (Copilot). Reusing the original date is what makes the
 * comparison stable — and it is the more useful date to show anyway: when the
 * exposure went away, not when the sweep last looked.
 *
 * @param {string | undefined} body
 * @returns {string | null}
 */
export function parseClearedDate(body) {
  const match =
    /\*\*No longer applicable on `[^`]+` as of (\d{4}-\d{2}-\d{2})\*\*/.exec(
      body ?? "",
    );
  return match ? match[1] : null;
}

export function buildClearedBody(group, { ghsas, reason, today }) {
  return [
    buildMarker({ ...group, ghsas }),
    `**No longer applicable on \`${TARGET_BRANCH}\` as of ${today}** — ${reason}.`,
    "",
    `Nothing here needs bumping any more: \`${group.package}\` is no longer exposed to ${ghsas.length === 1 ? "the advisory" : "the advisories"} below on \`${TARGET_BRANCH}\`. This body is rewritten in place rather than the issue being closed, because whether it is closed as **done** or as **not planned** depends on why the exposure went away — a merged fix shipped something, a dropped dependency did not — and that is a person's call.`,
    "",
    `Previously covered: ${ghsas.map((g) => `\`${g}\``).join(", ")}.`,
    "",
    "If the same advisory comes back into range, this issue is reused rather than a new one filed.",
  ].join("\n");
}

/**
 * The marker that makes a "new advisories" comment idempotent on its own.
 *
 * @param {string[]} added
 * @returns {string}
 */
export function buildCommentMarker(added) {
  return `<!-- dependabot-alerts:added ${[...added].sort().join(",")} -->`;
}

/**
 * The comment a NEW advisory for an already-open issue gets, instead of a
 * second issue.
 *
 * @param {ReturnType<typeof groupAlerts>[number]} group
 * @param {string[]} added the GHSAs not previously covered
 * @returns {string}
 */
export function buildNewAdvisoryComment(group, added) {
  const rows = group.advisories
    .filter((a) => added.includes(a.ghsa))
    .map(
      (a) => `| [${a.ghsa}](${a.url}) | ${a.severity} | ${cell(a.summary)} |`,
    )
    .join("\n");
  return [
    buildCommentMarker(added),
    // ⚠️ Posted BEFORE the body edit, so it must not assert anything about the
    // body's current state — the edit may not have happened yet, and may fail
    // (Copilot). It speaks for the comment's own marker, which is true the
    // moment this is posted.
    `${added.length} new Dependabot ${added.length === 1 ? "advisory" : "advisories"} for \`${group.package}\`, cleared by the same bump to \`${group.fixedIn}\`. This comment's own marker records ${added.length === 1 ? "it" : "them"} as announced, so a later run will not repeat this even if the issue body has yet to catch up.`,
    "",
    "| GHSA | Severity | Summary |",
    "| --- | --- | --- |",
    rows,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Impure half: everything below shells out to `gh`. Each takes its spawn
// function as a parameter, defaulted to `spawnSync`, so `main()` is testable
// with an injected fake rather than left to `workflow_dispatch` — the same
// shape `dependency-refresh.mjs` uses. In this repo `gh` itself is
// `lib/gh.mjs`'s (the header, edit 12).
// ---------------------------------------------------------------------------

/**
 * Is this failed lookup the "this token may not read that" answer, rather than
 * a real API failure?
 *
 * The distinction is what keeps the security-PR guard honest: a bad token, a
 * rate limit or a transient 5xx must NOT be waved through as "unverified", or
 * the sweep exits green having silently skipped its own precondition.
 *
 * ⚠️ Status alone is not enough, which is what the first version got wrong
 * (Copilot). GitHub answers BOTH "you lack `administration: read`" and "you
 * have exhausted your quota" with **403**, and the second is a real failure —
 * so the rate-limit wording is excluded explicitly. **401** is a bad or expired
 * token, never a scope question, and is a real failure too. **404** stays
 * tolerated because GitHub hides resources a token cannot see behind one rather
 * than admitting they exist.
 *
 * @param {string} stderr stderr from a non-zero `gh api` call
 * @returns {boolean}
 */
export function isPermissionDenied(stderr) {
  if (isRateLimited(stderr)) return false;
  return /HTTP (403|404)\b/.test(stderr);
}

/**
 * Did this failed `gh api` call hit a primary or secondary rate limit?
 *
 * GitHub reports both as 403 (sometimes 429), so the status cannot tell a
 * rate limit from a scope refusal — the wording is what distinguishes them.
 *
 * @param {string} stderr stderr from a non-zero `gh api` call
 * @returns {boolean}
 */
export function isRateLimited(stderr) {
  return /rate limit/i.test(stderr) || /HTTP 429\b/.test(stderr);
}

/**
 * Detect whether Dependabot's security-update PRs have been switched back on.
 *
 * `automated-security-fixes` is a repo SETTING, so it can be re-enabled from
 * the UI without a commit and nothing in this repo would record it. This check
 * is this design's analogue of the merge guard #2060 needed: one API call
 * standing in for a required status check plus a ruleset change.
 *
 * ⚠️ **The endpoint needs `administration: read`, which `GITHUB_TOKEN` cannot
 * be granted** — `permissions:` has no such key. So with the job's token the
 * call 403s, and treating that as failure would make every scheduled run red
 * for a reason unrelated to the alerts. An authorization-shaped failure is
 * therefore reported and skipped; every other failure throws, and an explicit
 * `enabled: true` throws. In this repo the job's token is the only one there
 * is (the header, edit 6), so UNVERIFIED is the expected answer here.
 *
 * Added in this repo: an answer that did come back must say `enabled` as true
 * or false. The source parses an empty answer as `{}` and returns "verified",
 * which is a claim the issue body then repeats.
 *
 * @returns {boolean} whether the setting was actually read
 */
function checkSecurityPrsStillDisabled(repo, spawn) {
  const result = gh(spawn, ["api", `repos/${repo}/automated-security-fixes`]);
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    if (!isPermissionDenied(stderr)) {
      throw new Error(`automated-security-fixes lookup failed: ${stderr}`);
    }
    console.log(
      `dependabot-alerts: cannot read automated-security-fixes (${stderr}) — ` +
        "the token lacks `administration: read`, so whether Dependabot security " +
        "PRs are still off is UNVERIFIED this run",
    );
    return false;
  }
  let state;
  try {
    state = JSON.parse(result.stdout ?? "");
  } catch (error) {
    throw new Error(
      `automated-security-fixes lookup returned a truncated or malformed response (${error.message})`,
    );
  }
  if (
    state === null ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    typeof state.enabled !== "boolean"
  ) {
    throw new Error(
      "automated-security-fixes lookup returned an answer with no true-or-false `enabled`",
    );
  }
  if (state.enabled === true) {
    throw new Error(
      "Dependabot security-update PRs are ENABLED again. This sweep exists to replace them; " +
        "an enabled setting means both flows are running and Dependabot is opening PRs with no " +
        "issue and no ticket. Disable it (the repository's Dependabot security updates setting, or " +
        `DELETE /repos/${repo}/automated-security-fixes) and re-run.`,
    );
  }
  return true;
}

/**
 * Every open Dependabot alert.
 *
 * ⚠️ `--slurp` is load-bearing. Without it `gh api --paginate` concatenates one
 * top-level JSON array PER PAGE, which `JSON.parse` rejects outright the moment
 * open alerts exceed the 100-per-page limit (Copilot). With it the pages arrive
 * as an array of arrays, flattened here.
 *
 * ⚠️ **Every failure here throws; none degrades to "no alerts"** (#2425). This
 * is the opposite of the automated-security-fixes check, and on purpose:
 * `main()` clears any tracked issue whose alert has vanished from this feed, so
 * an empty or partial list — a rate limit, a pagination cut off mid-stream, an
 * empty body — would stand down issues for alerts that are still open. The
 * call runs before anything is written, so throwing leaves every issue
 * exactly as it was, and the next scheduled run is the retry.
 */
function openAlerts(repo, spawn) {
  const result = gh(spawn, [
    "api",
    "--paginate",
    "--slurp",
    `repos/${repo}/dependabot/alerts?state=open&per_page=100`,
  ]);
  const untouched = "no issue was filed, commented on or cleared this run";
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    if (isRateLimited(stderr)) {
      throw new Error(
        `dependabot-alerts: the alert listing was rate-limited (${stderr}) — ` +
          `${untouched}; re-run once the quota resets`,
      );
    }
    throw new Error(
      `dependabot-alerts: the alert listing failed (${stderr}) — ${untouched}`,
    );
  }
  let pages;
  try {
    pages = JSON.parse(result.stdout ?? "");
  } catch (error) {
    throw new Error(
      `dependabot-alerts: the alert listing returned a truncated or malformed ` +
        `response (${error.message}) — ${untouched}`,
    );
  }
  // `--slurp` always yields an array of per-page arrays, `[[]]` when there are
  // no alerts at all, so any other shape is a partial or unexpected response.
  // ⚠️ `every` is vacuously true for `[]`, which is zero pages rather than one
  // empty page — the length check keeps it from reading as zero alerts.
  if (
    !Array.isArray(pages) ||
    pages.length === 0 ||
    !pages.every(Array.isArray)
  ) {
    throw new Error(
      `dependabot-alerts: the alert listing was not a list of pages — ${untouched}`,
    );
  }
  // Added in this repo (the header, edit 13). An issue is cleared when its
  // advisory is ABSENT from this listing, so every entry has to be one the run
  // can key: an entry that is not an object, or that does not name its
  // package, its manifest and its advisory, is an open alert the run cannot
  // account for, and the source's grouping would drop it without a word.
  const alerts = pages.flat();
  const named = (value) => typeof value === "string" && value !== "";
  for (const alert of alerts) {
    if (
      alert === null ||
      typeof alert !== "object" ||
      Array.isArray(alert) ||
      !named(alert.dependency?.package?.name) ||
      !named(alert.dependency?.manifest_path) ||
      !named(alert.security_advisory?.ghsa_id)
    ) {
      throw new Error(
        `dependabot-alerts: the alert listing held an entry that does not name its package, its manifest and its advisory — ${untouched}`,
      );
    }
  }
  return alerts;
}

/**
 * This checkout's `bun.lock`, in the shape the source's lockfile functions
 * read, or the reason it could not be read.
 *
 * In this repo (the header, edits 4 and 5): the source reads whatever path the
 * alert names. This reads ONE file, by a constant name, through the reader the
 * install guard already uses, and builds what `lockfileEntries` and
 * `isDirectDependency` expect of an npm lockfile: `packages[""]` is the root
 * workspace, and `packages["node_modules/a/node_modules/b"]` is `{version}`.
 *
 * ⚠️ Every failure is `unreadable`, and none is evidence. A file that is
 * missing, will not parse, or is a lockfile version the reader does not know
 * says nothing about whether a package is still exposed, so the caller leaves
 * the issue alone. (The source clears an issue when the alert's manifest is
 * gone from the branch; this repository's own lockfile being gone is a broken
 * checkout, not a fixed alert.)
 *
 * `unversioned` names every package with a copy whose locked version is not a
 * semver version: a git, file or workspace source. Such a copy cannot be
 * compared with an advisory's range. `semver.satisfies` answers false for
 * it, which would read as "out of range", so those copies are kept out of
 * `packages` and the caller treats the package as not probed.
 *
 * @returns {{lock: {packages: Record<string, object>}, unversioned: Set<string>} | {unreadable: string}}
 */
function readLockfile() {
  try {
    const { root, entries } = parseBunLock(readFileSync(LOCKFILE, "utf8"));
    const packages = { "": root };
    const unversioned = new Set();
    for (const entry of entries) {
      if (semver.valid(entry.version) === null) {
        unversioned.add(entry.name);
        continue;
      }
      packages[entry.dir] = { version: entry.version };
    }
    return { lock: { packages }, unversioned };
  } catch (error) {
    return { unreadable: String(error?.code ?? error?.message ?? error) };
  }
}

/** Is this entry of a listing an object, as every issue and comment is? */
const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Every open `dependabot`-labeled issue that THIS automation filed.
 *
 * Paginated rather than capped: the marker lookup is what makes this sweep
 * idempotent, so a truncated list files a duplicate for every issue it could
 * not see — at exactly the scale the `--slurp`ed alert fetch is built to handle
 * (Copilot). `/issues` also returns pull requests, which carry no marker and
 * are dropped.
 *
 * In this repo (the header, edits 10 and 13): the source keeps every issue the
 * listing returns. A marker is not evidence in a public repository, so an
 * issue is kept only when `isSweepAuthored` accepts it: written by
 * `github-actions[bot]`, account type `Bot`, and carrying `SWEEP_LABELS`.
 * Anyone else's issue is dropped here, before its body is ever parsed for a
 * marker, so it can be neither edited nor cleared, and cannot stand in for
 * the issue a bump still needs.
 *
 * The listing goes through `ghPaginatedList`, which throws on a failed call,
 * on an answer that is not a list of pages and on no pages at all. Two checks
 * are made here, and both throw: an entry that is not an object (skipped as
 * "not mine", it would let a malformed answer stand for "no issue of mine is
 * open", and a duplicate would be filed), and an own issue whose `number` is
 * not a positive integer (that field is handed to `gh issue edit` and
 * `gh issue comment` as an argument of its own, and is put into an API path,
 * so nothing `gh` could read as an option, and nothing but a number, may get
 * there).
 *
 * @returns {Array<{number: number, title: unknown, body: unknown}>}
 * @throws on a failed or malformed listing, and on an own issue with no usable number
 */
function openDependabotIssues(repo, spawn) {
  const path = `repos/${repo}/issues?state=open&labels=dependabot&per_page=100`;
  const issues = ghPaginatedList(spawn, path);
  for (const issue of issues) {
    if (!isRecord(issue)) {
      throw new Error(
        `unexpected response from ${path}: an entry that is not an object`,
      );
    }
  }
  const own = issues.filter(
    (issue) => !issue.pull_request && isSweepAuthored(issue, SWEEP_LABELS),
  );
  for (const issue of own) {
    if (!(Number.isSafeInteger(issue.number) && issue.number > 0)) {
      throw new Error(
        `unexpected response from ${path}: an issue of this sweep's own has no positive integer number`,
      );
    }
  }
  return own.map((issue) => ({
    number: issue.number,
    title: issue.title,
    body: issue.body,
  }));
}

/**
 * Every GHSA already announced by a comment on an issue, unioned.
 *
 * Unioned per ADVISORY, not compared per comment. Comparing whole sets looks
 * equivalent and is not: a run that posts `[B]` and then fails before rewriting
 * the marker leaves the next run computing `[B, C]`, which matches no existing
 * comment, and `B` is announced a second time (Copilot). Individual GHSAs are
 * what a comment actually claims to have announced.
 *
 * In this repo (the header, edit 10): a comment's marker counts only when the
 * automation wrote the comment. The source reads `gh issue view --json
 * comments` and takes a marker from any commenter, so anyone could write
 * "already announced" under an issue and an advisory would never be
 * announced. The comments are read from the REST endpoint instead, every
 * page, because it states each author's account type; that is how the
 * source's own upstream watch reads comments before `isAutomationComment`.
 * An entry that is not an object throws.
 */
function announcedAdvisories(repo, number, spawn) {
  const path = `repos/${repo}/issues/${number}/comments?per_page=100`;
  const announced = new Set();
  for (const comment of ghPaginatedList(spawn, path)) {
    if (!isRecord(comment)) {
      throw new Error(
        `unexpected response from ${path}: an entry that is not an object`,
      );
    }
    const written = {
      author: comment.user?.login,
      isBot: comment.user?.type === "Bot",
    };
    if (!isAutomationComment(written)) continue;
    for (const ghsa of parseCommentMarker(comment.body) ?? []) {
      announced.add(ghsa);
    }
  }
  return announced;
}

/**
 * File one issue, through the paced writer. In this repo it takes no
 * milestone and returns nothing: there is no board to place the issue on
 * afterwards (the header, edits 1 and 2).
 */
function createIssue(repo, group, body, spawn, write) {
  const args = [
    "issue",
    "create",
    "--repo",
    repo,
    "--title",
    buildIssueTitle(group),
    ...ISSUE_LABELS.flatMap((label) => ["--label", label]),
    "--body",
    body,
  ];
  const result = write(() => gh(spawn, args));
  if (result.status !== 0) {
    throw new Error(`gh issue create failed: ${(result.stderr ?? "").trim()}`);
  }
  console.log(`dependabot-alerts: filed ${(result.stdout ?? "").trim()}`);
}

/**
 * @param {string} [repo] `owner/name`; defaults to `GITHUB_REPOSITORY`
 * @param {typeof spawnSync} [spawn] every `gh` call goes through it
 * @param {string} [today] the date a newly cleared body records
 * @param {<T>(write: () => T) => T} [write] what every issue write goes
 *   through (addition A3); defaults to `pacedWrites()`, which waits a real
 *   second before any write after the first (`lib/paced-writes.mjs`)
 */
export function main(
  repo = process.env.GITHUB_REPOSITORY,
  spawn = spawnSync,
  today = new Date().toISOString().slice(0, 10),
  write = pacedWrites(),
) {
  if (!repo) throw new Error("repo not specified (GITHUB_REPOSITORY unset)");

  const securityPrsOff = checkSecurityPrsStillDisabled(repo, spawn);

  const alerts = openAlerts(repo, spawn);
  const groups = groupAlerts(alerts);

  // ⚠️ Loaded BEFORE the zero-group early return, and reconciled after the loop.
  // `openAlerts` asks for `state=open`, so an alert that is FIXED or DISMISSED
  // simply vanishes from the feed — its group is never built, the loop never
  // visits it, and the issue it produced would keep asserting a vulnerability
  // forever (Copilot). The disappearance is the signal, so it has to be read
  // from the issues rather than from the alerts.
  const existingIssues = openDependabotIssues(repo, spawn).map((issue) => ({
    ...issue,
    marker: parseMarker(issue.body),
  }));

  /** Read at most once, and only when an alert needs it. */
  let lockfile;

  /**
   * Rewrite an issue to its cleared state, at most once.
   *
   * The date is taken from the body already there when there is one, so a
   * cleared issue — which stays open, and so is seen again tomorrow — does not
   * get re-edited every day for a date change alone.
   */
  const writeCleared = (issue, group, reason) => {
    const priorDate = parseClearedDate(issue.body);
    const ghsas = issue.marker.ghsas;
    if (
      priorDate &&
      issue.body ===
        buildClearedBody(group, { ghsas, reason, today: priorDate })
    ) {
      return;
    }
    const body = buildClearedBody(group, { ghsas, reason, today });
    const edit = write(() =>
      gh(spawn, [
        "issue",
        "edit",
        String(issue.number),
        "--repo",
        repo,
        "--body",
        body,
      ]),
    );
    if (edit.status !== 0) {
      throw new Error(`gh issue edit failed: ${(edit.stderr ?? "").trim()}`);
    }
    console.log(`dependabot-alerts: cleared #${issue.number} — ${reason}`);
  };
  /** Grouping keys this run actually saw in the open feed. */
  const seenKeys = new Set();
  /**
   * Every open `(package, manifest, GHSA)`, taken from the RAW feed rather
   * than from `groups`.
   *
   * ⚠️ `groupAlerts` deliberately drops an alert with no `first_patched_version`
   * — there is nothing to bump to, so nothing to file. Building this set from
   * the groups would inherit that filter, so an advisory that stays open but
   * LOSES its patched version would vanish from both the keys and this set, and
   * reconciliation would call it "fixed or dismissed" (Copilot). Same wrong
   * direction as the superseded case, reached a different way: what a still-open
   * advisory must never do is stand itself down.
   */
  /**
   * What this run actually established about each `(package, manifest, GHSA)`.
   *
   * ⚠️ Recorded DURING the loop, not derived from `groups` beforehand. Being in
   * a group only means an alert exists; whether an issue tracks it is decided
   * by the ecosystem check, the manifest read and the range probe that follow
   * (Copilot). Reading "is it in a group?" as "does it have an issue?" would
   * clear an old issue as superseded while its replacement was skipped.
   *
   * - `tracked` — an issue for it exists after this run.
   * - `not-exposed` — probed, and nothing installed is in range.
   * - `indeterminate` — could not be probed at all this run.
   *
   * Absent means no group carried it, i.e. no bump is available for it.
   *
   * @type {Map<string, "tracked" | "not-exposed" | "indeterminate">}
   */
  const disposition = new Map();
  const note = (group, ghsas, value) => {
    for (const ghsa of ghsas) {
      disposition.set(
        advisoryKey(group.package, group.manifestPath, ghsa),
        value,
      );
    }
  };
  const openAdvisories = new Set(
    alerts
      .filter((a) => a.state === "open")
      .map((a) =>
        a.dependency?.package?.name &&
        a.dependency?.manifest_path &&
        a.security_advisory?.ghsa_id
          ? advisoryKey(
              a.dependency.package.name,
              a.dependency.manifest_path,
              a.security_advisory.ghsa_id,
            )
          : null,
      )
      .filter(Boolean),
  );

  for (const rawGroup of groups) {
    seenKeys.add(rawGroup.key);

    if (rawGroup.ecosystem !== SUPPORTED_ECOSYSTEM) {
      // Loud, not silent: nothing else will file this, so a human has to.
      console.log(
        `dependabot-alerts: ${rawGroup.package} (${rawGroup.ecosystem}, ${rawGroup.manifestPath}) is not an npm dependency — this sweep cannot file it, raise it by hand: ${rawGroup.ghsas.join(", ")}`,
      );
      note(rawGroup, rawGroup.ghsas, "indeterminate");
      continue;
    }

    // ⚠️ Resolved BEFORE the skips below, not after. An issue filed yesterday
    // is still open today, and if every copy has since moved out of range,
    // skipping straight past it leaves its body asserting a vulnerability that
    // no longer exists (Copilot). Matched on the full grouping key, `fixedIn`
    // included: a second bump of the same package is a different issue, not an
    // update to this one.
    const existing = existingIssues.find(
      (i) =>
        i.marker?.package === rawGroup.package &&
        i.marker?.manifestPath === rawGroup.manifestPath &&
        i.marker?.fixedIn === rawGroup.fixedIn,
    );

    /** Rewrite an open issue to its cleared state, once. */
    const clear = (reason) => {
      if (!existing) return;
      writeCleared(existing, rawGroup, reason);
    };

    // In this repo (the header, edit 5): the alert's manifest path is compared
    // with a fixed list and is never opened. A path outside the list cannot be
    // checked, which is evidence of nothing, so the issue is left alone.
    if (!KNOWN_MANIFESTS.includes(rawGroup.manifestPath)) {
      console.log(
        `dependabot-alerts: ${rawGroup.package} is reported against ${JSON.stringify(rawGroup.manifestPath)}, which is not a manifest this sweep knows (${KNOWN_MANIFESTS.join(", ")}) — it cannot check it and will not clear its issue, raise it by hand: ${rawGroup.ghsas.join(", ")}`,
      );
      note(rawGroup, rawGroup.ghsas, "indeterminate");
      continue;
    }

    lockfile ??= readLockfile();
    if (lockfile.unreadable !== undefined) {
      // Deliberately does NOT clear: a read error is not evidence that the
      // exposure went away, and treating it as such stands down a live alert.
      console.log(
        `dependabot-alerts: ${LOCKFILE} could not be read or parsed (${lockfile.unreadable}) — skipping ${rawGroup.package} WITHOUT clearing its issue`,
      );
      note(rawGroup, rawGroup.ghsas, "indeterminate");
      continue;
    }
    if (lockfile.unversioned.has(rawGroup.package)) {
      console.log(
        `dependabot-alerts: ${rawGroup.package} has a copy in ${LOCKFILE} whose version is not a semver version, so it cannot be compared with a range — skipping it WITHOUT clearing its issue`,
      );
      note(rawGroup, rawGroup.ghsas, "indeterminate");
      continue;
    }
    const { lock } = lockfile;

    const entries = lockfileEntries(lock, rawGroup.package);
    const applicable = narrowToApplicable(rawGroup, entries);
    if (applicable === null) {
      const seen = [...new Set(entries.map((e) => e.version))];
      console.log(
        `dependabot-alerts: ${rawGroup.package}@${seen.join("/") || "(absent)"} is already out of range on ${TARGET_BRANCH} — skipping`,
      );
      note(rawGroup, rawGroup.ghsas, "not-exposed");
      clear(
        seen.length > 0
          ? `every installed copy is out of range (${seen.map((v) => `\`${v}\``).join(", ")})`
          : "the package is no longer installed at all",
      );
      continue;
    }
    // From here on `group` carries only the advisories that apply to this
    // branch, so the marker, title, severity and table cannot overstate it.
    const { group, affected } = applicable;
    // The narrowing dropped advisories whose range no longer matches: those are
    // probed-and-clear, the survivors get an issue.
    note(
      rawGroup,
      rawGroup.ghsas.filter((g) => !group.ghsas.includes(g)),
      "not-exposed",
    );
    note(group, group.ghsas, "tracked");

    const declared = isDirectDependency(lock, group.package);

    if (!existing) {
      createIssue(
        repo,
        group,
        buildIssueBody(group, { affected, declared, securityPrsOff }),
        spawn,
        write,
      );
      continue;
    }

    const { merged, added } = mergeGhsas(existing.marker.ghsas, group.ghsas);
    const title = buildIssueTitle(group);
    const body = buildIssueBody(group, {
      affected,
      declared,
      ghsas: merged,
      securityPrsOff,
    });

    // ⚠️ "Nothing NEW" is not the same as "nothing CHANGED" (Copilot). An issue
    // filed for A+B whose branch has since moved so only B applies has no added
    // GHSAs, yet its table, severity, affected copies and remediation are all
    // stale. So the no-op is decided by comparing the rendered issue, not by
    // counting additions — while a COMMENT stays reserved for advisories that
    // are genuinely new.
    if (
      added.length === 0 &&
      existing.title === title &&
      existing.body === body
    ) {
      console.log(
        `dependabot-alerts: #${existing.number} is up to date for ${group.package} — no-op`,
      );
      continue;
    }

    // ⚠️ Comment FIRST, then rewrite the marker. The marker is the idempotency
    // key, so editing it first and failing on the comment would make the next
    // run take the no-op branch above and skip the comment permanently
    // (Copilot). In this order the worst case is a repeat, and the comment's
    // own marker rules that out too.
    const announced = announcedAdvisories(repo, existing.number, spawn);
    const unannounced = added.filter((ghsa) => !announced.has(ghsa));
    if (unannounced.length > 0) {
      const comment = write(() =>
        gh(spawn, [
          "issue",
          "comment",
          String(existing.number),
          "--repo",
          repo,
          "--body",
          buildNewAdvisoryComment(group, unannounced),
        ]),
      );
      if (comment.status !== 0) {
        throw new Error(
          `gh issue comment failed: ${(comment.stderr ?? "").trim()}`,
        );
      }
    }

    const edit = write(() =>
      gh(spawn, [
        "issue",
        "edit",
        String(existing.number),
        "--repo",
        repo,
        "--title",
        title,
        "--body",
        body,
      ]),
    );
    if (edit.status !== 0) {
      throw new Error(`gh issue edit failed: ${(edit.stderr ?? "").trim()}`);
    }
    console.log(
      added.length > 0
        ? `dependabot-alerts: added ${added.join(", ")} to #${existing.number}`
        : `dependabot-alerts: refreshed #${existing.number} for ${group.package}`,
    );
  }

  // Any marked issue whose bump is no longer in the open feed at all: its last
  // alert was fixed or dismissed, so there is nothing left to bump.
  for (const issue of existingIssues) {
    if (!issue.marker) continue;
    const key = groupKey(
      issue.marker.package,
      issue.marker.manifestPath,
      issue.marker.fixedIn,
    );
    if (seenKeys.has(key)) continue;

    // ⚠️ A vanished KEY is not the same as a closed ADVISORY. GitHub can revise
    // an alert's `first_patched_version`, which moves it to a different key
    // while the GHSA stays open — reporting that as "fixed or dismissed" would
    // stand down a live exposure (Copilot). So the reason is decided by whether
    // the GHSAs are still in the open feed, not by the key's absence.
    const key3 = (ghsa) =>
      advisoryKey(issue.marker.package, issue.marker.manifestPath, ghsa);
    const stillOpen = issue.marker.ghsas.filter((g) =>
      openAdvisories.has(key3(g)),
    );

    // ⚠️ Clearing needs positive evidence about every advisory still open here.
    // Two things deny it, and both mean "leave the issue alone" (Copilot):
    // an advisory this run could not probe (`indeterminate` — a non-npm
    // alert, a manifest this sweep does not know, or a lockfile that could
    // not be read), and one no group carried at all
    // (absent — `groupAlerts` drops an alert with no `first_patched_version`,
    // so there is nothing to bump to and no replacement issue).
    const unresolved = stillOpen.filter((g) => {
      const state = disposition.get(key3(g));
      return state === undefined || state === "indeterminate";
    });
    if (unresolved.length > 0) {
      console.log(
        `dependabot-alerts: #${issue.number} left as is — ${unresolved.join(", ")} ${unresolved.length === 1 ? "is" : "are"} still open and this run could not establish a replacement`,
      );
      continue;
    }

    const tracked = stillOpen.filter(
      (g) => disposition.get(key3(g)) === "tracked",
    );
    const reason =
      stillOpen.length === 0
        ? "every alert it tracked has been fixed or dismissed"
        : tracked.length > 0
          ? `this bump was superseded — ${tracked.map((g) => `\`${g}\``).join(", ")} ${tracked.length === 1 ? "is" : "are"} still open under a different patched version, and ${tracked.length === 1 ? "has" : "have"} their own issue`
          : "no installed copy is in range of its advisories any more";

    writeCleared(
      issue,
      {
        package: issue.marker.package,
        manifestPath: issue.marker.manifestPath,
        fixedIn: issue.marker.fixedIn,
      },
      reason,
    );
  }

  if (groups.length === 0) {
    console.log("dependabot-alerts: no open alerts");
  }
}

if (isMainModule(import.meta.url)) {
  main();
}
