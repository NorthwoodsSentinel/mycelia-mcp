// Tests for scripts/handoff-check.mjs (NOR-610): the reads a pull request is
// handed to the owner with. Run via `npm run test:scripts`.
//
// The defect this script answers: the prose block's pass line, `head
// unchanged`, depended on the two head lookups only, so any other read could
// fail or come back in part and the line still printed. So the centre of this
// file is one loop: each read fails ALONE, and no run of it may end with
// `head unchanged`.
//
// `spawn` is injected; neither `gh` nor `git` is started.

import { test } from "node:test";
import assert from "node:assert/strict";
import { REPO_SLUG } from "./lib/gh.mjs";
import {
  handoffCheck,
  main,
  readWorkflowsChanged,
  REQUIRED_JOB_NAMES,
} from "./handoff-check.mjs";

const H = "1".repeat(40);
const OTHER = "2".repeat(40);
const PR = 12;

const json = (value) => ({
  status: 0,
  signal: null,
  stdout: JSON.stringify(value),
  stderr: "",
});
const exits = (status, stderr = "") => ({
  status,
  signal: null,
  stdout: "",
  stderr,
});

const RUNS = [
  {
    id: 101,
    path: ".github/workflows/main.yml",
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    head_sha: H,
  },
  {
    id: 102,
    path: ".github/workflows/dco.yml",
    event: "pull_request",
    status: "in_progress",
    conclusion: null,
    head_sha: H,
  },
];
const JOBS = {
  101: [
    { id: 1, name: "validate", status: "completed", conclusion: "success" },
  ],
  102: [
    { id: 2, name: "DCO", status: "in_progress", conclusion: null },
    {
      id: 3,
      name: "DCO (main push)",
      status: "completed",
      conclusion: "skipped",
    },
  ],
};

/**
 * The names of the reads, in the order the script makes them. `head` is asked
 * twice; the second time it is `headAgain`.
 */
const READS = [
  "head",
  "runs",
  "jobs:101",
  "jobs:102",
  "statuses",
  "fetch",
  "catFile",
  "diff",
  "mergeability",
  "headAgain",
];

/**
 * A `spawn` that answers every command the script makes with a clean answer,
 * unless `answers` names another one for that read. It fails the test on a
 * command the script is not expected to make.
 */
function world(answers = {}) {
  const made = [];
  let headReads = 0;
  const clean = {
    head: json({ headRefOid: H }),
    headAgain: json({ headRefOid: H }),
    runs: json([{ total_count: RUNS.length, workflow_runs: RUNS }]),
    "jobs:101": json([{ total_count: 1, jobs: JOBS[101] }]),
    "jobs:102": json([{ total_count: 2, jobs: JOBS[102] }]),
    statuses: json([{ total_count: 0, statuses: [], sha: H }]),
    fetch: exits(0),
    catFile: exits(0),
    diff: exits(0),
    mergeability: json({ mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" }),
  };
  const nameOf = (cmd, args) => {
    const line = args.join(" ");
    if (cmd === "git") {
      if (line === "fetch origin") return "fetch";
      if (line === `cat-file -e ${H}^{commit}`) return "catFile";
      if (line === `diff --quiet origin/main...${H} -- .github/workflows/`) {
        return "diff";
      }
    }
    if (cmd === "gh") {
      if (line === `pr view ${PR} -R ${REPO_SLUG} --json headRefOid`) {
        headReads += 1;
        return headReads === 1 ? "head" : "headAgain";
      }
      if (
        line ===
        `pr view ${PR} -R ${REPO_SLUG} --json mergeable,mergeStateStatus`
      ) {
        return "mergeability";
      }
      const api = "api --paginate --slurp ";
      const base = `repos/${REPO_SLUG}`;
      if (line === `${api}${base}/actions/runs?head_sha=${H}&per_page=100`) {
        return "runs";
      }
      if (line === `${api}${base}/commits/${H}/status?per_page=100`) {
        return "statuses";
      }
      const jobs = new RegExp(
        `^${api}${base}/actions/runs/(\\d+)/jobs\\?per_page=100$`,
      ).exec(line);
      if (jobs) return `jobs:${jobs[1]}`;
    }
    return assert.fail(`unexpected command: ${cmd} ${line}`);
  };
  const spawn = (cmd, args) => {
    const name = nameOf(cmd, args);
    made.push(name);
    const answer = name in answers ? answers[name] : clean[name];
    assert.ok(answer, `no answer planned for ${name}`);
    return answer;
  };
  return { spawn, made };
}

function check(answers) {
  const w = world(answers);
  const out = [];
  const result = handoffCheck(w.spawn, PR, (line) => out.push(line));
  return { ...result, out, made: w.made };
}

test("the clean read ends with `head unchanged`, after every read", () => {
  const { pass, line, out, made } = check();
  assert.equal(pass, true);
  assert.equal(line, `head unchanged: ${H}`);
  assert.deepEqual(made, READS);
  assert.deepEqual(out, [
    "run=101 .github/workflows/main.yml pull_request completed success",
    "run=102 .github/workflows/dco.yml pull_request in_progress null",
    "run=101 job=validate completed success",
    "run=102 job=DCO in_progress null",
    "run=102 job=DCO (main push) completed skipped",
    "workflows unchanged by this PR",
    "mergeable=MERGEABLE mergeStateStatus=CLEAN",
    "read whole: 2 run(s), 3 job(s), 0 status(es), 0 named like a required job; reported, not judged",
  ]);
});

test("finding 2: each read failing alone ends with NO HAND-OFF, never `head unchanged`", () => {
  // `diff` is left out here: its exit 1 means "changed" and has its own test.
  for (const name of READS.filter((read) => read !== "diff")) {
    const { pass, line, out } = check({ [name]: exits(1, "HTTP 502") });
    assert.equal(pass, false, name);
    assert.match(line, /^NO HAND-OFF: /, name);
    for (const printed of [...out, line]) {
      assert.doesNotMatch(printed, /head unchanged/, name);
    }
  }
});

test("finding 2: a read that cannot be started, or prints no JSON, is a failed read", () => {
  for (const name of READS) {
    const gone = check({ [name]: { error: new Error("spawn ENOENT") } });
    assert.equal(gone.pass, false, name);
    assert.match(gone.line, /^NO HAND-OFF: .*ENOENT/, name);
  }
  for (const name of ["head", "runs", "jobs:101", "statuses", "mergeability"]) {
    const cut = check({
      [name]: { status: 0, signal: null, stdout: '[{"total_c', stderr: "" },
    });
    assert.equal(cut.pass, false, name);
    assert.match(cut.line, /^NO HAND-OFF: /, name);
  }
});

test("each failure names the read it belongs to", () => {
  for (const [name, label] of [
    ["head", /^NO HAND-OFF: the head: /],
    ["runs", /^NO HAND-OFF: the workflow runs: /],
    ["jobs:102", /^NO HAND-OFF: the jobs of run 102: /],
    ["statuses", /^NO HAND-OFF: the commit statuses: /],
    [
      "fetch",
      /^NO HAND-OFF: the workflow comparison: git fetch origin failed \(1\)/,
    ],
    [
      "catFile",
      /^NO HAND-OFF: the workflow comparison: the head commit is not in this clone/,
    ],
    ["mergeability", /^NO HAND-OFF: the mergeability: /],
    ["headAgain", /^NO HAND-OFF: the head, read again: /],
  ]) {
    assert.match(check({ [name]: exits(1, "boom") }).line, label, name);
  }
});

test("a head that is not a 40-character commit is not a head", () => {
  for (const value of [
    { headRefOid: "" },
    { headRefOid: "abc1234" },
    { headRefOid: "A".repeat(40) },
    { headRefOid: `${H}0` },
    { headRefOid: null },
    {},
    null,
    [],
  ]) {
    const first = check({ head: json(value) });
    assert.equal(first.pass, false);
    assert.match(
      first.line,
      /^NO HAND-OFF: the head: the head is not a 40-character commit/,
    );
    assert.deepEqual(first.made, ["head"], "nothing is read against no head");

    const last = check({ headAgain: json(value) });
    assert.equal(last.pass, false);
    assert.match(last.line, /^NO HAND-OFF: the head, read again: /);
  }
});

test("a head that moved between the first and the last read is no hand-off", () => {
  const { pass, line } = check({ headAgain: json({ headRefOid: OTHER }) });
  assert.equal(pass, false);
  assert.equal(
    line,
    `NO HAND-OFF: the head moved while it was read (was ${H}, is ${OTHER})`,
  );
});

test("a runs listing that reports more than it returned is a short read", () => {
  const { pass, line } = check({
    runs: json([{ total_count: 3, workflow_runs: RUNS }]),
  });
  assert.equal(pass, false);
  assert.match(
    line,
    /^NO HAND-OFF: the workflow runs: incomplete read .* 2 of 3 workflow_runs/,
  );
});

test("review r1, case 1: the same run on two pages, with the count right", () => {
  const { pass, line } = check({
    runs: json([
      { total_count: 2, workflow_runs: [RUNS[0]] },
      { total_count: 2, workflow_runs: [RUNS[0]] },
    ]),
  });
  assert.equal(pass, false);
  assert.match(
    line,
    /^NO HAND-OFF: the workflow runs: incomplete read .* id 101 appears twice/,
  );
});

test("the same job on two pages, and a job with no id, are short reads", () => {
  const twice = check({
    "jobs:102": json([
      { total_count: 2, jobs: [JOBS[102][0]] },
      { total_count: 2, jobs: [JOBS[102][0]] },
    ]),
  });
  assert.match(
    twice.line,
    /^NO HAND-OFF: the jobs of run 102: incomplete read .* id 2 appears twice/,
  );
  const noId = check({
    "jobs:101": json([
      {
        total_count: 1,
        jobs: [
          { name: "validate", status: "completed", conclusion: "success" },
        ],
      },
    ]),
  });
  assert.match(noId.line, /^NO HAND-OFF: the jobs of run 101: .*without an id/);
});

test("a run for another commit, or missing a field, is not evidence", () => {
  const foreign = check({
    runs: json([
      { total_count: 1, workflow_runs: [{ ...RUNS[0], head_sha: OTHER }] },
    ]),
  });
  assert.equal(
    foreign.line,
    "NO HAND-OFF: the workflow runs: run 101 is for another commit",
  );

  for (const field of ["path", "event", "status", "conclusion"]) {
    const run = { ...RUNS[0] };
    delete run[field];
    const { line } = check({
      runs: json([{ total_count: 1, workflow_runs: [run] }]),
    });
    assert.equal(
      line,
      "NO HAND-OFF: the workflow runs: run 101 is missing a field",
      field,
    );
  }
});

test("a job missing a field is not evidence", () => {
  for (const field of ["name", "status", "conclusion"]) {
    const job = { ...JOBS[101][0] };
    delete job[field];
    const { line } = check({
      "jobs:101": json([{ total_count: 1, jobs: [job] }]),
    });
    assert.equal(
      line,
      "NO HAND-OFF: the jobs of run 101: job 1 is missing a field",
      field,
    );
  }
});

test("review r1, case 2: a combined status reporting more than it returned is a short read", () => {
  const { pass, line } = check({
    statuses: json([
      {
        total_count: 2,
        sha: H,
        statuses: [{ id: 9, context: "unrelated", state: "success" }],
      },
    ]),
  });
  assert.equal(pass, false);
  assert.match(
    line,
    /^NO HAND-OFF: the commit statuses: incomplete read .* 1 of 2 statuses/,
  );
});

test("a combined status for another commit, or with an entry missing a field, is not evidence", () => {
  const foreign = check({
    statuses: json([{ total_count: 0, statuses: [], sha: OTHER }]),
  });
  assert.equal(
    foreign.line,
    "NO HAND-OFF: the commit statuses: the combined status is for another commit",
  );
  const noSha = check({ statuses: json([{ total_count: 0, statuses: [] }]) });
  assert.equal(noSha.pass, false);
  for (const field of ["context", "state"]) {
    const status = { id: 9, context: "validate", state: "success" };
    delete status[field];
    const { line } = check({
      statuses: json([{ total_count: 1, sha: H, statuses: [status] }]),
    });
    assert.equal(
      line,
      "NO HAND-OFF: the commit statuses: status 9 is missing a field",
      field,
    );
  }
});

test("a status named like a required job is reported, and the read still counts", () => {
  assert.deepEqual(REQUIRED_JOB_NAMES, ["validate", "DCO"]);
  const { pass, out } = check({
    statuses: json([
      {
        total_count: 3,
        sha: H,
        statuses: [
          { id: 7, context: "validate", state: "success" },
          { id: 8, context: "DCO", state: "pending" },
          { id: 9, context: "validate-extra", state: "success" },
        ],
      },
    ]),
  });
  assert.equal(pass, true);
  assert.ok(
    out.includes(
      "STATUS NAMED LIKE A REQUIRED JOB (not a workflow run): validate success",
    ),
  );
  assert.ok(
    out.includes(
      "STATUS NAMED LIKE A REQUIRED JOB (not a workflow run): DCO pending",
    ),
  );
  assert.ok(!out.some((line) => line.includes("validate-extra")));
  assert.match(out.at(-1), /3 status\(es\), 2 named like a required job/);
});

test("zero runs on the head is a whole read, reported as zero", () => {
  const { pass, line, out, made } = check({
    runs: json([{ total_count: 0, workflow_runs: [] }]),
  });
  assert.equal(pass, true);
  assert.equal(line, `head unchanged: ${H}`);
  assert.ok(!made.some((name) => name.startsWith("jobs:")));
  assert.match(out.at(-1), /^read whole: 0 run\(s\), 0 job\(s\)/);
});

test("workflows changed is reported, and is a different outcome from 'could not compare'", () => {
  const changed = check({ diff: exits(1) });
  assert.equal(changed.pass, true);
  assert.ok(changed.out.includes("THIS PR CHANGES THE WORKFLOWS"));
  assert.ok(!changed.out.includes("workflows unchanged by this PR"));

  for (const answer of [
    exits(2),
    exits(128, "fatal: no merge base"),
    { status: null, signal: "SIGKILL", stdout: "", stderr: "" },
  ]) {
    const failed = check({ diff: answer });
    assert.equal(failed.pass, false);
    assert.match(
      failed.line,
      /^NO HAND-OFF: the workflow comparison: the comparison could not be made/,
    );
    assert.ok(!failed.out.includes("THIS PR CHANGES THE WORKFLOWS"));
    assert.ok(!failed.out.includes("workflows unchanged by this PR"));
  }
});

test("readWorkflowsChanged does not compare when the fetch failed or the commit is absent", () => {
  const fetchFailed = world({ fetch: exits(128, "fatal: unable to access") });
  assert.throws(
    () => readWorkflowsChanged(fetchFailed.spawn, H),
    /git fetch origin failed \(128\): fatal: unable to access/,
  );
  assert.deepEqual(fetchFailed.made, ["fetch"]);

  const absent = world({ catFile: exits(128) });
  assert.throws(
    () => readWorkflowsChanged(absent.spawn, H),
    /not in this clone/,
  );
  assert.deepEqual(absent.made, ["fetch", "catFile"]);
});

test("a mergeability answer missing a field is a failed read", () => {
  for (const value of [
    {},
    { mergeable: "MERGEABLE" },
    { mergeStateStatus: "CLEAN" },
    { mergeable: "", mergeStateStatus: "CLEAN" },
    { mergeable: "MERGEABLE", mergeStateStatus: null },
    null,
  ]) {
    const { pass, line } = check({ mergeability: json(value) });
    assert.equal(pass, false);
    assert.equal(
      line,
      "NO HAND-OFF: the mergeability: the answer is missing a field",
    );
  }
});

test("a mergeability the service has not computed is read, and reported as it is", () => {
  const { pass, out } = check({
    mergeability: json({ mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }),
  });
  assert.equal(pass, true);
  assert.ok(out.includes("mergeable=UNKNOWN mergeStateStatus=UNKNOWN"));
});

test("main prints the deciding line last and exits 0, 1 or 2", () => {
  const run = (argv, answers) => {
    const w = world(answers);
    const out = [];
    const code = main(argv, { spawn: w.spawn, log: (line) => out.push(line) });
    return { out, code, made: w.made };
  };
  const pass = run([String(PR)]);
  assert.equal(pass.code, 0);
  assert.equal(pass.out.at(-1), `head unchanged: ${H}`);

  const fail = run([String(PR)], { runs: exits(1, "HTTP 500") });
  assert.equal(fail.code, 1);
  assert.match(fail.out.at(-1), /^NO HAND-OFF: the workflow runs: /);

  for (const argv of [[], ["0"], ["abc"], ["12", "13"], ["-R"], ["1.5"]]) {
    const bad = run(argv);
    assert.equal(bad.code, 2, JSON.stringify(argv));
    assert.equal(bad.out.length, 1);
    assert.match(bad.out[0], /^NO HAND-OFF: /);
    assert.deepEqual(bad.made, [], "nothing is read for a bad argument");
  }
});
