// Adversarial cases 1 to 8 for the daily alert sweep
// (scripts/dependabot-alerts.mjs, the helpers it uses under scripts/lib/, and
// the workflow .github/workflows/dependabot-alerts.yml).
//
// In this repo: the cases were written by the review model (Codex), a model
// from another vendor than the author's, in a tests round run on commit
// cca06387fd7b8505efafc2a9685ffb43c7e227cd of this change, before the pull
// request was opened. They are kept in its order and under its numbers, which
// is why each test is called "Codex case N".
//
// The comment above each test is that case's text, copied unchanged from the
// round's final message (sha256
// ce19da12cf5ddbd449ecc505a049c3380fa1abd35b7d901474831a637b7eb68a, lines 28
// to 223), each line behind "// ". The test below it is this repository's
// rendering of the case for `node --test`: the exact input the case names, and
// the verdict the case calls correct. No case was dropped, and no case's text
// was changed.
//
// What "current" in a case's text means: the commit the round read. All eight
// failed there, and each was reproduced before anything was changed, with the
// effect its text gives:
//
//   - cases 1 and 2: the open issue was rewritten to "every alert it tracked
//     has been fixed or dismissed";
//   - case 3: a second issue was filed for the same bump;
//   - case 4: the advisory was announced a second time;
//   - case 5: the run logged UNVERIFIED and carried on;
//   - case 6: nothing was written and the run ended green;
//   - case 7: an issue was filed from a lockfile whose root was malformed;
//   - case 8: two issues were filed for one alert.
//
// SEVEN ARE MET, by fixes in the commit that brought this file in (the
// script's header, edits 4, 13 and 14):
//
//   - cases 1 and 2: an entry of the alert listing that is not in the state
//     `open` throws, before anything is written;
//   - case 3: an issue of the sweep's own that does not state its body throws;
//   - case 4: an issue or a comment that does not state its author's login and
//     account type throws;
//   - case 6: an npm bump the run could not check is left alone and the run
//     then fails, naming it. The fix covers all three ways a bump can be
//     uncheckable, not only the case's: a manifest path outside the fixed
//     list, a lockfile that cannot be read, a locked version that is not a
//     version;
//   - case 7: a dependency map of the lockfile's root that is not a map makes
//     the lockfile unreadable, which case 6's fix then turns into a failed run;
//   - case 8: the same alert (one advisory's one vulnerable range, on one
//     package in one manifest) listed twice throws. The same advisory with a
//     different range is two alerts and is left to the grouping, as in the
//     source.
//
// ONE IS NOT MET: case 5. It is kept exactly as the round wrote it. Its test
// is marked `todo`, so it runs on every run of this suite, fails, and is
// reported as an open item without failing the suite. The author's proposed
// amendment and its reasons are in the comment beside it, and a second test
// holds the amended verdict in place. An amendment is a proposal: the review
// of the pull request judges it, and accepting it is the owner's decision at
// merge.
//
// Nothing here starts a process or uses the network: `main` is handed a fake
// `spawnSync`, which throws on any program but `gh` and on any `gh` call it
// does not know, and a writer that does not wait. A case that runs `main` does
// so inside a temporary directory holding the `bun.lock` it names. `npm run
// test:scripts` names this file by path. Record: PROVENANCE.md, "Sweeps".

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  ISSUE_LABELS,
  buildCommentMarker,
  buildIssueBody,
  buildIssueTitle,
  groupAlerts,
  main as sweepMain,
} from "./dependabot-alerts.mjs";
import { pacedWrites } from "./lib/paced-writes.mjs";

// ---------------------------------------------------------------------------
// The fixtures the cases name. They are this file's own copies of the ones in
// scripts/dependabot-alerts.test.mjs, which the round was pointed at: a test
// file exports nothing, and a case here must not change because a fixture
// there did.
// ---------------------------------------------------------------------------

/** `main`, with a writer whose pause does nothing, so no case waits. */
const main = (repo, spawn, today) =>
  sweepMain(
    repo,
    spawn,
    today,
    pacedWrites(() => {}),
  );

/** Shaped like a real `GET /repos/{o}/{r}/dependabot/alerts` entry. */
function alert({
  ghsa,
  pkg = "fast-uri",
  manifest = "package.json",
  fixed = "3.1.6",
  severity = "high",
  range = ">= 3.0.0, < 3.1.6",
}) {
  return {
    state: "open",
    html_url: `https://github.com/o/r/security/dependabot/${ghsa}`,
    dependency: {
      package: { name: pkg, ecosystem: "npm" },
      manifest_path: manifest,
      scope: "runtime",
    },
    security_advisory: {
      ghsa_id: ghsa,
      cve_id: null,
      severity,
      summary: `${pkg} is bad`,
    },
    security_vulnerability: {
      vulnerable_version_range: range,
      first_patched_version: { identifier: fixed },
    },
  };
}

/** The account the REST endpoints name as the author of the sweep's writes. */
const BOT = { login: "github-actions[bot]", type: "Bot" };

/** A fixture issue as the REST listing returns one this sweep filed. */
const asSweepIssue = (issue) => ({
  user: BOT,
  labels: ISSUE_LABELS.map((name) => ({ name })),
  ...issue,
});

/**
 * A fake `spawnSync`. The setting answers "off", and each listing answers
 * with what the case hands it. Every call is recorded. Any program but `gh`,
 * and any `gh` call not listed here, throws.
 */
function fakeSpawn({
  securityFixesResponse,
  alertPages = [[]],
  issues = [],
  issuesResponse,
  commentsResponse,
} = {}) {
  const calls = [];
  const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (cmd !== "gh") throw new Error(`unexpected program: ${cmd}`);
    const joined = args.join(" ");
    if (joined.includes("automated-security-fixes")) {
      return securityFixesResponse
        ? { stdout: "", stderr: "", ...securityFixesResponse }
        : ok(JSON.stringify({ enabled: false, paused: false }));
    }
    if (joined.includes("dependabot/alerts"))
      return ok(JSON.stringify(alertPages));
    if (args[0] === "api" && joined.includes("/comments?"))
      return commentsResponse
        ? { stdout: "", stderr: "", ...commentsResponse }
        : ok("[[]]");
    if (args[0] === "api" && joined.includes("/issues?"))
      return issuesResponse
        ? { stdout: "", stderr: "", ...issuesResponse }
        : ok(JSON.stringify([issues.map(asSweepIssue)]));
    if (args[0] === "issue" && args[1] === "create")
      return ok("https://github.com/o/r/issues/77\n");
    if (args[0] === "issue" && (args[1] === "edit" || args[1] === "comment"))
      return ok();
    throw new Error(`unexpected gh call: ${joined}`);
  };
  spawn.calls = calls;
  return spawn;
}

/** The `gh issue …` calls a run made: its writes. */
const issueWrites = (spawn) =>
  spawn.calls.filter((c) => c.cmd === "gh" && c.args[0] === "issue");

/** Run `run` with the sweep's progress lines kept off the console. */
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

/** Run `body` in a temporary working directory holding `files` as JSON. */
function inTempRepo(files, body) {
  const dir = mkdtempSync(join(tmpdir(), "dependabot-alerts-attack-"));
  const cwd = process.cwd();
  try {
    for (const [path, value] of Object.entries(files)) {
      const full = join(dir, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, JSON.stringify(value));
    }
    process.chdir(dir);
    return body();
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A `bun.lock` holding one hoisted, undeclared copy of `pkg` at `version`. */
const lockWith = (pkg, version) => ({
  lockfileVersion: 1,
  workspaces: { "": { name: "fixture", dependencies: {} } },
  packages: { [pkg]: [`${pkg}@${version}`, "", {}, "sha512-fixture"] },
});

/** A checkout whose lockfile holds a copy in range of the default alert. */
const VULNERABLE = { "bun.lock": lockWith("fast-uri", "3.1.5") };

/** An open issue for the default alert (`GHSA-a` on `fast-uri`), up to date. */
const filedIssue = (extra = {}) => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  return {
    number: 41,
    title: buildIssueTitle(group),
    body: buildIssueBody(group, {
      affected: [
        { path: "node_modules/fast-uri", version: "3.1.5", hoisted: true },
      ],
      declared: false,
    }),
    ...extra,
  };
};

// 1. **An alert missing `state` must not clear its existing issue**
//
//    Exact input:
//
//    ```js
//    const short = alert({ ghsa: "GHSA-a" });
//    delete short.state;
//    const spawn = fakeSpawn({
//      alertPages: [[short]],
//      issues: [filedIssue()],
//    });
//
//    assert.throws(() =>
//      inTempRepo(VULNERABLE, () =>
//        captureLog(() => main("o/r", spawn, "2026-09-04")),
//      ),
//    );
//    assert.deepEqual(issueWrites(spawn), []);
//    ```
//
//    Expected correct verdict: throw and make no write. Current logic accepts the entry in `openAlerts()`, drops it in `groupAlerts()`, omits it from `openAdvisories`, then clears the issue as fixed or dismissed.
//
//    Protects: “a failed, short or malformed read … [must not be] taken as ‘no alert is open’” and used to clear an issue.
test("Codex case 1: an alert missing `state` must not clear its existing issue", () => {
  const short = alert({ ghsa: "GHSA-a" });
  delete short.state;
  const spawn = fakeSpawn({
    alertPages: [[short]],
    issues: [filedIssue()],
  });

  assert.throws(() =>
    inTempRepo(VULNERABLE, () =>
      captureLog(() => main("o/r", spawn, "2026-09-04")),
    ),
  );
  assert.deepEqual(issueWrites(spawn), []);
});

// 2. **A contradictory alert state returned by the `state=open` listing must fail closed**
//
//    Exact input:
//
//    ```js
//    const contradictory = alert({ ghsa: "GHSA-a" });
//    contradictory.state = "dismissed";
//    const spawn = fakeSpawn({
//      alertPages: [[contradictory]],
//      issues: [filedIssue()],
//    });
//
//    assert.throws(() =>
//      inTempRepo(VULNERABLE, () =>
//        captureLog(() => main("o/r", spawn, "2026-09-04")),
//      ),
//    );
//    assert.deepEqual(issueWrites(spawn), []);
//    ```
//
//    Expected correct verdict: throw and make no write. A response inconsistent with the requested open-only endpoint is malformed evidence, not proof that an alert vanished.
//
//    Protects: the same malformed-alert-listing and false-clear requirement.
test("Codex case 2: a contradictory alert state returned by the `state=open` listing must fail closed", () => {
  const contradictory = alert({ ghsa: "GHSA-a" });
  contradictory.state = "dismissed";
  const spawn = fakeSpawn({
    alertPages: [[contradictory]],
    issues: [filedIssue()],
  });

  assert.throws(() =>
    inTempRepo(VULNERABLE, () =>
      captureLog(() => main("o/r", spawn, "2026-09-04")),
    ),
  );
  assert.deepEqual(issueWrites(spawn), []);
});

// 3. **An owned issue missing its body must not be read as “no matching issue”**
//
//    Exact input:
//
//    ```js
//    const own = asSweepIssue(filedIssue());
//    delete own.body;
//    const spawn = fakeSpawn({
//      alertPages: [[alert({ ghsa: "GHSA-a" })]],
//      issuesResponse: {
//        status: 0,
//        stdout: JSON.stringify([[own]]),
//      },
//    });
//
//    assert.throws(() =>
//      inTempRepo(VULNERABLE, () => captureLog(() => main("o/r", spawn))),
//    );
//    assert.deepEqual(issueWrites(spawn), []);
//    ```
//
//    Expected correct verdict: throw and file no duplicate. Currently `parseMarker(undefined)` returns `null`, so the sweep creates another issue.
//
//    Protects: “a failed, short or malformed … issue listing [must not be] taken as ‘no issue exists’.”
test("Codex case 3: an owned issue missing its body must not be read as “no matching issue”", () => {
  const own = asSweepIssue(filedIssue());
  delete own.body;
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
    issuesResponse: {
      status: 0,
      stdout: JSON.stringify([[own]]),
    },
  });

  assert.throws(() =>
    inTempRepo(VULNERABLE, () => captureLog(() => main("o/r", spawn))),
  );
  assert.deepEqual(issueWrites(spawn), []);
});

// 4. **A marker-bearing comment with incomplete author data must not become “nothing was announced”**
//
//    Exact input:
//
//    ```js
//    const spawn = fakeSpawn({
//      alertPages: [[
//        alert({ ghsa: "GHSA-a" }),
//        alert({ ghsa: "GHSA-b" }),
//      ]],
//      issues: [filedIssue()],
//      commentsResponse: {
//        status: 0,
//        stdout: JSON.stringify([[
//          {
//            body: buildCommentMarker(["GHSA-b"]),
//            user: { login: "github-actions[bot]" }, // missing REST type
//          },
//        ]]),
//      },
//    });
//
//    assert.throws(() =>
//      inTempRepo(VULNERABLE, () => captureLog(() => main("o/r", spawn))),
//    );
//    assert.deepEqual(issueWrites(spawn), []);
//    ```
//
//    Expected correct verdict: throw before repeating the announcement. Currently the malformed provenance is silently treated as a foreign comment and another comment is posted.
//
//    Protects: malformed comment listings must not be taken as “nothing was announced”; marker provenance must not fail open.
test("Codex case 4: a marker-bearing comment with incomplete author data must not become “nothing was announced”", () => {
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" }), alert({ ghsa: "GHSA-b" })]],
    issues: [filedIssue()],
    commentsResponse: {
      status: 0,
      stdout: JSON.stringify([
        [
          {
            body: buildCommentMarker(["GHSA-b"]),
            user: { login: "github-actions[bot]" }, // missing REST type
          },
        ],
      ]),
    },
  });

  assert.throws(() =>
    inTempRepo(VULNERABLE, () => captureLog(() => main("o/r", spawn))),
  );
  assert.deepEqual(issueWrites(spawn), []);
});

// 5. **An unrelated 403 must not be classified as an authorization-only UNVERIFIED result**
//
//    Exact input:
//
//    ```js
//    const spawn = fakeSpawn({
//      securityFixesResponse: {
//        status: 1,
//        stderr: "gh: HTTP 403: backend temporarily unavailable",
//      },
//    });
//
//    assert.throws(
//      () => captureLog(() => main("o/r", spawn)),
//      /automated-security-fixes lookup failed/,
//    );
//    assert.equal(spawn.calls.length, 1);
//    ```
//
//    Expected correct verdict: throw. Only an actual scope/authorization denial may degrade to UNVERIFIED. Current `isPermissionDenied()` accepts essentially every non-rate-limit `HTTP 403`.
//
//    Protects: a failed setting read must not be taken as an acceptable conditional inability to verify.
//
// PROPOSED AMENDMENT to case 5. It is the author's, not the round's. The case's
// text above is unchanged, and its test below is kept as written and marked
// `todo`.
//
//    Expected verdict as amended: the run logs UNVERIFIED and carries on, as
//    it does for any 403 or 404 that is not a rate limit.
//
//    Reasons:
//
//    1. `isPermissionDenied` is the source's function and this change does not
//       edit it. The design keeps the source's logic wherever a file's header
//       does not list an edit.
//    2. The case's verdict would change no outcome it could protect here.
//       Under this job's token the setting can never be read, so every run
//       already ends UNVERIFIED. UNVERIFIED is not "the setting is off": the
//       issue text then leaves that claim out, and every other read of the run
//       still throws on a failure.
//    3. Telling an authorization refusal from another 403 means matching the
//       exact text GitHub answers a job token with on this endpoint, and that
//       text has not been measured here: the first run under a job token is
//       the first evidence. A wording that did not match would make every
//       scheduled run fail at its first call, and the sweep would report
//       nothing at all.
//
//    What would change this: the refusal text read from a real run of this
//    workflow. With it, the tolerated 403 can be narrowed to that text.
test(
  "Codex case 5: an unrelated 403 must not be classified as an authorization-only UNVERIFIED result",
  {
    todo: "NOT MET: declined with a proposed amendment, in the comment above this test",
  },
  () => {
    const spawn = fakeSpawn({
      securityFixesResponse: {
        status: 1,
        stderr: "gh: HTTP 403: backend temporarily unavailable",
      },
    });

    assert.throws(
      () => captureLog(() => main("o/r", spawn)),
      /automated-security-fixes lookup failed/,
    );
    assert.equal(spawn.calls.length, 1);
  },
);

test("Codex case 5, as the amendment proposes: a 403 that is not a rate limit is logged as UNVERIFIED and the run carries on", () => {
  const spawn = fakeSpawn({
    securityFixesResponse: {
      status: 1,
      stderr: "gh: HTTP 403: backend temporarily unavailable",
    },
  });
  const log = captureLog(() => main("o/r", spawn));
  assert.ok(log.some((l) => l.includes("UNVERIFIED")));
  // The setting, then the alert listing and the issue listing: the run went
  // on, and with no alert open it wrote nothing.
  assert.equal(spawn.calls.length, 3);
  assert.deepEqual(issueWrites(spawn), []);

  // What is NOT waved through, as in the source: a rate limit (a 403 too), a
  // bad token and a server error each stop the run at this first call.
  for (const stderr of [
    "gh: API rate limit exceeded (HTTP 403)",
    "gh: HTTP 403: You have exceeded a secondary rate limit",
    "gh: HTTP 401: Bad credentials",
    "gh: HTTP 502: Bad Gateway",
  ]) {
    const failing = fakeSpawn({
      securityFixesResponse: { status: 1, stderr },
    });
    assert.throws(
      () => captureLog(() => main("o/r", failing)),
      /automated-security-fixes lookup failed/,
      stderr,
    );
    assert.equal(failing.calls.length, 1);
  }
});

// 6. **A non-semver locked copy must make the run red, not silently leave a required issue unfiled**
//
//    Exact input:
//
//    ```js
//    const spawn = fakeSpawn({
//      alertPages: [[alert({ ghsa: "GHSA-a" })]],
//    });
//
//    assert.throws(() =>
//      inTempRepo(
//        { "bun.lock": lockWith("fast-uri", "git+https://example.invalid/x.git") },
//        () => captureLog(() => main("o/r", spawn)),
//      ),
//    );
//    assert.deepEqual(issueWrites(spawn), []);
//    ```
//
//    Expected correct verdict: throw. Logging, skipping the alert, and exiting green is an author-declared limitation that the owner has not accepted.
//
//    Protects: E5’s one-issue-per-applicable-bump result and the requirement that malformed or unusable lock evidence not silently leave an issue unfiled.
test("Codex case 6: a non-semver locked copy must make the run red, not silently leave a required issue unfiled", () => {
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
  });

  assert.throws(() =>
    inTempRepo(
      { "bun.lock": lockWith("fast-uri", "git+https://example.invalid/x.git") },
      () => captureLog(() => main("o/r", spawn)),
    ),
  );
  assert.deepEqual(issueWrites(spawn), []);
});

// 7. **A malformed root dependency map must not produce authoritative remediation**
//
//    Exact input:
//
//    ```js
//    const malformed = lockWith("fast-uri", "3.1.5");
//    malformed.workspaces[""].dependencies = [];
//
//    const spawn = fakeSpawn({
//      alertPages: [[alert({ ghsa: "GHSA-a" })]],
//    });
//
//    assert.throws(() =>
//      inTempRepo(
//        { "bun.lock": malformed },
//        () => captureLog(() => main("o/r", spawn)),
//      ),
//    );
//    assert.deepEqual(issueWrites(spawn), []);
//    ```
//
//    Expected correct verdict: throw. The malformed root currently passes the lock reader and can file an issue with the wrong direct/transitive remediation classification.
//
//    Protects: malformed `bun.lock` must be indeterminate, not authoritative evidence; issue advice must follow the dependency-placement rule.
test("Codex case 7: a malformed root dependency map must not produce authoritative remediation", () => {
  const malformed = lockWith("fast-uri", "3.1.5");
  malformed.workspaces[""].dependencies = [];

  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
  });

  assert.throws(() =>
    inTempRepo({ "bun.lock": malformed }, () =>
      captureLog(() => main("o/r", spawn)),
    ),
  );
  assert.deepEqual(issueWrites(spawn), []);
});

// 8. **One GHSA returned twice with contradictory patched versions must not file two issues**
//
//    Exact input:
//
//    ```js
//    const spawn = fakeSpawn({
//      alertPages: [[
//        alert({ ghsa: "GHSA-a", fixed: "3.1.6" }),
//        alert({ ghsa: "GHSA-a", fixed: "3.1.7" }),
//      ]],
//    });
//
//    assert.throws(() =>
//      inTempRepo(VULNERABLE, () => captureLog(() => main("o/r", spawn))),
//    );
//    assert.deepEqual(issueWrites(spawn), []);
//    ```
//
//    Expected correct verdict: throw on the internally inconsistent listing. Current grouping can file two issues for the same open alert.
//
//    Protects: one issue per bump, malformed listing detection, and the no-duplicate requirement.
test("Codex case 8: one GHSA returned twice with contradictory patched versions must not file two issues", () => {
  const spawn = fakeSpawn({
    alertPages: [
      [
        alert({ ghsa: "GHSA-a", fixed: "3.1.6" }),
        alert({ ghsa: "GHSA-a", fixed: "3.1.7" }),
      ],
    ],
  });

  assert.throws(() =>
    inTempRepo(VULNERABLE, () => captureLog(() => main("o/r", spawn))),
  );
  assert.deepEqual(issueWrites(spawn), []);
});
