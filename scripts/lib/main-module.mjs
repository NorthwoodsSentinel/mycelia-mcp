// "Was this file run directly?" — the entry guard for every `scripts/*.mjs`
// CLI that also exports its `main()` for tests (#2748).
//
// The guard these scripts used to carry was
//
//   if (import.meta.url === `file://${process.argv[1]}`) main();
//
// which only holds on POSIX. On Windows `process.argv[1]` is
// `C:\work\inspector\scripts\board-card-add.mjs` while `import.meta.url` is
// `file:///C:/work/inspector/scripts/board-card-add.mjs`, so the comparison is
// never true: `main()` never ran, and the process exited 0 having printed
// nothing — which a procedure waiting for a `card: …` line reads as "not done"
// only if the reader notices the line is missing. It also misses on POSIX for a
// path that needs percent-encoding (a space), since `import.meta.url` is
// encoded and `argv[1]` is not.
//
// `pathToFileURL` builds the same canonical URL Node builds for
// `import.meta.url`, so comparing against it is right on every platform.
// The platform is a parameter so the Windows case is exercised on the POSIX
// machines that run this suite, the same pattern as `win-shell-args.mjs`.
//
// In this repo: copied from modelcontextprotocol/inspector at commit
// d330df9617e44ec893bc1a53618662239342d433, scripts/lib/main-module.mjs,
// because scripts/dco-check.mjs imports it. The scripts named above are the
// source's. Record: PROVENANCE.md.
//
// One edit to his code: the entry path is ALSO compared after resolving
// symlinks. Node gives the entry module an `import.meta.url` built from the
// file's REAL path (unless `--preserve-symlinks-main`), while
// `process.argv[1]` keeps the path as typed. Run through a symlinked
// directory (macOS `/tmp` and the default temp directory are both symlinks),
// his comparison was never true: `main()` did not run and the process exited
// 0 having checked nothing, which for the sign-off check reads as a pass. The
// original comparison is kept first; the resolved one is added. A path that
// cannot be resolved (it does not exist, or it is a Windows path given to a
// POSIX machine in a test) falls back to his behaviour alone.

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * True when the module whose `import.meta.url` is given is the process's entry
 * point.
 *
 * @param {string} importMetaUrl the caller's `import.meta.url`
 * @param {string | undefined} [argv1] defaults to `process.argv[1]`; absent
 *   under `node -e` / the REPL, where nothing is the entry module
 * @param {NodeJS.Platform} [platform] defaults to `process.platform`
 * @returns {boolean}
 */
export function isMainModule(
  importMetaUrl,
  argv1 = process.argv[1],
  platform = process.platform,
) {
  if (typeof argv1 !== "string" || argv1 === "") return false;
  const asUrl = (file) =>
    pathToFileURL(file, { windows: platform === "win32" }).href;
  if (importMetaUrl === asUrl(argv1)) return true;
  // Local edit (see header): compare the symlink-resolved path too.
  let real;
  try {
    real = realpathSync(argv1);
  } catch {
    return false;
  }
  return real !== argv1 && importMetaUrl === asUrl(real);
}
