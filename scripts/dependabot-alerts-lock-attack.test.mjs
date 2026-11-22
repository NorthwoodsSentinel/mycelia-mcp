// Adversarial cases 1 to 5 for the lock file check of the daily alert sweep
// (scripts/lib/lock-advisories.mjs, and its joining to the sweep in
// scripts/dependabot-alerts.mjs, the header's edit 15).
//
// In this repo: the cases were written by the review model (Codex), a model
// from another vendor than the author's, in a tests round run on commit
// 1cd003e7921eb78f736f856b58a20a3f5a19b7c3 of this change, before the pull
// request was opened. They are kept in its order and under its numbers, which
// is why each test is called "Codex case N".
//
// The comment above each test is that case's text, copied from the round's
// final message (sha256
// 3a383ae3a20976a25e68252e2519578b8f248ea495d0018bc95938aa8eafe544, lines 32
// to 131), each line behind "// ". ONE thing in that text is changed, in two
// places: two links pointed into the directory the round read on the author's
// machine, and in each that directory's path is written here as
// "<checkout>", because this repository is public and the path names a home
// directory. The sha256 is of the message as the round wrote it. Nothing else
// in any case's text is changed, and no case was dropped. The test below a
// case is this repository's rendering of it for `node --test`: the exact
// input the case names, and the verdict the case calls correct.
//
// What "current" in a case's text means: the commit the round read. Each case
// was run against that commit before anything was changed:
//
//   - case 1 failed there: the package only the later answer named got no
//     record, and at the level of the whole sweep its open issue was
//     rewritten to its cleared form;
//   - case 2 failed there in both of its variants: the run took the copy that
//     arrived first, wrote, and ended green;
//   - case 3 failed there: the malformed vulnerability was skipped, and the
//     run carried on to its writes;
//   - cases 4 and 5 failed there: the run stopped as on a failed read.
//
// FOUR ARE MET IN FULL, and case 2 in its first variant, by fixes in the
// commit that brought this file in:
//
//   - case 1: the copies of one advisory that two answers hold are united,
//     so a package only the later copy names is not lost;
//   - case 2, first variant: copies that disagree on `withdrawn_at` (or on
//     the severity, the summary or the CVE id) stop the run before any write;
//   - case 3: EVERY vulnerability of every advisory must state its package,
//     its vulnerable range and its patched version, asked about or not. This
//     is the design note's own wording (section 4); the build had read past a
//     vulnerability with a null package, because the endpoint's schema allows
//     one. Measured for this fix over all 8,184 reviewed npm advisories and
//     their 11,750 vulnerabilities: none has a null or missing one of these;
//   - cases 4 and 5: a severity and a CVE id are text, as the design note
//     says, and are no longer held to a list of words or a form.
//
// ONE VARIANT IS NOT MET AS WRITTEN: case 2's second, "a different patch such
// as 3.0.0". Its test is kept as the round wrote it and marked `todo`, so it
// runs on every run of this suite, fails, and is reported as an open item
// without failing the suite. The proposed amendment and its reason are in the
// comment beside it, and two more tests hold the amended verdict in place. An
// amendment is a proposal: the review of the pull request judges it, and
// accepting it is the owner's decision at merge.
//
// Nothing here starts a process or uses the network: the sweep's `main` is
// handed a fake `spawnSync`, which throws on any program but `gh` and on any
// `gh` call it does not know, and a writer that does not wait. The lock file
// check is the script's own default, as in a run. A case that runs `main`
// does so inside a temporary directory holding the `bun.lock` it names. `npm
// run test:scripts` names this file by path. Record: PROVENANCE.md, "Sweeps".

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ISSUE_LABELS,
  main as sweepMain,
  parseMarker,
} from "./dependabot-alerts.mjs";
import { readLockAdvisories } from "./lib/lock-advisories.mjs";
import { pacedWrites } from "./lib/paced-writes.mjs";

// ---------------------------------------------------------------------------
// The fixtures the cases name. They are this file's own copies of the ones in
// scripts/dependabot-alerts.test.mjs and scripts/lib/lock-advisories.test.mjs,
// which the round was pointed at: a test file exports nothing, and a case
// here must not change because a fixture there did.
// ---------------------------------------------------------------------------

/** The sweep as a run makes it, lock file check included, with no waiting. */
const sweep = (spawn) =>
  sweepMain(
    "o/r",
    spawn,
    "2026-11-22",
    pacedWrites(() => {}),
  );

/** One vulnerability of an advisory, as the endpoint states it. */
const vuln = (name, range, fixed) => ({
  package: { ecosystem: "npm", name },
  vulnerable_version_range: range,
  first_patched_version: fixed,
  vulnerable_functions: [],
});

/** Shaped like a real `GET /advisories` entry. */
function advisory({
  ghsa,
  pkg = "fast-uri",
  range = ">= 3.0.0, < 3.1.6",
  fixed = "3.1.6",
  severity = "high",
  cve = null,
  withdrawn = null,
  vulnerabilities,
}) {
  return {
    ghsa_id: ghsa,
    cve_id: cve,
    html_url: `https://example.invalid/not-used/${ghsa}`,
    summary: `${pkg} is bad`,
    type: "reviewed",
    severity,
    withdrawn_at: withdrawn,
    vulnerabilities: vulnerabilities ?? [vuln(pkg, range, fixed)],
  };
}

/** The two control advisories, as the endpoint returned them on 2026-11-22. */
const CONTROL_ADVISORIES = [
  advisory({
    ghsa: "GHSA-xvch-5gv4-984h",
    pkg: "minimist",
    severity: "critical",
    cve: "CVE-2021-44906",
    vulnerabilities: [
      vuln("minimist", ">= 1.0.0, < 1.2.6", "1.2.6"),
      vuln("minimist", "< 0.2.4", "0.2.4"),
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

/** Shaped like a real `GET /repos/{o}/{r}/dependabot/alerts` entry. */
const alert = ({ ghsa, pkg = "fast-uri" }) => ({
  state: "open",
  html_url: `https://github.com/o/r/security/dependabot/${ghsa}`,
  dependency: {
    package: { name: pkg, ecosystem: "npm" },
    manifest_path: "package.json",
    scope: "runtime",
  },
  security_advisory: {
    ghsa_id: ghsa,
    cve_id: null,
    severity: "high",
    summary: `${pkg} is bad`,
  },
  security_vulnerability: {
    vulnerable_version_range: ">= 3.0.0, < 3.1.6",
    first_patched_version: { identifier: "3.1.6" },
  },
});

/** The account the REST endpoints name as the author of the sweep's writes. */
const BOT = { login: "github-actions[bot]", type: "Bot" };

/**
 * A `spawnSync` stand-in: it throws on any program but `gh` and on any `gh`
 * call it does not know, and records every call. `advisoryAnswer(index)`
 * returns the whole answer to the query of that index, as a list.
 */
function fakeSpawn({ alerts = [], issues = [], advisoryAnswer } = {}) {
  const calls = [];
  let asked = 0;
  const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (cmd !== "gh") throw new Error(`unexpected program: ${cmd}`);
    const joined = args.join(" ");
    if (joined.includes("automated-security-fixes"))
      return ok(JSON.stringify({ enabled: false, paused: false }));
    if (joined.includes("dependabot/alerts?state=dismissed,auto_dismissed"))
      return ok(JSON.stringify([[]]));
    if (joined.includes("dependabot/alerts?state=open"))
      return ok(JSON.stringify([alerts]));
    if (args[0] === "api" && args.at(-1).startsWith("advisories?"))
      return ok(JSON.stringify([advisoryAnswer(asked++)]));
    if (args[0] === "api" && joined.includes("/comments?"))
      return ok(JSON.stringify([[]]));
    if (args[0] === "api" && joined.includes("/issues?"))
      return ok(
        JSON.stringify([
          issues.map((issue) => ({
            user: BOT,
            labels: ISSUE_LABELS.map((name) => ({ name })),
            ...issue,
          })),
        ]),
      );
    if (args[0] === "issue" && args[1] === "create")
      return ok("https://github.com/o/r/issues/77\n");
    if (args[0] === "issue" && args[1] === "edit") return ok();
    if (args[0] === "issue" && args[1] === "comment") return ok();
    throw new Error(`unexpected gh call: ${joined}`);
  };
  spawn.calls = calls;
  return spawn;
}

/** The `gh issue …` calls a run made: its writes. */
const issueWrites = (spawn) =>
  spawn.calls.filter((c) => c.cmd === "gh" && c.args[0] === "issue");
const titleOf = (call) => call.args[call.args.indexOf("--title") + 1];
const bodyOf = (call) => call.args[call.args.indexOf("--body") + 1];
/** Did the run get as far as listing its own issues? */
const listedIssues = (spawn) =>
  spawn.calls.some((c) => c.args.at(-1).includes("/issues?"));

/** Run `run` with `console.log` silenced, and return what it returned. */
function quietly(run) {
  const original = console.log;
  console.log = () => {};
  try {
    return run();
  } finally {
    console.log = original;
  }
}

/** A `bun.lock` holding one hoisted, undeclared copy of each package named. */
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

/** Run `body` in a temporary directory holding `lock` as its `bun.lock`. */
function inTempRepo(lock, body) {
  const dir = mkdtempSync(join(tmpdir(), "lock-attack-"));
  const cwd = process.cwd();
  try {
    writeFileSync(join(dir, "bun.lock"), JSON.stringify(lock));
    process.chdir(dir);
    return body();
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

const A = "GHSA-aaaa-aaaa-aaaa";
const B = "GHSA-bbbb-bbbb-bbbb";

/** `pkg-000` to `pkg-149`, all at 1.0.0: two queries' worth. */
const PKG_NAMES = Array.from(
  { length: 150 },
  (_, i) => `pkg-${String(i).padStart(3, "0")}`,
);
const PKG_ENTRIES = PKG_NAMES.map((name) => ({ name, version: "1.0.0" }));
const PKG_LOCK = Object.fromEntries(PKG_NAMES.map((name) => [name, "1.0.0"]));

/** A lock file with one copy of `fast-uri` in range of the default advisory. */
const VULNERABLE = lockOf({ "fast-uri": "3.1.5" });

/** `B` as one query's answer states it, naming the packages given. */
const copyOfB = (vulnerabilities, extra = {}) => ({
  ...advisory({ ghsa: B, vulnerabilities }),
  ...extra,
});

/**
 * A helper-level stand-in for the advisory listing only: `answers[index]` is
 * added to the two control advisories as the answer to that query.
 */
function fakeGh(answers) {
  let asked = 0;
  return (cmd, args) => {
    if (cmd !== "gh" || !args.at(-1).startsWith("advisories?")) {
      throw new Error(`unexpected call: ${cmd} ${args.join(" ")}`);
    }
    return {
      status: 0,
      stdout: JSON.stringify([[...CONTROL_ADVISORIES, ...answers[asked++]]]),
      stderr: "",
    };
  };
}

/**
 * The open issue a run files for an advisory found in the lock file, taken
 * from a real run so that it is byte for byte what the sweep writes.
 */
function filedLockIssue(lock, answer, pkg, number) {
  const spawn = fakeSpawn({
    advisoryAnswer: () => [...CONTROL_ADVISORIES, ...answer],
  });
  inTempRepo(lock, () => quietly(() => sweep(spawn)));
  const create = issueWrites(spawn).find(
    (c) => c.args[1] === "create" && parseMarker(bodyOf(c)).package === pkg,
  );
  return { number, title: titleOf(create), body: bodyOf(create) };
}

/** The open lock-file issue for `A` on `fast-uri`. */
const fastUriIssue = () =>
  filedLockIssue(VULNERABLE, [advisory({ ghsa: A })], "fast-uri", 51);

// ---------------------------------------------------------------------------
// Codex case 1
// ---------------------------------------------------------------------------
// 1. **The same GHSA returned with different package subsets in different queries must not lose the later package.**
//
//    Exact input: call `readLockAdvisories` with 150 locked packages (`pkg-000` through `pkg-149`, all `1.0.0`) so two queries are generated. Return both valid controls in both answers. In query 1 return:
//
//    ```js
//    advisory({
//      ghsa: "GHSA-bbbb-bbbb-bbbb",
//      vulnerabilities: [vuln("pkg-000", "< 2.0.0", "2.0.0")],
//    })
//    ```
//
//    In query 2 return the same GHSA with:
//
//    ```js
//    advisory({
//      ghsa: "GHSA-bbbb-bbbb-bbbb",
//      vulnerabilities: [vuln("pkg-149", "< 2.0.0", "2.0.0")],
//    })
//    ```
//
//    Expected correct verdict: two records, one for `pkg-000` and one for `pkg-149`. The run must not silently retain only the first advisory object. At the whole-sweep level, an existing `pkg-149` lock-file issue must not be cleared.
//
//    Current risk: `readLockAdvisories` stores the first object by GHSA and discards every later object at [lock-advisories.mjs](<checkout>/scripts/lib/lock-advisories.mjs:595).
//
//    Protects: “an advisory on a transitive package in `bun.lock` produces one issue”; design §4’s expectation that the same advisory may occur in multiple query answers and is taken once, without discarding evidence received in later answers.

test("Codex case 1: the same GHSA with different package subsets in two answers keeps both packages", () => {
  const { records } = readLockAdvisories(
    fakeGh([
      [copyOfB([vuln("pkg-000", "< 2.0.0", "2.0.0")])],
      [copyOfB([vuln("pkg-149", "< 2.0.0", "2.0.0")])],
    ]),
    PKG_ENTRIES,
  );
  assert.deepEqual(
    records.map((r) => [
      r.security_advisory.ghsa_id,
      r.dependency.package.name,
    ]),
    [
      [B, "pkg-000"],
      [B, "pkg-149"],
    ],
  );
});

test("Codex case 1: at the whole-sweep level, the existing pkg-149 lock-file issue is not cleared", () => {
  const whole = copyOfB([
    vuln("pkg-000", "< 2.0.0", "2.0.0"),
    vuln("pkg-149", "< 2.0.0", "2.0.0"),
  ]);
  const existing = filedLockIssue(lockOf(PKG_LOCK), [whole], "pkg-149", 61);
  assert.equal(parseMarker(existing.body).package, "pkg-149");

  const spawn = fakeSpawn({
    issues: [existing],
    advisoryAnswer: (index) => [
      ...CONTROL_ADVISORIES,
      copyOfB([
        index === 0
          ? vuln("pkg-000", "< 2.0.0", "2.0.0")
          : vuln("pkg-149", "< 2.0.0", "2.0.0"),
      ]),
    ],
  });
  inTempRepo(lockOf(PKG_LOCK), () => quietly(() => sweep(spawn)));

  const writes = issueWrites(spawn);
  assert.deepEqual(
    writes.map((c) => c.args[1]),
    ["create"],
    "pkg-000 is filed, and #61 is neither edited nor cleared",
  );
  assert.equal(parseMarker(bodyOf(writes[0])).package, "pkg-000");
});

// ---------------------------------------------------------------------------
// Codex case 2
// ---------------------------------------------------------------------------
// 2. **Contradictory copies of one GHSA across queries must fail closed before writes.**
//
//    Exact input: use the same two-query lock fixture. Query 1 returns `GHSA-bbbb-bbbb-bbbb` live for `pkg-000`, patched in `2.0.0`. Query 2 returns the same GHSA for `pkg-149` but either:
//
//    ```js
//    withdrawn_at: "2027-01-01T00:00:00Z"
//    ```
//
//    or a different patch such as `3.0.0`. Include both valid controls in each answer and prepare an existing lock-file issue plus an open alert that would otherwise cause writes.
//
//    Expected correct verdict: throw before issue listing or any create/comment/edit. Do not select whichever contradictory object happened to arrive first.
//
//    Protects: design §4 “every check on an answer”; “a failed read never clears an issue and ends the run red”; threat-model requirement that hostile answer fields cannot steer reconciliation.

/**
 * Case 2's run: the two-query lock fixture with `fast-uri` beside it, an
 * existing lock-file issue whose advisory is in neither answer (it would be
 * cleared) and an open alert (it would be filed), and `B` as query 1 states
 * it for `pkg-000`, live and patched in 2.0.0. `second` is what query 2
 * returns for the same advisory.
 */
function runCase2(second) {
  const lock = lockOf({ ...PKG_LOCK, "fast-uri": "3.1.5" });
  const spawn = fakeSpawn({
    alerts: [alert({ ghsa: "GHSA-a" })],
    issues: [fastUriIssue()],
    advisoryAnswer: (index) => [
      ...CONTROL_ADVISORIES,
      index === 0 ? copyOfB([vuln("pkg-000", "< 2.0.0", "2.0.0")]) : second,
    ],
  });
  return {
    spawn,
    run: () => inTempRepo(lock, () => quietly(() => sweep(spawn))),
  };
}

test("Codex case 2: copies of one GHSA that disagree on withdrawn_at stop the run before any write", () => {
  const { spawn, run } = runCase2(
    copyOfB([vuln("pkg-149", "< 2.0.0", "2.0.0")], {
      withdrawn_at: "2027-01-01T00:00:00Z",
    }),
  );
  assert.throws(
    run,
    /the lock file check could not be completed \(query 2 of 2: GHSA-bbbb-bbbb-bbbb does not agree with the copy an earlier answer held \(its withdrawn_at\)\) — no issue was filed, commented on or cleared this run/,
  );
  assert.equal(
    listedIssues(spawn),
    false,
    "it stopped before the issue listing",
  );
  assert.equal(issueWrites(spawn).length, 0);
});

// The case's second variant, as the round wrote it: query 2 returns the same
// GHSA for pkg-149 with "a different patch such as 3.0.0", and the expected
// verdict is a throw before the issue listing or any write.
//
// NOT MET, AND KEPT AS WRITTEN. Proposed amendment: this input is not a
// contradiction, and the correct verdict for it is two records, each with
// its own patched version, with neither copy chosen over the other.
//
// The reason. Query 1's copy says pkg-000 is patched in 2.0.0; query 2's
// copy says pkg-149 is patched in 3.0.0. Those are statements about two
// different packages, and one advisory giving two packages (or two ranges of
// one package) different patched versions is ordinary: of the two control
// advisories this check carries, GHSA-xvch-5gv4-984h lists minimist as
// patched in 0.2.4 for one range and in 1.2.6 for another. A rule that
// called this input contradictory would have to refuse case 1's input too,
// which differs from it only in the number, and case 1 requires both
// packages to be kept. What the case protects, "do not select whichever
// contradictory object happened to arrive first", holds under the amendment:
// nothing is selected, both copies are used, and the copies still have to
// agree on everything said about the advisory as a whole (the test above).
// The contradiction this variant reaches for does exist one step away, and
// stops the run: the SAME package and range with two patched versions (the
// last test of this case).
test(
  "Codex case 2: the same GHSA for pkg-149 with a different patch such as 3.0.0 stops the run before any write",
  {
    todo: "not met as written; the proposed amendment is in the comment above and the two tests below",
  },
  () => {
    const { spawn, run } = runCase2(
      copyOfB([vuln("pkg-149", "< 2.0.0", "3.0.0")]),
    );
    assert.throws(run);
    assert.equal(listedIssues(spawn), false);
    assert.equal(issueWrites(spawn).length, 0);
  },
);

test("Codex case 2, amended: two packages of one GHSA with two patched versions are two bumps, and neither copy is chosen over the other", () => {
  const { records } = readLockAdvisories(
    fakeGh([
      [copyOfB([vuln("pkg-000", "< 2.0.0", "2.0.0")])],
      [copyOfB([vuln("pkg-149", "< 2.0.0", "3.0.0")])],
    ]),
    PKG_ENTRIES,
  );
  assert.deepEqual(
    records.map((r) => [
      r.dependency.package.name,
      r.security_vulnerability.first_patched_version.identifier,
    ]),
    [
      ["pkg-000", "2.0.0"],
      ["pkg-149", "3.0.0"],
    ],
  );
});

test("Codex case 2, amended: the same package and range with two patched versions in two copies stops the run before any write", () => {
  const { spawn, run } = runCase2(
    copyOfB([
      vuln("pkg-149", "< 2.0.0", "2.0.0"),
      vuln("pkg-000", "< 2.0.0", "3.0.0"),
    ]),
  );
  assert.throws(
    run,
    /the lock file check could not be completed \(the advisory listing held GHSA-bbbb-bbbb-bbbb with the same range for pkg-000 twice, with two patched versions\) — no issue was filed, commented on or cleared this run/,
  );
  assert.equal(listedIssues(spawn), false);
  assert.equal(issueWrites(spawn).length, 0);
});

// ---------------------------------------------------------------------------
// Codex case 3
// ---------------------------------------------------------------------------
// 3. **Every vulnerability entry must have the design-required shape, even when it is not the vulnerability matching this query.**
//
//    Exact answer:
//
//    ```js
//    [
//      ...CONTROL_ADVISORIES,
//      advisory({
//        ghsa: "GHSA-aaaa-aaaa-aaaa",
//        vulnerabilities: [
//          vuln("fast-uri", "< 3.1.6", "3.1.6"),
//          {
//            package: null,
//            vulnerable_version_range: null,
//            // first_patched_version absent
//          },
//        ],
//      }),
//    ]
//    ```
//
//    Run through the default `main` lock checker with vulnerable `fast-uri`, an existing lock-file issue, and an open alert that would otherwise be written.
//
//    Expected correct verdict: red with zero issue writes. The malformed vulnerability must not be silently skipped.
//
//    Current tests explicitly accept this shape at [lock-advisories.test.mjs](<checkout>/scripts/lib/lock-advisories.test.mjs:319).
//
//    Protects: design §4: every vulnerability is an object stating a package with string ecosystem/name, string vulnerable range, and present string-or-null patched version; “Every one throws; none skips an entry.”

test("Codex case 3: a malformed vulnerability beside the one that matches stops the run with zero issue writes", () => {
  const spawn = fakeSpawn({
    alerts: [alert({ ghsa: "GHSA-a" })],
    issues: [fastUriIssue()],
    advisoryAnswer: () => [
      ...CONTROL_ADVISORIES,
      advisory({
        ghsa: "GHSA-aaaa-aaaa-aaaa",
        vulnerabilities: [
          vuln("fast-uri", "< 3.1.6", "3.1.6"),
          {
            package: null,
            vulnerable_version_range: null,
            // first_patched_version absent
          },
        ],
      }),
    ],
  });
  assert.throws(
    () => inTempRepo(VULNERABLE, () => quietly(() => sweep(spawn))),
    /the lock file check could not be completed \(query 1 of 1: the advisory listing held GHSA-aaaa-aaaa-aaaa with a vulnerability that does not state its package, its vulnerable range and its patched version\) — no issue was filed, commented on or cleared this run/,
  );
  assert.equal(issueWrites(spawn).length, 0);
  assert.equal(listedIssues(spawn), false);
});

// ---------------------------------------------------------------------------
// Codex case 4
// ---------------------------------------------------------------------------
// 4. **A string severity outside the helper’s private enum must not create a false read failure.**
//
//    Exact input: a valid applicable advisory with:
//
//    ```js
//    severity: "moderate"
//    ```
//
//    and otherwise ordinary fields, valid controls, and vulnerable `fast-uri@3.1.5`.
//
//    Expected correct verdict: one `bun.lock` issue whose highest severity and advisory row say `moderate`; the run is green.
//
//    Current behavior rejects it because `checkAnswer` restricts severity to `["unknown", "low", "medium", "high", "critical"]`, although the governing requirement requires a string and the existing sweep already ranks `moderate`.
//
//    Protects: design §4’s “severity and summary are strings” and §6’s rule that fields which decide nothing remain escaped data. This catches a false fail.

test("Codex case 4: the severity 'moderate' files one bun.lock issue that says moderate, and the run is green", () => {
  const spawn = fakeSpawn({
    advisoryAnswer: () => [
      ...CONTROL_ADVISORIES,
      advisory({ ghsa: A, severity: "moderate" }),
    ],
  });
  // Green: the run returns, and does not throw.
  inTempRepo(VULNERABLE, () => quietly(() => sweep(spawn)));

  const writes = issueWrites(spawn);
  assert.deepEqual(
    writes.map((c) => c.args[1]),
    ["create"],
  );
  const body = bodyOf(writes[0]);
  assert.equal(parseMarker(body).manifestPath, "bun.lock");
  const lines = body.split("\n");
  assert.ok(lines.includes("| Highest severity | moderate |"));
  assert.ok(
    lines.includes(
      `| [${A}](https://github.com/advisories/${A}) | — | moderate | >= 3.0.0, < 3.1.6 | fast-uri is bad |`,
    ),
    "the advisory's row says moderate",
  );
});

// ---------------------------------------------------------------------------
// Codex case 5
// ---------------------------------------------------------------------------
// 5. **A syntactically unusual but string-valued CVE must remain data rather than fail the read.**
//
//    Exact input: a valid applicable advisory with:
//
//    ```js
//    cve_id: "CVE-2026-1"
//    ```
//
//    valid controls, and vulnerable `fast-uri@3.1.5`.
//
//    Expected correct verdict: one issue containing the escaped CVE text; no extra command, path, URL, or marker interpretation.
//
//    Current behavior rejects it through `CVE_RE`, while the governing requirement permits any string or `null` and CVE text does not decide matching, identity, paths, or commands.
//
//    Protects: design §4’s “`cve_id` is a string or `null`” and §6’s “fields that decide nothing are data.”

test("Codex case 5: an unusual CVE string stays text in one issue, and nothing else is made of it", () => {
  const spawn = fakeSpawn({
    advisoryAnswer: () => [
      ...CONTROL_ADVISORIES,
      advisory({ ghsa: A, cve: "CVE-2026-1" }),
    ],
  });
  inTempRepo(VULNERABLE, () => quietly(() => sweep(spawn)));

  // Every call the run made: five reads, by their constant paths, and one
  // write. The CVE text is in none of them but the body.
  assert.deepEqual(
    spawn.calls.map((c) => {
      if (c.args[0] === "issue") return `issue ${c.args[1]}`;
      return c.args.at(-1).replace(/&affects=.*$/, "&affects=…");
    }),
    [
      "repos/o/r/automated-security-fixes",
      "repos/o/r/dependabot/alerts?state=open&per_page=100",
      "repos/o/r/dependabot/alerts?state=dismissed,auto_dismissed&per_page=100",
      "advisories?ecosystem=npm&type=reviewed&per_page=100&affects=…",
      "repos/o/r/issues?state=open&labels=dependabot&per_page=100",
      "issue create",
    ],
  );
  const [create] = issueWrites(spawn);
  for (const [i, arg] of create.args.entries()) {
    if (create.args[i - 1] === "--body") continue;
    assert.ok(!arg.includes("CVE-2026-1"), `the CVE text is in argument ${i}`);
  }
  const body = bodyOf(create);
  assert.deepEqual(parseMarker(body), {
    package: "fast-uri",
    manifestPath: "bun.lock",
    fixedIn: "3.1.6",
    ghsas: [A],
  });
  assert.ok(
    body
      .split("\n")
      .includes(
        `| [${A}](https://github.com/advisories/${A}) | CVE-2026-1 | high | >= 3.0.0, < 3.1.6 | fast-uri is bad |`,
      ),
    "the CVE text is one cell of the advisory's row, linked to nothing",
  );
});
