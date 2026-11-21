#!/usr/bin/env node
// Run the pre-push gate and say which commit the result belongs to (NOR-610)
// — `npm run gate:run`. It takes no arguments.
//
// A gate result belongs to a commit only when the gate exited 0 on a clean
// tree and the commit did not move. The gate reads the working tree, not the
// commit, so a repair left uncommitted passes the gate while the commit that
// gets pushed is still broken. `pr-flow` step 4 used to carry that check as a
// shell block in prose, and the last audit of the skill found the block's
// defect: it read its git probes through their OUTPUT only. A `git status`
// that fails prints nothing, and nothing is what a clean tree prints; two
// failed `git rev-parse` calls both print nothing, and compare equal. With the
// gate exiting 0, the block could then print `gate passed on` naming no commit.
//
// Here every probe has a failure of its own, which is never a clean answer:
//
//   1. Tree probe (`TREE_PROBE`). It FAILED when git could not be started, was
//      killed by a signal or exited non-zero. The tree is clean only when the
//      probe did not fail and printed nothing. The flags are explicit so that a
//      user's git configuration cannot hide untracked files or submodule
//      changes from it.
//   2. Head probe (`HEAD_PROBE`). It failed on the same three conditions, or
//      when its output, trimmed, is not exactly 40 lowercase hex characters.
//   3. If either probe failed, or the tree is not clean: NO gate is run.
//   4. The gate: `npm run local:gate`, output inherited, exit code read
//      directly and never through a pipe. Passed only when npm started, was not
//      killed by a signal and exited 0.
//   5. Both probes again. The head must equal the head of step 2.
//
// The last line on stdout is `gate passed on <40-hex sha>` (exit 0), or
// `NO PASS: <reason>` (exit 1; exit 2 for an argument). The reason names the
// first condition that failed, and "could not be read" is a different reason
// from "not clean" or "moved".
//
// ⚠️ The pass line says four things and no more: the tree was clean before,
// the gate exited 0, the tree was clean after, and the head was the same
// commit both times. It does not see a tracked file changed and put back while
// the gate ran, an ignored file the gate depends on, or a `GIT_DIR` that points
// git at another tree. It writes no record: the line is the record, and the
// pull request body carries it. And nothing here stops an agent that types the
// line by hand. The script makes the honest path correct; CI and the owner's
// merge are the controls on the rest.
//
// There is deliberately no flag that names the gate command. The runners are
// parameters of `gateRun` so the tests can inject them; the command line
// cannot.

import { spawnSync } from "node:child_process";
import { isMainModule } from "./lib/main-module.mjs";

export const TREE_PROBE = [
  "status",
  "--porcelain=v1",
  "--untracked-files=all",
  "--ignore-submodules=none",
];
export const HEAD_PROBE = ["rev-parse", "--verify", "HEAD^{commit}"];
export const GATE_COMMAND = ["npm", "run", "local:gate"];

const SHA = /^[0-9a-f]{40}$/;

/** A dirty tree can print more than `spawnSync`'s 1 MiB default allows. */
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

/** The default git runner: `git <args>` in `cwd`, output captured. */
export function gitIn(cwd, spawn = spawnSync) {
  return (args) =>
    spawn("git", args, { cwd, encoding: "utf8", maxBuffer: GIT_MAX_BUFFER });
}

/** The default gate runner: the gate itself, output inherited. */
export function gateIn(cwd, spawn = spawnSync) {
  return () =>
    spawn(GATE_COMMAND[0], GATE_COMMAND.slice(1), { cwd, stdio: "inherit" });
}

/**
 * Why a spawned command did not finish cleanly, or `null` when it did. A
 * `status` that is not exactly 0 is a failure: `null` (killed) included.
 */
export function failureOf(result) {
  if (result.error) {
    return `could not be started (${result.error.message})`;
  }
  if (result.signal) {
    return `was killed by ${result.signal}`;
  }
  if (result.status !== 0) {
    return `exited ${result.status}`;
  }
  return null;
}

/** `{ failed }` when the probe failed, else `{ clean }`. */
export function readTree(git) {
  const result = git(TREE_PROBE);
  const failed = failureOf(result);
  if (failed) {
    return { failed };
  }
  if (typeof result.stdout !== "string") {
    return { failed: "printed nothing that could be read" };
  }
  return { clean: result.stdout === "" };
}

/** `{ failed }` when the probe failed, else `{ sha }`. */
export function readHead(git) {
  const result = git(HEAD_PROBE);
  const failed = failureOf(result);
  if (failed) {
    return { failed };
  }
  const sha = typeof result.stdout === "string" ? result.stdout.trim() : "";
  if (!SHA.test(sha)) {
    return { failed: "did not print a 40-character commit" };
  }
  return { sha };
}

/**
 * Probe, run the gate, probe again. Returns `{ pass, line }`; `line` is the
 * one line that decides, and it is `gate passed on <sha>` only when `pass`.
 */
export function gateRun({ git, gate }) {
  const no = (reason) => ({ pass: false, line: `NO PASS: ${reason}` });

  const treeBefore = readTree(git);
  if (treeBefore.failed) {
    return no(
      `the tree could not be read (git status ${treeBefore.failed}); the gate was not run`,
    );
  }
  if (!treeBefore.clean) {
    return no("the tree is not clean; commit first; the gate was not run");
  }
  const headBefore = readHead(git);
  if (headBefore.failed) {
    return no(
      `HEAD could not be read (git rev-parse ${headBefore.failed}); the gate was not run`,
    );
  }

  const gateFailed = failureOf(gate());
  if (gateFailed) {
    return no(`the gate ${gateFailed}`);
  }

  const treeAfter = readTree(git);
  if (treeAfter.failed) {
    return no(
      `the tree could not be read after the gate (git status ${treeAfter.failed})`,
    );
  }
  if (!treeAfter.clean) {
    return no("the tree changed while the gate ran; it is not clean now");
  }
  const headAfter = readHead(git);
  if (headAfter.failed) {
    return no(
      `HEAD could not be read after the gate (git rev-parse ${headAfter.failed})`,
    );
  }
  if (headAfter.sha !== headBefore.sha) {
    return no(
      `HEAD moved while the gate ran (was ${headBefore.sha}, is ${headAfter.sha})`,
    );
  }
  return { pass: true, line: `gate passed on ${headBefore.sha}` };
}

export function main(
  argv,
  {
    log = console.log,
    git = gitIn(process.cwd()),
    gate = gateIn(process.cwd()),
  } = {},
) {
  if (argv.length > 0) {
    log(
      `NO PASS: gate-run takes no arguments (got: ${argv.join(" ")}); the gate was not run`,
    );
    return 2;
  }
  const { pass, line } = gateRun({ git, gate });
  log(line);
  return pass ? 0 : 1;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
