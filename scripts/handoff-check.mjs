#!/usr/bin/env node
// Read the evidence a pull request is handed to the owner with, against one
// head, and fail closed (NOR-610) — `npm run handoff:check -- <PR number>`.
//
// An agent never merges here; its last act is to say, with evidence, what the
// owner is merging. `pr-flow` step 7 used to carry the reads as a shell block
// in prose, and the last audit of the skill found the block's defect: its pass
// line, `head unchanged`, depended on the two head lookups ONLY. The workflow
// runs, the jobs, the statuses and the mergeability query could each fail, or
// come back in part, and the line still printed.
//
// Here every read is a condition of that line. In order, on the repository
// `lib/gh.mjs` names:
//
//   1. The head: `gh pr view --json headRefOid`. 40 lowercase hex characters.
//   2. The workflow runs on that head, every page (`ghPaginatedObject`, which
//      throws on a short or repeated read). Every run names that head.
//   3. The jobs of every run, every page.
//   4. The commit's COMBINED status, every page. The plain statuses listing
//      the block used is an array with no total, so a short read of it cannot
//      be told from a whole one (design review r1); the combined status
//      carries `total_count` and the latest status of each context, which is
//      what this read asks. A status whose context is exactly `validate` or
//      `DCO` is printed as named like a required job: it is not a workflow
//      run, and the skill does not count it as green.
//   5. Whether the pull request changes `.github/workflows/`: `git fetch
//      origin`, the head commit present in this clone, then a three-dot diff
//      against `origin/main`. "Changed" and "could not compare" were one line
//      in the block; here the first is reported and the second is a failed
//      read.
//   6. Mergeability: `gh pr view --json mergeable,mergeStateStatus`.
//   7. The head again. It must equal the first.
//
// Evidence lines are printed as they are read. The LAST line on stdout
// decides: `head unchanged: <sha>` (exit 0) only when every read above came
// back whole and the two heads are equal; otherwise `NO HAND-OFF: <the read
// that failed>` (exit 1; exit 2 for a bad argument). Lines printed before a
// `NO HAND-OFF` are not evidence of anything.
//
// ⚠️ It reads; it does not judge. `head unchanged` says the evidence was read
// whole against one head that did not move. It does not say the runs are
// green, that both required workflows ran, or that the pull request can be
// merged: zero runs on a head is a successful read. The judgement stays where
// step 7 puts it, reported item by item to the owner, who merges. And nothing
// here stops an agent that skips the script.
//
// `spawn` is a parameter everywhere (the source's pattern, `lib/gh.mjs`), so
// the tests start neither `gh` nor `git`.

import { spawnSync } from "node:child_process";
import { isMainModule } from "./lib/main-module.mjs";
import {
  ghJson,
  ghPaginatedObject,
  requirePositiveInt,
  REPO_SLUG,
} from "./lib/gh.mjs";

const SHA = /^[0-9a-f]{40}$/;

/** Contexts that would read as a required job if a status carried them. */
export const REQUIRED_JOB_NAMES = ["validate", "DCO"];

const isText = (value) => typeof value === "string" && value !== "";
const isTextOrNull = (value) => value === null || isText(value);

/** Run one read; a failure is renamed after the read it belongs to. */
function reading(name, read) {
  try {
    return read();
  } catch (cause) {
    throw new Error(`${name}: ${cause.message}`, { cause });
  }
}

export function readHead(spawn, pr) {
  const view = ghJson(spawn, [
    "pr",
    "view",
    String(pr),
    "-R",
    REPO_SLUG,
    "--json",
    "headRefOid",
  ]);
  const sha = view === null || typeof view !== "object" ? "" : view.headRefOid;
  if (typeof sha !== "string" || !SHA.test(sha)) {
    throw new Error("the head is not a 40-character commit");
  }
  return sha;
}

export function readRuns(spawn, sha) {
  const { items } = ghPaginatedObject(
    spawn,
    `repos/${REPO_SLUG}/actions/runs?head_sha=${sha}&per_page=100`,
    "workflow_runs",
  );
  for (const run of items) {
    if (
      !isText(run.path) ||
      !isText(run.event) ||
      !isText(run.status) ||
      !isTextOrNull(run.conclusion)
    ) {
      throw new Error(`run ${run.id} is missing a field`);
    }
    if (run.head_sha !== sha) {
      throw new Error(`run ${run.id} is for another commit`);
    }
  }
  return items;
}

export function readJobs(spawn, runId) {
  const { items } = ghPaginatedObject(
    spawn,
    `repos/${REPO_SLUG}/actions/runs/${runId}/jobs?per_page=100`,
    "jobs",
  );
  for (const job of items) {
    if (
      !isText(job.name) ||
      !isText(job.status) ||
      !isTextOrNull(job.conclusion)
    ) {
      throw new Error(`job ${job.id} is missing a field`);
    }
  }
  return items;
}

export function readStatuses(spawn, sha) {
  const { items, pages } = ghPaginatedObject(
    spawn,
    `repos/${REPO_SLUG}/commits/${sha}/status?per_page=100`,
    "statuses",
  );
  if (pages.some((page) => page.sha !== sha)) {
    throw new Error("the combined status is for another commit");
  }
  for (const status of items) {
    if (!isText(status.context) || !isText(status.state)) {
      throw new Error(`status ${status.id} is missing a field`);
    }
  }
  return items;
}

function git(spawn, args) {
  const result = spawn("git", args, { encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }
  return result;
}

/** `true` when the pull request changes a workflow, `false` when it does not. */
export function readWorkflowsChanged(spawn, sha) {
  const fetched = git(spawn, ["fetch", "origin"]);
  if (fetched.status !== 0) {
    throw new Error(
      `git fetch origin failed (${fetched.status}): ${(fetched.stderr ?? "").trim()}`,
    );
  }
  const present = git(spawn, ["cat-file", "-e", `${sha}^{commit}`]);
  if (present.status !== 0) {
    throw new Error("the head commit is not in this clone");
  }
  const diff = git(spawn, [
    "diff",
    "--quiet",
    `origin/main...${sha}`,
    "--",
    ".github/workflows/",
  ]);
  if (diff.status === 0) {
    return false;
  }
  if (diff.status === 1) {
    return true;
  }
  throw new Error(
    `the comparison could not be made (git diff ${diff.signal ?? diff.status})`,
  );
}

export function readMergeability(spawn, pr) {
  const view = ghJson(spawn, [
    "pr",
    "view",
    String(pr),
    "-R",
    REPO_SLUG,
    "--json",
    "mergeable,mergeStateStatus",
  ]);
  if (
    view === null ||
    typeof view !== "object" ||
    !isText(view.mergeable) ||
    !isText(view.mergeStateStatus)
  ) {
    throw new Error("the answer is missing a field");
  }
  return view;
}

/**
 * Every read, in order. Returns `{ pass, line }`; `line` is the one line that
 * decides, and it is `head unchanged: <sha>` only when `pass`.
 */
export function handoffCheck(spawn, pr, log) {
  try {
    const sha = reading("the head", () => readHead(spawn, pr));

    const runs = reading("the workflow runs", () => readRuns(spawn, sha));
    for (const run of runs) {
      log(
        `run=${run.id} ${run.path} ${run.event} ${run.status} ${run.conclusion}`,
      );
    }

    let jobCount = 0;
    for (const run of runs) {
      const jobs = reading(`the jobs of run ${run.id}`, () =>
        readJobs(spawn, run.id),
      );
      jobCount += jobs.length;
      for (const job of jobs) {
        log(`run=${run.id} job=${job.name} ${job.status} ${job.conclusion}`);
      }
    }

    const statuses = reading("the commit statuses", () =>
      readStatuses(spawn, sha),
    );
    const named = statuses.filter((status) =>
      REQUIRED_JOB_NAMES.includes(status.context),
    );
    for (const status of named) {
      log(
        `STATUS NAMED LIKE A REQUIRED JOB (not a workflow run): ${status.context} ${status.state}`,
      );
    }

    const changed = reading("the workflow comparison", () =>
      readWorkflowsChanged(spawn, sha),
    );
    log(
      changed
        ? "THIS PR CHANGES THE WORKFLOWS"
        : "workflows unchanged by this PR",
    );

    const merge = reading("the mergeability", () =>
      readMergeability(spawn, pr),
    );
    log(
      `mergeable=${merge.mergeable} mergeStateStatus=${merge.mergeStateStatus}`,
    );

    const again = reading("the head, read again", () => readHead(spawn, pr));
    if (again !== sha) {
      return {
        pass: false,
        line: `NO HAND-OFF: the head moved while it was read (was ${sha}, is ${again})`,
      };
    }

    log(
      `read whole: ${runs.length} run(s), ${jobCount} job(s), ${statuses.length} status(es), ` +
        `${named.length} named like a required job; reported, not judged`,
    );
    return { pass: true, line: `head unchanged: ${sha}` };
  } catch (cause) {
    return { pass: false, line: `NO HAND-OFF: ${cause.message}` };
  }
}

export function main(argv, { spawn = spawnSync, log = console.log } = {}) {
  let pr;
  try {
    if (argv.length !== 1) {
      throw new Error("usage: handoff-check <PR number>");
    }
    pr = requirePositiveInt(argv[0], "the PR number");
  } catch (cause) {
    log(`NO HAND-OFF: ${cause.message}`);
    return 2;
  }
  const { pass, line } = handoffCheck(spawn, pr, log);
  log(line);
  return pass ? 0 : 1;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
