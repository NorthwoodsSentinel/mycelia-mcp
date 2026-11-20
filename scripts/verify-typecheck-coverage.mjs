#!/usr/bin/env node
// verify:typecheck-coverage — every tracked TypeScript file gets a `tsc` pass,
// or is named in EXCLUDED with its reason.
//
// Why it exists here. `tsc --noEmit` passes on whatever the program holds and
// does not say which files that is. This repo's tsconfig.json `include` is
// `**/*.ts` (and the three other extensions), which does not enter a directory
// whose name starts with a dot, so a tracked `.ts` file under one is in no
// program and `tsc --noEmit` still exits 0. Lint catches some of those as a
// parser error, and none under `scripts/`, which lint ignores. This guard
// states the miss directly, naming the file.
//
// In this repo: ADAPTED from phase 2 of the MCP Inspector's
// scripts/verify-typecheck-coverage.mjs (modelcontextprotocol/inspector, blob
// 1f71e2c4bed881dbb63fa6b85f37d33e719c9548, the same blob at `main` eb54b44,
// lines 620-679): list the program with `tsc --listFilesOnly` (it includes
// import-reached files), take the tracked-file inventory
// (`lib/ts-inventory.mjs`), and fail naming each tracked file in no program.
// Its phase 1 (client enrollment, wiring checks, sibling vouching) is left
// out: this repo has one install and one project, and `typecheck` runs this
// guard itself, so the wiring is the script line. The adaptation comes, with
// only its comments changed, from a reviewed port of that guard in a private
// sibling repository. Record: PROVENANCE.md.
//
// Added in the port and kept: an EXCLUDED map whose entries are exact paths
// with reasons; a reasonless, untracked or now-typechecked entry fails as
// stale (the Inspector's KNOWN_OMISSIONS rules, in its
// verify-coverage-scope.mjs). EXCLUDED is empty here: all tracked TypeScript
// is in the program.
//
// Fails closed: a compiler that exits non-zero, dies by signal, prints an
// unusable record or lists nothing is a failure, not an empty program; an
// empty or failed inventory is a failure. Paths are compared canonically
// (resolved, realpath'd, repo-relative), so a symlinked checkout passes and a
// `<repo>-copy/...` path cannot stand for an in-repo file.
//
// Limit: the inventory drops a path with a segment named like a build-output
// directory (see `lib/ts-inventory.mjs`), so a tracked file under one is not
// required here.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./lib/main-module.mjs";
import { trackedTypeScript } from "./lib/ts-inventory.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * Exact repo-relative path → reason. Empty: every tracked TypeScript file is
 * in the program.
 *
 * @type {Record<string, string>}
 */
export const EXCLUDED = {};

const GLOB_CHARS = /[*?[\]{}!]/;
const hasReason = (r) => typeof r === "string" && r.trim() !== "";
const slash = (p) => p.split(path.sep).join("/");

/**
 * The TypeScript compiler's entry file, resolved from the repo's own install
 * and run with this Node (the source's `tscEntry` approach).
 *
 * @param {string} root
 */
export function tscEntry(root) {
  return createRequire(path.join(root, "package.json")).resolve(
    "typescript/bin/tsc",
  );
}

/**
 * Run `tsc -p tsconfig.json --listFilesOnly` and return the repo-relative
 * files of the program that are inside the repo.
 *
 * @param {string} root
 * @param {string} tsc path to a tsc entry script
 * @returns {{ files: string[] } | { failure: string }}
 */
export function programFiles(root, tsc) {
  const ran = spawnSync(
    process.execPath,
    [tsc, "-p", "tsconfig.json", "--listFilesOnly"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (ran.error)
    return { failure: `could not run the compiler: ${ran.error.message}` };
  if (ran.signal)
    return { failure: `the compiler was killed by ${ran.signal}` };
  if (ran.status !== 0)
    return {
      failure: `the compiler exited ${ran.status}:\n${(ran.stdout + ran.stderr).trim()}`,
    };
  const records = ran.stdout.split(/\r?\n/).filter((l) => l !== "");
  if (records.length === 0)
    return {
      failure:
        "the compiler listed no files — an empty program is not evidence",
    };
  const realRoot = realpathSync(root);
  const files = [];
  for (const record of records) {
    if (record.includes("\0") || record.includes("�"))
      return {
        failure: `the compiler printed an unusable path record: ${JSON.stringify(record)}`,
      };
    if (!path.isAbsolute(record)) continue;
    let real;
    try {
      real = realpathSync(path.resolve(record));
    } catch {
      continue;
    }
    const rel = path.relative(realRoot, real);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    files.push(slash(rel));
  }
  return { files };
}

/**
 * @param {{
 *   tracked: readonly string[],
 *   program: readonly string[],
 *   excluded: Record<string, string>,
 * }} input
 * @returns {string[]} failures
 */
export function diffTypecheck({ tracked, program, excluded }) {
  if (tracked.length === 0)
    return [
      "the tracked TypeScript inventory is empty — nothing to check is a failure, not a pass",
    ];
  const failures = [];
  const inProgram = new Set(program);
  const trackedSet = new Set(tracked);
  for (const [entry, reason] of Object.entries(excluded)) {
    if (GLOB_CHARS.test(entry))
      failures.push(`EXCLUDED names ${entry}, a pattern — exact paths only`);
    else if (!hasReason(reason))
      failures.push(`EXCLUDED names ${entry} without a reason`);
    else if (!trackedSet.has(entry))
      failures.push(
        `EXCLUDED names ${entry}, which is not a tracked TypeScript file — stale; remove it`,
      );
    else if (inProgram.has(entry))
      failures.push(
        `EXCLUDED names ${entry}, which the program now typechecks — stale; remove it`,
      );
  }
  const missing = tracked.filter(
    (f) =>
      !inProgram.has(f) &&
      !(Object.hasOwn(excluded, f) && hasReason(excluded[f])),
  );
  if (missing.length > 0)
    failures.push(
      `${missing.length} tracked TypeScript file(s) are in no TypeScript program and not named in EXCLUDED:\n` +
        missing.map((f) => `    ${f} — in no tsconfig project`).join("\n"),
    );
  return failures;
}

/**
 * @param {{
 *   root?: string,
 *   tsc?: string,
 *   excluded?: Record<string, string>,
 *   inventory?: (root: string) => string[],
 * }} [deps]
 * @returns {{ failures: string[], checked: number }}
 */
export function run({
  root = repoRoot,
  tsc,
  excluded = EXCLUDED,
  inventory = trackedTypeScript,
} = {}) {
  let tracked;
  try {
    tracked = inventory(root);
  } catch (error) {
    return { failures: [error.message], checked: 0 };
  }
  if (tracked.length === 0)
    return {
      failures: diffTypecheck({ tracked, program: [], excluded }),
      checked: 0,
    };
  let entry;
  try {
    entry = tsc ?? tscEntry(root);
  } catch (error) {
    return {
      failures: [`cannot find the TypeScript compiler: ${error.message}`],
      checked: 0,
    };
  }
  const listed = programFiles(root, entry);
  if ("failure" in listed) return { failures: [listed.failure], checked: 0 };
  return {
    failures: diffTypecheck({ tracked, program: listed.files, excluded }),
    checked: tracked.length,
  };
}

// The symlink-safe entry check (see lib/main-module.mjs); a bare
// comparison exits 0 having checked nothing when run through a symlinked path.
if (isMainModule(import.meta.url)) {
  const { failures, checked } = run();
  if (failures.length > 0) {
    console.error(
      `verify:typecheck-coverage — ${failures.length} failure(s):\n`,
    );
    for (const f of failures) console.error(`  ${f}`);
    console.error(
      "\nA file in no program is outside `tsconfig.json`'s `include` (which does not enter a directory whose name starts with a dot) or is named in its `exclude`. Move the file, widen the `include`, or name it in EXCLUDED with its reason. See AGENTS.md.",
    );
    process.exit(1);
  }
  console.log(
    `verify:typecheck-coverage — OK: all ${checked} tracked TypeScript file(s) get a tsc pass or are named in EXCLUDED (${Object.keys(EXCLUDED).length}).`,
  );
}
