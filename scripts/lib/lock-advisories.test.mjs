// Tests for scripts/lib/lock-advisories.mjs, the lock file check of the daily
// alert sweep: the pure halves directly, and `readLockAdvisories` through an
// injected `spawnSync`, so no `gh` process is started and nothing leaves the
// machine.
//
// Written in this repo, with the module. Design:
// docs/DESIGN-nor-695-lockfile-advisories.md, sections 4 and 11; its evidence
// row E5 (every failed read throws) is the table of cases under "checkAnswer
// refuses" and the `readLockAdvisories` cases below. The cases that run the
// whole sweep with this check in it are in scripts/dependabot-alerts.test.mjs,
// under "The lock file check". Run via `npm run test:scripts`, which names
// this file by path.
//
// The advisories in the fixtures are shaped like real `GET /advisories`
// entries, cut down to the fields the module reads. The two control
// advisories are as the endpoint returned them on 2026-11-22.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONTROLS,
  LOCK_MANIFEST,
  MAX_AFFECTS_CHARS,
  MAX_PAIRS_PER_QUERY,
  advisoryPath,
  advisoryQueries,
  checkAnswer,
  controlStates,
  lockRecords,
  lockedVersions,
  readLockAdvisories,
  semverRange,
} from "./lock-advisories.mjs";

/** One vulnerability of an advisory, as the endpoint states it. */
const vuln = (name, range, fixed, ecosystem = "npm") => ({
  package: { ecosystem, name },
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
    vulnerabilities: vulnerabilities ?? [vuln(pkg, range, fixed)],
  };
}

const MINIMIST = advisory({
  ghsa: "GHSA-xvch-5gv4-984h",
  pkg: "minimist",
  severity: "critical",
  cve: "CVE-2021-44906",
  vulnerabilities: [
    vuln("minimist", ">= 1.0.0, < 1.2.6", "1.2.6"),
    vuln("minimist", "< 0.2.4", "0.2.4"),
  ],
});
const LODASH = advisory({
  ghsa: "GHSA-35jh-r3h4-6jhm",
  pkg: "lodash",
  cve: "CVE-2021-23337",
  range: "< 4.17.21",
  fixed: "4.17.21",
});
/** Both control advisories, good. */
const CONTROL_ADVISORIES = [MINIMIST, LODASH];

const CONTROL_PAIRS = CONTROLS.map(({ name, version }) => ({ name, version }));
const FAST_URI = { name: "fast-uri", version: "3.1.5" };
/** What one query for `fast-uri@3.1.5` asks about. */
const ASKED = [...CONTROL_PAIRS, FAST_URI];

const A = "GHSA-aaaa-aaaa-aaaa";
const B = "GHSA-bbbb-bbbb-bbbb";

/**
 * A `spawnSync` stand-in for the advisory listing: it throws on any program
 * but `gh` and on any call that is not `gh api --paginate --slurp
 * advisories?…`, records every call, and answers each query with
 * `answer(path, index)`: a list (one page), or a raw result.
 */
function fakeGh(answer = () => CONTROL_ADVISORIES) {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (cmd !== "gh") throw new Error(`unexpected program: ${cmd}`);
    if (
      args.length !== 4 ||
      args[0] !== "api" ||
      args[1] !== "--paginate" ||
      args[2] !== "--slurp" ||
      !args[3].startsWith("advisories?")
    ) {
      throw new Error(`unexpected gh call: ${args.join(" ")}`);
    }
    const result = answer(args[3], calls.length - 1);
    return Array.isArray(result)
      ? { status: 0, stdout: JSON.stringify([result]), stderr: "" }
      : { stdout: "", stderr: "", ...result };
  };
  spawn.calls = calls;
  return spawn;
}

/** The pairs a query path asks about, read back out of its one parameter. */
const pairsOf = (path) =>
  new URLSearchParams(path.slice(path.indexOf("?") + 1))
    .get("affects")
    .split(",");

// ---------------------------------------------------------------------------
// lockedVersions
// ---------------------------------------------------------------------------

test("lockedVersions lists each package's distinct versions, both sorted", () => {
  const versionsOf = lockedVersions([
    { name: "minimatch", version: "11.0.8" },
    { name: "@hono/node-server", version: "2.1.6" },
    { name: "minimatch", version: "10.2.6" },
    { name: "minimatch", version: "11.0.8" },
  ]);
  assert.deepEqual(
    [...versionsOf],
    [
      ["@hono/node-server", ["2.1.6"]],
      ["minimatch", ["10.2.6", "11.0.8"]],
    ],
  );
});

test("lockedVersions takes a prerelease and a build suffix as versions", () => {
  const versionsOf = lockedVersions([
    { name: "a", version: "1.0.0-rc.1" },
    { name: "b", version: "1.0.0+build.5" },
  ]);
  assert.deepEqual(versionsOf.get("a"), ["1.0.0-rc.1"]);
  assert.deepEqual(versionsOf.get("b"), ["1.0.0+build.5"]);
});

for (const name of [
  "",
  "Has-Capital",
  "has space",
  "a,b",
  "a&affects=b",
  "a=b",
  "-leading-dash",
  "{owner}",
  "@scope",
  "@scope/",
  "@/name",
  "a/b",
  "../etc/passwd",
  "x".repeat(215),
  null,
  42,
]) {
  test(`lockedVersions stops on a name it cannot ask about: ${JSON.stringify(name)?.slice(0, 40)}`, () => {
    assert.throws(
      () => lockedVersions([{ name, version: "1.0.0" }]),
      /not an npm package name this check can ask about/,
    );
  });
}

for (const version of [
  "",
  "v1.2.3",
  "=1.2.3",
  " 1.2.3",
  "1.2",
  // The form of a version, and not one: semver allows no leading zero.
  "01.2.3",
  "^1.2.3",
  "1.2.3 || 2.0.0",
  "github:owner/repo#abc1234",
  "file:../local",
  "workspace:*",
  "1.2.3,4.5.6",
  `1.0.0-${"a".repeat(260)}`,
  null,
  1,
]) {
  test(`lockedVersions stops on a version that is not a registry version: ${JSON.stringify(version)?.slice(0, 40)}`, () => {
    assert.throws(
      () => lockedVersions([{ name: "fast-uri", version }]),
      /not a registry version this check can ask about/,
    );
  });
}

// ---------------------------------------------------------------------------
// advisoryPath and advisoryQueries
// ---------------------------------------------------------------------------

test("advisoryPath builds ONE affects parameter for two pairs, comma-joined and percent-encoded", () => {
  // The design note, section 11, correction 1. Repeating the parameter is not
  // the same request: the endpoint keeps only the last one (measured), so the
  // other pairs would never be asked about and the answer would look clean.
  const path = advisoryPath([
    { name: "minimist", version: "0.0.8" },
    { name: "@hono/node-server", version: "2.1.5" },
  ]);
  assert.equal(path.split("affects=").length - 1, 1, "exactly one affects=");
  assert.equal(
    path,
    "advisories?ecosystem=npm&type=reviewed&per_page=100&affects=minimist%400.0.8%2C%40hono%2Fnode-server%402.1.5",
  );
  // Read back the way a server reads a query string: one value, both pairs.
  const params = new URLSearchParams(path.slice(path.indexOf("?") + 1));
  assert.deepEqual(params.getAll("affects"), [
    "minimist@0.0.8,@hono/node-server@2.1.5",
  ]);
});

test("advisoryPath starts with a constant, so nothing in it can be read as an option", () => {
  assert.ok(
    advisoryPath([{ name: "a", version: "1.0.0" }]).startsWith(
      "advisories?ecosystem=npm&type=reviewed&",
    ),
  );
});

test("advisoryQueries still asks about the controls when the lock file holds nothing", () => {
  const queries = advisoryQueries(new Map());
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].asked, CONTROL_PAIRS);
  assert.deepEqual(pairsOf(queries[0].path), [
    "minimist@0.0.8",
    "lodash@4.17.20",
  ]);
});

test("advisoryQueries splits by count, and every query carries both controls and one affects parameter", () => {
  const entries = Array.from({ length: 250 }, (_, i) => ({
    name: `pkg-${String(i).padStart(3, "0")}`,
    version: "1.0.0",
  }));
  const queries = advisoryQueries(lockedVersions(entries));
  assert.deepEqual(
    queries.map((q) => q.asked.length),
    [102, 102, 52],
  );
  const asked = [];
  for (const query of queries) {
    assert.equal(query.path.split("affects=").length - 1, 1);
    const pairs = pairsOf(query.path);
    assert.deepEqual(pairs.slice(0, 2), ["minimist@0.0.8", "lodash@4.17.20"]);
    assert.ok(pairs.length - 2 <= MAX_PAIRS_PER_QUERY);
    assert.deepEqual(
      pairs,
      query.asked.map((p) => `${p.name}@${p.version}`),
      "`asked` is what the path asks",
    );
    asked.push(...pairs.slice(2));
  }
  assert.deepEqual(
    asked,
    entries.map((e) => `${e.name}@${e.version}`),
    "every pair is asked about, once",
  );
});

test("advisoryQueries splits by length before a value outgrows the budget", () => {
  const entries = Array.from({ length: 60 }, (_, i) => ({
    name: `@a-long-scope-name-for-the-budget/${"n".repeat(150)}-${i}`,
    version: "10.20.30",
  }));
  const queries = advisoryQueries(lockedVersions(entries));
  assert.ok(queries.length > 1, "60 long pairs do not fit one query");
  const prefix = advisoryPath([]).length;
  let total = 0;
  for (const query of queries) {
    assert.ok(
      query.path.length - prefix <= MAX_AFFECTS_CHARS,
      `an affects value of ${query.path.length - prefix} characters`,
    );
    assert.ok(query.asked.length <= MAX_PAIRS_PER_QUERY + 2);
    total += query.asked.length - 2;
  }
  assert.equal(total, 60);
});

// ---------------------------------------------------------------------------
// checkAnswer
// ---------------------------------------------------------------------------

test("checkAnswer takes an answer of real shape and returns it", () => {
  const list = [
    ...CONTROL_ADVISORIES,
    advisory({ ghsa: A, cve: "CVE-2026-12345" }),
  ];
  assert.equal(checkAnswer(list, ASKED), list);
});

test("checkAnswer takes an empty answer: whether that means 'nothing found' is the controls' question", () => {
  assert.deepEqual(checkAnswer([], ASKED), []);
});

test("checkAnswer reads past a vulnerability that is not asked about, whatever it holds", () => {
  const list = [
    advisory({
      ghsa: A,
      vulnerabilities: [
        vuln("fast-uri", "< 3.1.6", "3.1.6"),
        // The endpoint's schema allows a null package and a null name.
        { package: null, vulnerable_version_range: null },
        { package: { ecosystem: "npm", name: null } },
        // Another ecosystem's ranges are not semver, and are not read.
        vuln("fast-uri", "[1.0,2.0)", "2.0", "maven"),
        // Another package's, which this query did not ask about.
        vuln("something-else", "not a range", "nor a version"),
      ],
    }),
  ];
  assert.equal(checkAnswer(list, ASKED), list);
});

test("checkAnswer takes a withdrawn advisory whose range no asked version is in", () => {
  const list = [
    advisory({ ghsa: A, range: "< 1.0.0", withdrawn: "2026-11-18T15:38:56Z" }),
  ];
  assert.equal(checkAnswer(list, ASKED), list);
});

const REFUSED = [
  ["an entry that is not an object", ["GHSA-aaaa-aaaa-aaaa"], /not an object/],
  ["a null entry", [null], /not an object/],
  ["a list for an entry", [[]], /not an object/],
  [
    "an entry with no advisory id",
    [{ ...advisory({ ghsa: A }), ghsa_id: undefined }],
    /no usable advisory id/,
  ],
  [
    "an advisory id of another form",
    [advisory({ ghsa: "GHSA-a" })],
    /no usable advisory id/,
  ],
  [
    "an advisory id that would break a marker",
    [advisory({ ghsa: "GHSA-aaaa-aaaa-aaaa; fixed=9.9.9" })],
    /no usable advisory id/,
  ],
  [
    "the same advisory twice in one answer",
    [advisory({ ghsa: A }), advisory({ ghsa: A, fixed: "9.9.9" })],
    /twice in one answer/,
  ],
  [
    "an advisory of a type that was not asked for",
    [advisory({ ghsa: A, type: "unreviewed" })],
    /a type other than "reviewed"/,
  ],
  [
    "an entry with no type",
    [{ ...advisory({ ghsa: A }), type: undefined }],
    /a type other than "reviewed"/,
  ],
  [
    "an entry that leaves out withdrawn_at",
    [(({ withdrawn_at: _gone, ...rest }) => rest)(advisory({ ghsa: A }))],
    /without a withdrawn_at/,
  ],
  [
    "a withdrawn_at that is neither a date nor null",
    [advisory({ ghsa: A, withdrawn: false })],
    /without a withdrawn_at/,
  ],
  [
    "a severity the endpoint does not document",
    [advisory({ ghsa: A, severity: "high | injected | cell" })],
    /severity, summary or CVE id/,
  ],
  [
    "a summary that is not text",
    [{ ...advisory({ ghsa: A }), summary: null }],
    /severity, summary or CVE id/,
  ],
  [
    "a CVE id of another form",
    [advisory({ ghsa: A, cve: "CVE-2026-1 | x" })],
    /severity, summary or CVE id/,
  ],
  [
    "an entry with no vulnerabilities field",
    [{ ...advisory({ ghsa: A }), vulnerabilities: undefined }],
    /no list of vulnerabilities/,
  ],
  [
    "an empty list of vulnerabilities",
    [advisory({ ghsa: A, vulnerabilities: [] })],
    /no list of vulnerabilities/,
  ],
  [
    "a vulnerability that is not an object",
    [advisory({ ghsa: A, vulnerabilities: ["fast-uri"] })],
    /a vulnerability that is not an object/,
  ],
  [
    "a vulnerability with no package field",
    [
      advisory({
        ghsa: A,
        vulnerabilities: [{ vulnerable_version_range: "*" }],
      }),
    ],
    /does not state its package/,
  ],
  [
    "a package that states no ecosystem",
    [
      advisory({
        ghsa: A,
        vulnerabilities: [{ package: { name: "fast-uri" } }],
      }),
    ],
    /does not state its package/,
  ],
  [
    "a package whose name is not text",
    [
      advisory({
        ghsa: A,
        vulnerabilities: [
          { package: { ecosystem: "npm", name: ["fast-uri"] } },
        ],
      }),
    ],
    /does not state its package/,
  ],
  [
    "a range semver cannot read, on a package asked about",
    [advisory({ ghsa: A, range: "definitely not a range" })],
    /not semver/,
  ],
  [
    "a range that is only separators, which semver would read as every version",
    [advisory({ ghsa: A, range: " , " })],
    /not semver/,
  ],
  [
    "a range that is not text",
    [advisory({ ghsa: A, range: null })],
    /not semver/,
  ],
  [
    "a vulnerability that leaves out first_patched_version",
    [
      advisory({
        ghsa: A,
        vulnerabilities: [
          {
            package: { ecosystem: "npm", name: "fast-uri" },
            vulnerable_version_range: "< 3.1.6",
          },
        ],
      }),
    ],
    /not semver/,
  ],
  [
    "a patched version that is not a version",
    [advisory({ ghsa: A, fixed: "3.1.6 -->" })],
    /not semver/,
  ],
  [
    "a patched version in the alert listing's shape, not this one's",
    [advisory({ ghsa: A, fixed: { identifier: "3.1.6" } })],
    /not semver/,
  ],
  [
    "an advisory that names no package this query asked about",
    [advisory({ ghsa: A, pkg: "some-other-package" })],
    /names no package this query asked about/,
  ],
  [
    "an advisory whose only asked-about package is another ecosystem's",
    [
      advisory({
        ghsa: A,
        vulnerabilities: [vuln("fast-uri", "< 3.1.6", "3.1.6", "pip")],
      }),
    ],
    /names no package this query asked about/,
  ],
  [
    "a live advisory returned although no asked version is in its range",
    [advisory({ ghsa: A, range: "< 3.0.0", fixed: "3.0.0" })],
    /no version asked about is in its range as semver reads it/,
  ],
];

for (const [what, list, message] of REFUSED) {
  test(`checkAnswer refuses ${what}`, () => {
    assert.throws(() => checkAnswer(list, ASKED), message);
  });
}

test("checkAnswer refuses the disagreement a prerelease version makes, and does not call it 'not exposed'", () => {
  // The listing counts 3.1.6-beta.1 as below 3.1.6; `semver.satisfies` does
  // not match a prerelease against a range that names none. A record would
  // never be made for it, so the disagreement has to stop the run.
  assert.throws(
    () =>
      checkAnswer(
        [advisory({ ghsa: A, range: "< 3.1.6" })],
        [...CONTROL_PAIRS, { name: "fast-uri", version: "3.1.6-beta.1" }],
      ),
    /no version asked about is in its range as semver reads it/,
  );
});

// ---------------------------------------------------------------------------
// controlStates
// ---------------------------------------------------------------------------

const states = (answer) =>
  Object.fromEntries(
    controlStates(answer).map(({ control, state }) => [control.name, state]),
  );

test("the controls are two known-positive pairs on two unrelated packages", () => {
  assert.deepEqual(
    CONTROLS.map((c) => [c.name, c.version, c.ghsa]),
    [
      ["minimist", "0.0.8", "GHSA-xvch-5gv4-984h"],
      ["lodash", "4.17.20", "GHSA-35jh-r3h4-6jhm"],
    ],
  );
});

test("controlStates: good when the advisory is there, live, and covers the control version", () => {
  assert.deepEqual(states(CONTROL_ADVISORIES), {
    minimist: "good",
    lodash: "good",
  });
});

test("controlStates: absent when the advisory is not in the answer at all", () => {
  assert.deepEqual(states([LODASH]), { minimist: "absent", lodash: "good" });
  assert.deepEqual(states([]), { minimist: "absent", lodash: "absent" });
});

test("controlStates: stale when the advisory is withdrawn", () => {
  assert.deepEqual(
    states([MINIMIST, { ...LODASH, withdrawn_at: "2027-01-01T00:00:00Z" }]),
    { minimist: "good", lodash: "stale" },
  );
});

test("controlStates: stale when the advisory no longer covers the control version", () => {
  const narrowed = {
    ...MINIMIST,
    vulnerabilities: [vuln("minimist", ">= 1.0.0, < 1.2.6", "1.2.6")],
  };
  assert.deepEqual(states([narrowed, LODASH]), {
    minimist: "stale",
    lodash: "good",
  });
});

// ---------------------------------------------------------------------------
// lockRecords
// ---------------------------------------------------------------------------

test("lockRecords makes one alert-shaped record per range a locked version is in", () => {
  const versionsOf = lockedVersions([
    { name: "fast-uri", version: "3.1.5" },
    { name: "fast-uri", version: "2.4.0" },
  ]);
  const records = lockRecords(
    [
      advisory({
        ghsa: A,
        cve: "CVE-2026-12345",
        severity: "medium",
        vulnerabilities: [
          vuln("fast-uri", ">= 3.0.0, < 3.1.6", "3.1.6"),
          // No locked version is in this one: no record for it.
          vuln("fast-uri", "< 1.0.0", "1.0.0"),
          vuln("fast-uri", ">= 2.0.0, < 2.4.1", "2.4.1"),
        ],
      }),
    ],
    versionsOf,
  );
  assert.deepEqual(records, [
    {
      state: "open",
      html_url: `https://github.com/advisories/${A}`,
      dependency: {
        package: { ecosystem: "npm", name: "fast-uri" },
        manifest_path: "bun.lock",
        scope: "not determined",
      },
      security_advisory: {
        ghsa_id: A,
        cve_id: "CVE-2026-12345",
        severity: "medium",
        summary: "fast-uri is bad",
      },
      security_vulnerability: {
        vulnerable_version_range: ">= 3.0.0, < 3.1.6",
        first_patched_version: { identifier: "3.1.6" },
      },
    },
    {
      state: "open",
      html_url: `https://github.com/advisories/${A}`,
      dependency: {
        package: { ecosystem: "npm", name: "fast-uri" },
        manifest_path: "bun.lock",
        scope: "not determined",
      },
      security_advisory: {
        ghsa_id: A,
        cve_id: "CVE-2026-12345",
        severity: "medium",
        summary: "fast-uri is bad",
      },
      security_vulnerability: {
        vulnerable_version_range: ">= 2.0.0, < 2.4.1",
        first_patched_version: { identifier: "2.4.1" },
      },
    },
  ]);
  assert.equal(LOCK_MANIFEST, "bun.lock");
});

test("lockRecords takes no URL from the answer", () => {
  const [record] = lockRecords(
    [
      {
        ...advisory({ ghsa: A }),
        html_url: "https://example.invalid/) [click](https://example.invalid",
      },
    ],
    lockedVersions([FAST_URI]),
  );
  assert.equal(record.html_url, `https://github.com/advisories/${A}`);
});

test("lockRecords makes nothing of a withdrawn advisory", () => {
  assert.deepEqual(
    lockRecords(
      [advisory({ ghsa: A, withdrawn: "2026-11-18T15:38:56Z" })],
      lockedVersions([FAST_URI]),
    ),
    [],
  );
});

test("lockRecords makes nothing of a control advisory unless the lock file holds that package in range", () => {
  assert.deepEqual(
    lockRecords(CONTROL_ADVISORIES, lockedVersions([FAST_URI])),
    [],
  );
  const records = lockRecords(
    CONTROL_ADVISORIES,
    lockedVersions([
      { name: "lodash", version: "4.17.20" },
      { name: "minimist", version: "1.2.8" },
    ]),
  );
  assert.deepEqual(
    records.map((r) => [
      r.dependency.package.name,
      r.security_advisory.ghsa_id,
    ]),
    [["lodash", "GHSA-35jh-r3h4-6jhm"]],
  );
});

test("lockRecords keeps an advisory with no patched version, as null", () => {
  const [record] = lockRecords(
    [advisory({ ghsa: A, fixed: null })],
    lockedVersions([FAST_URI]),
  );
  assert.equal(record.security_vulnerability.first_patched_version, null);
});

test("lockRecords stops on the same advisory, package and range twice", () => {
  assert.throws(
    () =>
      lockRecords(
        [
          advisory({
            ghsa: A,
            vulnerabilities: [
              vuln("fast-uri", "< 3.1.6", "3.1.6"),
              vuln("fast-uri", "< 3.1.6", "9.9.9"),
            ],
          }),
        ],
        lockedVersions([FAST_URI]),
      ),
    /the same range for fast-uri twice/,
  );
});

test("lockRecords checks the range of a locked package that the answer's own query did not ask about", () => {
  // An advisory returned for one query can name a package of another query.
  // `checkAnswer` never read that range, so it is read here, and one semver
  // cannot read stops the run rather than counting as "not in range".
  assert.throws(
    () =>
      lockRecords(
        [
          advisory({
            ghsa: A,
            vulnerabilities: [
              vuln("fast-uri", "< 3.1.6", "3.1.6"),
              vuln("zod", "not a range", "4.0.0"),
            ],
          }),
        ],
        lockedVersions([FAST_URI, { name: "zod", version: "3.25.0" }]),
      ),
    /GHSA-aaaa-aaaa-aaaa on zod with a vulnerable range or a patched version that is not semver/,
  );
});

// ---------------------------------------------------------------------------
// readLockAdvisories
// ---------------------------------------------------------------------------

test("readLockAdvisories asks through gh's argument array and returns the records that apply", () => {
  const spawn = fakeGh(() => [...CONTROL_ADVISORIES, advisory({ ghsa: A })]);
  const result = readLockAdvisories(spawn, [FAST_URI]);
  assert.equal(spawn.calls.length, 1);
  assert.deepEqual(spawn.calls[0].args.slice(0, 3), [
    "api",
    "--paginate",
    "--slurp",
  ]);
  assert.deepEqual(pairsOf(spawn.calls[0].args[3]), [
    "minimist@0.0.8",
    "lodash@4.17.20",
    "fast-uri@3.1.5",
  ]);
  assert.deepEqual(
    result.records.map((r) => r.security_advisory.ghsa_id),
    [A],
  );
  assert.deepEqual(result.staleControls, []);
});

test("readLockAdvisories reads every query, and takes an advisory two answers hold once", () => {
  const entries = Array.from({ length: 150 }, (_, i) => ({
    name: `pkg-${String(i).padStart(3, "0")}`,
    version: "1.0.0",
  }));
  // One advisory on a package of each query, and one that names both.
  const both = advisory({
    ghsa: B,
    vulnerabilities: [
      vuln("pkg-000", "< 2.0.0", "2.0.0"),
      vuln("pkg-149", "< 2.0.0", "2.0.0"),
    ],
  });
  const spawn = fakeGh((_path, index) => [
    ...CONTROL_ADVISORIES,
    both,
    advisory({
      ghsa: index === 0 ? A : "GHSA-cccc-cccc-cccc",
      pkg: index === 0 ? "pkg-001" : "pkg-148",
      range: "< 1.0.1",
      fixed: "1.0.1",
    }),
  ]);
  const result = readLockAdvisories(spawn, entries);
  assert.equal(spawn.calls.length, 2);
  assert.deepEqual(
    result.records
      .map((r) => `${r.security_advisory.ghsa_id} ${r.dependency.package.name}`)
      .sort(),
    [
      `${A} pkg-001`,
      `${B} pkg-000`,
      `${B} pkg-149`,
      "GHSA-cccc-cccc-cccc pkg-148",
    ],
  );
});

test("readLockAdvisories: a clean lock file is two good controls and no record", () => {
  const result = readLockAdvisories(fakeGh(), [FAST_URI]);
  assert.deepEqual(result, { records: [], staleControls: [] });
});

test("readLockAdvisories: an EMPTY answer is a failed read, not 'nothing found'", () => {
  // What a query that silently asked about nothing looks like: one empty
  // page, exit 0, exactly as for a name that does not exist (measured).
  assert.throws(
    () =>
      readLockAdvisories(
        fakeGh(() => []),
        [FAST_URI],
      ),
    /query 1 of 1: the answer does not hold the control advisories for minimist@0\.0\.8 \(GHSA-xvch-5gv4-984h\) and lodash@4\.17\.20 \(GHSA-35jh-r3h4-6jhm\), so it cannot be read as "nothing found"/,
  );
});

test("readLockAdvisories: ONE control absent is a failed read, even beside a good one", () => {
  // What a repeated `affects` parameter does to an answer: only the last
  // pair's advisories come back.
  assert.throws(
    () =>
      readLockAdvisories(
        fakeGh(() => [LODASH]),
        [FAST_URI],
      ),
    /the answer does not hold the control advisory for minimist@0\.0\.8 \(GHSA-xvch-5gv4-984h\)/,
  );
});

test("readLockAdvisories: a control absent from a LATER query's answer is a failed read too", () => {
  const entries = Array.from({ length: 150 }, (_, i) => ({
    name: `pkg-${i}`,
    version: "1.0.0",
  }));
  assert.throws(
    () =>
      readLockAdvisories(
        fakeGh((_path, index) => (index === 0 ? CONTROL_ADVISORIES : [])),
        entries,
      ),
    /query 2 of 2: the answer does not hold the control advisories/,
  );
});

test("readLockAdvisories: one control withdrawn leaves the read standing and names it", () => {
  const withdrawn = { ...MINIMIST, withdrawn_at: "2027-01-01T00:00:00Z" };
  const result = readLockAdvisories(
    fakeGh(() => [withdrawn, LODASH, advisory({ ghsa: A })]),
    [FAST_URI],
  );
  assert.deepEqual(
    result.records.map((r) => r.security_advisory.ghsa_id),
    [A],
    "the other control vouched for the answer, so its record stands",
  );
  assert.deepEqual(result.staleControls, [
    "minimist@0.0.8 (GHSA-xvch-5gv4-984h)",
  ]);
});

test("readLockAdvisories: both controls withdrawn is a failed read", () => {
  assert.throws(
    () =>
      readLockAdvisories(
        fakeGh(() => [
          { ...MINIMIST, withdrawn_at: "2027-01-01T00:00:00Z" },
          { ...LODASH, withdrawn_at: "2027-01-02T00:00:00Z" },
        ]),
        [FAST_URI],
      ),
    /every control advisory is withdrawn or no longer covers its control version .* so nothing vouches for the answer/,
  );
});

for (const [what, result, message] of [
  [
    "gh exits non-zero",
    { status: 1, stdout: "[]", stderr: "connection refused" },
    /failed \(1\): connection refused/,
  ],
  [
    "a rate limit",
    { status: 1, stderr: "gh: API rate limit exceeded (HTTP 403)" },
    /rate limit exceeded/,
  ],
  [
    "a URL too long",
    {
      status: 1,
      stderr: "gh: We received a Request-URL that is too long (HTTP 414)",
    },
    /HTTP 414/,
  ],
  ["no pages at all", { status: 0, stdout: "[]" }, /no pages/],
  ["an empty body", { status: 0, stdout: "" }, /JSON/],
  ["output that is not JSON", { status: 0, stdout: "<html>" }, /JSON/],
  ["JSON cut short", { status: 0, stdout: '[[{"ghsa_id":"GHSA-xvch' }, /JSON/],
  ["an object where pages belong", { status: 0, stdout: "{}" }, /non-list/],
  [
    "a page that is not a list",
    { status: 0, stdout: '[{"message":"Not Found"}]' },
    /non-list/,
  ],
  [
    "a misshapen entry",
    { status: 0, stdout: JSON.stringify([[...CONTROL_ADVISORIES, "x"]]) },
    /query 1 of 1: the advisory listing held an entry that is not an object/,
  ],
]) {
  test(`readLockAdvisories throws on ${what}`, () => {
    assert.throws(
      () =>
        readLockAdvisories(
          fakeGh(() => result),
          [FAST_URI],
        ),
      message,
    );
  });
}

test("readLockAdvisories starts no process when a lock entry cannot be asked about", () => {
  const spawn = fakeGh();
  assert.throws(
    () =>
      readLockAdvisories(spawn, [
        FAST_URI,
        { name: "local-thing", version: "file:../local-thing" },
      ]),
    /not a registry version/,
  );
  assert.equal(spawn.calls.length, 0);
});

// ---------------------------------------------------------------------------
// semverRange
// ---------------------------------------------------------------------------

test("semverRange turns GitHub's comma-separated conjuncts into semver ANDs", () => {
  assert.equal(semverRange(">= 3.1.3, < 3.1.6"), ">= 3.1.3 < 3.1.6");
  assert.equal(semverRange("  < 0.2.4 ,"), "< 0.2.4");
  assert.equal(semverRange(" , "), "");
});
