// Adversarial cases 1 to 8 for the monthly dependency sweep
// (scripts/dependency-refresh.mjs, its helpers under scripts/lib/, the
// workflow .github/workflows/dependency-refresh.yml and the rule it changes
// in AGENTS.md).
//
// In this repo: the cases were written by the review model (Codex), a model
// from another vendor than the author's, in a tests round run on commit
// 2b6bbd925f7bdc22a27434d80482f4da45b31685 of this change, before the pull
// request was opened. They are kept in its order and under its numbers, which
// is why each test is called "Codex case N".
//
// The comment above each test is that case's text, copied unchanged from the
// round's final message (sha256
// 499f431aa3f823ce9c42dce5ac5dde57caa0fb92752f1efd20c413782fc5829e, lines 40
// to 201), each line behind "// ". The test below it is this repository's
// rendering of the case for `node --test`: the exact input the case names,
// and the verdict the case calls correct. No case was dropped, and none was
// amended.
//
// What "current behavior" in a case's text means: the commit the round read.
// Four cases named a wrong verdict there, and each was fixed in the commit
// that brought this file in:
//
//   - case 1: AGENTS.md still carried the "no sweeps yet" marker under the
//     monthly rule;
//   - cases 2, 3 and 4: `npm outdated` output that was short, an array or a
//     string was parsed as a list (the script's edit 8);
//   - case 5: a listing of no pages was read as "no issue exists"
//     (`ghPaginatedList` in scripts/lib/gh.mjs).
//
// Cases 6, 7 and 8 passed on the commit the round read and hold a boundary in
// place.
//
// Nothing here starts a process or uses the network: `main` is handed a fake
// `spawnSync`, which throws on any program but `npm` and `gh` and on any `gh`
// call it does not know. Cases 1 and 7 read two files of this checkout, by
// paths relative to the repository root, which is where `npm run
// test:scripts` runs. That script names this file by path. Record:
// PROVENANCE.md, "Sweeps".

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import { ISSUE_LABELS, ISSUE_MARKER, main } from "./dependency-refresh.mjs";

/** An open issue this sweep filed, as the REST issues endpoint returns it. */
function sweepIssue(number, body) {
  return {
    number,
    body,
    user: { login: "github-actions[bot]", type: "Bot" },
    labels: ISSUE_LABELS.map((name) => ({ name })),
  };
}

/** One outdated package, as `npm outdated --json` prints it with exit 1. */
const ONE_BEHIND = {
  status: 1,
  stdout: JSON.stringify({
    ajv: { current: "8.0.0", wanted: "8.1.0", latest: "8.1.0" },
  }),
  stderr: "",
};

/**
 * A fake `spawnSync`: `npm` answers with `npm`, the issue listing with
 * `listing`, every release list is empty, and an issue write succeeds. Every
 * call is recorded with its options. Any other program, and any other `gh`
 * call, throws.
 *
 * @param {object} opts
 * @param {{status: number, stdout: string, stderr: string}} opts.npm
 * @param {{status: number, stdout: string, stderr: string}} [opts.listing]
 */
function fakeSpawn({
  npm,
  listing = { status: 0, stdout: "[[]]", stderr: "" },
}) {
  const calls = [];
  const fn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (cmd === "npm") return npm;
    if (cmd !== "gh") throw new Error(`unexpected program: ${cmd}`);
    if (args[0] === "api" && args.some((a) => a.includes("/releases")))
      return { status: 0, stdout: "", stderr: "" };
    if (args[0] === "api" && args.some((a) => a.includes("/issues?")))
      return listing;
    if (args[0] === "issue" && (args[1] === "create" || args[1] === "edit"))
      return {
        status: 0,
        stdout: "https://github.com/o/r/issues/9\n",
        stderr: "",
      };
    throw new Error(`unexpected spawn: ${cmd} ${args.join(" ")}`);
  };
  fn.calls = calls;
  return fn;
}

/** The `gh issue …` calls a run made: its writes. */
const issueCalls = (spawn) =>
  spawn.calls.filter((c) => c.cmd === "gh" && c.args[0] === "issue");

/** Run `main` with its progress lines kept off the console. */
function run(spawn) {
  const original = console.log;
  console.log = () => {};
  try {
    main("o/r", spawn, (write) => write());
  } finally {
    console.log = original;
  }
}

/** A listing of one page holding these issues. */
const listingOf = (...issues) => ({
  status: 0,
  stdout: JSON.stringify([issues]),
  stderr: "",
});

/** The sweep's own open issue, with a table from an earlier run. */
const STALE = sweepIssue(
  77,
  `${ISSUE_MARKER}\n### \`root\`\n\n| Package | Current | Wanted | Latest |\n| --- | --- | --- | --- |\n| \`zod\` | 3.0.0 | 3.1.0 | 4.0.0 |`,
);

// 1. **E7 must distinguish the two identical markers.**
//
//    Exact command/input:
//
//    ```js
//    const agents = readFileSync("AGENTS.md", "utf8");
//    const monthly = agents.match(
//      /### Dependency updates are issue-driven[\s\S]*?(?=\n### )/,
//    )[0];
//    const upstream = agents.match(
//      /### The upstream watch is the third sweep[\s\S]*?(?=\n## )/,
//    )[0];
//
//    assert.doesNotMatch(monthly, /\[No sweeps yet in this repo\]/);
//    assert.match(upstream, /\[No sweeps yet in this repo\]/);
//    ```
//
//    Expected correct verdict: fail on the current head because the monthly marker remains. The upstream marker must remain.
//
//    Protects: design E7: “`AGENTS.md` no longer says `[No sweeps yet in this repo]` under ‘Dependency updates are issue-driven’; the same marker under ‘The upstream watch is the third sweep’ stays.”
test("Codex case 1: E7 must distinguish the two identical markers", () => {
  const agents = readFileSync("AGENTS.md", "utf8");
  const monthly = agents.match(
    /### Dependency updates are issue-driven[\s\S]*?(?=\n### )/,
  )[0];
  const upstream = agents.match(
    /### The upstream watch is the third sweep[\s\S]*?(?=\n## )/,
  )[0];

  assert.doesNotMatch(monthly, /\[No sweeps yet in this repo\]/);
  assert.match(upstream, /\[No sweeps yet in this repo\]/);
});

// 2. **Exit 1 with empty `npm outdated` output is a short read, not a clean result.**
//
//    Exact fake result:
//
//    ```js
//    { status: 1, stdout: "", stderr: "" }
//    ```
//
//    Supply an existing trusted issue containing `ISSUE_MARKER` and a stale package table.
//
//    Expected correct verdict: `main()` throws and performs neither `gh issue edit` nor `gh issue create`. It must not clear the existing issue.
//
//    Current behavior: treats the empty output as no outdated packages and clears the issue.
//
//    Protects: threat model: “a failed, short or malformed read (npm outdated …) [must not be] taken as ‘nothing is behind’”; dependency-refresh header’s failure-closed rule.
test("Codex case 2: exit 1 with empty npm outdated output is a short read, not a clean result", () => {
  const spawn = fakeSpawn({
    npm: { status: 1, stdout: "", stderr: "" },
    listing: listingOf(STALE),
  });
  assert.throws(() => run(spawn), /exited 1.*printed nothing/s);
  assert.deepEqual(issueCalls(spawn), []);
});

// 3. **A JSON array from `npm outdated` is malformed, not an empty package map.**
//
//    Exact fake result:
//
//    ```js
//    { status: 0, stdout: "[]", stderr: "" }
//    ```
//
//    Again include a trusted existing issue with stale rows.
//
//    Expected correct verdict: throw before any issue write.
//
//    Current behavior: `Object.entries([])` becomes empty and the sweep clears the existing issue.
//
//    Protects: the same malformed-read requirement and E4’s requirement that the issue match the state actually read.
test("Codex case 3: a JSON array from npm outdated is malformed, not an empty package map", () => {
  const spawn = fakeSpawn({
    npm: { status: 0, stdout: "[]", stderr: "" },
    listing: listingOf(STALE),
  });
  assert.throws(() => run(spawn), /not an object of packages/);
  assert.deepEqual(issueCalls(spawn), []);
});

// 4. **A scalar JSON value must not fabricate an outdated package.**
//
//    Exact fake result:
//
//    ```js
//    { status: 0, stdout: '"x"', stderr: "" }
//    ```
//
//    Expected correct verdict: throw and make no issue write.
//
//    Current behavior: `Object.entries("x")` produces package key `"0"` and files a false issue row with fallback versions.
//
//    Protects: false-fail prevention and the malformed `npm outdated` read requirement.
test("Codex case 4: a scalar JSON value must not fabricate an outdated package", () => {
  const spawn = fakeSpawn({ npm: { status: 0, stdout: '"x"', stderr: "" } });
  assert.throws(() => run(spawn), /not an object of packages/);
  assert.deepEqual(issueCalls(spawn), []);
});

// 5. **A slurped issue listing must contain at least one page.**
//
//    Exact fake `gh api --paginate --slurp` result:
//
//    ```js
//    { status: 0, stdout: "[]", stderr: "" }
//    ```
//
//    Run with one outdated npm package.
//
//    Expected correct verdict: throw and perform neither create nor edit.
//
//    Current behavior: the vacuous `pages.some(...)` check accepts zero pages and files a duplicate as though the listing proved no issue existed.
//
//    Protects: threat model: “a failed, short or malformed … issue listing [must not be] taken as ‘no issue exists’.” This does not require a total-count check and therefore stays within the accepted limitation.
test("Codex case 5: a slurped issue listing must contain at least one page", () => {
  const spawn = fakeSpawn({
    npm: ONE_BEHIND,
    listing: { status: 0, stdout: "[]", stderr: "" },
  });
  assert.throws(() => run(spawn), /issues\?state=open.*no pages/);
  assert.deepEqual(issueCalls(spawn), []);
});

// 6. **Hostile npm fields must remain one `--body` value.**
//
//    Exact npm payload:
//
//    ```json
//    {
//      "`pkg` | $(touch /tmp/NOR-684-PWNED)": {
//        "current": "1.0.0; gh issue close 1",
//        "wanted": "../../workflow.yml",
//        "latest": "--repo attacker/repo"
//      }
//    }
//    ```
//
//    Return it with status 1. The fake spawn must reject every program except `npm` and `gh`, record every argument, and assert:
//
//    - exactly one issue-create invocation occurs;
//    - the hostile strings occur only inside the single value following `--body`;
//    - none becomes a separate argument, command, path, repository, title, label, or issue number.
//
//    Expected correct verdict: issue creation through the fixed argument vector; no additional process or write.
//
//    Protects: threat model boundary for `npm outdated` text and the stated write/network upper bound.
test("Codex case 6: hostile npm fields must remain one --body value", () => {
  const payload = {
    "`pkg` | $(touch /tmp/NOR-684-PWNED)": {
      current: "1.0.0; gh issue close 1",
      wanted: "../../workflow.yml",
      latest: "--repo attacker/repo",
    },
  };
  const [name] = Object.keys(payload);
  const hostile = [name, ...Object.values(payload[name])];
  const spawn = fakeSpawn({
    npm: { status: 1, stdout: JSON.stringify(payload), stderr: "" },
  });
  run(spawn);

  // Exactly one issue-create invocation, and no other write.
  const writes = issueCalls(spawn);
  assert.equal(writes.length, 1);
  const [create] = writes;
  const body = create.args[create.args.length - 1];
  // The fixed argument vector: nothing of the payload chose an argument.
  assert.deepEqual(create.args, [
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
    "--body",
    body,
  ]);
  for (const text of hostile) assert.ok(body.includes(text), text);

  // The hostile strings occur only inside the single value following --body:
  // in no program name, no option and no other argument of any call.
  for (const call of spawn.calls) {
    assert.ok(["npm", "gh"].includes(call.cmd), `started ${call.cmd}`);
    // No shell is asked for, so no argument is ever read as a command line.
    assert.equal(call.opts?.shell, undefined);
    call.args.forEach((arg, i) => {
      const isTheBody = call === create && i === call.args.length - 1;
      if (isTheBody) return;
      for (const text of hostile) {
        assert.ok(
          !String(arg).includes(text),
          `${JSON.stringify(text)} reached ${call.cmd} ${call.args[0]} as argument ${i}`,
        );
      }
    });
    for (const text of hostile) {
      assert.ok(!String(call.opts?.cwd ?? "").includes(text));
      assert.ok(!String(call.opts?.input ?? "").includes(text));
    }
  }
});

// 7. **The actual workflow must pin the complete operational contract.**
//
//    Exact input: parse `.github/workflows/dependency-refresh.yml` with the repository’s `yaml` package and assert:
//
//    ```js
//    assert.deepEqual(Object.keys(workflow.on).sort(), [
//      "schedule",
//      "workflow_dispatch",
//    ]);
//    assert.equal(workflow.concurrency.group, "dependency-refresh");
//    assert.equal(workflow.concurrency["cancel-in-progress"], false);
//    assert.deepEqual(workflow.permissions, { contents: "read" });
//
//    const job = workflow.jobs["dependency-sweep"];
//    assert.equal(job["timeout-minutes"], 5);
//    assert.deepEqual(job.permissions, {
//      contents: "read",
//      issues: "write",
//    });
//    ```
//
//    Also assert exactly one install step equals:
//
//    ```text
//    bun install --frozen-lockfile --ignore-scripts
//    ```
//
//    and the final step equals:
//
//    ```text
//    node scripts/dependency-refresh.mjs
//    ```
//
//    with only `GH_TOKEN` and `GITHUB_REPOSITORY` in its environment. Every `uses:` value must contain a 40-hex SHA and an exact `# vX.Y.Z` comment.
//
//    Expected correct verdict: pass on this head; fail for a removed concurrency block, broadened permission, PR trigger, moving action tag, second install, or substituted entry point.
//
//    Protects: A2, action-pin rules, token boundary, one-install decision, trigger boundary, timeout rule, and silent-skip prevention.
test("Codex case 7: the actual workflow must pin the complete operational contract", () => {
  const text = readFileSync(".github/workflows/dependency-refresh.yml", "utf8");
  const workflow = parse(text);

  assert.deepEqual(Object.keys(workflow.on).sort(), [
    "schedule",
    "workflow_dispatch",
  ]);
  assert.equal(workflow.concurrency.group, "dependency-refresh");
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.deepEqual(workflow.permissions, { contents: "read" });

  const job = workflow.jobs["dependency-sweep"];
  assert.equal(job["timeout-minutes"], 5);
  assert.deepEqual(job.permissions, {
    contents: "read",
    issues: "write",
  });

  // One job, so nothing else can hold a wider grant or run something else.
  assert.deepEqual(Object.keys(workflow.jobs), ["dependency-sweep"]);

  // Exactly one install step, and it is the frozen, script-free Bun install.
  // The only other step that runs a command is the last one: the sweep.
  const runs = job.steps.filter((step) => "run" in step);
  assert.deepEqual(
    runs.map((step) => step.run),
    [
      "bun install --frozen-lockfile --ignore-scripts",
      "node scripts/dependency-refresh.mjs",
    ],
  );
  const last = job.steps[job.steps.length - 1];
  assert.equal(last.run, "node scripts/dependency-refresh.mjs");
  assert.deepEqual(Object.keys(last.env).sort(), [
    "GH_TOKEN",
    "GITHUB_REPOSITORY",
  ]);
  // No other step, and neither the job nor the workflow, is handed anything.
  for (const step of job.steps.slice(0, -1)) assert.equal(step.env, undefined);
  assert.equal(job.env, undefined);
  assert.equal(workflow.env, undefined);

  // Every `uses:` value holds a 40-hex SHA and an exact `# vX.Y.Z` comment.
  // The comment is not data to the parser, so it is read off the file's lines,
  // and the two counts must agree: no `uses:` the line pattern did not see.
  const uses = job.steps.filter((step) => "uses" in step);
  assert.ok(uses.length > 0);
  for (const step of uses) assert.match(step.uses, /@[0-9a-f]{40}$/);
  const pinned = text
    .split("\n")
    .filter((line) =>
      /^\s+uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/.test(line),
    );
  assert.equal(pinned.length, uses.length);
  assert.equal(job.steps.length, uses.length + runs.length);
});

// 8. **Two trusted sweep issues use the first listed one only.**
//
//    Exact listing:
//
//    ```js
//    [[
//      sweepIssue(41, `${ISSUE_MARKER}\nfirst`),
//      sweepIssue(42, `${ISSUE_MARKER}\nsecond`)
//    ]]
//    ```
//
//    Run with one outdated package.
//
//    Expected correct verdict: exactly one edit of issue `41`; no edit of `42`, no create, and no close.
//
//    Protects: settled decision: “when more than one open issue passes the check the first in the listing is used.”
test("Codex case 8: two trusted sweep issues use the first listed one only", () => {
  const spawn = fakeSpawn({
    npm: ONE_BEHIND,
    listing: {
      status: 0,
      stdout: JSON.stringify([
        [
          sweepIssue(41, `${ISSUE_MARKER}\nfirst`),
          sweepIssue(42, `${ISSUE_MARKER}\nsecond`),
        ],
      ]),
      stderr: "",
    },
  });
  run(spawn);

  // Exactly one edit, of issue 41: no edit of 42, no create, and no close.
  const writes = issueCalls(spawn);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].args.slice(0, 5), [
    "issue",
    "edit",
    "41",
    "--repo",
    "o/r",
  ]);
  assert.ok(!spawn.calls.some((c) => c.args.includes("close")));
});
