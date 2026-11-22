// Tests for scripts/dependabot-alerts.mjs, the daily alert sweep: the pure
// grouping and formatting helpers, and `main()` driven through an injected
// `spawnSync`, so no `gh` process is ever started.
//
// In this repo: the MCP Inspector's test file (modelcontextprotocol/inspector
// at commit 7df76f6eea9ea425891289333837878ebb31ae6a,
// scripts/dependabot-alerts.test.mjs, blob
// 8493d3c40695e6d82568aafda0aa357af1d7ded6), by copy then edit: the unchanged
// file is this file's first commit here. Record: PROVENANCE.md, "Sweeps". A
// comment that cites "(Copilot)" or a "#NNNN" is the source's.
//
// Edits, following the script's (its header numbers them):
//
//   - The cases for the board, the second token and the milestone are removed
//     with the code (`pickMilestone`, the three board cases, the two token
//     helpers that wrapped every `main()` call).
//   - The cases for `overrideAncestors` and `scopedOverrideExample` are
//     removed with the two functions, and the case for a package that is both
//     declared and nested asserts the top-level `overrides` form.
//   - A fixture's lockfile is a `bun.lock` (`lockOf`, `lockWith`), and an
//     alert's default manifest is `package.json`.
//   - The cases that used a second lockfile in a sub-folder are rewritten: an
//     alert that names any path outside the fixed list is not checked and its
//     issue is not cleared, and the source's "manifest is gone, so clear the
//     issue" case is now "the manifest is unknown, so leave the issue alone".
//   - The fake answers the REST shapes. An issue or a comment in a fixture
//     that states no `user` is given the automation's authorship (and an issue
//     its labels), so the source's fixtures stay as written; the cases for
//     addition A1 state their own.
//   - The fake throws on any program but `gh` and on any `gh` call it does not
//     know, where the source's answered every unknown call with success.
//   - `main` below is the script's `main` with a writer that does not wait
//     (addition A3), so the source's call sites stay as written and no test
//     sleeps.
//   - Cases written in this repo are under "Written in this repo", at the end.
//   - The lock file check (the script's header, edit 15) has its cases last,
//     under "The lock file check". They run `main` with its own default
//     check; every case above them runs it with a check that found nothing
//     (`NO_LOCK_FINDINGS`), so each keeps the meaning it had before the
//     check existed. The fake answers the two listings the check reads.
//
// The source's reason for covering `main()` here, unchanged: a production
// trigger is not a test (Copilot): everything that can go wrong in the
// orchestration goes wrong only against the real API, where nothing would be
// asserted. Run via `npm run test:scripts`, which names this file by path.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  advisoryKey,
  parseClearedDate,
  ISSUE_LABELS,
  LOCK_CLEARED_REASON,
  KNOWN_MANIFESTS,
  LOCKFILE,
  PLACEMENT_DOC,
  SUPPORTED_ECOSYSTEM,
  SWEEP_LABELS,
  TARGET_BRANCH,
  buildClearedBody,
  buildCommentMarker,
  narrowToApplicable,
  lockfileEntries,
  remediation,
  buildIssueBody,
  buildIssueTitle,
  buildMarker,
  buildNewAdvisoryComment,
  groupAlerts,
  isDirectDependency,
  isPermissionDenied,
  isRateLimited,
  lockfileVersions,
  main as sweepMain,
  mergeGhsas,
  parseCommentMarker,
  parseMarker,
  toSemverRange,
} from "./dependabot-alerts.mjs";
import { semverRange } from "./lib/lock-advisories.mjs";
import { pacedWrites, WRITE_PAUSE_MS } from "./lib/paced-writes.mjs";

/** A lock file check that found nothing, with both controls good. */
const NO_LOCK_FINDINGS = () => ({ records: [], staleControls: [] });

/**
 * The script's `main`, with a writer whose pause does nothing: the pacing is
 * real in a run and has its own cases below, and no other test should wait a
 * second for each write after the first.
 *
 * In this repo (the script's header, edit 15): and with a lock file check
 * that found nothing. Every case that calls this is a case about the ALERT
 * path, most of them the source's, and each keeps the meaning it had before
 * the lock file check existed. The cases for the check itself are under "The
 * lock file check", at the end; they call `sweepMain` with its own default,
 * as a run does.
 */
const main = (repo, spawn, today) =>
  sweepMain(
    repo,
    spawn,
    today,
    pacedWrites(() => {}),
    NO_LOCK_FINDINGS,
  );

/** Shaped like a real `GET /repos/{o}/{r}/dependabot/alerts` entry. */
function alert({
  ghsa,
  pkg = "fast-uri",
  manifest = "package.json",
  fixed = "3.1.6",
  severity = "high",
  range = ">= 3.0.0, < 3.1.6",
  scope = "runtime",
  cve = null,
  state = "open",
  ecosystem = "npm",
}) {
  return {
    state,
    html_url: `https://github.com/o/r/security/dependabot/${ghsa}`,
    dependency: {
      package: { name: pkg, ecosystem },
      manifest_path: manifest,
      scope,
    },
    security_advisory: {
      ghsa_id: ghsa,
      cve_id: cve,
      severity,
      summary: `${pkg} is bad`,
    },
    security_vulnerability: {
      vulnerable_version_range: range,
      first_patched_version: { identifier: fixed },
    },
  };
}

test("toSemverRange turns GitHub's comma-separated conjuncts into semver ANDs", () => {
  assert.equal(toSemverRange(">= 3.1.3, < 3.1.6"), ">= 3.1.3 < 3.1.6");
  assert.equal(toSemverRange("<= 4.28.6"), "<= 4.28.6");
  assert.equal(toSemverRange(">= 2.2.5, < 6.16.0"), ">= 2.2.5 < 6.16.0");
});

test("toSemverRange tolerates stray whitespace and trailing commas", () => {
  assert.equal(toSemverRange("  >= 1.0.0 ,  < 2.0.0 , "), ">= 1.0.0 < 2.0.0");
});

test("lockfileVersions finds hoisted and nested copies, deduped and sorted", () => {
  const lock = {
    packages: {
      "": { dependencies: { zod: "^3.0.0" } },
      "node_modules/fast-uri": { version: "3.1.5" },
      "node_modules/ajv/node_modules/fast-uri": { version: "3.0.1" },
      "node_modules/other/node_modules/fast-uri": { version: "3.1.5" },
      "node_modules/fast-uri-lookalike": { version: "9.9.9" },
    },
  };
  assert.deepEqual(lockfileVersions(lock, "fast-uri"), ["3.0.1", "3.1.5"]);
});

test("lockfileVersions returns [] when the package is absent", () => {
  assert.deepEqual(lockfileVersions({ packages: {} }, "qs"), []);
  assert.deepEqual(lockfileVersions({}, "qs"), []);
});

test("isDirectDependency reads the root manifest entry, not the tree", () => {
  const lock = {
    packages: {
      "": { dependencies: { zod: "^4.0.0" }, devDependencies: { vitest: "1" } },
      "node_modules/fast-uri": { version: "3.1.5" },
    },
  };
  assert.equal(isDirectDependency(lock, "zod"), true);
  assert.equal(isDirectDependency(lock, "vitest"), true);
  assert.equal(isDirectDependency(lock, "fast-uri"), false);
});

test("groupAlerts collapses advisories into one entry per bump", () => {
  const grouped = groupAlerts([
    alert({ ghsa: "GHSA-5jgf", range: ">= 3.1.3, < 3.1.6" }),
    alert({ ghsa: "GHSA-f65p" }),
    alert({ ghsa: "GHSA-jqff" }),
    alert({ ghsa: "GHSA-fph4", range: ">= 3.1.2, < 3.1.6" }),
    alert({
      ghsa: "GHSA-x5fp",
      pkg: "qs",
      fixed: "6.16.0",
      severity: "medium",
      range: ">= 6.14.2, <= 6.15.3",
    }),
    alert({
      ghsa: "GHSA-73wf",
      pkg: "browserslist",
      manifest: "clients/tui/package-lock.json",
      fixed: "4.28.7",
      scope: "development",
      range: "<= 4.28.6",
    }),
  ]);

  assert.deepEqual(
    grouped.map((g) => [g.package, g.manifestPath, g.fixedIn, g.ghsas.length]),
    [
      ["browserslist", "clients/tui/package-lock.json", "4.28.7", 1],
      ["fast-uri", "package.json", "3.1.6", 4],
      ["qs", "package.json", "6.16.0", 1],
    ],
  );
  // GHSAs are sorted within a group so the marker is stable across runs.
  assert.deepEqual(grouped[1].ghsas, [
    "GHSA-5jgf",
    "GHSA-f65p",
    "GHSA-fph4",
    "GHSA-jqff",
  ]);
});

test("groupAlerts keeps the highest severity across a group", () => {
  const [group] = groupAlerts([
    alert({ ghsa: "GHSA-a", severity: "low" }),
    alert({ ghsa: "GHSA-b", severity: "critical" }),
    alert({ ghsa: "GHSA-c", severity: "medium" }),
  ]);
  assert.equal(group.severity, "critical");
});

test("groupAlerts splits a package whose advisories need different bumps", () => {
  const grouped = groupAlerts([
    alert({ ghsa: "GHSA-a", fixed: "3.1.6" }),
    alert({ ghsa: "GHSA-b", fixed: "4.0.0" }),
  ]);
  assert.equal(grouped.length, 2);
  assert.deepEqual(
    grouped.map((g) => g.fixedIn),
    ["3.1.6", "4.0.0"],
  );
});

test("groupAlerts drops closed alerts and ones with no patched version", () => {
  const unpatched = alert({ ghsa: "GHSA-x" });
  unpatched.security_vulnerability.first_patched_version = null;
  assert.deepEqual(
    groupAlerts([alert({ ghsa: "GHSA-y", state: "fixed" }), unpatched]),
    [],
  );
});

test("buildMarker and parseMarker round-trip, sorting the GHSA list", () => {
  const marker = buildMarker({
    package: "fast-uri",
    manifestPath: "package.json",
    fixedIn: "3.1.6",
    ghsas: ["GHSA-b", "GHSA-a"],
  });
  assert.equal(
    marker,
    "<!-- dependabot-alerts: pkg=fast-uri; manifest=package.json; fixed=3.1.6; ghsas=GHSA-a,GHSA-b -->",
  );
  assert.deepEqual(parseMarker(`${marker}\nbody text`), {
    package: "fast-uri",
    manifestPath: "package.json",
    fixedIn: "3.1.6",
    ghsas: ["GHSA-a", "GHSA-b"],
  });
});

test("the marker carries fixedIn, so two bumps of one package stay distinct", () => {
  const [a] = groupAlerts([alert({ ghsa: "GHSA-a", fixed: "3.1.6" })]);
  const [b] = groupAlerts([alert({ ghsa: "GHSA-b", fixed: "4.0.0" })]);
  assert.notEqual(buildMarker(a), buildMarker(b));
  assert.equal(parseMarker(buildMarker(a)).fixedIn, "3.1.6");
  assert.equal(parseMarker(buildMarker(b)).fixedIn, "4.0.0");
});

test("buildCommentMarker and parseCommentMarker round-trip", () => {
  const marker = buildCommentMarker(["GHSA-b", "GHSA-a"]);
  assert.equal(marker, "<!-- dependabot-alerts:added GHSA-a,GHSA-b -->");
  assert.deepEqual(parseCommentMarker(`${marker}\ntext`), ["GHSA-a", "GHSA-b"]);
  assert.equal(parseCommentMarker("an ordinary comment"), null);
});

test("isPermissionDenied tolerates a scope refusal", () => {
  // The two ways GitHub says "this token may not read that": an explicit 403,
  // and a 404 hiding a resource the token cannot see.
  assert.equal(
    isPermissionDenied("gh: HTTP 403: Resource not accessible by integration"),
    true,
  );
  assert.equal(isPermissionDenied("gh: HTTP 404: Not Found"), true);
});

test("isPermissionDenied treats a bad token or a rate limit as a real failure", () => {
  // ⚠️ A rate limit is also a 403, so status alone cannot decide this — waving
  // it through would exit green having skipped the sweep's own precondition.
  assert.equal(
    isPermissionDenied("gh: API rate limit exceeded (HTTP 403)"),
    false,
  );
  assert.equal(
    isPermissionDenied(
      "gh: HTTP 403: You have exceeded a secondary rate limit",
    ),
    false,
  );
  // 401 is a bad or expired token, never a scope question.
  assert.equal(isPermissionDenied("gh: HTTP 401: Bad credentials"), false);
  assert.equal(
    isPermissionDenied("gh: HTTP 500: Internal Server Error"),
    false,
  );
});

test("isRateLimited recognizes primary, secondary and 429 rate limits", () => {
  assert.equal(isRateLimited("gh: API rate limit exceeded (HTTP 403)"), true);
  assert.equal(
    isRateLimited("gh: HTTP 403: You have exceeded a secondary rate limit"),
    true,
  );
  assert.equal(isRateLimited("gh: HTTP 429: Too Many Requests"), true);
  // A scope refusal shares the 403 but is not a rate limit.
  assert.equal(
    isRateLimited("gh: HTTP 403: Resource not accessible by integration"),
    false,
  );
  assert.equal(isRateLimited("gh: HTTP 502: Bad Gateway"), false);
});

test("parseMarker returns null for an unmarked or absent body", () => {
  assert.equal(parseMarker(undefined), null);
  assert.equal(parseMarker("just an issue someone wrote"), null);
  // The marker is the FIRST line or it is not the idempotency key.
  assert.equal(
    parseMarker(
      "preamble\n<!-- dependabot-alerts: pkg=x; manifest=y; fixed=1.0.0; ghsas=GHSA-a -->",
    ),
    null,
  );
});

test("mergeGhsas reports only the advisories the issue does not already name", () => {
  assert.deepEqual(mergeGhsas(["GHSA-a", "GHSA-b"], ["GHSA-b", "GHSA-c"]), {
    merged: ["GHSA-a", "GHSA-b", "GHSA-c"],
    added: ["GHSA-c"],
  });
});

test("mergeGhsas reports nothing added when the issue already covers them", () => {
  assert.deepEqual(mergeGhsas(["GHSA-a", "GHSA-b"], ["GHSA-a"]), {
    merged: ["GHSA-a", "GHSA-b"],
    added: [],
  });
});

/** The probe shape `buildIssueBody` takes: one vulnerable copy, nested by default. */
const nested = (
  version = "3.1.5",
  path = "node_modules/ajv/node_modules/fast-uri",
) => ({
  affected: [{ path, version, hoisted: false }],
  declared: false,
});
const hoisted = (version = "3.1.5") => ({
  affected: [{ path: "node_modules/fast-uri", version, hoisted: true }],
  declared: true,
});

test("narrowToApplicable drops advisories the installed version is out of range of", () => {
  // Same package, manifest and patched version, so one group — but different
  // vulnerable ranges, and 3.1.0 is in range of only one of them.
  const [group] = groupAlerts([
    alert({
      ghsa: "GHSA-narrow",
      range: ">= 3.1.3, < 3.1.6",
      severity: "critical",
    }),
    alert({
      ghsa: "GHSA-wide",
      range: ">= 3.0.0, < 3.1.6",
      severity: "medium",
    }),
  ]);
  assert.equal(group.advisories.length, 2);

  const result = narrowToApplicable(group, [
    { path: "node_modules/fast-uri", version: "3.1.0", hoisted: true },
  ]);
  assert.deepEqual(result.group.ghsas, ["GHSA-wide"]);
  // Severity is re-derived: the critical one does not apply here.
  assert.equal(result.group.severity, "medium");
  assert.equal(result.affected.length, 1);
  // ...and the marker cannot claim an advisory this branch is not exposed to.
  assert.deepEqual(parseMarker(buildMarker(result.group)).ghsas, ["GHSA-wide"]);
});

test("narrowToApplicable keeps every advisory that does apply", () => {
  const [group] = groupAlerts([
    alert({ ghsa: "GHSA-narrow", range: ">= 3.1.3, < 3.1.6" }),
    alert({ ghsa: "GHSA-wide", range: ">= 3.0.0, < 3.1.6" }),
  ]);
  const result = narrowToApplicable(group, [
    { path: "node_modules/fast-uri", version: "3.1.5", hoisted: true },
  ]);
  assert.deepEqual(result.group.ghsas, ["GHSA-narrow", "GHSA-wide"]);
});

test("narrowToApplicable returns null when nothing installed is in range", () => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  assert.equal(
    narrowToApplicable(group, [
      { path: "node_modules/fast-uri", version: "3.1.6", hoisted: true },
    ]),
    null,
  );
  assert.equal(narrowToApplicable(group, []), null);
});

test("buildIssueBody escapes a disjoint range so the table survives it", () => {
  // `||` is legal in a semver range and is also the Markdown column separator.
  const [group] = groupAlerts([
    alert({ ghsa: "GHSA-a", range: ">= 1.0.0, < 2.0.0 || >= 3.0.0, < 3.5.0" }),
  ]);
  const body = buildIssueBody(group, nested());
  const row = body
    .split("\n")
    .find((line) => line.includes("GHSA-a") && line.startsWith("|"));
  // Count only the pipes Markdown will treat as separators: five columns means
  // four inner separators plus the two outer ones.
  const separators = row.replace(/\\\|/g, "").split("|").length - 1;
  assert.equal(
    separators,
    6,
    `escaped row should keep its column count: ${row}`,
  );
  assert.ok(row.includes(String.raw`\|\|`), "the range's own pipes survive");
});

test("buildIssueTitle names the bump and pluralizes the advisory count", () => {
  const [many] = groupAlerts([
    alert({ ghsa: "GHSA-a" }),
    alert({ ghsa: "GHSA-b" }),
  ]);
  assert.equal(
    buildIssueTitle(many),
    "chore(deps): bump `fast-uri` to `3.1.6` in `package.json` (2 advisories)",
  );
  const [one] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  assert.equal(
    buildIssueTitle(one),
    "chore(deps): bump `fast-uri` to `3.1.6` in `package.json` (1 advisory)",
  );
});

test("buildIssueBody leads with the marker and asks for an overrides pin when transitive", () => {
  const [group] = groupAlerts([
    alert({ ghsa: "GHSA-a", cve: "CVE-2026-1" }),
    alert({ ghsa: "GHSA-b" }),
  ]);
  const body = buildIssueBody(group, nested());

  assert.ok(body.startsWith(buildMarker(group)));
  assert.match(body, /\| Vulnerable on `main` \| `3\.1\.5` \|/);
  assert.match(body, /\| Fixed in \| `3\.1\.6` \|/);
  assert.match(body, /GHSA-a/);
  assert.match(body, /CVE-2026-1/);
  assert.match(body, /`overrides`/);
  assert.doesNotMatch(body, /raise its declared range/);
});

test("buildIssueBody asks a direct dependency's range to be raised, not widened", () => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const body = buildIssueBody(group, hoisted());
  assert.match(body, /Raise the declared range in `package\.json`/);
  assert.match(body, /can no longer resolve below `3\.1\.6`/);
  // Prescribing `>=3.1.6` would throw away the manifest's compatibility bound.
  assert.doesNotMatch(body, /range to `>=/);
  assert.doesNotMatch(body, /overrides/);
});

test("remediation reads the vulnerable copies, not the declaration", () => {
  const declaredSafe = [
    {
      path: "node_modules/ajv/node_modules/fast-uri",
      version: "3.1.5",
      hoisted: false,
    },
  ];
  // The manifest declares `fast-uri`, but the copy in range is a nested one:
  // raising the declared range would change nothing at all.
  assert.deepEqual(remediation(declaredSafe, true), {
    direct: false,
    transitive: true,
  });
  assert.deepEqual(
    remediation(
      [{ path: "node_modules/fast-uri", version: "3.1.5", hoisted: true }],
      true,
    ),
    { direct: true, transitive: false },
  );
  // An undeclared hoisted copy got there transitively like any other, so it
  // needs the override — "hoisted" is not a synonym for "declared".
  assert.deepEqual(
    remediation(
      [{ path: "node_modules/fast-uri", version: "3.1.5", hoisted: true }],
      false,
    ),
    { direct: false, transitive: true },
  );
});

test("buildIssueBody asks for BOTH edits when declared and nested copies are vulnerable", () => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const body = buildIssueBody(group, {
    declared: true,
    affected: [
      { path: "node_modules/fast-uri", version: "3.1.5", hoisted: true },
      {
        path: "node_modules/ajv/node_modules/fast-uri",
        version: "3.0.1",
        hoisted: false,
      },
    ],
  });
  assert.match(body, /Both edits are needed/);
  assert.match(body, /1\. \*\*Raise the declared range/);
  assert.match(body, /2\. \*\*Add an \[`overrides`\]/);
  // In this repo: the top-level form only. The pinned Bun ignores a nested
  // entry and accepts a top-level one beside a direct dependency (measured;
  // the script's header, edit 9), so the body gives no parent-scoped example
  // and does not speak of npm's EOVERRIDE.
  assert.match(body, /at the top level of `overrides`/);
  assert.match(body, /the declared one included/);
  assert.doesNotMatch(body, /EOVERRIDE/);
  assert.doesNotMatch(body, /"ajv": \{/);
  // The table names the copies, so the maintainer can see why.
  assert.match(
    body,
    /\| `node_modules\/ajv\/node_modules\/fast-uri` \| `3\.0\.1` \|/,
  );
});

test("buildIssueBody asks only for an override when the declared copy is safe", () => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  // A valid lock: safe declared fast-uri@4, vulnerable nested fast-uri@3.1.5.
  const body = buildIssueBody(group, {
    declared: true,
    affected: [
      {
        path: "node_modules/ajv/node_modules/fast-uri",
        version: "3.1.5",
        hoisted: false,
      },
    ],
  });
  assert.doesNotMatch(body, /Raise the declared range/);
  assert.match(body, /Add an \[`overrides`\]/);
});

test("lockfileEntries keeps each copy's path and marks the hoisted one", () => {
  const lock = {
    packages: {
      "": { dependencies: { "fast-uri": "^4.0.0" } },
      "node_modules/fast-uri": { version: "4.0.0" },
      "node_modules/ajv/node_modules/fast-uri": { version: "3.1.5" },
    },
  };
  assert.deepEqual(lockfileEntries(lock, "fast-uri"), [
    {
      path: "node_modules/ajv/node_modules/fast-uri",
      version: "3.1.5",
      hoisted: false,
    },
    { path: "node_modules/fast-uri", version: "4.0.0", hoisted: true },
  ]);
});

test("buildIssueBody honors an overridden GHSA list when rewriting an issue", () => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const body = buildIssueBody(group, {
    ...nested(),
    ghsas: ["GHSA-a", "GHSA-old"],
  });
  assert.deepEqual(parseMarker(body).ghsas, ["GHSA-a", "GHSA-old"]);
});

test("buildNewAdvisoryComment lists only the newly-seen advisories", () => {
  const [group] = groupAlerts([
    alert({ ghsa: "GHSA-a" }),
    alert({ ghsa: "GHSA-b" }),
  ]);
  const comment = buildNewAdvisoryComment(group, ["GHSA-b"]);
  assert.match(comment, /1 new Dependabot advisory/);
  assert.match(comment, /GHSA-b/);
  assert.doesNotMatch(comment, /GHSA-a/);
});

// ---------------------------------------------------------------------------
// main() orchestration, driven through the injected spawn function.
//
// `workflow_dispatch` is a production trigger, not a test — and everything that
// can go wrong here goes wrong in production only: a paginated alert feed, a
// manifest that has moved on, a half-written board card, a comment posted twice
// (Copilot). Manifests are read from the working tree, so each test runs in a
// temp directory it populates itself.
// ---------------------------------------------------------------------------

/** The account the REST endpoints name as the author of the sweep's writes. */
const BOT = { login: "github-actions[bot]", type: "Bot" };

/** Shaped like a real `GET /advisories` entry (the lock file check reads these). */
function advisory({
  ghsa,
  pkg = "fast-uri",
  range = ">= 3.0.0, < 3.1.6",
  fixed = "3.1.6",
  severity = "high",
  cve = null,
  withdrawn = null,
  type = "reviewed",
  vulnerabilities,
}) {
  return {
    ghsa_id: ghsa,
    cve_id: cve,
    html_url: `https://example.invalid/not-used/${ghsa}`,
    summary: `${pkg} is bad`,
    type,
    severity,
    withdrawn_at: withdrawn,
    vulnerabilities: vulnerabilities ?? [
      {
        package: { ecosystem: "npm", name: pkg },
        vulnerable_version_range: range,
        first_patched_version: fixed,
        vulnerable_functions: [],
      },
    ],
  };
}

/**
 * The two control advisories as the endpoint returned them on 2026-11-22,
 * cut down to the fields read: each lists two ranges for its package, and
 * the control version is in one of them.
 */
const CONTROL_ADVISORIES = [
  advisory({
    ghsa: "GHSA-xvch-5gv4-984h",
    pkg: "minimist",
    severity: "critical",
    cve: "CVE-2021-44906",
    vulnerabilities: [
      {
        package: { ecosystem: "npm", name: "minimist" },
        vulnerable_version_range: ">= 1.0.0, < 1.2.6",
        first_patched_version: "1.2.6",
      },
      {
        package: { ecosystem: "npm", name: "minimist" },
        vulnerable_version_range: "< 0.2.4",
        first_patched_version: "0.2.4",
      },
    ],
  }),
  advisory({
    ghsa: "GHSA-35jh-r3h4-6jhm",
    pkg: "lodash",
    cve: "CVE-2021-23337",
    range: "< 4.17.21",
    fixed: "4.17.21",
  }),
];

/** A fixture issue as the REST listing returns one this sweep filed. */
const asSweepIssue = (issue) => ({
  user: BOT,
  labels: ISSUE_LABELS.map((name) => ({ name })),
  ...issue,
});

/** A fixture comment as the REST listing returns one this sweep wrote. */
const asBotComment = (comment) => ({ user: BOT, ...comment });

/**
 * A `spawnSync` stand-in. `gh` responses are matched on the argument list, in
 * the order the handlers are declared, and every call is recorded.
 *
 * In this repo: any program but `gh`, and any `gh` call not listed here,
 * throws. `issues` and `comments` are given the automation's authorship
 * unless a fixture states its own `user` (and, for an issue, `labels`).
 */
function fakeSpawn({
  securityFixes = { enabled: false, paused: false },
  securityFixesStatus = 0,
  securityFixesStderr = "",
  // A raw answer to the setting lookup, overriding the three above.
  securityFixesResponse,
  alertPages = [[]],
  // A raw alert-listing response, overriding `alertPages` — for the failure
  // paths, where `gh` exits non-zero or hands back something unparseable.
  alertResponse,
  issues = [],
  // A raw issue-listing response, overriding `issues`.
  issuesResponse,
  comments = [],
  // A raw comment-listing response, overriding `comments`.
  commentsResponse,
  // The lock file check (the script's header, edit 15). The dismissed-alert
  // listing, as pages; and a raw answer that overrides it.
  dismissedPages = [[]],
  dismissedResponse,
  // What the advisory listing returns besides the two control advisories,
  // which every answer holds unless `advisoryAnswer` or `advisoryResponse`
  // says otherwise: `advisoryAnswer(path)` returns one query's whole answer
  // as a list, `advisoryResponse` is a raw answer to every query.
  advisories = [],
  advisoryAnswer,
  advisoryResponse,
  // The exit status of each kind of issue write.
  createStatus = 0,
  editStatus = 0,
  commentStatus = 0,
} = {}) {
  const calls = [];
  const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
  const written = (status, stdout = "") =>
    status === 0 ? ok(stdout) : { status, stdout: "", stderr: "write blew up" };

  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (cmd !== "gh") throw new Error(`unexpected program: ${cmd}`);
    const joined = args.join(" ");

    if (joined.includes("automated-security-fixes")) {
      if (securityFixesResponse)
        return { stdout: "", stderr: "", ...securityFixesResponse };
      return securityFixesStatus === 0
        ? ok(JSON.stringify(securityFixes))
        : {
            status: securityFixesStatus,
            stdout: "",
            stderr: securityFixesStderr,
          };
    }
    // Before the open listing: both paths hold "dependabot/alerts".
    if (joined.includes("dependabot/alerts?state=dismissed,auto_dismissed")) {
      if (dismissedResponse)
        return { stdout: "", stderr: "", ...dismissedResponse };
      return ok(JSON.stringify(dismissedPages));
    }
    if (args[0] === "api" && args.at(-1).startsWith("advisories?")) {
      if (advisoryResponse)
        return { stdout: "", stderr: "", ...advisoryResponse };
      const list = advisoryAnswer
        ? advisoryAnswer(args.at(-1))
        : [...CONTROL_ADVISORIES, ...advisories];
      return ok(JSON.stringify([list]));
    }
    if (joined.includes("dependabot/alerts")) {
      if (alertResponse) return { stdout: "", stderr: "", ...alertResponse };
      // `--slurp` yields one array PER PAGE; main() must flatten them.
      return ok(JSON.stringify(alertPages));
    }
    // `--slurp`, so one array per page.
    if (args[0] === "api" && joined.includes("/comments?")) {
      if (commentsResponse)
        return { stdout: "", stderr: "", ...commentsResponse };
      return ok(JSON.stringify([comments.map(asBotComment)]));
    }
    // `--slurp`, so one array per page — `issues` may be a flat list or pages.
    if (args[0] === "api" && joined.includes("/issues?")) {
      if (issuesResponse) return { stdout: "", stderr: "", ...issuesResponse };
      const pages = Array.isArray(issues[0]) ? issues : [issues];
      return ok(JSON.stringify(pages.map((page) => page.map(asSweepIssue))));
    }
    if (args[0] === "issue" && args[1] === "create")
      return written(createStatus, "https://github.com/o/r/issues/77\n");
    if (args[0] === "issue" && args[1] === "edit") return written(editStatus);
    if (args[0] === "issue" && args[1] === "comment")
      return written(commentStatus);
    throw new Error(`unexpected gh call: ${joined}`);
  };
  spawn.calls = calls;
  return spawn;
}

const ghCall = (spawn, verb) =>
  spawn.calls.find(
    (c) => c.cmd === "gh" && c.args[0] === "issue" && c.args[1] === verb,
  );
const ghCalls = (spawn, verb) =>
  spawn.calls.filter(
    (c) => c.cmd === "gh" && c.args[0] === "issue" && c.args[1] === verb,
  );

function captureLog(run) {
  const lines = [];
  const original = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    run();
  } finally {
    console.log = original;
  }
  return lines;
}

/**
 * Run `run`, which must throw `message`, and return what it logged first.
 * In this repo: a run that could not check an npm bump logs why, leaves the
 * issue alone, and then fails (the script's header, edit 14).
 */
function captureLogOfFailedRun(run, message) {
  const lines = [];
  const original = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    assert.throws(run, message);
  } finally {
    console.log = original;
  }
  return lines;
}

/** The end-of-run failure of a sweep that could not check a bump. */
const UNCHECKED = /could not be checked this run/;

/** Run `body` in a temp cwd populated with `files` (path -> JSON value, or text). */
function inTempRepo(files, body) {
  const dir = mkdtempSync(join(tmpdir(), "dependabot-alerts-"));
  const cwd = process.cwd();
  try {
    for (const [path, value] of Object.entries(files)) {
      const full = join(dir, path);
      mkdirSync(dirname(full), { recursive: true });
      // In this repo: a string is written as it is, for a lockfile in the
      // text form Bun writes; anything else as JSON.
      writeFileSync(
        full,
        typeof value === "string" ? value : JSON.stringify(value),
      );
    }
    process.chdir(dir);
    return body();
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The probe `main()` derives from `lockWith`: one hoisted, undeclared copy.
 * A fixture issue built from this renders byte-identically to what `main()`
 * would produce, which is what makes the no-op path assertable.
 */
const asInstalled = (version = "3.1.5") => ({
  affected: [{ path: "node_modules/fast-uri", version, hoisted: true }],
  declared: false,
});

/**
 * A `bun.lock` holding one hoisted, undeclared copy of each package named, at
 * the version given. `inTempRepo` writes it as JSON, which the reader takes.
 */
const lockOf = (versions) => ({
  lockfileVersion: 1,
  workspaces: { "": { name: "fixture", dependencies: {} } },
  packages: Object.fromEntries(
    Object.entries(versions).map(([pkg, version]) => [
      pkg,
      [`${pkg}@${version}`, "", {}, "sha512-fixture"],
    ]),
  ),
});

/** A lockfile holding one transitive copy of `pkg` at `version`. */
const lockWith = (pkg, version) => lockOf({ [pkg]: version });

test("main files one issue per bump, flattening a paginated alert feed", () => {
  // Two pages, as `--slurp` returns them: a single JSON.parse of concatenated
  // pages would have thrown before this ever reached grouping.
  const spawn = fakeSpawn({
    alertPages: [
      [
        alert({ ghsa: "GHSA-a", range: ">= 3.1.3, < 3.1.6" }),
        alert({ ghsa: "GHSA-b" }),
      ],
      [
        alert({
          ghsa: "GHSA-c",
          pkg: "browserslist",
          fixed: "4.28.7",
          range: "<= 4.28.6",
        }),
      ],
    ],
  });

  const log = inTempRepo(
    {
      "bun.lock": lockOf({ "fast-uri": "3.1.5", browserslist: "4.28.2" }),
    },
    () => captureLog(() => main("o/r", spawn)),
  );

  const created = ghCalls(spawn, "create");
  assert.equal(created.length, 2, "3 advisories, 2 bumps, 2 issues");
  const titles = created.map((c) => c.args[c.args.indexOf("--title") + 1]);
  assert.ok(titles.some((t) => t.includes("`fast-uri` to `3.1.6`")));
  assert.ok(titles.some((t) => t.includes("`browserslist` to `4.28.7`")));
  // The fast-uri issue names both of its advisories.
  const fastUri = created.find((c) =>
    c.args[c.args.indexOf("--title") + 1].includes("fast-uri"),
  );
  const body = fastUri.args[fastUri.args.indexOf("--body") + 1];
  assert.deepEqual(parseMarker(body).ghsas, ["GHSA-a", "GHSA-b"]);
  // In this repo: no milestone; the three labels, and the body last.
  for (const call of created) {
    assert.deepEqual(
      call.args.filter((_, i) => call.args[i - 1] === "--label"),
      ISSUE_LABELS,
    );
    assert.equal(call.args.at(-2), "--body");
    assert.equal(call.args.includes("--milestone"), false);
  }
  assert.ok(log.some((l) => l.includes("filed")));
});

test("main skips an alert already out of range on the checked-out branch", () => {
  const spawn = fakeSpawn({ alertPages: [[alert({ ghsa: "GHSA-a" })]] });
  const log = inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.6") }, () =>
    captureLog(() => main("o/r", spawn)),
  );
  assert.equal(ghCall(spawn, "create"), undefined);
  assert.ok(log.some((l) => l.includes("already out of range")));
});

test("main does not check an alert whose manifest it does not know", () => {
  // In this repo: the source read the path and, finding no file, skipped the
  // alert as "absent". Here the path is compared with a fixed list and is not
  // read at all, so there is nothing to find or to miss.
  const spawn = fakeSpawn({
    alertPages: [
      [alert({ ghsa: "GHSA-a", manifest: "gone/package-lock.json" })],
    ],
  });
  const log = inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.5") }, () =>
    captureLogOfFailedRun(() => main("o/r", spawn), UNCHECKED),
  );
  assert.equal(ghCall(spawn, "create"), undefined);
  assert.ok(
    log.some(
      (l) =>
        l.includes('"gone/package-lock.json"') &&
        l.includes("not a manifest this sweep knows") &&
        l.includes("GHSA-a"),
    ),
    `expected an unknown-manifest line, got: ${log.join(" | ")}`,
  );
});

test("main is a complete no-op on a second run", () => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(group),
        body: buildIssueBody(group, asInstalled()),
      },
    ],
  });
  const log = inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.5") }, () =>
    captureLog(() => main("o/r", spawn)),
  );
  assert.equal(ghCall(spawn, "create"), undefined);
  assert.equal(ghCall(spawn, "comment"), undefined);
  assert.equal(ghCall(spawn, "edit"), undefined);
  assert.ok(log.some((l) => l.includes("#41 is up to date")));
});

test("main will not update an issue whose bump differs, even for the same package", () => {
  // The marker's `fixed=` is what keeps a 4.0.0 bump off the 3.1.6 issue.
  const [old] = groupAlerts([alert({ ghsa: "GHSA-a", fixed: "3.1.6" })]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-b", fixed: "4.0.0", range: "< 4.0.0" })]],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(old),
        body: buildIssueBody(old, asInstalled()),
      },
    ],
  });
  const log = inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.5") }, () =>
    captureLog(() => main("o/r", spawn, "2026-09-04")),
  );
  assert.ok(ghCall(spawn, "create"), "a different bump gets its own issue");
  // ...and the 3.1.6 issue, whose alert is no longer in the open feed, is
  // cleared rather than left asserting a vulnerability nobody tracks.
  const edit = ghCall(spawn, "edit");
  assert.ok(edit, "the superseded issue is reconciled");
  assert.match(
    edit.args[edit.args.indexOf("--body") + 1],
    /fixed or dismissed/,
  );
  assert.ok(log.some((l) => l.includes("fixed or dismissed")));
});

test("main comments a new advisory BEFORE rewriting the marker", () => {
  const [old] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" }), alert({ ghsa: "GHSA-b" })]],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(old),
        body: buildIssueBody(old, asInstalled()),
      },
    ],
  });
  inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.5") }, () =>
    captureLog(() => main("o/r", spawn)),
  );

  const order = spawn.calls
    .filter(
      (c) => c.args[0] === "issue" && ["comment", "edit"].includes(c.args[1]),
    )
    .map((c) => c.args[1]);
  // Marker-first would let a failed comment be skipped forever by the no-op branch.
  assert.deepEqual(order, ["comment", "edit"]);

  const comment = ghCall(spawn, "comment");
  const text = comment.args[comment.args.indexOf("--body") + 1];
  assert.deepEqual(parseCommentMarker(text), ["GHSA-b"]);
  assert.ok(!text.includes("GHSA-a"), "only the newly-seen advisory");

  const edit = ghCall(spawn, "edit");
  assert.deepEqual(
    parseMarker(edit.args[edit.args.indexOf("--body") + 1]).ghsas,
    ["GHSA-a", "GHSA-b"],
  );
});

test("main does not repeat a comment it already posted", () => {
  const [old] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" }), alert({ ghsa: "GHSA-b" })]],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(old),
        body: buildIssueBody(old, asInstalled()),
      },
    ],
    comments: [{ body: `${buildCommentMarker(["GHSA-b"])}\nsaid already` }],
  });
  inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.5") }, () =>
    captureLog(() => main("o/r", spawn)),
  );
  assert.equal(ghCall(spawn, "comment"), undefined);
  // The marker still gets brought up to date.
  assert.ok(ghCall(spawn, "edit"));
});

test("main announces only the advisories no comment has claimed yet", () => {
  // The exact shape a failed marker edit leaves behind: the comment for `b`
  // went out, the body edit did not, and a third advisory has since arrived.
  // Comparing whole GHSA sets would find no match and announce `b` twice.
  const [old] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const spawn = fakeSpawn({
    alertPages: [
      [
        alert({ ghsa: "GHSA-a" }),
        alert({ ghsa: "GHSA-b" }),
        alert({ ghsa: "GHSA-c" }),
      ],
    ],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(old),
        body: buildIssueBody(old, asInstalled()),
      },
    ],
    comments: [{ body: `${buildCommentMarker(["GHSA-b"])}\nannounced b` }],
  });
  inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.5") }, () =>
    captureLog(() => main("o/r", spawn)),
  );

  const comment = ghCall(spawn, "comment");
  assert.ok(comment, "the unannounced advisory still gets a comment");
  const text = comment.args[comment.args.indexOf("--body") + 1];
  assert.deepEqual(parseCommentMarker(text), ["GHSA-c"]);
  assert.ok(!text.includes("GHSA-b"), "b was already announced");
});

test("main refreshes the title when an issue grows another advisory", () => {
  const [old] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" }), alert({ ghsa: "GHSA-b" })]],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(old),
        body: buildIssueBody(old, asInstalled()),
      },
    ],
  });
  inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.5") }, () =>
    captureLog(() => main("o/r", spawn)),
  );
  const edit = ghCall(spawn, "edit");
  // Filed as "(1 advisory)"; editing only the body would leave it saying so.
  assert.match(
    edit.args[edit.args.indexOf("--title") + 1],
    /\(2 advisories\)$/,
  );
});

test("main fails loudly when Dependabot security PRs are back on", () => {
  const spawn = fakeSpawn({ securityFixes: { enabled: true, paused: false } });
  assert.throws(
    () => captureLog(() => main("o/r", spawn)),
    /security-update PRs are ENABLED again/,
  );
  assert.equal(spawn.calls.length, 1, "nothing else runs");
});

test("main continues, reporting UNVERIFIED, when the token cannot read the setting", () => {
  const spawn = fakeSpawn({
    securityFixesStatus: 1,
    securityFixesStderr: "gh: HTTP 403: Resource not accessible by integration",
    alertPages: [[]],
  });
  const log = captureLog(() => main("o/r", spawn));
  assert.ok(log.some((l) => l.includes("UNVERIFIED")));
  assert.ok(log.some((l) => l.includes("no open alerts")));
});

test("main throws when the setting lookup fails for a non-permission reason", () => {
  const spawn = fakeSpawn({
    securityFixesStatus: 1,
    securityFixesStderr: "gh: HTTP 502: Bad Gateway",
  });
  // Swallowing this would exit green having skipped the sweep's own precondition.
  assert.throws(
    () => captureLog(() => main("o/r", spawn)),
    /automated-security-fixes lookup failed.*502/s,
  );
});

// A failed or partial alert listing must never read as "no alerts": main()
// clears every tracked issue whose alert vanished from the feed, so each of
// these has to throw before any issue is touched (#2425).
const trackedIssue = () => ({
  number: 12,
  state: "open",
  title: "Bump `fast-uri` to `3.1.6` (security)",
  body: buildIssueBody(
    {
      package: "fast-uri",
      manifestPath: "package.json",
      fixedIn: "3.1.6",
      ghsas: ["GHSA-a"],
      severity: "high",
      advisories: [],
    },
    asInstalled(),
  ),
});

function assertListingFailureTouchesNothing(alertResponse, message) {
  const spawn = fakeSpawn({ alertResponse, issues: [trackedIssue()] });
  assert.throws(
    () =>
      inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.5") }, () =>
        captureLog(() => main("o/r", spawn)),
      ),
    message,
  );
  const writes = spawn.calls.filter(
    (c) =>
      c.args[0] === "issue" &&
      ["create", "edit", "comment", "close"].includes(c.args[1]),
  );
  assert.deepEqual(writes, [], "no issue is written");
  assert.equal(
    spawn.calls.some((c) => c.args.join(" ").includes("/issues?")),
    false,
    "the run stops before it even reads the tracked issues",
  );
}

test("main throws, touching nothing, when the alert listing is rate-limited", () => {
  assertListingFailureTouchesNothing(
    { status: 1, stderr: "gh: API rate limit exceeded (HTTP 403)" },
    /alert listing was rate-limited.*re-run once the quota resets/s,
  );
  assertListingFailureTouchesNothing(
    { status: 1, stderr: "gh: HTTP 429: Too Many Requests" },
    /alert listing was rate-limited/,
  );
});

test("main throws, touching nothing, when the alert listing fails mid-pagination", () => {
  // `gh api --paginate` exits non-zero when a later page fails, even though
  // earlier pages were fetched — those must not be used as the whole feed.
  assertListingFailureTouchesNothing(
    { status: 1, stdout: "[[{", stderr: "gh: HTTP 502: Bad Gateway" },
    /alert listing failed \(gh: HTTP 502: Bad Gateway\) — no issue was filed/,
  );
});

test("main throws, touching nothing, on a truncated or empty alert listing", () => {
  assertListingFailureTouchesNothing(
    { status: 0, stdout: '[[{"number": 1' },
    /truncated or malformed response/,
  );
  // An empty body used to parse as `null` and read as zero alerts.
  assertListingFailureTouchesNothing(
    { status: 0, stdout: "" },
    /truncated or malformed response/,
  );
});

test("main throws, touching nothing, on an alert listing that is not a list of pages", () => {
  assertListingFailureTouchesNothing(
    { status: 0, stdout: JSON.stringify({ message: "Not Found" }) },
    /not a list of pages/,
  );
  assertListingFailureTouchesNothing(
    { status: 0, stdout: JSON.stringify([[], { message: "oops" }]) },
    /not a list of pages/,
  );
  // Zero pages is not one empty page: `[[]]` is the no-alert answer.
  assertListingFailureTouchesNothing(
    { status: 0, stdout: "[]" },
    /not a list of pages/,
  );
});

test("main refreshes an issue whose exposure shrank, without commenting", () => {
  // Filed when both advisories applied; `main` has since moved to 3.1.0,
  // which is out of range of the narrow one. Nothing is NEW, so `added` is
  // empty — but the body still claims an advisory that no longer applies.
  const [filed] = groupAlerts([
    alert({ ghsa: "GHSA-narrow", range: ">= 3.1.3, < 3.1.6" }),
    alert({ ghsa: "GHSA-wide", range: ">= 3.0.0, < 3.1.6" }),
  ]);
  const spawn = fakeSpawn({
    alertPages: [
      [
        alert({ ghsa: "GHSA-narrow", range: ">= 3.1.3, < 3.1.6" }),
        alert({ ghsa: "GHSA-wide", range: ">= 3.0.0, < 3.1.6" }),
      ],
    ],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(filed),
        body: buildIssueBody(filed, asInstalled()),
      },
    ],
  });
  const log = inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.0") }, () =>
    captureLog(() => main("o/r", spawn)),
  );

  // A comment is for genuinely new advisories, and there are none.
  assert.equal(ghCall(spawn, "comment"), undefined);

  const edit = ghCall(spawn, "edit");
  assert.ok(edit, "the stale body is rewritten");
  const body = edit.args[edit.args.indexOf("--body") + 1];
  assert.ok(!body.includes("| [GHSA-narrow]"), "no longer in the table");
  assert.match(body, /`3\.1\.0`/, "the affected version is refreshed");
  assert.match(edit.args[edit.args.indexOf("--title") + 1], /\(1 advisory\)$/);
  // The marker stays monotonic: it records what has been announced, so the
  // dropped advisory cannot be re-announced later.
  assert.deepEqual(parseMarker(body).ghsas, ["GHSA-narrow", "GHSA-wide"]);
  assert.ok(log.some((l) => l.includes("refreshed #41")));
});

test("main leaves an open issue alone when its alert names a manifest it does not know", () => {
  // In this repo: the source cleared this issue, on the strength of a missing
  // file. A path this sweep does not know is not evidence that the exposure
  // went away, so nothing is written.
  const [group] = groupAlerts([
    alert({ ghsa: "GHSA-a", manifest: "clients/gone/package-lock.json" }),
  ]);
  const spawn = fakeSpawn({
    alertPages: [
      [alert({ ghsa: "GHSA-a", manifest: "clients/gone/package-lock.json" })],
    ],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(group),
        body: buildIssueBody(group, asInstalled()),
      },
    ],
  });
  const log = inTempRepo({}, () =>
    captureLogOfFailedRun(() => main("o/r", spawn, "2026-09-04"), UNCHECKED),
  );

  assert.equal(ghCall(spawn, "edit"), undefined, "the issue is not cleared");
  assert.equal(ghCall(spawn, "create"), undefined);
  assert.equal(ghCall(spawn, "comment"), undefined);
  assert.ok(log.some((l) => l.includes("not a manifest this sweep knows")));
});

test("main clears an open issue when every copy moved out of range", () => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(group),
        body: buildIssueBody(group, asInstalled()),
      },
    ],
  });
  const log = inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.6") }, () =>
    captureLog(() => main("o/r", spawn, "2026-09-04")),
  );
  const edit = ghCall(spawn, "edit");
  assert.ok(edit);
  const body = edit.args[edit.args.indexOf("--body") + 1];
  assert.match(body, /every installed copy is out of range \(`3\.1\.6`\)/);
  assert.ok(log.some((l) => l.includes("cleared #41")));
});

test("main does not re-clear an issue it already cleared", () => {
  // The second run of a cleared sweep must touch nothing at all.
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(group),
        body: buildClearedBody(group, {
          ghsas: ["GHSA-a"],
          reason: "every installed copy is out of range (`3.1.6`)",
          today: "2026-09-04",
        }),
      },
    ],
  });
  inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.6") }, () =>
    captureLog(() => main("o/r", spawn, "2026-09-04")),
  );
  assert.equal(ghCall(spawn, "edit"), undefined);
  assert.equal(ghCall(spawn, "create"), undefined);
});

test("main skips quietly when nothing applies and no issue is open", () => {
  const spawn = fakeSpawn({ alertPages: [[alert({ ghsa: "GHSA-a" })]] });
  inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.6") }, () =>
    captureLog(() => main("o/r", spawn)),
  );
  assert.equal(ghCall(spawn, "edit"), undefined);
  assert.equal(ghCall(spawn, "create"), undefined);
});

test("buildIssueBody counts the applicable alerts in its prose, not the marker", () => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  // The marker carries a second, since-closed advisory; the prose must not.
  const body = buildIssueBody(group, {
    ...nested(),
    ghsas: ["GHSA-a", "GHSA-closed"],
  });
  assert.match(body, /Filed automatically from 1 open Dependabot alert\b/);
  assert.deepEqual(parseMarker(body).ghsas, ["GHSA-a", "GHSA-closed"]);
});

test("main clears an issue when its last alert is fixed or dismissed", () => {
  // `openAlerts` asks for state=open, so a fixed alert simply vanishes and its
  // group is never built. The issue has to be reconciled from the other side.
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const spawn = fakeSpawn({
    alertPages: [[]],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(group),
        body: buildIssueBody(group, asInstalled()),
      },
    ],
  });
  const log = inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.5") }, () =>
    captureLog(() => main("o/r", spawn, "2026-09-04")),
  );
  const edit = ghCall(spawn, "edit");
  assert.ok(edit, "the zero-alert run still reconciles open issues");
  const body = edit.args[edit.args.indexOf("--body") + 1];
  assert.match(body, /every alert it tracked has been fixed or dismissed/);
  assert.deepEqual(parseMarker(body).ghsas, ["GHSA-a"]);
  assert.ok(log.some((l) => l.includes("fixed or dismissed")));
});

test("main reconciles a vanished group even while other groups remain", () => {
  // The early return is only half of it: a disappeared group is also never
  // visited by the loop when the feed still has other bumps in it.
  const [gone] = groupAlerts([
    alert({ ghsa: "GHSA-gone", pkg: "qs", fixed: "6.16.0" }),
  ]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(gone),
        body: buildIssueBody(gone, {
          affected: [
            { path: "node_modules/qs", version: "6.15.3", hoisted: true },
          ],
          declared: false,
        }),
      },
    ],
  });
  inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.5") }, () =>
    captureLog(() => main("o/r", spawn, "2026-09-04")),
  );
  assert.ok(ghCall(spawn, "create"), "the live bump is still filed");
  const edit = ghCall(spawn, "edit");
  assert.ok(edit, "the vanished bump's issue is still cleared");
  assert.equal(edit.args[2], "41");
});

test("main does not re-clear a vanished group's issue on the next run", () => {
  const spawn = fakeSpawn({
    alertPages: [[]],
    issues: [
      {
        number: 41,
        title:
          "chore(deps): bump `fast-uri` to `3.1.6` in `package.json` (1 advisory)",
        body: buildClearedBody(
          {
            package: "fast-uri",
            manifestPath: "package.json",
            fixedIn: "3.1.6",
          },
          {
            ghsas: ["GHSA-a"],
            reason: "every alert it tracked has been fixed or dismissed",
            today: "2026-09-04",
          },
        ),
      },
    ],
  });
  inTempRepo({}, () => captureLog(() => main("o/r", spawn, "2026-09-04")));
  assert.equal(ghCall(spawn, "edit"), undefined);
});

test("groupAlerts records the ecosystem so non-npm alerts are identifiable", () => {
  const [docker] = groupAlerts([
    alert({
      ghsa: "GHSA-d",
      pkg: "node",
      manifest: "Dockerfile",
      ecosystem: "docker",
    }),
  ]);
  assert.equal(docker.ecosystem, "docker");
  assert.notEqual(docker.ecosystem, SUPPORTED_ECOSYSTEM);
});

test("main skips a non-npm alert loudly instead of crashing on its manifest", () => {
  // The source's case (its repository has a Dockerfile): parsing that as a
  // lockfile threw and aborted the entire sweep before any npm group ran. Here
  // the same holds for an alert on a workflow's action.
  const spawn = fakeSpawn({
    alertPages: [
      [
        alert({
          ghsa: "GHSA-docker",
          pkg: "node",
          manifest: "Dockerfile",
          ecosystem: "docker",
        }),
        alert({ ghsa: "GHSA-a" }),
      ],
    ],
  });
  const log = inTempRepo(
    {
      "bun.lock": lockWith("fast-uri", "3.1.5"),
    },
    () => captureLog(() => main("o/r", spawn)),
  );

  // The npm bump is still filed — the non-npm alert must not abort the run.
  const created = ghCalls(spawn, "create");
  assert.equal(created.length, 1);
  assert.match(
    created[0].args[created[0].args.indexOf("--title") + 1],
    /`fast-uri`/,
  );
  // ...and the skipped one is named, with its GHSA, so a human can file it.
  assert.ok(
    log.some(
      (l) =>
        l.includes("docker") &&
        l.includes("Dockerfile") &&
        l.includes("GHSA-docker") &&
        l.includes("raise it by hand"),
    ),
    `expected a loud skip line, got: ${log.join(" | ")}`,
  );
});

test("main says superseded, not fixed, when the GHSA is still open elsewhere", () => {
  // GitHub revised `first_patched_version`, so the advisory moved to a new key
  // while staying open. Calling that "fixed or dismissed" would stand down a
  // live exposure.
  const [filed] = groupAlerts([alert({ ghsa: "GHSA-a", fixed: "3.1.6" })]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a", fixed: "3.1.7", range: "< 3.1.7" })]],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(filed),
        body: buildIssueBody(filed, asInstalled()),
      },
    ],
  });
  inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.5") }, () =>
    captureLog(() => main("o/r", spawn, "2026-09-04")),
  );
  const edit = ghCall(spawn, "edit");
  assert.ok(edit);
  const body = edit.args[edit.args.indexOf("--body") + 1];
  assert.match(body, /superseded/);
  assert.match(body, /`GHSA-a` is still open/);
  assert.doesNotMatch(body, /fixed or dismissed/);
  // ...and the new bump gets its own issue.
  assert.ok(ghCall(spawn, "create"));
});

test("buildIssueBody does not claim security PRs are off when unverified", () => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const verified = buildIssueBody(group, nested());
  assert.match(verified, /Dependabot opens no security-update PRs/);

  const unverified = buildIssueBody(group, {
    ...nested(),
    securityPrsOff: false,
  });
  assert.doesNotMatch(unverified, /opens no security-update PRs/);
  assert.match(unverified, /The fix is written by hand/);
});

test("main omits the security-PR claim when the token could not read it", () => {
  const spawn = fakeSpawn({
    securityFixesStatus: 1,
    securityFixesStderr: "gh: HTTP 403: Resource not accessible by integration",
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
  });
  const log = inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.5") }, () =>
    captureLog(() => main("o/r", spawn)),
  );
  assert.ok(log.some((l) => l.includes("UNVERIFIED")));
  const create = ghCall(spawn, "create");
  assert.ok(create);
  assert.doesNotMatch(
    create.args[create.args.indexOf("--body") + 1],
    /opens no security-update PRs/,
  );
});

test("main will not stand down an open alert that lost its patched version", () => {
  // groupAlerts drops an alert with no first_patched_version, so the bump's key
  // disappears — but the advisory is still OPEN. Reading the open-GHSA set from
  // the groups instead of the raw feed would report it as fixed or dismissed.
  const [filed] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const unpatched = alert({ ghsa: "GHSA-a" });
  unpatched.security_vulnerability.first_patched_version = null;

  const spawn = fakeSpawn({
    alertPages: [[unpatched]],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(filed),
        body: buildIssueBody(filed, asInstalled()),
      },
    ],
  });
  const log = inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.5") }, () =>
    captureLog(() => main("o/r", spawn, "2026-09-04")),
  );
  // Nothing to bump to means no replacement issue exists, so "superseded" would
  // be false and clearing would stand down a live exposure nothing is tracking.
  // The correct move is to leave the issue exactly as it is.
  assert.equal(ghCall(spawn, "edit"), undefined);
  assert.ok(
    log.some(
      (l) =>
        l.includes("left as is") &&
        l.includes("GHSA-a") &&
        l.includes("could not establish a replacement"),
    ),
    `expected a left-as-is line, got: ${log.join(" | ")}`,
  );
});

test("a cleared issue is not re-edited on a LATER day", () => {
  // ⚠️ The bug the same-date no-reclear test could never catch: a cleared issue
  // stays open, so the sweep sees it again tomorrow. With today's date rendered
  // into the body, every cleared issue would be edited once a day forever.
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const cleared = buildClearedBody(
    {
      package: "fast-uri",
      manifestPath: "package.json",
      fixedIn: "3.1.6",
    },
    {
      ghsas: ["GHSA-a"],
      reason: "every alert it tracked has been fixed or dismissed",
      today: "2026-09-04",
    },
  );
  const spawn = fakeSpawn({
    alertPages: [[]],
    issues: [{ number: 41, title: buildIssueTitle(group), body: cleared }],
  });
  inTempRepo({}, () =>
    // A DIFFERENT day from the one the body records.
    captureLog(() => main("o/r", spawn, "2026-09-11")),
  );
  assert.equal(ghCall(spawn, "edit"), undefined);
});

test("a cleared issue takes the new date when its reason changes", () => {
  // A real change still gets one edit — and takes the new date, since the state
  // genuinely changed on that day.
  const cleared = buildClearedBody(
    {
      package: "fast-uri",
      manifestPath: "package.json",
      fixedIn: "3.1.6",
    },
    { ghsas: ["GHSA-a"], reason: "an older reason", today: "2026-09-04" },
  );
  const spawn = fakeSpawn({
    alertPages: [[]],
    issues: [{ number: 41, title: "t", body: cleared }],
  });
  inTempRepo({}, () => captureLog(() => main("o/r", spawn, "2026-09-11")));
  const edit = ghCall(spawn, "edit");
  assert.ok(edit, "a changed reason is still written");
  assert.equal(
    parseClearedDate(edit.args[edit.args.indexOf("--body") + 1]),
    "2026-09-11",
  );
});

test("parseClearedDate reads the date back, and only from a cleared body", () => {
  const body = buildClearedBody(
    { package: "p", manifestPath: "package.json", fixedIn: "1.0.0" },
    { ghsas: ["GHSA-a"], reason: "why", today: "2026-09-04" },
  );
  assert.equal(parseClearedDate(body), "2026-09-04");
  assert.equal(parseClearedDate("an ordinary issue body"), null);
  assert.equal(parseClearedDate(undefined), null);
});

test("main does not clear an issue when the lockfile cannot be parsed", () => {
  // A malformed lockfile is evidence of nothing. Treating it like an absent one
  // would stand down a live alert on the strength of a read error.
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(group),
        body: buildIssueBody(group, asInstalled()),
      },
    ],
  });

  const dir = mkdtempSync(join(tmpdir(), "dependabot-alerts-"));
  const cwd = process.cwd();
  let log;
  try {
    writeFileSync(join(dir, "bun.lock"), "{ truncated…");
    process.chdir(dir);
    // In this repo the run then fails: it could not check the bump.
    log = captureLogOfFailedRun(
      () => main("o/r", spawn, "2026-09-04"),
      UNCHECKED,
    );
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(ghCall(spawn, "edit"), undefined, "the issue is left alone");
  assert.equal(ghCall(spawn, "create"), undefined);
  assert.ok(
    log.some(
      (l) =>
        l.includes("could not be read or parsed") &&
        l.includes("WITHOUT clearing"),
    ),
    `expected a parse-failure line, got: ${log.join(" | ")}`,
  );
});

test("advisoryKey distinguishes the same GHSA in different manifests", () => {
  assert.notEqual(
    advisoryKey("fast-uri", "package.json", "GHSA-a"),
    advisoryKey("fast-uri", "clients/tui/package-lock.json", "GHSA-a"),
  );
});

test("another manifest's alert cannot vouch for this one when clearing", () => {
  // The same GHSA can be reported against more than one manifest; in this repo
  // the two the sweep knows are `package.json` and `bun.lock`. Here the
  // `package.json` alert lost its patched version while the `bun.lock` one is
  // still filable — keying on the GHSA alone would let the second vouch for the
  // first's issue and clear it, even though that alert is open with no bump
  // available.
  const [rootFiled] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const rootUnpatched = alert({ ghsa: "GHSA-a" });
  rootUnpatched.security_vulnerability.first_patched_version = null;

  const spawn = fakeSpawn({
    alertPages: [
      [
        rootUnpatched,
        alert({
          ghsa: "GHSA-a",
          manifest: "bun.lock",
          range: "< 3.1.6",
        }),
      ],
    ],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(rootFiled),
        body: buildIssueBody(rootFiled, asInstalled()),
      },
    ],
  });
  const log = inTempRepo(
    {
      "bun.lock": lockWith("fast-uri", "3.1.5"),
    },
    () => captureLog(() => main("o/r", spawn, "2026-09-04")),
  );

  // The `bun.lock` bump is filed; the first issue is left alone, not cleared.
  assert.ok(ghCall(spawn, "create"));
  assert.equal(ghCall(spawn, "edit"), undefined);
  assert.ok(
    log.some((l) => l.includes("#41 left as is")),
    `expected the root issue left as is, got: ${log.join(" | ")}`,
  );
});

test("a revised bump does not clear the old issue when the probe is indeterminate", () => {
  // GitHub revised first_patched_version, so the old key vanished — but the
  // replacement group was skipped because the lockfile would not parse. Nothing
  // was established, so "superseded, it has its own issue" would be a guess.
  const [filed] = groupAlerts([alert({ ghsa: "GHSA-a", fixed: "3.1.6" })]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a", fixed: "3.1.7", range: "< 3.1.7" })]],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(filed),
        body: buildIssueBody(filed, asInstalled()),
      },
    ],
  });

  const dir = mkdtempSync(join(tmpdir(), "dependabot-alerts-"));
  const cwd = process.cwd();
  let log;
  try {
    writeFileSync(join(dir, "bun.lock"), "{ truncated…");
    process.chdir(dir);
    // In this repo the run then fails: it could not check the bump.
    log = captureLogOfFailedRun(
      () => main("o/r", spawn, "2026-09-04"),
      UNCHECKED,
    );
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(ghCall(spawn, "edit"), undefined, "the old issue is preserved");
  assert.equal(ghCall(spawn, "create"), undefined);
  assert.ok(
    log.some((l) => l.includes("could not establish a replacement")),
    `expected an indeterminate line, got: ${log.join(" | ")}`,
  );
});

test("a revised bump that is no longer exposed clears without claiming an issue", () => {
  // Same revision, but the probe DID run and found nothing in range. That is
  // positive evidence, so the old issue clears — saying exposure is gone rather
  // than claiming a replacement issue that was never filed.
  const [filed] = groupAlerts([alert({ ghsa: "GHSA-a", fixed: "3.1.6" })]);
  const spawn = fakeSpawn({
    alertPages: [
      [alert({ ghsa: "GHSA-a", fixed: "3.1.7", range: ">= 3.1.6, < 3.1.7" })],
    ],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(filed),
        body: buildIssueBody(filed, asInstalled()),
      },
    ],
  });
  inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.5") }, () =>
    captureLog(() => main("o/r", spawn, "2026-09-04")),
  );
  const edit = ghCall(spawn, "edit");
  assert.ok(edit);
  const body = edit.args[edit.args.indexOf("--body") + 1];
  assert.match(body, /no installed copy is in range/);
  assert.doesNotMatch(body, /has their own issue|superseded/);
});

test("main reads every page of open dependabot issues", () => {
  // The second page holds the matching marker. Truncating the lookup would
  // file a duplicate issue rather than recognising this one.
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
    issues: [
      [{ number: 1, body: "an unrelated dependabot issue" }],
      [
        {
          number: 41,
          title: buildIssueTitle(group),
          body: buildIssueBody(group, asInstalled()),
        },
      ],
    ],
  });
  const log = inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.5") }, () =>
    captureLog(() => main("o/r", spawn)),
  );
  assert.equal(ghCall(spawn, "create"), undefined);
  assert.ok(log.some((l) => l.includes("#41 is up to date")));
});

test("main drops a pull request returned by the issues endpoint", () => {
  // `/issues` returns PRs too; one carrying no marker must not be mistaken for
  // a match, nor crash the lookup.
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
    issues: [[{ number: 9, body: "a PR body", pull_request: { url: "..." } }]],
  });
  inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.5") }, () =>
    captureLog(() => main("o/r", spawn)),
  );
  assert.ok(ghCall(spawn, "create"), "the issue is still filed");
});

test("main files an issue naming only the advisories that apply here", () => {
  const spawn = fakeSpawn({
    alertPages: [
      [
        alert({ ghsa: "GHSA-narrow", range: ">= 3.1.3, < 3.1.6" }),
        alert({ ghsa: "GHSA-wide", range: ">= 3.0.0, < 3.1.6" }),
      ],
    ],
  });
  inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.0") }, () =>
    captureLog(() => main("o/r", spawn)),
  );
  const create = ghCall(spawn, "create");
  const body = create.args[create.args.indexOf("--body") + 1];
  assert.deepEqual(parseMarker(body).ghsas, ["GHSA-wide"]);
  assert.ok(!body.includes("GHSA-narrow"), "3.1.0 is out of that range");
  assert.match(
    create.args[create.args.indexOf("--title") + 1],
    /\(1 advisory\)$/,
  );
});

// ---------------------------------------------------------------------------
// Written in this repo: the cases for what the script's header lists as
// edits. Each names the edit it holds in place.
// ---------------------------------------------------------------------------

/** The `gh issue …` calls a run made: its writes. */
const issueWrites = (spawn) =>
  spawn.calls.filter((c) => c.cmd === "gh" && c.args[0] === "issue");

/** An open issue for the default alert (`GHSA-a` on `fast-uri`), up to date. */
const filedIssue = (extra = {}) => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  return {
    number: 41,
    title: buildIssueTitle(group),
    body: buildIssueBody(group, asInstalled()),
    ...extra,
  };
};

const VULNERABLE = { "bun.lock": lockWith("fast-uri", "3.1.5") };

test("the constants name this repository's branch, lockfile, manifests and labels", () => {
  assert.equal(TARGET_BRANCH, "main");
  assert.equal(LOCKFILE, "bun.lock");
  assert.deepEqual(KNOWN_MANIFESTS, ["package.json", "bun.lock"]);
  assert.deepEqual(ISSUE_LABELS, ["factory", "chore", "dependabot"]);
  assert.deepEqual(SWEEP_LABELS, ["chore", "dependabot"]);
  assert.equal(
    PLACEMENT_DOC,
    "https://github.com/NorthwoodsSentinel/mycelia-mcp/blob/main/AGENTS.md#dependency-placement",
  );
});

test("main refuses to run with no repository named, before any call", () => {
  const spawn = fakeSpawn();
  assert.throws(() => main("", spawn), /repo not specified/);
  assert.equal(spawn.calls.length, 0);
});

// --- edits 1, 2, 7, 8 and 9: what an issue says, and how it is filed -----------

test("an issue's text names this repository and none of the source's board, branch or issue numbers", () => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const bodies = [
    buildIssueBody(group, asInstalled()),
    buildIssueBody(group, {
      declared: true,
      affected: [
        { path: "node_modules/fast-uri", version: "3.1.5", hoisted: true },
        {
          path: "node_modules/ajv/node_modules/fast-uri",
          version: "3.0.1",
          hoisted: false,
        },
      ],
    }),
    buildClearedBody(group, {
      ghsas: ["GHSA-a"],
      reason: "why",
      today: "2026-09-04",
    }),
    buildNewAdvisoryComment(group, ["GHSA-a"]),
  ];
  for (const body of bodies) {
    assert.doesNotMatch(body, /#\d/, "no issue number of the source's");
    assert.doesNotMatch(body, /v2\/main/);
    assert.doesNotMatch(body, /modelcontextprotocol/);
    assert.doesNotMatch(body, /board|card|milestone|Priority/i);
    assert.doesNotMatch(body, /package-lock\.json/);
  }
  assert.ok(bodies[0].includes(`](${PLACEMENT_DOC})`));
  assert.match(bodies[0], /read from `bun\.lock`/);
  assert.match(bodies[2], /No longer applicable on `main` as of 2026-09-04/);
});

test("an override is asked for at the top level, whether or not the package is declared", () => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const transitiveOnly = buildIssueBody(group, asInstalled());
  assert.match(
    transitiveOnly,
    /Add an \[`overrides`\]\(.+\) entry\*\* in `package\.json` pinning `fast-uri` to `3\.1\.6`/,
  );
  assert.match(transitiveOnly, /which no declared range reaches/);
  assert.match(transitiveOnly, /Bun ignores a nested \(parent-scoped\) entry/);
  assert.doesNotMatch(transitiveOnly, /the declared one included/);
  assert.doesNotMatch(transitiveOnly, /```json/, "no parent-scoped example");
});

// --- edit 4: bun.lock, through the existing reader ------------------------------

test("main reads bun.lock as Bun writes it: trailing commas, nested and scoped copies", () => {
  // The text form, not JSON: Bun leaves a comma before each closing bracket.
  const text = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "fixture",
      "dependencies": {
        "fast-uri": "^4.0.0",
      },
    },
  },
  "packages": {
    "@sc/a": ["@sc/a@1.0.0", "", {}, "sha512-fixture"],

    "@sc/a/fast-uri": ["fast-uri@3.0.1", "", {}, "sha512-fixture"],

    "ajv": ["ajv@8.0.0", "", {}, "sha512-fixture"],

    "ajv/fast-uri": ["fast-uri@3.1.5", "", {}, "sha512-fixture"],

    "fast-uri": ["fast-uri@4.0.0", "", {}, "sha512-fixture"],
  }
}
`;
  const spawn = fakeSpawn({ alertPages: [[alert({ ghsa: "GHSA-a" })]] });
  inTempRepo({ "bun.lock": text }, () => captureLog(() => main("o/r", spawn)));

  const create = ghCall(spawn, "create");
  assert.ok(create, "the nested copies are in range, so an issue is filed");
  const body = create.args[create.args.indexOf("--body") + 1];
  // Each nested copy, under the path the source's functions expect.
  assert.match(
    body,
    /\| `node_modules\/@sc\/a\/node_modules\/fast-uri` \| `3\.0\.1` \|/,
  );
  assert.match(
    body,
    /\| `node_modules\/ajv\/node_modules\/fast-uri` \| `3\.1\.5` \|/,
  );
  // The declared, hoisted copy is 4.0.0 and safe: only the override is asked.
  assert.doesNotMatch(body, /\| `node_modules\/fast-uri` \|/);
  assert.doesNotMatch(body, /Raise the declared range/);
  assert.match(body, /Add an \[`overrides`\]/);
  assert.match(body, /\| Vulnerable on `main` \| `3\.0\.1`, `3\.1\.5` \|/);
});

test("main asks for the declared range to be raised when bun.lock's root declares the vulnerable copy", () => {
  const lock = lockOf({ "fast-uri": "3.1.5" });
  lock.workspaces[""].devDependencies = { "fast-uri": "^3.0.0" };
  const spawn = fakeSpawn({ alertPages: [[alert({ ghsa: "GHSA-a" })]] });
  inTempRepo({ "bun.lock": lock }, () => captureLog(() => main("o/r", spawn)));
  const create = ghCall(spawn, "create");
  const body = create.args[create.args.indexOf("--body") + 1];
  assert.match(body, /Raise the declared range in `package\.json`/);
  assert.doesNotMatch(body, /overrides/);
});

for (const [name, files, reason] of [
  ["is missing", {}, "ENOENT"],
  [
    "is a lockfile version the reader does not know",
    { "bun.lock": { ...lockWith("fast-uri", "3.1.5"), lockfileVersion: 2 } },
    "lockfileVersion 2",
  ],
  [
    "has no packages map",
    { "bun.lock": { lockfileVersion: 1, workspaces: { "": {} } } },
    "no packages map",
  ],
]) {
  test(`main neither files nor clears when bun.lock ${name}`, () => {
    // A lockfile that cannot be read is evidence of nothing: the open issue
    // stays exactly as it is, nothing new is filed on a guess, and the run
    // ends red.
    const spawn = fakeSpawn({
      alertPages: [[alert({ ghsa: "GHSA-a" })]],
      issues: [filedIssue()],
    });
    const log = inTempRepo(files, () =>
      captureLogOfFailedRun(() => main("o/r", spawn, "2026-09-04"), UNCHECKED),
    );
    assert.deepEqual(issueWrites(spawn), []);
    assert.ok(
      log.some(
        (l) =>
          l.includes("bun.lock could not be read or parsed") &&
          l.includes(reason) &&
          l.includes("WITHOUT clearing"),
      ),
      `expected an unreadable-lockfile line naming ${reason}, got: ${log.join(" | ")}`,
    );
  });
}

test("main does not judge a copy whose locked version is not a version", () => {
  // `semver.satisfies` answers false for a git source, which would read as
  // "out of range" and clear the issue. The package is left alone instead.
  const lock = lockOf({ "fast-uri": "3.1.6" });
  lock.packages["ajv"] = ["ajv@8.0.0", "", {}, "sha512-fixture"];
  lock.packages["ajv/fast-uri"] = ["fast-uri@github:someone/fast-uri#abc1234"];
  for (const issues of [[], [filedIssue()]]) {
    const spawn = fakeSpawn({
      alertPages: [[alert({ ghsa: "GHSA-a" })]],
      issues,
    });
    const log = inTempRepo({ "bun.lock": lock }, () =>
      captureLogOfFailedRun(
        () => main("o/r", spawn, "2026-09-04"),
        /fast-uri \(GHSA-a\): a copy in bun\.lock has a version that is not a semver version/,
      ),
    );
    assert.deepEqual(issueWrites(spawn), []);
    assert.ok(
      log.some(
        (l) =>
          l.includes("fast-uri has a copy in bun.lock") &&
          l.includes("not a semver version") &&
          l.includes("WITHOUT clearing"),
      ),
      `expected a not-a-version line, got: ${log.join(" | ")}`,
    );
  }
});

test("a package with an unversioned copy does not stop another package's issue", () => {
  const lock = lockOf({ "fast-uri": "3.1.5", qs: "6.15.3" });
  lock.packages["x"] = ["x@1.0.0", "", {}, "sha512-fixture"];
  lock.packages["x/qs"] = ["qs@file:../qs"];
  const spawn = fakeSpawn({
    alertPages: [
      [
        alert({ ghsa: "GHSA-a" }),
        alert({
          ghsa: "GHSA-q",
          pkg: "qs",
          fixed: "6.16.0",
          range: "< 6.16.0",
        }),
      ],
    ],
  });
  // The run fails at its end, naming the one it could not check, after it has
  // filed the one it could.
  inTempRepo({ "bun.lock": lock }, () =>
    captureLogOfFailedRun(
      () => main("o/r", spawn),
      /1 open npm bump could not be checked this run; no issue of its was filed, edited or cleared —\n {2}qs \(GHSA-q\)/,
    ),
  );
  const created = ghCalls(spawn, "create");
  assert.equal(created.length, 1);
  assert.match(
    created[0].args[created[0].args.indexOf("--title") + 1],
    /`fast-uri`/,
  );
});

// --- edit 5: the alert's manifest path is compared, never opened ----------------

for (const manifest of KNOWN_MANIFESTS) {
  test(`an alert against ${manifest} is checked against bun.lock`, () => {
    const spawn = fakeSpawn({
      alertPages: [[alert({ ghsa: "GHSA-a", manifest })]],
    });
    inTempRepo(VULNERABLE, () => captureLog(() => main("o/r", spawn)));
    const create = ghCall(spawn, "create");
    assert.ok(create);
    assert.ok(
      create.args[create.args.indexOf("--title") + 1].includes(
        `in \`${manifest}\``,
      ),
    );
  });
}

test("a file at the path an alert names is never read: an unknown manifest is not checked", () => {
  // The source opened this path. Each file below is a readable lockfile that
  // says the package is vulnerable, so a run that opened it would file an
  // issue. None is filed, and nothing is cleared either.
  const vulnerable = lockWith("fast-uri", "3.1.5");
  const cases = [
    "package-lock.json",
    "sub/package.json",
    "sub/bun.lock",
    "./bun.lock",
    "../outside/bun.lock",
    "BUN.LOCK",
  ];
  for (const manifest of cases) {
    const spawn = fakeSpawn({
      alertPages: [[alert({ ghsa: "GHSA-a", manifest })]],
      issues: [
        {
          number: 41,
          title: "t",
          body: buildIssueBody(
            groupAlerts([alert({ ghsa: "GHSA-a", manifest })])[0],
            asInstalled(),
          ),
        },
      ],
    });
    // The checkout's own lockfile says "not exposed": a run that fell back to
    // it for an unknown manifest would clear the issue.
    const files = { "sub/placeholder": "" };
    if (!manifest.startsWith("..")) files[manifest] = vulnerable;
    files["bun.lock"] ??= lockWith("fast-uri", "3.1.6");
    const log = inTempRepo(files, () =>
      captureLogOfFailedRun(() => main("o/r", spawn, "2026-09-04"), UNCHECKED),
    );
    assert.deepEqual(issueWrites(spawn), [], manifest);
    assert.ok(
      log.some(
        (l) =>
          l.includes(JSON.stringify(manifest)) &&
          l.includes("not a manifest this sweep knows"),
      ),
      `${manifest}: expected an unknown-manifest line, got: ${log.join(" | ")}`,
    );
  }
});

// --- edit 6: the setting, with the job's own token ------------------------------

test("no call is handed a token or an environment of its own", () => {
  // The source passed a second token, from PROJECT_TOKEN, to the setting
  // lookup. Even with that variable set, every call here inherits the
  // process's environment and nothing else.
  const saved = process.env.PROJECT_TOKEN;
  process.env.PROJECT_TOKEN = "not-used";
  const spawn = fakeSpawn({ alertPages: [[alert({ ghsa: "GHSA-a" })]] });
  try {
    inTempRepo(VULNERABLE, () => captureLog(() => main("o/r", spawn)));
  } finally {
    if (saved === undefined) delete process.env.PROJECT_TOKEN;
    else process.env.PROJECT_TOKEN = saved;
  }
  assert.ok(ghCall(spawn, "create"));
  for (const call of spawn.calls) {
    assert.equal(call.opts?.env, undefined, call.args.join(" "));
    assert.equal(call.args.includes("not-used"), false);
    assert.notEqual(call.args[0], "project");
  }
});

test("a readable setting answer that does not say enabled as true or false stops the run", () => {
  // The source parsed an empty answer as {} and went on as "verified off".
  for (const [stdout, message] of [
    ["", /truncated or malformed response/],
    ["{", /truncated or malformed response/],
    ["null", /no true-or-false `enabled`/],
    ["[]", /no true-or-false `enabled`/],
    ["{}", /no true-or-false `enabled`/],
    ['{"enabled":"false"}', /no true-or-false `enabled`/],
    ['{"message":"Not Found"}', /no true-or-false `enabled`/],
  ]) {
    const spawn = fakeSpawn({
      securityFixesResponse: { status: 0, stdout },
      alertPages: [[alert({ ghsa: "GHSA-a" })]],
      issues: [filedIssue()],
    });
    assert.throws(
      () => inTempRepo(VULNERABLE, () => captureLog(() => main("o/r", spawn))),
      message,
      JSON.stringify(stdout),
    );
    assert.equal(spawn.calls.length, 1, "nothing else runs");
  }
});

// --- edit 10, addition A1: a marker counts only on what the automation wrote ----

const NOT_THE_SWEEPS = [
  ["a person wrote it", { user: { login: "mallory", type: "User" } }],
  [
    "a person wrote it under the automation's name",
    { user: { login: "github-actions[bot]", type: "User" } },
  ],
  ["another bot wrote it", { user: { login: "other[bot]", type: "Bot" } }],
  ["it has no author", { user: null }],
  ["it lacks the chore label", { labels: [{ name: "dependabot" }] }],
  ["it has no labels", { labels: [] }],
];

for (const [why, forged] of NOT_THE_SWEEPS) {
  test(`an issue carrying the marker is not this sweep's when ${why}: the real one is filed`, () => {
    // The forged issue matches the bump exactly. The source would have
    // taken it for its own and filed nothing.
    const spawn = fakeSpawn({
      alertPages: [[alert({ ghsa: "GHSA-a" })]],
      issues: [filedIssue({ number: 66, ...forged })],
    });
    inTempRepo(VULNERABLE, () => captureLog(() => main("o/r", spawn)));
    const writes = issueWrites(spawn);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].args[1], "create");
  });

  test(`an issue carrying the marker is not this sweep's when ${why}: it is never cleared`, () => {
    // No alert is open, so the source would have rewritten this issue to
    // "no longer applicable". It is someone else's, and is left alone.
    const spawn = fakeSpawn({
      alertPages: [[]],
      issues: [filedIssue({ number: 66, ...forged })],
    });
    inTempRepo(VULNERABLE, () =>
      captureLog(() => main("o/r", spawn, "2026-09-04")),
    );
    assert.deepEqual(issueWrites(spawn), []);
  });
}

test("a forged issue listed first does not hide the sweep's own", () => {
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
    issues: [
      filedIssue({ number: 66, user: { login: "mallory", type: "User" } }),
      filedIssue(),
    ],
  });
  const log = inTempRepo(VULNERABLE, () =>
    captureLog(() => main("o/r", spawn)),
  );
  assert.deepEqual(issueWrites(spawn), []);
  assert.ok(log.some((l) => l.includes("#41 is up to date")));
});

test("the comments are read from the REST listing, every page, and never through issue view", () => {
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" }), alert({ ghsa: "GHSA-b" })]],
    issues: [filedIssue()],
  });
  inTempRepo(VULNERABLE, () => captureLog(() => main("o/r", spawn)));
  const read = spawn.calls.find((c) => c.args.join(" ").includes("/comments?"));
  assert.deepEqual(read.args, [
    "api",
    "--paginate",
    "--slurp",
    "repos/o/r/issues/41/comments?per_page=100",
  ]);
  assert.equal(ghCall(spawn, "view"), undefined);
});

for (const [why, user] of [
  ["a person", { login: "mallory", type: "User" }],
  [
    "a person under the automation's name",
    { login: "github-actions[bot]", type: "User" },
  ],
  ["another bot", { login: "other[bot]", type: "Bot" }],
  ["nobody", null],
]) {
  test(`a comment marker written by ${why} does not stop an advisory being announced`, () => {
    // The source took a marker from any commenter, so one comment could keep
    // a new advisory from ever being announced.
    const spawn = fakeSpawn({
      alertPages: [[alert({ ghsa: "GHSA-a" }), alert({ ghsa: "GHSA-b" })]],
      issues: [filedIssue()],
      comments: [{ user, body: `${buildCommentMarker(["GHSA-b"])}\nforged` }],
    });
    inTempRepo(VULNERABLE, () => captureLog(() => main("o/r", spawn)));
    const comment = ghCall(spawn, "comment");
    assert.ok(comment, "the advisory is still announced");
    assert.deepEqual(
      parseCommentMarker(comment.args[comment.args.indexOf("--body") + 1]),
      ["GHSA-b"],
    );
  });
}

// --- edit 13: what gh hands back is checked before it is acted on ---------------

test("an alert entry that cannot be keyed stops the run before anything is touched", () => {
  const nameless = alert({ ghsa: "GHSA-a" });
  delete nameless.dependency.package.name;
  const pathless = alert({ ghsa: "GHSA-a" });
  pathless.dependency.manifest_path = "";
  const unadvised = alert({ ghsa: "GHSA-a" });
  delete unadvised.security_advisory;
  // And one that is not in the state the listing was asked for: dropped by
  // the grouping, it would read as an alert that went away.
  const stateless = alert({ ghsa: "GHSA-a" });
  delete stateless.state;
  for (const entry of [
    null,
    "an alert",
    7,
    [],
    {},
    nameless,
    pathless,
    unadvised,
    stateless,
    alert({ ghsa: "GHSA-a", state: "dismissed" }),
    alert({ ghsa: "GHSA-a", state: "fixed" }),
  ]) {
    assertListingFailureTouchesNothing(
      {
        status: 0,
        stdout: JSON.stringify([[alert({ ghsa: "GHSA-b" }), entry]]),
      },
      /held an entry that is not an open alert stating its package, ecosystem, manifest, advisory, vulnerable range and patched version in a usable form/,
    );
  }
});

/** A run whose issue listing is `issuesResponse` must throw and write nothing. */
function assertIssueListingStopsTheRun(issuesResponse, message) {
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
    issuesResponse,
  });
  assert.throws(
    () => inTempRepo(VULNERABLE, () => captureLog(() => main("o/r", spawn))),
    message,
    JSON.stringify(issuesResponse),
  );
  assert.deepEqual(issueWrites(spawn), []);
}

test("an issue listing that failed, is empty, is not JSON or has no pages is never 'no issue is open'", () => {
  // Read as "no issue of mine is open", each of these would file a duplicate.
  assertIssueListingStopsTheRun(
    { status: 1, stderr: "gh: HTTP 502: Bad Gateway" },
    /failed \(1\): gh: HTTP 502/,
  );
  assertIssueListingStopsTheRun({ status: 0, stdout: "" }, SyntaxError);
  assertIssueListingStopsTheRun({ status: 0, stdout: "[[{" }, SyntaxError);
  assertIssueListingStopsTheRun({ status: 0, stdout: "[]" }, /no pages/);
  assertIssueListingStopsTheRun({ status: 0, stdout: "null" }, /non-list/);
  assertIssueListingStopsTheRun(
    { status: 0, stdout: '{"message":"Not Found"}' },
    /non-list/,
  );
  assertIssueListingStopsTheRun({ status: 0, stdout: "[[], {}]" }, /non-list/);
});

test("an issue listing entry that is not an object stops the run", () => {
  for (const entry of [null, "an issue", 41, []]) {
    assertIssueListingStopsTheRun(
      {
        status: 0,
        stdout: JSON.stringify([[asSweepIssue(filedIssue()), entry]]),
      },
      /an entry that is not an object/,
    );
  }
});

test("an issue of the sweep's own with no positive integer number stops the run before any write", () => {
  // The number is handed to `gh issue edit` and `gh issue comment` as an
  // argument of its own, and is put into an API path.
  for (const number of ["--help", "41", 0, -1, 1.5, null, [41]]) {
    for (const alertPages of [[[alert({ ghsa: "GHSA-a" })]], [[]]]) {
      const spawn = fakeSpawn({
        alertPages,
        issues: [filedIssue({ number })],
      });
      assert.throws(
        () =>
          inTempRepo(VULNERABLE, () =>
            captureLog(() => main("o/r", spawn, "2026-09-04")),
          ),
        /an issue of this sweep's own has no positive integer number/,
        String(number),
      );
      assert.deepEqual(issueWrites(spawn), []);
    }
  }
});

test("someone else's issue with an unusable number is dropped, not fatal", () => {
  // Only an issue the sweep takes for its own can reach `gh` by number.
  const spawn = fakeSpawn({
    alertPages: [[]],
    issues: [
      filedIssue({
        number: "--help",
        user: { login: "mallory", type: "User" },
      }),
    ],
  });
  inTempRepo(VULNERABLE, () => captureLog(() => main("o/r", spawn)));
  assert.deepEqual(issueWrites(spawn), []);
});

test("a comment listing that failed or is malformed stops the run with the issue untouched", () => {
  for (const [commentsResponse, message] of [
    [{ status: 1, stderr: "gh: HTTP 502: Bad Gateway" }, /failed \(1\)/],
    [{ status: 0, stdout: "" }, SyntaxError],
    [{ status: 0, stdout: "[]" }, /no pages/],
    [{ status: 0, stdout: '{"message":"Not Found"}' }, /non-list/],
    [{ status: 0, stdout: "[[null]]" }, /an entry that is not an object/],
    [
      { status: 0, stdout: '[["a comment"]]' },
      /an entry that is not an object/,
    ],
  ]) {
    const spawn = fakeSpawn({
      alertPages: [[alert({ ghsa: "GHSA-a" }), alert({ ghsa: "GHSA-b" })]],
      issues: [filedIssue()],
      commentsResponse,
    });
    assert.throws(
      () => inTempRepo(VULNERABLE, () => captureLog(() => main("o/r", spawn))),
      message,
      JSON.stringify(commentsResponse),
    );
    assert.deepEqual(issueWrites(spawn), []);
  }
});

test("a write that fails stops the run, and a failed comment leaves the marker unwritten", () => {
  const grown = {
    alertPages: [[alert({ ghsa: "GHSA-a" }), alert({ ghsa: "GHSA-b" })]],
    issues: [filedIssue()],
  };
  const run = (spawn) =>
    inTempRepo(VULNERABLE, () =>
      captureLog(() => main("o/r", spawn, "2026-09-04")),
    );

  const create = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
    createStatus: 1,
  });
  assert.throws(() => run(create), /gh issue create failed: write blew up/);

  const comment = fakeSpawn({ ...grown, commentStatus: 1 });
  assert.throws(() => run(comment), /gh issue comment failed: write blew up/);
  assert.equal(ghCall(comment, "edit"), undefined, "comment first, or nothing");

  const edit = fakeSpawn({ ...grown, editStatus: 1 });
  assert.throws(() => run(edit), /gh issue edit failed: write blew up/);

  const cleared = fakeSpawn({
    alertPages: [[]],
    issues: [filedIssue()],
    editStatus: 1,
  });
  assert.throws(() => run(cleared), /gh issue edit failed: write blew up/);
});

// --- edit 11, addition A3: every issue write goes through the paced writer ------

test("every create, comment and edit goes through the writer, and no read does", () => {
  // One run that makes all three kinds of write: a comment and an edit on the
  // issue that grew an advisory, a clearing edit on the one whose alert is
  // gone, and a create for a new bump.
  const [gone] = groupAlerts([
    alert({ ghsa: "GHSA-gone", pkg: "qs", fixed: "6.16.0" }),
  ]);
  const spawn = fakeSpawn({
    alertPages: [
      [
        alert({ ghsa: "GHSA-a" }),
        alert({ ghsa: "GHSA-b" }),
        alert({
          ghsa: "GHSA-c",
          pkg: "browserslist",
          fixed: "4.28.7",
          range: "<= 4.28.6",
        }),
      ],
    ],
    issues: [
      filedIssue(),
      {
        number: 42,
        title: buildIssueTitle(gone),
        body: buildIssueBody(gone, asInstalled()),
      },
    ],
  });
  let writing = false;
  const through = [];
  const write = (fn) => {
    writing = true;
    try {
      return fn();
    } finally {
      writing = false;
    }
  };
  const recording = (cmd, args, opts) => {
    through.push({ args, writing });
    return spawn(cmd, args, opts);
  };
  inTempRepo(
    { "bun.lock": lockOf({ "fast-uri": "3.1.5", browserslist: "4.28.2" }) },
    () => captureLog(() => sweepMain("o/r", recording, "2026-09-04", write)),
  );

  const kinds = through
    .filter((c) => c.args[0] === "issue")
    .map((c) => c.args[1]);
  assert.deepEqual(kinds, ["create", "comment", "edit", "edit"]);
  for (const call of through) {
    assert.equal(
      call.writing,
      call.args[0] === "issue",
      `${call.args.slice(0, 2).join(" ")} ${call.writing ? "went" : "did not go"} through the writer`,
    );
  }
});

test("a run that makes several writes pauses one second before each write after the first", () => {
  const spawn = fakeSpawn({
    alertPages: [
      [
        alert({ ghsa: "GHSA-a" }),
        alert({
          ghsa: "GHSA-q",
          pkg: "qs",
          fixed: "6.16.0",
          range: "< 6.16.0",
        }),
        alert({
          ghsa: "GHSA-c",
          pkg: "browserslist",
          fixed: "4.28.7",
          range: "<= 4.28.6",
        }),
      ],
    ],
  });
  const events = [];
  const recording = (cmd, args, opts) => {
    if (args[0] === "issue") events.push(args[1]);
    return spawn(cmd, args, opts);
  };
  inTempRepo(
    {
      "bun.lock": lockOf({
        "fast-uri": "3.1.5",
        qs: "6.15.3",
        browserslist: "4.28.2",
      }),
    },
    () =>
      captureLog(() =>
        sweepMain(
          "o/r",
          recording,
          "2026-09-04",
          pacedWrites((ms) => events.push(`pause ${ms}`)),
        ),
      ),
  );
  assert.deepEqual(events, [
    "create",
    `pause ${WRITE_PAUSE_MS}`,
    "create",
    `pause ${WRITE_PAUSE_MS}`,
    "create",
  ]);
});

test("with the default writer, a run that makes one write goes straight through", () => {
  // The fourth parameter left out: `pacedWrites()`, whose first write does not
  // wait. One write is made, so nothing here sleeps.
  const spawn = fakeSpawn({ alertPages: [[alert({ ghsa: "GHSA-a" })]] });
  inTempRepo(VULNERABLE, () => captureLog(() => sweepMain("o/r", spawn)));
  assert.equal(issueWrites(spawn).length, 1);
});

// --- edits 13 and 14, as the review model's attack cases left them -------------
// The cases themselves are in scripts/dependabot-alerts-attack.test.mjs, each
// under its own text. These hold the edges of the fixes in place: what each
// check refuses, and what it must go on accepting.

test("the same alert listed twice stops the run; the same advisory with another range does not", () => {
  // One advisory's one range on one package in one manifest is one alert.
  for (const second of [
    alert({ ghsa: "GHSA-a" }),
    alert({ ghsa: "GHSA-a", fixed: "3.1.7" }),
  ]) {
    assertListingFailureTouchesNothing(
      {
        status: 0,
        stdout: JSON.stringify([[alert({ ghsa: "GHSA-a" })], [second]]),
      },
      /held the same alert twice \(GHSA-a on fast-uri in "package\.json"\)/,
    );
  }

  // An advisory can name two ranges of one package, each with its own patched
  // version. That is two alerts and two bumps, as in the source's grouping;
  // the lockfile then says which of them applies.
  const spawn = fakeSpawn({
    alertPages: [
      [
        alert({ ghsa: "GHSA-a" }),
        alert({
          ghsa: "GHSA-a",
          fixed: "4.0.2",
          range: ">= 4.0.0, < 4.0.2",
        }),
        alert({ ghsa: "GHSA-a", manifest: "bun.lock" }),
      ],
    ],
  });
  inTempRepo(VULNERABLE, () => captureLog(() => main("o/r", spawn)));
  const titles = ghCalls(spawn, "create").map(
    (c) => c.args[c.args.indexOf("--title") + 1],
  );
  assert.equal(titles.length, 2, "the 4.x range does not apply to 3.1.5");
  assert.ok(titles.every((t) => t.includes("`fast-uri` to `3.1.6`")));
});

test("an issue or a comment that does not state its author in full stops the run", () => {
  // Read as "not the automation's", the sweep's own issue would be filed again
  // and its own comment would stop counting.
  const partial = [
    { login: "github-actions[bot]" },
    { type: "Bot" },
    { login: 7, type: "Bot" },
    "github-actions[bot]",
    [],
    undefined,
  ];
  for (const user of partial) {
    const own = { ...asSweepIssue(filedIssue()), user };
    if (user === undefined) delete own.user;
    assertIssueListingStopsTheRun(
      { status: 0, stdout: JSON.stringify([[own]]) },
      /an entry that does not state its author's login and account type/,
    );

    const comment = { user, body: buildCommentMarker(["GHSA-b"]) };
    if (user === undefined) delete comment.user;
    const spawn = fakeSpawn({
      alertPages: [[alert({ ghsa: "GHSA-a" }), alert({ ghsa: "GHSA-b" })]],
      issues: [filedIssue()],
      commentsResponse: { status: 0, stdout: JSON.stringify([[comment]]) },
    });
    assert.throws(
      () => inTempRepo(VULNERABLE, () => captureLog(() => main("o/r", spawn))),
      /an entry that does not state its author's login and account type/,
      JSON.stringify(user),
    );
    assert.deepEqual(issueWrites(spawn), []);
  }
});

test("an issue of the sweep's own must state its body; an emptied body is a real answer", () => {
  // No `body` field at all is a short answer, and stops the run.
  const bodiless = asSweepIssue(filedIssue());
  delete bodiless.body;
  assertIssueListingStopsTheRun(
    { status: 0, stdout: JSON.stringify([[bodiless]]) },
    /an issue of this sweep's own does not state its body/,
  );
  assertIssueListingStopsTheRun(
    {
      status: 0,
      stdout: JSON.stringify([[asSweepIssue(filedIssue({ body: 7 }))]]),
    },
    /an issue of this sweep's own does not state its body/,
  );

  // `null` is what the endpoint answers for an issue whose body was emptied.
  // That issue carries no marker, so it tracks no bump and the bump is filed.
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
    issues: [filedIssue({ body: null })],
  });
  inTempRepo(VULNERABLE, () => captureLog(() => main("o/r", spawn)));
  assert.deepEqual(
    issueWrites(spawn).map((c) => c.args[1]),
    ["create"],
  );

  // Someone else's issue is dropped before its body is looked at.
  const foreign = asSweepIssue(filedIssue());
  delete foreign.body;
  foreign.user = { login: "mallory", type: "User" };
  const other = fakeSpawn({
    alertPages: [[]],
    issuesResponse: { status: 0, stdout: JSON.stringify([[foreign]]) },
  });
  inTempRepo(VULNERABLE, () => captureLog(() => main("o/r", other)));
  assert.deepEqual(issueWrites(other), []);
});

test("a comment of the sweep's own must state its body; anyone else's need not", () => {
  const run = (comment) => {
    const spawn = fakeSpawn({
      alertPages: [[alert({ ghsa: "GHSA-a" }), alert({ ghsa: "GHSA-b" })]],
      issues: [filedIssue()],
      commentsResponse: { status: 0, stdout: JSON.stringify([[comment]]) },
    });
    return {
      spawn,
      go: () =>
        inTempRepo(VULNERABLE, () => captureLog(() => main("o/r", spawn))),
    };
  };
  for (const body of [undefined, null, 7]) {
    const own = run({ user: BOT, body });
    assert.throws(
      own.go,
      /a comment of this sweep's own does not state its body/,
    );
    assert.deepEqual(issueWrites(own.spawn), []);

    const foreign = run({ user: { login: "mallory", type: "User" }, body });
    foreign.go();
    assert.ok(ghCall(foreign.spawn, "comment"), "the advisory is announced");
  }
});

test("a root dependency map that is not a map makes bun.lock unreadable", () => {
  // `isDirectDependency` reads these maps. A list or a string would answer
  // "not declared" for every package and the issue would give the wrong fix.
  for (const map of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const value of [[], "fast-uri", null, 7]) {
      const lock = lockWith("fast-uri", "3.1.5");
      lock.workspaces[""][map] = value;
      const spawn = fakeSpawn({
        alertPages: [[alert({ ghsa: "GHSA-a" })]],
        issues: [filedIssue()],
      });
      const log = inTempRepo({ "bun.lock": lock }, () =>
        captureLogOfFailedRun(() => main("o/r", spawn), UNCHECKED),
      );
      assert.deepEqual(issueWrites(spawn), [], `${map}: ${String(value)}`);
      assert.ok(
        log.some((l) => l.includes(`the root workspace's ${map} is not a map`)),
        `expected an unreadable-lockfile line for ${map}, got: ${log.join(" | ")}`,
      );
    }
  }
});

test("a run that could not check some bumps still files the rest, then fails naming each", () => {
  // Three bumps: one on a manifest the sweep does not know, one it can check
  // and must file, one whose issue is up to date. The failure comes last.
  const spawn = fakeSpawn({
    alertPages: [
      [
        alert({
          ghsa: "GHSA-u",
          pkg: "aaa",
          manifest: "sub/package.json",
        }),
        alert({ ghsa: "GHSA-a" }),
        alert({
          ghsa: "GHSA-q",
          pkg: "qs",
          fixed: "6.16.0",
          range: "< 6.16.0",
        }),
      ],
    ],
    issues: [filedIssue()],
  });
  const log = inTempRepo(
    { "bun.lock": lockOf({ "fast-uri": "3.1.5", qs: "6.15.3" }) },
    () =>
      captureLogOfFailedRun(
        () => main("o/r", spawn),
        /1 open npm bump could not be checked this run; no issue of its was filed, edited or cleared —\n {2}aaa \(GHSA-u\): reported against "sub\/package\.json"/,
      ),
  );
  const writes = issueWrites(spawn);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].args[1], "create");
  assert.match(writes[0].args[writes[0].args.indexOf("--title") + 1], /`qs`/);
  assert.ok(log.some((l) => l.includes("#41 is up to date")));
});

test("an alert that is not npm is logged and does not fail the run", () => {
  // The sweep was never going to file it, so it is not "could not check".
  const spawn = fakeSpawn({
    alertPages: [
      [
        alert({
          ghsa: "GHSA-act",
          pkg: "actions/checkout",
          manifest: ".github/workflows/main.yml",
          ecosystem: "actions",
        }),
      ],
    ],
  });
  const log = inTempRepo(VULNERABLE, () =>
    captureLog(() => main("o/r", spawn)),
  );
  assert.deepEqual(issueWrites(spawn), []);
  assert.ok(log.some((l) => l.includes("raise it by hand: GHSA-act")));
});

// --- edit 13, as the pull request's audit left it (round 1) --------------------

test("an alert missing a field a decision rests on stops the run before anything is touched", () => {
  // Each of these has a default in the source's grouping that turns the
  // missing field into an answer: "not npm" (skipped, run green), "every
  // version" (an issue for a copy that is not exposed), "no patch yet"
  // (dropped).
  const without = (edit) => {
    const entry = alert({ ghsa: "GHSA-a" });
    edit(entry);
    return entry;
  };
  for (const entry of [
    without((a) => delete a.dependency.package.ecosystem),
    without((a) => (a.dependency.package.ecosystem = "")),
    without((a) => (a.dependency.package.ecosystem = 7)),
    without((a) => delete a.security_vulnerability.vulnerable_version_range),
    without((a) => (a.security_vulnerability.vulnerable_version_range = "")),
    without((a) => delete a.security_vulnerability.first_patched_version),
    without((a) => (a.security_vulnerability.first_patched_version = "3.1.6")),
    without((a) => (a.security_vulnerability.first_patched_version = {})),
    without(
      (a) => (a.security_vulnerability.first_patched_version.identifier = 3),
    ),
    without((a) => delete a.security_vulnerability),
  ]) {
    assertListingFailureTouchesNothing(
      {
        status: 0,
        stdout: JSON.stringify([[alert({ ghsa: "GHSA-b" }), entry]]),
      },
      /not an open alert stating its package, ecosystem, manifest, advisory, vulnerable range and patched version in a usable form/,
    );
  }
});

test("an alert with no patch yet states so with null, and is still not filed", () => {
  // `null` is the endpoint's answer for "no patched version". It is not a
  // short entry: the run goes on, files nothing for it, and leaves its issue.
  const unpatched = alert({ ghsa: "GHSA-a" });
  unpatched.security_vulnerability.first_patched_version = null;
  const spawn = fakeSpawn({ alertPages: [[unpatched]] });
  inTempRepo(VULNERABLE, () => captureLog(() => main("o/r", spawn)));
  assert.deepEqual(issueWrites(spawn), []);
});

test("a value that would break a marker stops the run, so no issue is filed that the next run cannot recognise", () => {
  // The markers are lines of text split on "; ", "," and " -->". The source
  // wrote any value into them; a run that filed with one of these could not
  // read its own marker back and would file the same issue every day.
  const cases = [
    { ghsa: "GHSA-a\nGHSA-b" },
    { ghsa: "GHSA-a,GHSA-b" },
    { ghsa: "GHSA-a -->" },
    { ghsa: "GHSA a" },
    { ghsa: "GHSA-a", pkg: "fast-uri; manifest=x" },
    { ghsa: "GHSA-a", pkg: "fast uri" },
    { ghsa: "GHSA-a", fixed: "3.1.6; ghsas=GHSA-z" },
    { ghsa: "GHSA-a", fixed: "3.1.6\n" },
    { ghsa: "GHSA-a", fixed: "<3.1.6>" },
  ];
  for (const fields of cases) {
    assertListingFailureTouchesNothing(
      { status: 0, stdout: JSON.stringify([[alert(fields)]]) },
      /in a usable form/,
    );
  }

  // What real names, ids and versions hold passes: a scope, a slash, a
  // prerelease, build metadata. Filed once, the issue is recognised again.
  const real = alert({
    ghsa: "GHSA-5jgf-7c3w-x8q2",
    pkg: "@scope/fast-uri.js_x",
    fixed: "3.1.6-rc.1+build.5",
    range: ">= 3.0.0, < 3.1.6-rc.1",
  });
  const lock = { "bun.lock": lockWith("@scope/fast-uri.js_x", "3.1.5") };
  const first = fakeSpawn({ alertPages: [[real]] });
  inTempRepo(lock, () => captureLog(() => main("o/r", first)));
  const create = ghCall(first, "create");
  assert.ok(create, "the bump is filed");

  const second = fakeSpawn({
    alertPages: [[real]],
    issues: [
      {
        number: 41,
        title: create.args[create.args.indexOf("--title") + 1],
        body: create.args[create.args.indexOf("--body") + 1],
      },
    ],
  });
  const log = inTempRepo(lock, () => captureLog(() => main("o/r", second)));
  assert.deepEqual(issueWrites(second), []);
  assert.ok(log.some((l) => l.includes("#41 is up to date")));
});

test("an issue entry that does not state its labels as a list of named labels stops the run", () => {
  // Read as "no labels", the sweep's own issue would count as someone else's
  // and its bump would be filed again.
  for (const labels of [
    undefined,
    null,
    "chore,dependabot",
    { name: "chore" },
    ["chore", "dependabot"],
    [{ name: "chore" }, null],
    [{ name: "chore" }, { id: 1 }],
  ]) {
    const own = { ...asSweepIssue(filedIssue()), labels };
    if (labels === undefined) delete own.labels;
    assertIssueListingStopsTheRun(
      { status: 0, stdout: JSON.stringify([[own]]) },
      /an entry that does not state its labels as a list of named labels/,
    );
    // Someone else's entry is held to the same shape: a listing is whole or
    // it is not.
    const foreign = { ...own, user: { login: "mallory", type: "User" } };
    assertIssueListingStopsTheRun(
      { status: 0, stdout: JSON.stringify([[foreign]]) },
      /an entry that does not state its labels as a list of named labels/,
    );
  }
});

// --- edit 13, as the pull request's audit left it (round 2) --------------------

test("an npm alert whose range or patched version is not semver stops the run before anything is touched", () => {
  // `semver.satisfies` answers false for a range it cannot read. Taken as
  // "out of range", that cleared the open issue of a live alert.
  for (const fields of [
    { range: "garbage" },
    { range: ">= three" },
    { range: ", ," },
    { range: " " },
    { fixed: "not-semver" },
    { fixed: "3.1" },
    { fixed: "v3.1.6.0" },
  ]) {
    assertListingFailureTouchesNothing(
      {
        status: 0,
        stdout: JSON.stringify([[alert({ ghsa: "GHSA-a", ...fields })]]),
      },
      /an npm alert \(GHSA-a on fast-uri\) whose vulnerable range or patched version is not semver/,
    );
  }
});

test("the ranges GitHub writes for npm are read, and an alert of another ecosystem is not held to semver", () => {
  for (const range of [
    ">= 3.1.3, < 3.1.6",
    "<= 4.28.6",
    "< 3.1.6",
    "= 3.1.5",
    ">= 1.0.0, < 2.0.0 || >= 3.0.0, < 3.5.0",
  ]) {
    const spawn = fakeSpawn({
      alertPages: [[alert({ ghsa: "GHSA-a", range })]],
    });
    inTempRepo(VULNERABLE, () => captureLog(() => main("o/r", spawn)));
    assert.ok(ghCall(spawn, "create"), `${range} applies to 3.1.5`);
  }

  // A pip range and version are not semver. That alert is logged for a
  // person, as before, and does not stop the run or the npm bump beside it.
  const spawn = fakeSpawn({
    alertPages: [
      [
        alert({
          ghsa: "GHSA-pip",
          pkg: "requests",
          manifest: "requirements.txt",
          ecosystem: "pip",
          range: ">= 2.0, < 2.31.post1",
          fixed: "2.31.post1",
        }),
        alert({ ghsa: "GHSA-a" }),
      ],
    ],
  });
  const log = inTempRepo(VULNERABLE, () =>
    captureLog(() => main("o/r", spawn)),
  );
  assert.equal(ghCalls(spawn, "create").length, 1);
  assert.ok(log.some((l) => l.includes("raise it by hand: GHSA-pip")));
});

test("an issue entry whose pull_request field is neither absent nor an object stops the run", () => {
  // Anything truthy there drops the entry as a pull request, so a short or
  // odd value would hide the sweep's own issue and its bump would be filed
  // again.
  for (const value of [true, "yes", 1, null, []]) {
    assertIssueListingStopsTheRun(
      {
        status: 0,
        stdout: JSON.stringify([
          [{ ...asSweepIssue(filedIssue()), pull_request: value }],
        ]),
      },
      /an entry whose pull_request field is not an object/,
    );
  }
});

// ---------------------------------------------------------------------------
// The lock file check (the script's header, edit 15; the design note
// docs/DESIGN-nor-695-lockfile-advisories.md). Written in this repo. Every
// case here calls `sweepMain` with its own default check, as a run does, and
// a fake `gh` that answers the advisory listing and the dismissed-alert
// listing. The module's own cases are in scripts/lib/lock-advisories.test.mjs.
// ---------------------------------------------------------------------------

/** The sweep as a run makes it, lock file check included, with no waiting. */
const sweep = (spawn, today = "2026-11-22") =>
  sweepMain(
    "o/r",
    spawn,
    today,
    pacedWrites(() => {}),
  );

const LOCK_A = "GHSA-aaaa-aaaa-aaaa";
const LOCK_B = "GHSA-bbbb-bbbb-bbbb";

/** The `--title` and `--body` of one recorded `gh issue` call. */
const titleOf = (call) => call.args[call.args.indexOf("--title") + 1];
const bodyOf = (call) => call.args[call.args.indexOf("--body") + 1];

/** The failure of a run whose lock file check could not be completed. */
const LOCK_CHECK_FAILED =
  /^dependabot-alerts: the lock file check could not be completed \(.*\) — no issue was filed, commented on or cleared this run$/s;

/**
 * The open issue a run files for `LOCK_A` on `fast-uri`, found in the lock
 * file: taken from a real run, so it is byte for byte what the sweep writes.
 */
function lockIssue(extra = {}) {
  const spawn = fakeSpawn({ advisories: [advisory({ ghsa: LOCK_A })] });
  inTempRepo(VULNERABLE, () => captureLog(() => sweep(spawn)));
  const create = ghCall(spawn, "create");
  return { number: 51, title: titleOf(create), body: bodyOf(create), ...extra };
}

test("lock file check: an advisory on a package no alert covers files exactly one issue, marked bun.lock", () => {
  // The design note's evidence row E3.
  const spawn = fakeSpawn({
    advisories: [
      advisory({ ghsa: LOCK_A, cve: "CVE-2026-12345", severity: "medium" }),
    ],
  });
  const log = inTempRepo(VULNERABLE, () => captureLog(() => sweep(spawn)));

  assert.equal(issueWrites(spawn).length, 1, "one write: the create");
  const create = ghCall(spawn, "create");
  assert.equal(
    titleOf(create),
    "chore(deps): bump `fast-uri` to `3.1.6` in `bun.lock` (1 advisory)",
  );
  assert.deepEqual(
    create.args.filter((_, i) => create.args[i - 1] === "--label"),
    ISSUE_LABELS,
  );
  const body = bodyOf(create);
  assert.deepEqual(parseMarker(body), {
    package: "fast-uri",
    manifestPath: "bun.lock",
    fixedIn: "3.1.6",
    ghsas: [LOCK_A],
  });
  const lines = body.split("\n");
  assert.equal(
    lines[1],
    "Filed automatically: 1 advisory in GitHub's advisory database applies to a version locked in `bun.lock`. Dependabot opens no security-update PRs on this repo; the fix is written by hand against `main`.",
  );
  assert.ok(lines.includes("| Manifest | `bun.lock` |"));
  assert.ok(lines.includes("| Scope | not determined |"));
  assert.ok(lines.includes("| Highest severity | medium |"));
  assert.ok(
    lines.includes(
      `| [${LOCK_A}](https://github.com/advisories/${LOCK_A}) | CVE-2026-12345 | medium | >= 3.0.0, < 3.1.6 | fast-uri is bad |`,
    ),
    "the advisory's row, linked to its advisory page",
  );
  assert.ok(!body.includes("example.invalid"), "no URL from the answer");
  assert.ok(body.includes("**Add an [`overrides`]"), "a transitive copy");
  assert.ok(lines.includes("| `node_modules/fast-uri` | `3.1.5` |"));
  assert.ok(
    body.includes("reported by GitHub's advisory database."),
    "the note names where the advisory came from",
  );
  assert.ok(
    log.some((l) =>
      l.includes(
        "checked the 1 entries of bun.lock against GitHub's advisory database — 1 advisory range applies to a locked version, 1 of them not covered by a Dependabot alert",
      ),
    ),
    `expected the check's own line, got: ${log.join(" | ")}`,
  );
});

test("lock file check: it asks about the locked pairs in ONE affects parameter, with both controls", () => {
  const spawn = fakeSpawn();
  inTempRepo(
    { "bun.lock": lockOf({ "fast-uri": "3.1.5", "@scope/pkg": "1.0.0" }) },
    () => captureLog(() => sweep(spawn)),
  );
  const asks = spawn.calls.filter((c) =>
    c.args.at(-1).startsWith("advisories?"),
  );
  assert.equal(asks.length, 1);
  assert.deepEqual(asks[0].args.slice(0, 3), ["api", "--paginate", "--slurp"]);
  const path = asks[0].args[3];
  assert.equal(path.split("affects=").length - 1, 1, "exactly one affects=");
  assert.deepEqual(
    new URLSearchParams(path.slice(path.indexOf("?") + 1)).getAll("affects"),
    ["minimist@0.0.8,lodash@4.17.20,@scope/pkg@1.0.0,fast-uri@3.1.5"],
  );
  assert.ok(!path.includes("@"), "every @ is percent-encoded");
});

test("lock file check: a second run with the same answers writes nothing", () => {
  const spawn = fakeSpawn({
    advisories: [advisory({ ghsa: LOCK_A })],
    issues: [lockIssue()],
  });
  const log = inTempRepo(VULNERABLE, () => captureLog(() => sweep(spawn)));
  assert.equal(issueWrites(spawn).length, 0);
  assert.ok(log.some((l) => l.includes("#51 is up to date for fast-uri")));
});

test("lock file check: a clean lock file files nothing and says what it checked", () => {
  const spawn = fakeSpawn();
  const log = inTempRepo({ "bun.lock": lockWith("fast-uri", "3.1.6") }, () =>
    captureLog(() => sweep(spawn)),
  );
  assert.equal(issueWrites(spawn).length, 0);
  assert.ok(
    log.some((l) => l.includes("0 advisory ranges apply to a locked version")),
  );
  assert.ok(log.some((l) => l.includes("no open alerts")));
});

test("lock file check: a withdrawn advisory files nothing", () => {
  const spawn = fakeSpawn({
    advisories: [advisory({ ghsa: LOCK_A, withdrawn: "2026-11-18T15:38:56Z" })],
  });
  inTempRepo(VULNERABLE, () => captureLog(() => sweep(spawn)));
  assert.equal(issueWrites(spawn).length, 0);
});

test("lock file check: an advisory that leaves the answer clears its issue, once, and never closes it", () => {
  const filed = lockIssue();
  const spawn = fakeSpawn({ issues: [filed] });
  const log = inTempRepo(VULNERABLE, () => captureLog(() => sweep(spawn)));

  const writes = issueWrites(spawn);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].args[1], "edit");
  assert.ok(!writes[0].args.includes("--state"), "an edit of the body only");
  const cleared = bodyOf(writes[0]);
  assert.deepEqual(parseMarker(cleared), parseMarker(filed.body));
  assert.ok(
    cleared.includes(
      `**No longer applicable on \`main\` as of 2026-11-22** — ${LOCK_CLEARED_REASON}.`,
    ),
  );
  assert.ok(log.some((l) => l.includes("cleared #51")));

  // The cleared issue stays open and is seen again the next day: no edit.
  const next = fakeSpawn({ issues: [{ ...filed, body: cleared }] });
  inTempRepo(VULNERABLE, () => captureLog(() => sweep(next, "2026-11-23")));
  assert.equal(issueWrites(next).length, 0);
});

test("lock file check: a second advisory for an open lock-file issue is a comment, then the marker", () => {
  const spawn = fakeSpawn({
    advisories: [advisory({ ghsa: LOCK_A }), advisory({ ghsa: LOCK_B })],
    issues: [lockIssue()],
  });
  inTempRepo(VULNERABLE, () => captureLog(() => sweep(spawn)));
  const writes = issueWrites(spawn);
  assert.deepEqual(
    writes.map((c) => c.args[1]),
    ["comment", "edit"],
  );
  const comment = bodyOf(writes[0]);
  assert.deepEqual(parseCommentMarker(comment), [LOCK_B]);
  assert.ok(
    comment.includes("1 new advisory for `fast-uri`"),
    "an advisory found against bun.lock is not called Dependabot's",
  );
  assert.deepEqual(parseMarker(bodyOf(writes[1])).ghsas, [LOCK_A, LOCK_B]);
});

test("lock file check: an advisory an OPEN alert already names is left to the alert: one issue", () => {
  // The design note's evidence row E4: both paths report the same advisory
  // on the same package, and the run files one issue, the alert's.
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: LOCK_A })]],
    advisories: [advisory({ ghsa: LOCK_A })],
  });
  const log = inTempRepo(VULNERABLE, () => captureLog(() => sweep(spawn)));
  const creates = ghCalls(spawn, "create");
  assert.equal(creates.length, 1);
  assert.equal(parseMarker(bodyOf(creates[0])).manifestPath, "package.json");
  assert.equal(issueWrites(spawn).length, 1);
  assert.ok(
    log.some(
      (l) =>
        l.includes(`${LOCK_A} applies to fast-uri in bun.lock`) &&
        l.includes("left to the alert"),
    ),
  );
});

for (const state of ["dismissed", "auto_dismissed"]) {
  test(`lock file check: an advisory a person ${state === "dismissed" ? "dismissed" : "or a rule auto-dismissed"} as an alert is not filed again from the lock file`, () => {
    const spawn = fakeSpawn({
      dismissedPages: [[alert({ ghsa: LOCK_A, state })]],
      advisories: [advisory({ ghsa: LOCK_A })],
    });
    inTempRepo(VULNERABLE, () => captureLog(() => sweep(spawn)));
    assert.equal(issueWrites(spawn).length, 0);
  });
}

test("lock file check: a dismissed alert covers its own advisory and package only", () => {
  const spawn = fakeSpawn({
    dismissedPages: [
      [
        alert({ ghsa: LOCK_B, state: "dismissed" }),
        alert({ ghsa: LOCK_A, pkg: "some-other-package", state: "dismissed" }),
        // Not npm: an advisory id shared with another ecosystem covers nothing.
        alert({ ghsa: LOCK_A, state: "dismissed", ecosystem: "pip" }),
      ],
    ],
    advisories: [advisory({ ghsa: LOCK_A })],
  });
  inTempRepo(VULNERABLE, () => captureLog(() => sweep(spawn)));
  assert.equal(ghCalls(spawn, "create").length, 1);
});

test("lock file check: alerts GitHub calls fixed are never asked for, so one cannot hide a nested copy", () => {
  const spawn = fakeSpawn({ advisories: [advisory({ ghsa: LOCK_A })] });
  inTempRepo(VULNERABLE, () => captureLog(() => sweep(spawn)));
  const alertReads = spawn.calls
    .map((c) => c.args.at(-1))
    .filter((arg) => arg.includes("dependabot/alerts"));
  assert.deepEqual(alertReads, [
    "repos/o/r/dependabot/alerts?state=open&per_page=100",
    "repos/o/r/dependabot/alerts?state=dismissed,auto_dismissed&per_page=100",
  ]);
  assert.equal(ghCalls(spawn, "create").length, 1);
});

test("lock file check: another advisory on a package with an open alert is its own bump, on its own manifest", () => {
  // The rule is per advisory, not per package: dropping every lock-file
  // record for a package that has any alert would hide exactly the copy the
  // alert cannot see. So two advisories, one alerted and one not, are two
  // issues, even when both name the same patched version.
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
    advisories: [advisory({ ghsa: LOCK_B })],
  });
  inTempRepo(VULNERABLE, () => captureLog(() => sweep(spawn)));
  assert.deepEqual(
    ghCalls(spawn, "create")
      .map((c) => parseMarker(bodyOf(c)))
      .map((m) => `${m.manifestPath} ${m.ghsas.join(",")}`)
      .sort(),
    [`bun.lock ${LOCK_B}`, "package.json GHSA-a"],
  );
});

test("lock file check: an advisory with no patched version is logged by name and files nothing", () => {
  const spawn = fakeSpawn({
    advisories: [advisory({ ghsa: LOCK_A, fixed: null })],
  });
  const log = inTempRepo(VULNERABLE, () => captureLog(() => sweep(spawn)));
  assert.equal(issueWrites(spawn).length, 0);
  assert.ok(
    log.some(
      (l) =>
        l.includes(`${LOCK_A} applies to fast-uri in bun.lock`) &&
        l.includes("has no patched version yet"),
    ),
  );
});

test("lock file check: an open advisory that LOSES its patched version does not clear its issue", () => {
  const spawn = fakeSpawn({
    advisories: [advisory({ ghsa: LOCK_A, fixed: null })],
    issues: [lockIssue()],
  });
  const log = inTempRepo(VULNERABLE, () => captureLog(() => sweep(spawn)));
  assert.equal(issueWrites(spawn).length, 0);
  assert.ok(log.some((l) => l.includes("#51 left as is")));
});

test("lock file check: an issue with its marker that the automation did not write is not taken for its own", () => {
  // Addition A1 holds for this marker as for the alert path's.
  const forged = {
    ...lockIssue(),
    user: { login: "someone-else", type: "User" },
  };
  const spawn = fakeSpawn({
    advisories: [advisory({ ghsa: LOCK_A })],
    issues: [forged],
  });
  inTempRepo(VULNERABLE, () => captureLog(() => sweep(spawn)));
  assert.deepEqual(
    issueWrites(spawn).map((c) => c.args[1]),
    ["create"],
    "the real issue is filed, and the forged one is not edited",
  );
});

test("lock file check: every read is made before the first write, and writes are paced", () => {
  const pauses = [];
  const spawn = fakeSpawn({
    advisories: [
      advisory({ ghsa: LOCK_A }),
      advisory({
        ghsa: LOCK_B,
        pkg: "browserslist",
        range: "<= 4.28.6",
        fixed: "4.28.7",
      }),
    ],
  });
  inTempRepo(
    { "bun.lock": lockOf({ "fast-uri": "3.1.5", browserslist: "4.28.2" }) },
    () =>
      captureLog(() =>
        sweepMain(
          "o/r",
          spawn,
          "2026-11-22",
          pacedWrites((ms) => pauses.push(ms)),
        ),
      ),
  );
  const kinds = spawn.calls.map((c) =>
    c.args[0] === "issue" ? `write:${c.args[1]}` : "read",
  );
  assert.deepEqual(kinds, [
    "read", // the setting
    "read", // the open alerts
    "read", // the dismissed alerts
    "read", // the advisory listing
    "read", // the open issues
    "write:create",
    "write:create",
  ]);
  assert.deepEqual(pauses, [WRITE_PAUSE_MS], "one pause, between the two");
});

/**
 * A run that must fail at the lock file check and write NOTHING, though it
 * holds an open alert that would file an issue and an open lock-file issue
 * whose advisory is not in the (failed) answer and would be cleared.
 */
function assertLockCheckStopsTheRun(options, files, message) {
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
    issues: [lockIssue()],
    ...options,
  });
  inTempRepo(files, () => {
    captureLog(() => {
      assert.throws(
        () => sweep(spawn),
        (error) => {
          assert.match(error.message, LOCK_CHECK_FAILED);
          assert.match(error.message, message);
          return true;
        },
      );
    });
  });
  assert.equal(
    issueWrites(spawn).length,
    0,
    "no issue is filed, edited, commented on or cleared",
  );
  assert.equal(
    spawn.calls.some((c) => c.args.at(-1).includes("/issues?")),
    false,
    "the run stopped before it listed its issues",
  );
}

// The design note's evidence row E5, through the whole sweep.
for (const [what, options, message] of [
  [
    "the advisory listing cannot be reached",
    {
      advisoryResponse: {
        status: 1,
        stdout: "[]",
        stderr: "dial tcp: refused",
      },
    },
    /dial tcp: refused/,
  ],
  [
    "the advisory listing is rate-limited",
    {
      advisoryResponse: {
        status: 1,
        stderr: "gh: API rate limit exceeded (HTTP 403)",
      },
    },
    /rate limit exceeded/,
  ],
  [
    "the job's token is refused by the advisory listing",
    {
      advisoryResponse: {
        status: 1,
        stderr: "gh: Resource not accessible by integration (HTTP 403)",
      },
    },
    /Resource not accessible by integration/,
  ],
  [
    "the advisory listing answers with no pages",
    { advisoryResponse: { status: 0, stdout: "[]" } },
    /no pages/,
  ],
  [
    "the advisory listing prints nothing",
    { advisoryResponse: { status: 0, stdout: "" } },
    /JSON/,
  ],
  [
    "the advisory listing prints something that is not JSON",
    { advisoryResponse: { status: 0, stdout: "<html>maintenance</html>" } },
    /JSON/,
  ],
  [
    "the advisory listing's answer is EMPTY, so no control advisory came back",
    { advisoryAnswer: () => [] },
    /does not hold the control advisories/,
  ],
  [
    "one control advisory is missing from the answer",
    { advisoryAnswer: () => [CONTROL_ADVISORIES[1]] },
    /does not hold the control advisory for minimist@0\.0\.8/,
  ],
  [
    "both control advisories are withdrawn",
    {
      advisoryAnswer: () =>
        CONTROL_ADVISORIES.map((a) => ({
          ...a,
          withdrawn_at: "2027-01-01T00:00:00Z",
        })),
    },
    /nothing vouches for the answer/,
  ],
  [
    "an advisory entry is misshapen",
    {
      advisoryAnswer: () => [
        ...CONTROL_ADVISORIES,
        { ...advisory({ ghsa: LOCK_A }), withdrawn_at: undefined },
      ],
    },
    /without a withdrawn_at/,
  ],
  [
    "an advisory's range is one semver cannot read",
    {
      advisoryAnswer: () => [
        ...CONTROL_ADVISORIES,
        advisory({ ghsa: LOCK_A, range: "three point one" }),
      ],
    },
    /not semver/,
  ],
  [
    "an advisory's patched version is not a version",
    {
      advisoryAnswer: () => [
        ...CONTROL_ADVISORIES,
        advisory({ ghsa: LOCK_A, fixed: "soon" }),
      ],
    },
    /not semver/,
  ],
  [
    "the dismissed-alert listing fails",
    { dismissedResponse: { status: 1, stderr: "HTTP 502" } },
    /HTTP 502/,
  ],
  [
    "the dismissed-alert listing answers with no pages",
    { dismissedResponse: { status: 0, stdout: "[]" } },
    /no pages/,
  ],
  [
    "the dismissed-alert listing holds an entry that is not an object",
    { dismissedPages: [["GHSA-a"]] },
    /not a dismissed alert stating its package, ecosystem and advisory/,
  ],
  [
    "the dismissed-alert listing holds an alert in another state",
    { dismissedPages: [[alert({ ghsa: "GHSA-a", state: "open" })]] },
    /not a dismissed alert stating its package, ecosystem and advisory/,
  ],
  [
    "a dismissed alert does not name its advisory",
    {
      dismissedPages: [
        [
          {
            ...alert({ ghsa: "GHSA-a", state: "dismissed" }),
            security_advisory: {},
          },
        ],
      ],
    },
    /not a dismissed alert stating its package, ecosystem and advisory/,
  ],
]) {
  test(`lock file check: nothing is written when ${what}`, () => {
    assertLockCheckStopsTheRun(options, VULNERABLE, message);
  });
}

for (const [what, files, message] of [
  ["bun.lock is missing", {}, /ENOENT/],
  [
    "bun.lock will not parse",
    { "bun.lock": "{ truncated…" },
    /could not parse/,
  ],
  [
    "bun.lock is a version of the format the reader does not know",
    { "bun.lock": { ...lockWith("fast-uri", "3.1.5"), lockfileVersion: 2 } },
    /lockfileVersion/,
  ],
  [
    "a lock entry is not a registry version",
    {
      "bun.lock": lockOf({
        "fast-uri": "3.1.5",
        "local-thing": "file:../local-thing",
      }),
    },
    /not a registry version this check can ask about/,
  ],
  [
    "a lock entry's name is not one that can be asked about",
    { "bun.lock": lockOf({ "fast-uri": "3.1.5", "Has-Capital": "1.0.0" }) },
    /not an npm package name this check can ask about/,
  ],
]) {
  test(`lock file check: nothing is written, and the advisory listing is not asked, when ${what}`, () => {
    const spawn = fakeSpawn({
      alertPages: [[alert({ ghsa: "GHSA-a" })]],
      issues: [lockIssue()],
    });
    inTempRepo(files, () => {
      captureLog(() => {
        assert.throws(
          () => sweep(spawn),
          (error) => {
            assert.match(error.message, LOCK_CHECK_FAILED);
            assert.match(error.message, message);
            return true;
          },
        );
      });
    });
    assert.equal(issueWrites(spawn).length, 0);
    assert.equal(
      spawn.calls.some((c) => c.args.at(-1).startsWith("advisories?")),
      false,
    );
  });
}

test("lock file check: ONE stale control leaves the run working, and the run then fails naming it", () => {
  const spawn = fakeSpawn({
    advisoryAnswer: () => [
      { ...CONTROL_ADVISORIES[0], withdrawn_at: "2027-01-01T00:00:00Z" },
      CONTROL_ADVISORIES[1],
      advisory({ ghsa: LOCK_A }),
    ],
  });
  const log = inTempRepo(VULNERABLE, () =>
    captureLogOfFailedRun(
      () => sweep(spawn),
      /the lock file check's control minimist@0\.0\.8 \(GHSA-xvch-5gv4-984h\) no longer vouches for an answer.*replace the stale one in scripts\/lib\/lock-advisories\.mjs/s,
    ),
  );
  assert.deepEqual(
    issueWrites(spawn).map((c) => c.args[1]),
    ["create"],
    "the other control vouched for the answer, so the issue is filed",
  );
  assert.ok(log.some((l) => l.includes("filed")));
});

test("lock file check: a stale control and a bump that could not be checked are both named", () => {
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a", manifest: "gone/lock.json" })]],
    advisoryAnswer: () => [
      CONTROL_ADVISORIES[0],
      { ...CONTROL_ADVISORIES[1], withdrawn_at: "2027-01-01T00:00:00Z" },
    ],
  });
  inTempRepo(VULNERABLE, () =>
    captureLog(() =>
      assert.throws(
        () => sweep(spawn),
        (error) => {
          assert.match(error.message, UNCHECKED);
          assert.match(
            error.message,
            /control lodash@4\.17\.20 \(GHSA-35jh-r3h4-6jhm\) no longer vouches/,
          );
          return true;
        },
      ),
    ),
  );
});

test("lock file check: its range normaliser and the sweep's give the same answers", () => {
  // `lib/lock-advisories.mjs` repeats `toSemverRange`, because this script
  // imports that file. This holds the two together.
  for (const range of [
    ">= 3.1.3, < 3.1.6",
    "< 0.2.4",
    ">= 1.0, < 2.0 || >= 3.0, < 3.5",
    "  <= 4.17.21 ,",
    " , ",
    "",
  ]) {
    assert.equal(semverRange(range), toSemverRange(range), range);
  }
});

test("lock file check: two ranges of one advisory with one patched version are one issue that names the advisory once", () => {
  // The pull request's audit, round 1. A hoisted copy in one range and a
  // nested copy in another, both patched by the same version: one bump.
  const lock = {
    lockfileVersion: 1,
    workspaces: { "": { name: "fixture", dependencies: {} } },
    packages: {
      ajv: ["ajv@8.17.1", "", {}, "sha512-fixture"],
      "fast-uri": ["fast-uri@3.1.5", "", {}, "sha512-fixture"],
      "ajv/fast-uri": ["fast-uri@2.4.0", "", {}, "sha512-fixture"],
    },
  };
  const twoRanges = advisory({
    ghsa: LOCK_A,
    vulnerabilities: [
      {
        package: { ecosystem: "npm", name: "fast-uri" },
        vulnerable_version_range: ">= 3.0.0, < 3.1.6",
        first_patched_version: "3.1.6",
      },
      {
        package: { ecosystem: "npm", name: "fast-uri" },
        vulnerable_version_range: "< 2.5.0",
        first_patched_version: "3.1.6",
      },
    ],
  });
  const spawn = fakeSpawn({ advisories: [twoRanges] });
  inTempRepo({ "bun.lock": lock }, () => captureLog(() => sweep(spawn)));

  const writes = issueWrites(spawn);
  assert.equal(writes.length, 1);
  assert.equal(
    titleOf(writes[0]),
    "chore(deps): bump `fast-uri` to `3.1.6` in `bun.lock` (1 advisory)",
  );
  const body = bodyOf(writes[0]);
  assert.deepEqual(parseMarker(body).ghsas, [LOCK_A]);
  const lines = body.split("\n");
  assert.ok(
    lines.includes(
      `| [${LOCK_A}](https://github.com/advisories/${LOCK_A}) | — | high | < 2.5.0 \\|\\| >= 3.0.0, < 3.1.6 | fast-uri is bad |`,
    ),
    "one row, with both ranges",
  );
  assert.ok(lines.includes("| `node_modules/fast-uri` | `3.1.5` |"));
  assert.ok(
    lines.includes("| `node_modules/ajv/node_modules/fast-uri` | `2.4.0` |"),
    "the nested copy is named too",
  );

  // And the next run, with the ranges the other way round, writes nothing.
  const again = fakeSpawn({
    advisories: [
      {
        ...twoRanges,
        vulnerabilities: [...twoRanges.vulnerabilities].reverse(),
      },
    ],
    issues: [{ number: 52, title: titleOf(writes[0]), body }],
  });
  inTempRepo({ "bun.lock": lock }, () => captureLog(() => sweep(again)));
  assert.equal(issueWrites(again).length, 0);
});
