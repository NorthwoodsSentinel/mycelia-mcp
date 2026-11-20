// In this repo: the MCP Inspector's `scripts/verify-coverage-scope.mjs`
// (modelcontextprotocol/inspector, blob
// ec119f3d5bc1b91ecdd0b674335abda2ae466237, the same blob at `main` eb54b44),
// edited. The Inspector's header follows unchanged below this block; read
// "client" as "this repository", which has one coverage run at its root. The
// edits numbered 1 to 5 were made in a reviewed port of this guard in a
// private sibling repository, and the code comes from that port; a comment
// that cites "Codex design review r1" means that port's review, and "Edit N"
// in a comment below means item N here. Record: PROVENANCE.md.
//
// Why it is here. The per-file coverage bar (AGENTS.md, "Always test new or
// modified code") only judges the files that reach
// `coverage/coverage-summary.json`. Two things could shrink that set with
// every check still green, and this guard fails on both, by name:
//
//   (a) the run measures fewer files than `coverage.include` declares;
//   (b) a tracked TypeScript file is outside the declaration: here, a module
//       placed outside `src/`.
//
// This repo's declaration (vitest.config.ts) is `include: src/**/*.ts` minus
// `exclude: src/**/*.test.ts`. Coverage is measured inside `validate` here,
// not in a separate stage as in the Inspector, so the guard brackets the
// Vitest run inside `npm run test`: `--prepare` before it, the check after it.
//
// What differs from the Inspector, and why:
//
//   1. One root run instead of five clients: `CLIENTS`, the client roster and
//      its discovery are removed. `run()` checks `vitest.config.ts` at the
//      repo root and reads `coverage/coverage-summary.json` there.
//   2. A tracked-file inventory (Codex design review r1, finding 1). Every
//      tracked TypeScript file (`scripts/lib/ts-inventory.mjs`, the Inspector's
//      own `verify-typecheck-coverage.mjs` inventory) must be in the expanded
//      declaration, or be an exact path in `EXCLUDED`, or match a pattern in
//      `EXCLUDED_PATTERNS`. Otherwise it fails by name: a file that the
//      coverage declaration does not select is not under the per-file gate.
//      Entries need a reason; an entry that names no tracked file, or a file
//      the declaration now selects, is stale and fails (the Inspector's
//      `KNOWN_OMISSIONS` rules, applied to the new lists). `EXCLUDED` holds
//      exact paths only: a glob there is refused, so the reviewed pattern
//      list stays the only broad exclusion.
//   3. `--prepare` deletes the summary before the run and fails if it is still
//      there (Codex design review r1, finding 3): the Inspector's guard reads
//      whatever summary exists, so a summary left by an earlier run could be
//      judged. It removes the one path: a symlink is unlinked, not followed; a
//      directory there is a failure, not a recursive delete.
//   4. The summary must be a regular file, read through one O_NOFOLLOW,
//      O_NONBLOCK descriptor, non-empty, a JSON object, and list at least one
//      file. Its keys are compared canonically: only an absolute path counts,
//      resolved and realpath'd, so `file://…`, a relative `../…` and a
//      `<repo>-copy/…` spelling cannot stand for an in-repo file.
//   5. Vitest is closed exactly once when the config was resolved, even if
//      reading the resolved options throws.
//
// What differs from the port: `EXCLUDED` and `EXCLUDED_PATTERNS` are this
// repo's (one entry each), and the label in messages is this repo's name.
//
// Limit, the Inspector's own (see its header): an exclude is read leniently,
// so an over-broad exclude makes the guard expect fewer files.
//
// ---- the Inspector's header, unchanged ----
/**
 * Guards the file set each client's coverage run measures (#2709).
 *
 * The per-file ≥90 gate only judges the files that reach
 * `coverage/coverage-summary.json`. Nothing checked that the report holds the
 * files it should, so when a client's coverage `include` globs stop matching,
 * the gate shrinks silently and stays green. That happened during the #2557
 * dependency refresh: under vitest 5, whose fix for "coverage include/exclude
 * globs too eager" changed how `clients/web`'s mixed relative/absolute
 * patterns resolve, web's report fell from 418 files to 11 — every remaining
 * file cleared 90, every test passed, and only a by-hand comparison of the
 * summary file counts caught it. It is #1301's class (core/ files silently
 * leaving the gate), reached through a tooling upgrade instead of a path move.
 *
 * **The check compares the report against an independent expansion of the
 * client's own declaration.** For each client, Vitest resolves the config —
 * so the patterns read here are the ones the run actually used, hard-coded
 * default exclusions included — but the patterns are then expanded against
 * the file system with Node's own `fs.globSync` / `path.matchesGlob`, never
 * with Vitest's matcher. Asking the tool under test which files it meant would
 * agree with it by construction, which is exactly the blind spot this closes.
 * There is no file count to maintain: a new file under an included directory
 * is expected the moment it exists.
 *
 * **How a declared pattern is read** — the declaration, not any one Vitest
 * version's matcher, is the reference:
 *
 *   • an absolute pattern means itself;
 *   • a relative pattern resolves against the client directory, unless it
 *     starts with the client's own repo-relative path (`clients/web/server/**`
 *     in web's list), which can only mean a repo-root-relative path;
 *   • an exclude pattern removes a file when it matches the file's absolute,
 *     client-relative or repo-relative path. That is deliberately lenient: an
 *     over-broad exclude can only make the guard expect fewer files, never
 *     report a file as missing that the run was right to drop.
 *
 * Every client gated by `npm run coverage` is checked, and a client with a
 * `test:coverage` script that this guard does not list fails loudly rather
 * than going unchecked — the same deny-by-default as `verify:test-timeouts`.
 *
 * It reads coverage output, so it runs at the end of the root `coverage`
 * script (and with it in `local:gate` and the CI `coverage` job), not in
 * `validate`.
 *
 * ⚠️ Observed to FAIL before it was trusted: with web's summary reduced to
 * the `clients/web/server/**` rows a vitest 5 run produced, it names every
 * web component, hook, lib, util and core/ file that dropped out.
 */

import {
  closeSync,
  constants,
  fstatSync,
  globSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./lib/main-module.mjs";
import { trackedTypeScript } from "./lib/ts-inventory.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");

/** The config that declares the coverage scope, and the summary it writes. */
export const CONFIG = "vitest.config.ts";
export const SUMMARY = "coverage/coverage-summary.json";

/**
 * Tracked TypeScript the coverage run deliberately does not measure: exact
 * repo-relative paths, each with its reason. A file named here must be
 * tracked and outside the coverage declaration, or the entry fails as stale.
 *
 * @type {Record<string, string>}
 */
export const EXCLUDED = {
  "vitest.config.ts": "the test run's configuration, not code under test",
};

/**
 * The reviewed broad exclusions: patterns (Node's `path.matchesGlob`), each
 * with its reason. Nothing else broad may be added to `EXCLUDED`. The one
 * pattern here is the coverage `exclude` in vitest.config.ts, spelled the
 * same; the two are edited together.
 *
 * @type {Record<string, string>}
 */
export const EXCLUDED_PATTERNS = {
  "src/**/*.test.ts": "test files are not code under test",
};

/**
 * Files a client's declaration matches that its coverage run legitimately
 * omits, as repo-relative paths. Each entry must say why. Empty today.
 *
 * @type {Record<string, string>}
 */
export const KNOWN_OMISSIONS = {};

/** @param {string} p */
const slash = (p) => p.split(path.sep).join("/");

/**
 * Expand one client's coverage `include`/`exclude` against the file system.
 *
 * @param {{
 *   include: readonly string[],
 *   exclude: readonly string[],
 *   clientDir: string,
 *   repoRoot: string,
 * }} scope absolute `clientDir` and `repoRoot`
 * @returns {string[]} sorted absolute, forward-slashed file paths
 */
export function expandCoverageScope({ include, exclude, clientDir, repoRoot }) {
  const clientPrefix = `${slash(path.relative(repoRoot, clientDir))}/`;
  const files = new Set();
  for (const raw of include) {
    const pattern = slash(raw);
    let matches;
    if (path.isAbsolute(raw)) {
      matches = globSync(pattern);
    } else {
      const base = pattern.startsWith(clientPrefix) ? repoRoot : clientDir;
      matches = globSync(pattern, { cwd: base }).map((f) =>
        path.resolve(base, f),
      );
    }
    for (const f of matches) files.add(slash(path.resolve(f)));
  }
  const excludes = exclude.map(slash);
  return (
    [...files]
      .filter((abs) => {
        const candidates = [
          abs,
          slash(path.relative(clientDir, abs)),
          slash(path.relative(repoRoot, abs)),
        ];
        return !excludes.some((p) =>
          candidates.some((c) => path.matchesGlob(c, p)),
        );
      })
      // `globSync` returns directories too; a coverage report holds files.
      .filter((abs) => statSync(abs).isFile())
      .sort()
  );
}

/**
 * Compare the expected file set with the files a coverage summary reports.
 *
 * @param {{
 *   client: string,
 *   expected: readonly string[],
 *   reported: readonly string[],
 *   omissions?: Record<string, string>,
 *   repoRoot: string,
 * }} input absolute, forward-slashed paths
 * @returns {string[]} failure messages; empty when the scope holds
 */
export function diffCoverageScope({
  client,
  expected,
  reported,
  omissions = {},
  repoRoot,
}) {
  const failures = [];
  if (expected.length === 0) {
    failures.push(
      `${client}: its coverage include expands to no files at all — the ` +
        `declaration no longer names anything on disk`,
    );
    return failures;
  }
  const have = new Set(reported.map(slash));
  const rel = (abs) => slash(path.relative(repoRoot, abs));
  // An omission is honored only with a stated reason; an entry without one
  // would weaken the gate as silently as the glob drift this guard exists for.
  const isJustified = (r) =>
    typeof omissions[r] === "string" && omissions[r].trim() !== "";
  const missing = expected.filter(
    (f) => !have.has(f) && !(rel(f) in omissions && isJustified(rel(f))),
  );
  if (missing.length > 0) {
    failures.push(
      `${client}: ${missing.length} of ${expected.length} file(s) its coverage ` +
        `include declares are missing from coverage-summary.json (the report ` +
        `holds ${have.size}) — the run measured a narrower scope than it ` +
        `declares, so those files are not under the per-file gate:\n` +
        missing.map((f) => `    ${rel(f)}`).join("\n"),
    );
  }
  const expectedRel = new Set(expected.map(rel));
  const reportedRel = new Set([...have].map(rel));
  for (const omitted of Object.keys(omissions)) {
    if (!isJustified(omitted)) {
      failures.push(
        `${client}: KNOWN_OMISSIONS names ${omitted} without a reason — ` +
          `state why the run may omit it, or remove the entry`,
      );
    } else if (!expectedRel.has(omitted)) {
      failures.push(
        `${client}: KNOWN_OMISSIONS names ${omitted}, which its declaration ` +
          `no longer matches — a stale entry hides nothing and should be removed`,
      );
    } else if (reportedRel.has(omitted)) {
      failures.push(
        `${client}: KNOWN_OMISSIONS names ${omitted}, which the report now ` +
          `measures — the exemption is stale and should be removed`,
      );
    }
  }
  return failures;
}

const GLOB_CHARS = /[*?[\]{}!]/;
const hasReason = (r) => typeof r === "string" && r.trim() !== "";

/**
 * Edit 2: compare the tracked inventory with the expanded declaration and the
 * named exclusions. Pure, so its rules are tested without a run.
 *
 * @param {{
 *   tracked: readonly string[],
 *   expected: readonly string[],
 *   excluded: Record<string, string>,
 *   patterns: Record<string, string>,
 *   repoRoot: string,
 * }} input `tracked` repo-relative; `expected` absolute, forward-slashed
 * @returns {string[]} failures
 */
export function diffInventory({
  tracked,
  expected,
  excluded,
  patterns,
  repoRoot,
}) {
  const failures = [];
  if (tracked.length === 0) {
    failures.push(
      "the tracked TypeScript inventory is empty — nothing to check is a failure, not a pass",
    );
    return failures;
  }
  const rel = (abs) => slash(path.relative(repoRoot, abs));
  const declared = new Set(expected.map(rel));
  const trackedSet = new Set(tracked);
  for (const [entry, reason] of Object.entries(excluded)) {
    if (GLOB_CHARS.test(entry))
      failures.push(
        `EXCLUDED names ${entry}, a pattern — EXCLUDED takes exact paths only; a broad exclusion belongs in the reviewed EXCLUDED_PATTERNS`,
      );
    else if (!hasReason(reason))
      failures.push(`EXCLUDED names ${entry} without a reason`);
    else if (!trackedSet.has(entry))
      failures.push(
        `EXCLUDED names ${entry}, which is not a tracked TypeScript file — a stale entry hides nothing and should be removed`,
      );
    else if (declared.has(entry))
      failures.push(
        `EXCLUDED names ${entry}, which the coverage declaration now selects — the exclusion is stale and should be removed`,
      );
  }
  for (const [pattern, reason] of Object.entries(patterns)) {
    if (!hasReason(reason))
      failures.push(`EXCLUDED_PATTERNS names ${pattern} without a reason`);
    else if (!tracked.some((f) => path.matchesGlob(f, pattern)))
      failures.push(
        `EXCLUDED_PATTERNS names ${pattern}, which matches no tracked TypeScript file — remove it`,
      );
  }
  const outside = tracked.filter(
    (f) =>
      !declared.has(f) &&
      !(
        Object.hasOwn(excluded, f) &&
        hasReason(excluded[f]) &&
        !GLOB_CHARS.test(f)
      ) &&
      !Object.entries(patterns).some(
        ([p, r]) => hasReason(r) && path.matchesGlob(f, p),
      ),
  );
  if (outside.length > 0)
    failures.push(
      `${outside.length} tracked TypeScript file(s) are outside the expanded coverage declaration and are not named in EXCLUDED or EXCLUDED_PATTERNS, so they are not under the per-file gate:\n` +
        outside.map((f) => `    ${f}`).join("\n"),
    );
  return failures;
}

/**
 * Resolve the coverage options through Vitest's own config resolver, so the
 * patterns checked are the ones the run used. Edit 5: `close` runs exactly
 * once whenever an instance was created.
 *
 * @param {string} root
 * @param {string} configFile
 * @param {(mode: string, options: object) => Promise<{config: {coverage: {include?: string[], exclude?: string[]}}, close: () => Promise<void>}>} [create]
 * @returns {Promise<{include: string[], exclude: string[]}>}
 */
export async function resolveCoverageOptions(root, configFile, create) {
  const createVitest = create ?? (await import("vitest/node")).createVitest;
  const vitest = await createVitest("test", {
    watch: false,
    run: true,
    root,
    config: path.join(root, configFile),
  });
  try {
    const { include, exclude } = vitest.config.coverage;
    return { include: include ?? [], exclude: exclude ?? [] };
  } finally {
    await vitest.close();
  }
}

/**
 * Edit 4: read the summary as current, regular evidence.
 *
 * @param {string} summaryPath
 * @returns {{ reported: string[] } | { failure: string }}
 */
export function readSummary(summaryPath) {
  let fd;
  try {
    fd = openSync(
      summaryPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    return {
      failure: `cannot open ${summaryPath} as a regular file (${error.code ?? error.message}) — run the coverage first; a missing or symlinked summary is not evidence`,
    };
  }
  let text;
  try {
    if (!fstatSync(fd).isFile())
      return {
        failure: `${summaryPath} is not a regular file — not evidence`,
      };
    text = readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
  if (text.trim() === "") return { failure: `${summaryPath} is empty` };
  let summary;
  try {
    summary = JSON.parse(text);
  } catch (error) {
    return { failure: `${summaryPath} is not JSON: ${error.message}` };
  }
  if (summary === null || typeof summary !== "object" || Array.isArray(summary))
    return { failure: `${summaryPath} is not a JSON object` };
  const reported = Object.keys(summary).filter((k) => k !== "total");
  if (reported.length === 0)
    return { failure: `${summaryPath} reports no files at all` };
  return { reported };
}

/** An absolute, resolved, realpath'd spelling, or null for anything else. */
function canonical(p) {
  if (!path.isAbsolute(p)) return null;
  const resolved = path.resolve(p);
  try {
    return slash(realpathSync(resolved));
  } catch {
    return slash(resolved);
  }
}

/**
 * Edit 3: remove the exact summary path before a run and prove it gone.
 *
 * @param {string} [root]
 * @returns {string[]} failures
 */
export function prepare(root = repoRoot) {
  const target = path.join(root, SUMMARY);
  let entry;
  try {
    entry = lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    return [`cannot inspect ${SUMMARY}: ${error.message}`];
  }
  if (entry.isDirectory())
    return [
      `${SUMMARY} is a directory — refusing to remove it; remove it by hand`,
    ];
  try {
    unlinkSync(target);
  } catch (error) {
    return [`cannot remove ${SUMMARY}: ${error.message}`];
  }
  try {
    lstatSync(target);
    return [`${SUMMARY} still exists after removal`];
  } catch {
    return [];
  }
}

/**
 * @param {{
 *   root?: string,
 *   config?: string,
 *   omissions?: Record<string, string>,
 *   excluded?: Record<string, string>,
 *   patterns?: Record<string, string>,
 *   resolveOptions?: typeof resolveCoverageOptions,
 *   inventory?: (root: string) => string[],
 *   log?: (line: string) => void,
 * }} [deps]
 * @returns {Promise<string[]>} failures
 */
export async function run({
  root = repoRoot,
  config = CONFIG,
  omissions = KNOWN_OMISSIONS,
  excluded = EXCLUDED,
  patterns = EXCLUDED_PATTERNS,
  resolveOptions = resolveCoverageOptions,
  inventory = trackedTypeScript,
  log = (line) => console.log(line),
} = {}) {
  const realRoot = slash(realpathSync(root));
  const summary = readSummary(path.join(root, SUMMARY));
  if ("failure" in summary) return [summary.failure];
  let include;
  let exclude;
  try {
    ({ include, exclude } = await resolveOptions(root, config));
  } catch (error) {
    return [
      `could not resolve the coverage options from ${config}: ${error.message}`,
    ];
  }
  const expected = expandCoverageScope({
    include,
    exclude,
    clientDir: realRoot,
    repoRoot: realRoot,
  });
  const reported = summary.reported.map(canonical).filter((p) => p !== null);
  const failures = diffCoverageScope({
    client: "mycelia-mcp",
    expected,
    reported,
    omissions,
    repoRoot: realRoot,
  });
  if (expected.length > 0) {
    let tracked;
    try {
      tracked = inventory(root);
    } catch (error) {
      return [...failures, error.message];
    }
    failures.push(
      ...diffInventory({
        tracked,
        expected,
        excluded,
        patterns,
        repoRoot: realRoot,
      }),
    );
    if (failures.length === 0)
      log(
        `  ${expected.length} declared file(s), all measured; ${tracked.length} tracked TypeScript file(s), each declared or named`,
      );
  }
  return failures;
}

// The symlink-safe entry check (see lib/main-module.mjs); a bare
// comparison exits 0 having checked nothing when run through a symlinked path.
if (isMainModule(import.meta.url)) {
  const preparing = process.argv.includes("--prepare");
  const failures = preparing
    ? prepare()
    : (console.log(
        "verify:coverage-scope — coverage report holds its declared scope, and every tracked TypeScript file is declared or named",
      ),
      await run());
  if (failures.length > 0) {
    console.error(`\n✗ ${failures.length} coverage-scope failure(s):\n`);
    for (const f of failures) console.error(`  - ${f}\n`);
    process.exit(1);
  }
  console.log(
    preparing
      ? `verify:coverage-scope --prepare — ${SUMMARY} is absent`
      : "✓ the coverage report holds its declared file set; every tracked TypeScript file is declared or named",
  );
}
