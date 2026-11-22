// In this repo: the MCP Inspector's test file (modelcontextprotocol/inspector
// at commit 7df76f6eea9ea425891289333837878ebb31ae6a,
// scripts/dependency-refresh.test.mjs, blob
// b014cc13ded0d1adacf2c6fc981bcbbabf3cd47c), by copy then edit: the unchanged
// file is this file's first commit here. Its "#NNNN" numbers and "(Copilot)"
// notes are the source's. Edits, following the script's own (its header lists
// them):
//
//   - the cases for the Docker half and for the milestone lookup are removed
//     with the code they tested, and the fake `spawn` no longer answers `curl`
//     or a milestone call: either would now be an unexpected call and fail;
//   - the fake answers the labelled REST listing where the source's answered
//     `gh issue list`, and an existing issue in a fixture is the REST shape,
//     written by the automation and carrying the sweep's labels (`sweepIssue`);
//   - `INSTALLS` is the one root install, and the issue is filed with this
//     repository's three labels and no milestone;
//   - below the line "written here": the cases for addition A1 (a marker is
//     trusted only on what the automation wrote; the labelled listing), for
//     addition A3 (issue writes go through the paced writer), for a write that
//     fails, and for the issue text naming nothing of the source's.
//
// The review model's adversarial cases for this sweep are in
// `scripts/dependency-refresh-attack.test.mjs`. Record: PROVENANCE.md, "Sweeps".
//
// ---- the source's header, unchanged ----
// Tests for dependency-refresh.mjs (#2229) — both the pure parsing/formatting
// helpers and `main()`'s orchestration, the latter driven through the injected
// spawn function so no `npm`, `gh` or `curl` process is ever started — the
// Docker Hub digest lookup (#2885) included, so the suite needs no network.
//
// `main()` is covered rather than left to `workflow_dispatch` because a
// production trigger is not a test (Copilot): the helper-only suite this
// replaced passed while a non-zero `npm outdated` exit reported a clean sweep.
// Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildClearedBody,
  buildIssueBody,
  highestVersionTag,
  isActionStale,
  main,
  parseActionRefs,
  parseOutdated,
  parseVersionRef,
  staleActions,
  INSTALLS,
  ISSUE_LABELS,
  ISSUE_MARKER,
  PLACEMENT_DOC,
  SWEEP_LABELS,
} from "./dependency-refresh.mjs";
import { pacedWrites } from "./lib/paced-writes.mjs";

/**
 * An open issue as the REST issues endpoint returns one that this sweep filed:
 * written by the automation, carrying the labels the sweep applies.
 *
 * @param {number} number
 * @param {string | null} body
 * @param {object} [overrides] fields to replace, e.g. `user` or `labels`
 */
function sweepIssue(number, body, overrides = {}) {
  return {
    number,
    body,
    user: { login: "github-actions[bot]", type: "Bot" },
    labels: ISSUE_LABELS.map((name) => ({ name })),
    ...overrides,
  };
}

/**
 * A fake `spawnSync` that answers by command shape and records every call.
 * Anything it does not know — another program, another `gh` subcommand — is
 * an error, so a call this sweep is not meant to make fails the test.
 *
 * @param {object} opts
 * @param {Record<string,unknown>} [opts.outdated] parsed `npm outdated` payload, per install dir
 * @param {number} [opts.outdatedStatus] exit status for every `npm outdated`
 * @param {object[]} [opts.existing] the open `dependabot`-labelled issues, as one page
 * @param {unknown} [opts.listing] the whole slurped listing answer, in place of `[existing]`
 * @param {number} [opts.listingStatus] exit status of the listing call
 * @param {string[]} [opts.releaseTags] tags every action's release list returns
 * @param {number} [opts.releasesStatus] exit status for every release lookup
 * @param {string} [opts.releasesStderr] stderr for a failing release lookup
 * @param {number} [opts.createStatus] exit status of `gh issue create`
 * @param {string} [opts.createStderr] stderr of a failing `gh issue create`
 * @param {number} [opts.editStatus] exit status of `gh issue edit`
 */
function fakeSpawn({
  outdated = {},
  outdatedStatus,
  existing = [],
  listing,
  listingStatus,
  releaseTags = [],
  releasesStatus,
  releasesStderr = "",
  createStatus = 0,
  createStderr = "",
  editStatus = 0,
} = {}) {
  const calls = [];
  const fn = (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts?.cwd, input: opts?.input });
    if (cmd === "npm") {
      const payload = outdated[opts.cwd] ?? {};
      const found = Object.keys(payload).length > 0;
      return {
        // Real `npm outdated` exits 1 precisely when it found something.
        status: outdatedStatus ?? (found ? 1 : 0),
        stdout: found ? JSON.stringify(payload) : "",
        stderr: outdatedStatus ? "ENOTFOUND registry.npmjs.org" : "",
      };
    }
    if (cmd !== "gh") throw new Error(`unexpected program: ${cmd}`);
    // MUST be tested before the listing branch below: both are `gh api`, so
    // matching on args[0] alone hands the release lookup the issue listing
    // and the assertion silently checks nothing.
    if (args[0] === "api" && args.some((a) => a.includes("/releases")))
      return {
        status: releasesStatus ?? 0,
        stdout: releasesStatus ? "" : releaseTags.join("\n"),
        stderr: releasesStderr,
      };
    if (args[0] === "api" && args.some((a) => a.includes("/issues?")))
      return {
        status: listingStatus ?? 0,
        stdout: listingStatus ? "" : JSON.stringify(listing ?? [existing]),
        stderr: listingStatus ? "gh: Bad Gateway (HTTP 502)" : "",
      };
    if (args[0] === "issue" && args[1] === "create")
      return {
        status: createStatus,
        stdout: createStatus ? "" : "https://github.com/o/r/issues/9\n",
        stderr: createStderr,
      };
    if (args[0] === "issue" && args[1] === "edit")
      return {
        status: editStatus,
        stdout: "",
        stderr: editStatus ? "gh: Not Found (HTTP 404)" : "",
      };
    throw new Error(`unexpected spawn: ${cmd} ${args.join(" ")}`);
  };
  fn.calls = calls;
  return fn;
}

const ghCall = (spawn, verb) =>
  spawn.calls.find((c) => c.cmd === "gh" && c.args[1] === verb);

/** Silence main()'s progress logging; returns the captured lines. */
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

test("parseOutdated returns [] for empty npm-outdated output", () => {
  assert.deepEqual(parseOutdated(""), []);
  assert.deepEqual(parseOutdated("{}"), []);
});

test("parseOutdated normalizes and sorts entries by name", () => {
  const json = JSON.stringify({
    zod: { current: "3.0.0", wanted: "3.1.0", latest: "4.0.0" },
    ajv: { current: "8.0.0", wanted: "8.0.0", latest: "8.1.0" },
  });
  assert.deepEqual(parseOutdated(json), [
    { name: "ajv", current: "8.0.0", wanted: "8.0.0", latest: "8.1.0" },
    { name: "zod", current: "3.0.0", wanted: "3.1.0", latest: "4.0.0" },
  ]);
});

test("parseOutdated falls back when a field is missing", () => {
  const json = JSON.stringify({ pkg: { current: "1.0.0" } });
  assert.deepEqual(parseOutdated(json), [
    { name: "pkg", current: "1.0.0", wanted: "1.0.0", latest: "?" },
  ]);
});

test("parseActionRefs pulls owner/repo@ref out of a workflow, in file order", () => {
  const yaml = [
    "jobs:",
    "  build:",
    "    steps:",
    "      - uses: actions/checkout@v7",
    "      - name: Setup",
    "        uses: actions/setup-node@v7",
    '      - uses: "docker/login-action@v4"',
    "      - uses: docker/build-push-action@v7 # trailing comment",
  ].join("\n");
  assert.deepEqual(parseActionRefs(yaml), [
    { action: "actions/checkout", ref: "v7" },
    { action: "actions/setup-node", ref: "v7" },
    { action: "docker/login-action", ref: "v4" },
    { action: "docker/build-push-action", ref: "v7" },
  ]);
});

test("parseActionRefs skips local, container and unpinned steps", () => {
  const yaml = [
    "      - uses: ./.github/actions/local",
    "      - uses: docker://alpine:3.20",
    "      - uses: actions/checkout",
    "      - uses: github/codeql-action/init@v3",
  ].join("\n");
  assert.deepEqual(parseActionRefs(yaml), [
    { action: "github/codeql-action/init", ref: "v3" },
  ]);
});

test("parseActionRefs reads the version comment on a SHA pin, and only there", () => {
  const sha = "3d3c42e5aac5ba805825da76410c181273ba90b1";
  const yaml = [
    `      - uses: actions/checkout@${sha} # v7.0.1`,
    `      - uses: actions/setup-node@${sha}`,
    "      - uses: docker/login-action@v4 # v4.6.0",
    `      - uses: actions/cache@${sha} # not a version`,
  ].join("\n");
  assert.deepEqual(parseActionRefs(yaml), [
    { action: "actions/checkout", ref: sha, version: "v7.0.1" },
    // No comment: the pin is still found, just unrankable.
    { action: "actions/setup-node", ref: sha },
    // A tag ref already names its version; the comment is not consulted.
    { action: "docker/login-action", ref: "v4" },
    { action: "actions/cache", ref: sha },
  ]);
});

test("parseVersionRef reads a numeric ref and rejects anything else", () => {
  assert.deepEqual(parseVersionRef("v7"), [7]);
  assert.deepEqual(parseVersionRef("7.0.1"), [7, 0, 1]);
  assert.equal(parseVersionRef("main"), null);
  assert.equal(
    parseVersionRef("8f4b7f84864484a7bf31766abe9204da3cbe65b3"),
    null,
  );
});

test("isActionStale compares only to the precision the ref specifies", () => {
  // `v7` is a moving major tag, so a v7.x release does not make it stale.
  assert.equal(isActionStale("v7", "v7.0.1"), false);
  assert.equal(isActionStale("v7", "v8.0.0"), true);
  // An exactly-pinned ref is behind its own patch release.
  assert.equal(isActionStale("v7.0.0", "v7.0.1"), true);
  assert.equal(isActionStale("v7.1", "v7.0.9"), false);
});

test("isActionStale reports nothing for a ref it cannot rank", () => {
  // A SHA pin is deliberately immovable; a tag comparison says nothing about it.
  assert.equal(
    isActionStale("8f4b7f84864484a7bf31766abe9204da3cbe65b3", "v5"),
    false,
  );
  assert.equal(isActionStale("main", "v5"), false);
  assert.equal(isActionStale("v5", "not-a-tag"), false);
});

test("highestVersionTag picks the greatest version, not the newest entry", () => {
  // GitHub's `releases/latest` is the DESIGNATED latest, not the greatest
  // version: a maintenance release cut for an older major after a newer one
  // would make a workflow on v7 read as current (Copilot).
  assert.equal(highestVersionTag(["v6.9.1", "v8.0.0", "v7.2.0"]), "v8.0.0");
  assert.equal(highestVersionTag(["v7", "v7.0.1"]), "v7.0.1");
  assert.equal(highestVersionTag(["v10.0.0", "v9.9.9"]), "v10.0.0");
});

test("highestVersionTag ignores tags it cannot parse", () => {
  assert.equal(highestVersionTag(["nightly", "v2.0.0", "latest"]), "v2.0.0");
  assert.equal(highestVersionTag(["nightly", "latest"]), null);
  assert.equal(highestVersionTag([]), null);
});

test("staleActions dedupes, drops actions with no known release and sorts", () => {
  const refs = [
    { action: "actions/checkout", ref: "v7" },
    { action: "actions/cache", ref: "v6" },
    { action: "actions/cache", ref: "v6" },
    { action: "some/unreleased", ref: "v1" },
  ];
  assert.deepEqual(
    staleActions(refs, {
      "actions/cache": "v7.0.0",
      "actions/checkout": "v7.0.1",
      "some/unreleased": null,
    }),
    [{ action: "actions/cache", current: "v6", latest: "v7.0.0" }],
  );
});

test("staleActions ranks a SHA pin by its version comment, to the patch", () => {
  const sha = "3d3c42e5aac5ba805825da76410c181273ba90b1";
  const refs = [
    { action: "actions/checkout", ref: sha, version: "v7.0.1" },
    { action: "actions/setup-node", ref: sha, version: "v7.0.0" },
    // Without a comment a SHA pin cannot be ranked, so it is never reported.
    { action: "actions/cache", ref: sha },
  ];
  assert.deepEqual(
    staleActions(refs, {
      "actions/checkout": "v7.0.2",
      "actions/setup-node": "v7.0.0",
      "actions/cache": "v9.0.0",
    }),
    [
      {
        action: "actions/checkout",
        current: "v7.0.1 (`3d3c42e`)",
        latest: "v7.0.2",
      },
    ],
  );
});

test("buildIssueBody returns null when every install is up to date", () => {
  assert.equal(buildIssueBody([{ label: "root", packages: [] }]), null);
});

test("buildIssueBody starts with the idempotency marker and skips empty installs", () => {
  const body = buildIssueBody([
    { label: "empty", packages: [] },
    {
      label: "root",
      packages: [
        { name: "zod", current: "3.0.0", wanted: "3.1.0", latest: "4.0.0" },
      ],
    },
  ]);
  assert.ok(body.startsWith(ISSUE_MARKER));
  assert.ok(body.includes("### `root`"));
  assert.ok(!body.includes("### `empty`"));
  assert.ok(body.includes("| `zod` | 3.0.0 | 3.1.0 | 4.0.0 |"));
});

test("buildClearedBody keeps the marker so the next sweep still finds the issue", () => {
  const body = buildClearedBody("2026-09-03");
  assert.ok(body.startsWith(ISSUE_MARKER));
  assert.ok(body.includes("2026-09-03"));
  assert.ok(body.includes("Safe to close"));
});

test("main throws when npm outdated exits with an undocumented status", () => {
  // The regression that motivated covering main(): exit 2 used to fall through
  // to empty stdout and report a clean sweep across all five installs.
  const spawn = fakeSpawn({ outdatedStatus: 2 });
  assert.throws(
    () => captureLog(() => main("o/r", spawn)),
    /npm outdated failed in \.\s*\(exit 2\).*ENOTFOUND/s,
  );
  assert.equal(ghCall(spawn, "create"), undefined);
});

test("INSTALLS is the one root install", () => {
  // This repository is one package. An install added here without a matching
  // install step in the workflow would be swept over a tree that is not there.
  assert.deepEqual(
    INSTALLS.map((i) => i.dir),
    ["."],
  );
});

test("main sweeps the install and files one issue with the three labels", () => {
  const spawn = fakeSpawn({
    outdated: {
      ".": {
        zod: { current: "3.0.0", wanted: "3.1.0", latest: "4.0.0" },
      },
    },
  });
  const log = captureLog(() => main("o/r", spawn));

  assert.deepEqual(
    spawn.calls.filter((c) => c.cmd === "npm").map((c) => c.cwd),
    INSTALLS.map((i) => i.dir),
  );
  const create = ghCall(spawn, "create");
  assert.ok(create, "expected an issue to be created");
  assert.deepEqual(create.args.slice(0, 12), [
    "issue",
    "create",
    "--repo",
    "o/r",
    "--title",
    "chore(deps): monthly dependency refresh",
    "--label",
    "factory",
    "--label",
    "chore",
    "--label",
    "dependabot",
  ]);
  assert.ok(!create.args.includes("--milestone"));
  assert.equal(create.args[create.args.length - 2], "--body");
  assert.ok(create.args[create.args.length - 1].includes("`zod`"));
  assert.ok(log.some((l) => l.includes("filed")));
});

test("main edits the existing issue instead of filing a duplicate", () => {
  const spawn = fakeSpawn({
    outdated: {
      ".": { ajv: { current: "8.0.0", wanted: "8.1.0", latest: "8.1.0" } },
    },
    existing: [sweepIssue(77, `${ISSUE_MARKER}\nstale`)],
  });
  const log = captureLog(() => main("o/r", spawn));

  assert.equal(ghCall(spawn, "create"), undefined);
  const edit = ghCall(spawn, "edit");
  assert.equal(edit.args[2], "77");
  assert.ok(edit.args[edit.args.length - 1].includes("`ajv`"));
  assert.ok(log.some((l) => l.includes("updated existing #77")));
});

test("main clears a still-open issue once everything is current again", () => {
  const spawn = fakeSpawn({
    existing: [sweepIssue(77, `${ISSUE_MARKER}\n| \`zod\` | 3.0.0 |`)],
  });
  const log = captureLog(() => main("o/r", spawn));

  const edit = ghCall(spawn, "edit");
  assert.ok(edit, "an open issue must be cleared, not left with a stale table");
  const body = edit.args[edit.args.length - 1];
  assert.ok(body.startsWith(ISSUE_MARKER));
  assert.ok(!body.includes("`zod`"));
  assert.ok(log.some((l) => l.includes("cleared stale list on #77")));
});

test("main is a true no-op when nothing is outdated and no issue is open", () => {
  const spawn = fakeSpawn();
  const log = captureLog(() => main("o/r", spawn));

  assert.equal(ghCall(spawn, "edit"), undefined);
  assert.equal(ghCall(spawn, "create"), undefined);
  assert.ok(log.some((l) => l.includes("no-op")));
});

test("main refuses to run without a repo", () => {
  // `main`'s default reads process.env.GITHUB_REPOSITORY, which GitHub Actions
  // sets on every run — so this has to clear the variable rather than assume
  // the ambient environment lacks it. Relying on the ambient value passed
  // locally and failed in CI, which is the one place the default is always
  // populated.
  const saved = process.env.GITHUB_REPOSITORY;
  delete process.env.GITHUB_REPOSITORY;
  try {
    assert.throws(
      () => main(undefined, fakeSpawn()),
      /GITHUB_REPOSITORY unset/,
    );
  } finally {
    if (saved !== undefined) process.env.GITHUB_REPOSITORY = saved;
  }
});

test("main falls back to GITHUB_REPOSITORY when no repo is passed", () => {
  // The other half of the default: with the variable set, `main(undefined, …)`
  // must use it rather than throw. Together the two tests pin the default's
  // behavior in both environments instead of inheriting whichever one happens
  // to be running.
  const saved = process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_REPOSITORY = "env/repo";
  try {
    const spawn = fakeSpawn({
      outdated: {
        ".": { ajv: { current: "8.0.0", wanted: "8.1.0", latest: "8.1.0" } },
      },
    });
    captureLog(() => main(undefined, spawn));
    const create = ghCall(spawn, "create");
    assert.equal(create.args[create.args.indexOf("--repo") + 1], "env/repo");
  } finally {
    if (saved === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = saved;
  }
});

test("buildIssueBody renders a GitHub Actions section after the npm ones", () => {
  const body = buildIssueBody(
    [{ label: "root", packages: [] }],
    [{ action: "actions/cache", current: "v6", latest: "v7.0.0" }],
  );
  assert.ok(body.startsWith(ISSUE_MARKER));
  assert.ok(body.includes("### GitHub Actions"));
  assert.ok(body.includes("| `actions/cache` | v6 | v7.0.0 |"));
  assert.ok(!body.includes("### `root`"));
});

test("buildIssueBody returns null only when npm and actions are both clean", () => {
  assert.equal(buildIssueBody([{ label: "root", packages: [] }], []), null);
  assert.notEqual(
    buildIssueBody(
      [],
      [{ action: "actions/cache", current: "v6", latest: "v7.0.0" }],
    ),
    null,
  );
});

test("buildClearedBody speaks for both halves of the sweep", () => {
  const body = buildClearedBody("2026-09-04");
  assert.ok(body.startsWith(ISSUE_MARKER));
  assert.ok(body.includes("2026-09-04"));
  // npm-only wording here would assert an all-clear the sweep never checked.
  assert.match(body, /npm package/);
  assert.match(body, /uses:/);
  // Must not claim every ref was verified: a SHA pin with no version comment
  // and a branch are never ranked against a release (Copilot).
  assert.match(body, /commit SHA with no such comment, or a branch/);
});

test("main fails the sweep when a release lookup errors, rather than reporting no stale actions", () => {
  // The silent-success shape one level down: a 403 read as "no release" is
  // indistinguishable from "not stale", and every action here is already on
  // its latest major, so the empty section would look like a healthy run.
  const spawn = fakeSpawn({
    releasesStatus: 1,
    releasesStderr: "gh: API rate limit exceeded (HTTP 403)",
  });
  assert.throws(
    () => captureLog(() => main("o/r", spawn)),
    /release lookup for .* failed/,
  );
});

test("main fails on a 404 release lookup — a missing action repo is not 'no releases'", () => {
  // The release LIST endpoint answers "no releases" with a successful empty
  // array, so a 404 means the repository is missing or inaccessible. Treating
  // it as benign would silently drop a broken or renamed action from the sweep
  // that replaced Dependabot (Copilot).
  const spawn = fakeSpawn({
    releasesStatus: 1,
    releasesStderr: "gh: Not Found (HTTP 404)",
  });
  assert.throws(
    () => captureLog(() => main("o/r", spawn)),
    /release lookup for .* failed/,
  );
});

test("main treats an empty release list as 'this action cuts no releases'", () => {
  // The benign case: status 0 with no tags. The action is simply not ranked.
  const spawn = fakeSpawn({ releaseTags: [] });
  const log = captureLog(() => main("o/r", spawn));
  assert.match(log.join("\n"), /no-op/);
});

test("main asks for release lists, not the designated latest release", () => {
  const spawn = fakeSpawn();
  captureLog(() => main("o/r", spawn));
  const lookups = spawn.calls.filter(
    (c) =>
      c.cmd === "gh" &&
      c.args[0] === "api" &&
      c.args.some((a) => a.includes("/releases")),
  );
  assert.ok(lookups.length > 0, "expected at least one release lookup");
  for (const call of lookups) {
    // `releases/latest` is GitHub's designated latest, not the greatest
    // version — ranking must come from the list.
    assert.ok(!call.args.some((a) => /releases\/latest/.test(a)));
    assert.ok(call.args.some((a) => /\/releases\?/.test(a)));
    // And every page of it: the list is ordered by release DATE, so a genuine
    // maximum can sit past page 1 behind newer maintenance releases on lower
    // majors. Ranking one page would report a lower major as highest.
    assert.ok(
      call.args.includes("--paginate"),
      "release lookup must paginate, or the highest version can be missed",
    );
  }
});

// ---- written here ----

/** One outdated package at the root: enough for `main` to want an issue. */
const BEHIND = {
  ".": { ajv: { current: "8.0.0", wanted: "8.1.0", latest: "8.1.0" } },
};

test("main reports a stale action on its own, from this repo's workflow files", () => {
  // The action half end to end: `main` reads the real `.github/workflows`,
  // where every action is a SHA pin with a version comment, and a release far
  // above any of them makes each one stale.
  const spawn = fakeSpawn({ releaseTags: ["v999.0.0"] });
  captureLog(() => main("o/r", spawn));
  const create = ghCall(spawn, "create");
  assert.ok(create, "stale actions alone must file the tracking issue");
  const body = create.args[create.args.length - 1];
  assert.ok(body.includes("### GitHub Actions"));
  assert.ok(body.includes("| `actions/checkout` | v"));
  assert.ok(body.includes("| v999.0.0 |"));
});

test("main starts npm and gh and nothing else", () => {
  // The source's script also ran `curl` (the Docker half) and read
  // milestones. Neither is here; the fake throws on both, and this says so.
  for (const opts of [
    {},
    { outdated: BEHIND },
    { outdated: BEHIND, existing: [sweepIssue(77, `${ISSUE_MARKER}\nold`)] },
    { existing: [sweepIssue(77, `${ISSUE_MARKER}\nold`)] },
  ]) {
    const spawn = fakeSpawn(opts);
    captureLog(() => main("o/r", spawn));
    for (const call of spawn.calls) {
      assert.ok(["npm", "gh"].includes(call.cmd), `started ${call.cmd}`);
      assert.ok(!call.args.includes("--milestone"));
      assert.ok(!call.args.some((a) => a.includes("milestones")));
    }
  }
});

// Addition A1: the lookup, and whose marker counts.

test("main looks its issue up with the labelled REST listing, every page, not with issue search", () => {
  const spawn = fakeSpawn();
  captureLog(() => main("o/r", spawn));
  const listings = spawn.calls.filter(
    (c) => c.cmd === "gh" && c.args.some((a) => a.includes("/issues?")),
  );
  assert.equal(listings.length, 1);
  assert.deepEqual(listings[0].args, [
    "api",
    "--paginate",
    "--slurp",
    "repos/o/r/issues?state=open&labels=dependabot&per_page=100",
  ]);
  assert.equal(ghCall(spawn, "list"), undefined);
  assert.ok(!spawn.calls.some((c) => c.args.includes("--search")));
});

test("main finds its issue on a later page of the listing", () => {
  const others = Array.from({ length: 100 }, (_, i) =>
    sweepIssue(200 + i, "an alert issue, with another marker"),
  );
  const spawn = fakeSpawn({
    outdated: BEHIND,
    listing: [others, [sweepIssue(77, `${ISSUE_MARKER}\nold`)]],
  });
  captureLog(() => main("o/r", spawn));
  assert.equal(ghCall(spawn, "create"), undefined);
  assert.equal(ghCall(spawn, "edit").args[2], "77");
});

test("a marker on an issue the automation did not write is not this sweep's issue", () => {
  const body = `${ISSUE_MARKER}\nforged`;
  const forgeries = {
    "an outsider, no labels": sweepIssue(50, body, {
      user: { login: "someone", type: "User" },
      labels: [],
    }),
    "an outsider, even with the labels": sweepIssue(50, body, {
      user: { login: "someone", type: "User" },
    }),
    "a human account with the automation's name": sweepIssue(50, body, {
      user: { login: "github-actions", type: "User" },
    }),
    "another bot": sweepIssue(50, body, {
      user: { login: "dependabot[bot]", type: "Bot" },
    }),
    "the automation, without the type label": sweepIssue(50, body, {
      labels: [{ name: "factory" }, { name: "dependabot" }],
    }),
    "the automation, without the sweep's label": sweepIssue(50, body, {
      labels: [{ name: "factory" }, { name: "chore" }],
    }),
    "no author at all": sweepIssue(50, body, { user: null }),
  };
  for (const [what, forged] of Object.entries(forgeries)) {
    // Something is behind: the sweep must file its own issue, not edit this one.
    const filing = fakeSpawn({ outdated: BEHIND, existing: [forged] });
    captureLog(() => main("o/r", filing));
    assert.equal(ghCall(filing, "edit"), undefined, `edited: ${what}`);
    assert.ok(ghCall(filing, "create"), `did not file its own: ${what}`);

    // Nothing is behind: the sweep must not "clear" someone else's issue.
    const clean = fakeSpawn({ existing: [forged] });
    const log = captureLog(() => main("o/r", clean));
    assert.equal(ghCall(clean, "edit"), undefined, `cleared: ${what}`);
    assert.equal(ghCall(clean, "create"), undefined);
    assert.ok(log.some((l) => l.includes("no-op")));
  }
});

test("the sweep's own issue is found behind a forged one", () => {
  const spawn = fakeSpawn({
    outdated: BEHIND,
    existing: [
      sweepIssue(90, `${ISSUE_MARKER}\nforged`, {
        user: { login: "someone", type: "User" },
        labels: [],
      }),
      sweepIssue(77, `${ISSUE_MARKER}\nold`),
    ],
  });
  captureLog(() => main("o/r", spawn));
  assert.equal(ghCall(spawn, "create"), undefined);
  assert.equal(ghCall(spawn, "edit").args[2], "77");
});

test("the marker must be the first thing in the body", () => {
  for (const body of [
    `intro\n${ISSUE_MARKER}`,
    ` ${ISSUE_MARKER}`,
    ISSUE_MARKER.slice(0, -1),
    "",
    null,
    undefined,
    7,
  ]) {
    const spawn = fakeSpawn({
      outdated: BEHIND,
      existing: [sweepIssue(77, body)],
    });
    captureLog(() => main("o/r", spawn));
    assert.equal(ghCall(spawn, "edit"), undefined, JSON.stringify(body));
    assert.ok(ghCall(spawn, "create"), JSON.stringify(body));
  }
});

test("a pull request in the listing is never this sweep's issue", () => {
  // The issues endpoint returns pull requests too. One that somehow carried
  // the author, the labels and the marker is still not an issue to edit.
  const spawn = fakeSpawn({
    outdated: BEHIND,
    existing: [
      sweepIssue(77, `${ISSUE_MARKER}\nold`, {
        pull_request: { url: "https://api.github.com/repos/o/r/pulls/77" },
      }),
    ],
  });
  captureLog(() => main("o/r", spawn));
  assert.equal(ghCall(spawn, "edit"), undefined);
  assert.ok(ghCall(spawn, "create"));
});

test("the author check asks for the labels SWEEP_LABELS names, and the issue is filed with them", () => {
  assert.deepEqual(ISSUE_LABELS, ["factory", "chore", "dependabot"]);
  assert.deepEqual(SWEEP_LABELS, ["chore", "dependabot"]);
  // An issue the sweep files must pass the sweep's own check on the next run.
  for (const label of SWEEP_LABELS) assert.ok(ISSUE_LABELS.includes(label));
  // The process label is not part of the check: its removal by a maintainer
  // does not make the sweep file a second issue.
  const spawn = fakeSpawn({
    outdated: BEHIND,
    existing: [
      sweepIssue(77, `${ISSUE_MARKER}\nold`, {
        labels: SWEEP_LABELS.map((name) => ({ name })),
      }),
    ],
  });
  captureLog(() => main("o/r", spawn));
  assert.equal(ghCall(spawn, "create"), undefined);
  assert.equal(ghCall(spawn, "edit").args[2], "77");
});

test("main fails the sweep when the listing fails or is not a list of pages, and writes nothing", () => {
  // A listing read as "no issue" would file a duplicate every month.
  for (const [opts, pattern] of [
    [{ listingStatus: 1 }, /issues\?state=open.*failed \(1\).*502/s],
    [{ listing: { message: "Not Found" } }, /non-list response/],
    [{ listing: [{ message: "Not Found" }] }, /non-list response/],
  ]) {
    const spawn = fakeSpawn({ outdated: BEHIND, ...opts });
    assert.throws(() => captureLog(() => main("o/r", spawn)), pattern);
    assert.equal(ghCall(spawn, "create"), undefined);
    assert.equal(ghCall(spawn, "edit"), undefined);
  }
});

// A write that fails.

test("main throws when the issue cannot be created, as with a label that does not exist", () => {
  const spawn = fakeSpawn({
    outdated: BEHIND,
    createStatus: 1,
    createStderr: "could not add label: 'chore' not found",
  });
  assert.throws(
    () => captureLog(() => main("o/r", spawn)),
    /gh issue create failed: could not add label: 'chore' not found/,
  );
});

test("main throws when the issue cannot be edited", () => {
  const spawn = fakeSpawn({
    outdated: BEHIND,
    existing: [sweepIssue(77, `${ISSUE_MARKER}\nold`)],
    editStatus: 1,
  });
  assert.throws(
    () => captureLog(() => main("o/r", spawn)),
    /gh issue edit failed: .*404/,
  );
  assert.equal(ghCall(spawn, "create"), undefined);
});

// Addition A3: issue writes go through the paced writer.

test("every issue write goes through the writer main is given, and no read does", () => {
  const cases = {
    create: { outdated: BEHIND },
    edit: {
      outdated: BEHIND,
      existing: [sweepIssue(77, `${ISSUE_MARKER}\nold`)],
    },
    clear: { existing: [sweepIssue(77, `${ISSUE_MARKER}\nold`)] },
    "no-op": {},
  };
  for (const [name, opts] of Object.entries(cases)) {
    const spawn = fakeSpawn(opts);
    const inside = [];
    let writing = false;
    const write = (fn) => {
      writing = true;
      const before = spawn.calls.length;
      try {
        return fn();
      } finally {
        writing = false;
        inside.push(...spawn.calls.slice(before));
      }
    };
    captureLog(() => main("o/r", spawn, write));
    assert.equal(writing, false);
    const writes = spawn.calls.filter(
      (c) => c.cmd === "gh" && c.args[0] === "issue",
    );
    assert.deepEqual(inside, writes, `${name}: a write went round the writer`);
    assert.equal(writes.length, name === "no-op" ? 0 : 1, name);
  }
});

test("a run makes one write, so the one-second pause does not fire", () => {
  for (const opts of [
    { outdated: BEHIND },
    { outdated: BEHIND, existing: [sweepIssue(77, `${ISSUE_MARKER}\nold`)] },
    { existing: [sweepIssue(77, `${ISSUE_MARKER}\nold`)] },
  ]) {
    const pauses = [];
    const spawn = fakeSpawn(opts);
    captureLog(() =>
      main(
        "o/r",
        spawn,
        pacedWrites((ms) => pauses.push(ms)),
      ),
    );
    assert.deepEqual(pauses, []);
  }
});

// The issue text names this repository, and nothing of the source's.

test("neither issue body carries the source's issue numbers, branch, repository or Docker half", () => {
  const filed = buildIssueBody(
    [
      {
        label: "root",
        packages: [
          { name: "zod", current: "3.0.0", wanted: "3.1.0", latest: "4.0.0" },
        ],
      },
    ],
    [{ action: "actions/cache", current: "v6", latest: "v7.0.0" }],
  );
  for (const body of [filed, buildClearedBody("2026-11-21")]) {
    // `#NNNN` in an issue here would link to this repository's own numbers.
    assert.doesNotMatch(body, /#\d/);
    assert.doesNotMatch(body, /v2\/main/);
    assert.doesNotMatch(body, /modelcontextprotocol/);
    assert.doesNotMatch(body, /docker|base.image|client/i);
  }
  assert.ok(filed.includes(`](${PLACEMENT_DOC})`));
  assert.equal(
    PLACEMENT_DOC,
    "https://github.com/NorthwoodsSentinel/mycelia-mcp/blob/main/AGENTS.md#dependency-placement",
  );
  assert.match(filed, /against `main`/);
});

test("the cleared body says a SHA pin with a version comment is covered", () => {
  // Every action in this repository is pinned that way, and `parseActionRefs`
  // ranks such a pin by its comment. The source's sentence said no SHA pin is
  // covered, which here would read as "no action was checked".
  const body = buildClearedBody("2026-11-21");
  assert.match(body, /commit SHA followed by a `# vX\.Y\.Z` comment/);
});
