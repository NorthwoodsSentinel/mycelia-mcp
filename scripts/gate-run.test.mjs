// Tests for scripts/gate-run.mjs (NOR-610): the gate run that names the commit
// its result belongs to. Run via `npm run test:scripts`.
//
// The cases that matter most are the ones the prose block got wrong: a git
// probe that FAILS prints nothing, and the block read nothing as "clean" and
// two nothings as "the same commit". Each of those must be a NO PASS here, and
// the gate must not even run when the first probes cannot be read.
//
// The runners are injected, so no test starts npm. The last two tests use real
// git in a temporary repository, with a stub in place of the gate.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  failureOf,
  GATE_COMMAND,
  gateIn,
  gateRun,
  gitIn,
  HEAD_PROBE,
  main,
  readHead,
  readTree,
  TREE_PROBE,
} from "./gate-run.mjs";

const A = "a".repeat(40);
const B = "b".repeat(40);

const ok = (stdout = "") => ({ status: 0, signal: null, stdout, stderr: "" });
const exited = (status) => ({ status, signal: null, stdout: "", stderr: "x" });
const killed = (signal) => ({ status: null, signal, stdout: "", stderr: "" });
const notStarted = () => ({ error: new Error("spawn ENOENT"), status: null });

/**
 * A git runner that answers the tree probe from `trees` and the head probe
 * from `heads`, one answer per call, in order; and a gate runner that records
 * that it ran.
 */
function world({ trees, heads, gate = ok() }) {
  const calls = [];
  const queues = { tree: [...trees], head: [...heads] };
  const git = (args) => {
    const kind =
      args === TREE_PROBE ? "tree" : args === HEAD_PROBE ? "head" : "other";
    calls.push(kind);
    assert.notEqual(kind, "other", `unexpected git ${args.join(" ")}`);
    const answer = queues[kind].shift();
    assert.ok(answer, `more ${kind} probes than the test planned`);
    return answer;
  };
  const gateRunner = () => {
    calls.push("gate");
    return typeof gate === "function" ? gate() : gate;
  };
  return { git, gate: gateRunner, calls };
}

const clean = { trees: [ok(), ok()], heads: [ok(`${A}\n`), ok(`${A}\n`)] };

test("the clean pass names the commit, and probes before and after the gate", () => {
  const w = world(clean);
  assert.deepEqual(gateRun(w), {
    pass: true,
    line: `gate passed on ${A}`,
  });
  assert.deepEqual(w.calls, ["tree", "head", "gate", "tree", "head"]);
});

test("finding 1: a tree probe that fails with no output is not a clean tree", () => {
  // `git status` exits 128 and prints nothing: the block read this as clean.
  for (const failure of [
    exited(128),
    exited(1),
    killed("SIGKILL"),
    notStarted(),
  ]) {
    const w = world({ ...clean, trees: [failure] });
    const result = gateRun(w);
    assert.equal(result.pass, false);
    assert.match(
      result.line,
      /^NO PASS: the tree could not be read \(git status /,
    );
    assert.match(result.line, /the gate was not run$/);
    assert.deepEqual(w.calls, ["tree"], "the gate must not run");
  }
});

test("finding 1: the same failure on the second tree probe is not a clean tree", () => {
  for (const failure of [exited(128), killed("SIGTERM"), notStarted()]) {
    const w = world({ ...clean, trees: [ok(), failure] });
    const result = gateRun(w);
    assert.equal(result.pass, false);
    assert.match(
      result.line,
      /^NO PASS: the tree could not be read after the gate/,
    );
    assert.deepEqual(w.calls, ["tree", "head", "gate", "tree"]);
  }
});

test("finding 1: a head probe that fails is not a commit, before the gate", () => {
  // Two failed `rev-parse` calls both print nothing: the block compared them
  // and found them equal.
  for (const failure of [
    exited(128),
    killed("SIGKILL"),
    notStarted(),
    ok(""),
    ok("\n"),
    ok("abc1234\n"),
    ok(`${"g".repeat(40)}\n`),
    ok(`${"A".repeat(40)}\n`),
    ok(`${A}${A}\n`),
    ok(`${A} ${B}\n`),
    { status: 0, signal: null, stdout: undefined, stderr: "" },
  ]) {
    const w = world({ ...clean, heads: [failure] });
    const result = gateRun(w);
    assert.equal(result.pass, false);
    assert.match(
      result.line,
      /^NO PASS: HEAD could not be read \(git rev-parse /,
    );
    assert.deepEqual(w.calls, ["tree", "head"], "the gate must not run");
  }
});

test("finding 1: a head probe that fails after the gate is not 'the same commit'", () => {
  for (const failure of [
    exited(128),
    ok(""),
    killed("SIGKILL"),
    notStarted(),
  ]) {
    const w = world({ ...clean, heads: [ok(`${A}\n`), failure] });
    const result = gateRun(w);
    assert.equal(result.pass, false);
    assert.match(
      result.line,
      /^NO PASS: HEAD could not be read after the gate/,
    );
  }
});

test("finding 1: both head probes failing is never a pass", () => {
  const w = world({ ...clean, heads: [exited(128), exited(128)] });
  const result = gateRun(w);
  assert.equal(result.pass, false);
  assert.doesNotMatch(result.line, /gate passed on/);
});

test("a tree that is not clean before the gate: the gate is never run", () => {
  const w = world({ ...clean, trees: [ok(" M src/index.ts\n")] });
  assert.deepEqual(gateRun(w), {
    pass: false,
    line: "NO PASS: the tree is not clean; commit first; the gate was not run",
  });
  assert.deepEqual(w.calls, ["tree"]);
});

test("an untracked file counts as not clean", () => {
  const w = world({ ...clean, trees: [ok("?? notes.txt\n")] });
  assert.equal(gateRun(w).pass, false);
});

test("a gate that fails, is killed or cannot be started is no pass", () => {
  for (const [gate, reason] of [
    [exited(1), "NO PASS: the gate exited 1"],
    [exited(2), "NO PASS: the gate exited 2"],
    [killed("SIGINT"), "NO PASS: the gate was killed by SIGINT"],
    [notStarted(), "NO PASS: the gate could not be started (spawn ENOENT)"],
    [{ status: null, signal: null }, "NO PASS: the gate exited null"],
  ]) {
    const w = world({ ...clean, gate });
    assert.deepEqual(gateRun(w), { pass: false, line: reason });
    assert.deepEqual(w.calls, ["tree", "head", "gate"]);
  }
});

test("a tree dirtied while the gate ran is no pass", () => {
  const w = world({ ...clean, trees: [ok(), ok(" M package.json\n")] });
  assert.deepEqual(gateRun(w), {
    pass: false,
    line: "NO PASS: the tree changed while the gate ran; it is not clean now",
  });
});

test("a head that moved while the gate ran is no pass, and both commits are named", () => {
  const w = world({ ...clean, heads: [ok(`${A}\n`), ok(`${B}\n`)] });
  assert.deepEqual(gateRun(w), {
    pass: false,
    line: `NO PASS: HEAD moved while the gate ran (was ${A}, is ${B})`,
  });
});

test("readTree and readHead report a failure as a failure", () => {
  assert.deepEqual(
    readTree(() => ok()),
    { clean: true },
  );
  assert.deepEqual(
    readTree(() => ok("?? x\n")),
    { clean: false },
  );
  assert.deepEqual(
    readTree(() => exited(128)),
    { failed: "exited 128" },
  );
  assert.deepEqual(
    readTree(() => ({ status: 0, signal: null, stdout: undefined })),
    { failed: "printed nothing that could be read" },
  );
  assert.deepEqual(
    readHead(() => ok(`${A}\n`)),
    { sha: A },
  );
  assert.deepEqual(
    readHead(() => killed("SIGKILL")),
    {
      failed: "was killed by SIGKILL",
    },
  );
  assert.equal(failureOf(ok()), null);
});

test("the probes name every flag that a git configuration could change", () => {
  assert.deepEqual(TREE_PROBE, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ]);
  assert.deepEqual(HEAD_PROBE, ["rev-parse", "--verify", "HEAD^{commit}"]);
  assert.deepEqual(GATE_COMMAND, ["npm", "run", "local:gate"]);
});

test("the default runners start git with captured output and the gate with inherited output", () => {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return ok();
  };
  gitIn("/somewhere", spawn)(TREE_PROBE);
  gateIn("/somewhere", spawn)();
  assert.equal(calls[0].cmd, "git");
  assert.equal(calls[0].args, TREE_PROBE);
  assert.equal(calls[0].opts.cwd, "/somewhere");
  assert.equal(calls[0].opts.encoding, "utf8");
  assert.ok(calls[0].opts.maxBuffer > 1024 * 1024);
  assert.equal(calls[1].cmd, "npm");
  assert.deepEqual(calls[1].args, ["run", "local:gate"]);
  assert.deepEqual(calls[1].opts, { cwd: "/somewhere", stdio: "inherit" });
});

test("main prints the deciding line last and exits 0, 1 or 2", () => {
  const run = (argv, deps) => {
    const out = [];
    const code = main(argv, { log: (line) => out.push(line), ...deps });
    return { out, code };
  };
  const pass = run([], world(clean));
  assert.deepEqual(pass, { out: [`gate passed on ${A}`], code: 0 });

  const fail = run([], world({ ...clean, gate: exited(1) }));
  assert.deepEqual(fail, { out: ["NO PASS: the gate exited 1"], code: 1 });

  // There is no flag that names another gate: any argument is refused, and
  // neither git nor the gate is started.
  const refused = world({ trees: [], heads: [] });
  const withArgument = run(["--gate", "true"], refused);
  assert.equal(withArgument.code, 2);
  assert.match(withArgument.out[0], /^NO PASS: gate-run takes no arguments/);
  assert.deepEqual(refused.calls, []);
});

// --- real git ---------------------------------------------------------------

/** `git` in `dir`, isolated from the machine's own configuration and hooks. */
function gitFor(dir) {
  return (...args) => {
    const result = spawnSync(
      "git",
      [
        "-c",
        "user.name=Gate Run Test",
        "-c",
        "user.email=gate-run@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "init.defaultBranch=main",
        ...args,
      ],
      { cwd: dir, encoding: "utf8" },
    );
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
}

function temporaryRepo() {
  const dir = mkdtempSync(join(tmpdir(), "gate-run-"));
  const git = gitFor(dir);
  git("init", "--quiet");
  writeFileSync(join(dir, "file.txt"), "one\n");
  git("add", "file.txt");
  git("commit", "--quiet", "-m", "one");
  return { dir, git };
}

test("real git: a clean repository passes on its head, and a moved head does not", () => {
  const { dir, git } = temporaryRepo();
  try {
    const head = git("rev-parse", "HEAD");
    assert.deepEqual(gateRun({ git: gitIn(dir), gate: () => ok() }), {
      pass: true,
      line: `gate passed on ${head}`,
    });

    // A gate during which a new commit is made: clean before, clean after,
    // and a different commit.
    const moving = () => {
      writeFileSync(join(dir, "file.txt"), "two\n");
      git("commit", "--quiet", "-am", "two");
      return ok();
    };
    const moved = gateRun({ git: gitIn(dir), gate: moving });
    assert.equal(moved.pass, false);
    assert.match(moved.line, /^NO PASS: HEAD moved while the gate ran/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real git: an untracked file, a dirtied tree, and a directory that is no repository", () => {
  const { dir } = temporaryRepo();
  const outside = mkdtempSync(join(tmpdir(), "gate-run-none-"));
  try {
    // Dirtied during the gate.
    const dirtying = () => {
      writeFileSync(join(dir, "left-behind.txt"), "x\n");
      return ok();
    };
    assert.match(
      gateRun({ git: gitIn(dir), gate: dirtying }).line,
      /^NO PASS: the tree changed while the gate ran/,
    );
    // And so not clean before the next one, whose gate must not run.
    let ran = false;
    const result = gateRun({
      git: gitIn(dir),
      gate: () => {
        ran = true;
        return ok();
      },
    });
    assert.match(result.line, /^NO PASS: the tree is not clean/);
    assert.equal(ran, false);

    // Not a repository: `git status` fails and prints nothing on stdout. This
    // is finding 1 with the real tool.
    const none = gateRun({
      git: gitIn(outside),
      gate: () => assert.fail("the gate must not run"),
    });
    assert.equal(none.pass, false);
    assert.match(
      none.line,
      /^NO PASS: the tree could not be read \(git status exited \d+\)/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
