// The tracked-TypeScript inventory: the set of files a guard here requires an
// answer for. `scripts/verify-typecheck-coverage.mjs` compares it with the
// TypeScript program, and `scripts/verify-coverage-scope.mjs` with the
// expanded coverage declaration. It exists because "every tracked TypeScript
// file is typechecked and coverage-measured, or named" needs one list of
// tracked files that no glob in a config can narrow.
//
// In this repo: the behaviour is the MCP Inspector's
// scripts/verify-typecheck-coverage.mjs (modelcontextprotocol/inspector, blob
// 1f71e2c4bed881dbb63fa6b85f37d33e719c9548, the same blob at `main` eb54b44):
// `isRequiredSource` (its lines 79-86) and the
// `git ls-files "*.ts" "*.tsx" "*.mts" "*.cts"` inventory with build output
// dropped (its lines 406-446). Deny-by-default: a file at a new top-level
// location is required without editing anything. The module itself comes from
// a reviewed port of that guard in a private sibling repository, which split
// the inventory out; "Codex case 13" below is a case of that port's review.
// Record: PROVENANCE.md.
//
// One change from the Inspector, made in the port: `git ls-files -z`. The
// Inspector's version splits on newlines, which turns a filename containing a newline into
// two invented paths and returns names Git has quoted (spaces are fine, but
// tabs, non-ASCII and quotes come back in C-quoted form). NUL-delimited output
// has neither problem (Codex case 13).
//
// One change from the port, made here: the build-output list. It is this
// repo's tsconfig.json `exclude`, name for name (node_modules, dist, build,
// coverage, .scratch), so the inventory and the program leave out the same
// directories. Build output is dropped by path segment: a tracked file under a
// directory with one of these names, at any depth, leaves the inventory.
// AGENTS.md forbids tracking build output ("Build output is never a gate
// target"); that rule, not this module, is what keeps such a file from
// existing.

import { spawnSync } from "node:child_process";

/** The four TypeScript source extensions, minus ambient declaration files. */
export const isRequiredSource = (rel) =>
  /\.(ts|tsx|mts|cts)$/.test(rel) && !/\.d\.(ts|mts|cts)$/.test(rel);

export const GENERATED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".scratch",
]);

const isGenerated = (rel) =>
  rel.split("/").some((segment) => GENERATED_DIRS.has(segment));

/**
 * Split NUL-delimited `git ls-files -z` output into paths.
 *
 * @param {string} out
 * @returns {string[]}
 */
export function parseNulList(out) {
  return out.split("\0").filter((p) => p !== "");
}

/**
 * Tracked first-party TypeScript, repo-relative, sorted. Throws when Git
 * fails, so "inventory unavailable" is never read as "nothing required".
 * An empty result is returned as empty; each caller fails on it.
 *
 * @param {string} root
 * @param {string} [git] the git executable (found on PATH, as the source does)
 * @returns {string[]}
 */
export function trackedTypeScript(root, git = "git") {
  const ran = spawnSync(
    git,
    ["ls-files", "-z", "--", "*.ts", "*.tsx", "*.mts", "*.cts"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (ran.error)
    throw new Error(
      `the TypeScript inventory could not run git ls-files: ${ran.error.message}`,
    );
  if (ran.status !== 0)
    throw new Error(
      `the TypeScript inventory failed: git ls-files exited ${ran.status ?? `by signal ${ran.signal}`}: ${ran.stderr.trim()}`,
    );
  return parseNulList(ran.stdout)
    .filter(isRequiredSource)
    .filter((f) => !isGenerated(f))
    .sort();
}
