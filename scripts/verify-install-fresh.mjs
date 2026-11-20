// Guard: the installed `node_modules` matches `bun.lock`.
//
// In this repo: the MCP Inspector's `scripts/verify-install-fresh.mjs`
// (`modelcontextprotocol/inspector` `main` eb54b44, its #2494), adapted from
// npm's `package-lock.json` to `bun.lock`. The adaptation comes, with only its
// comments changed, from a reviewed port of that guard in a private sibling
// repository; a comment below that cites a review round ("Codex design r1")
// means a round of that port's review. Record: `PROVENANCE.md`.
//
// Why it exists (the Inspector's reason, from its header). No other check
// here can see a checkout whose `node_modules` is older than the lockfile it
// sits beside. That is the ordinary state of a long-lived checkout after a
// pull brings in a dependency bump and nobody re-runs the install, and it
// fails far from its cause: in the Inspector, when the MCP SDK moved 2.0.0 to
// 2.1.0, a checkout still holding 2.0.0 passed every guard, lint and
// typecheck, and went red only in a behavioral test, which reported the OLD
// behavior as a product defect. With a stale install, green tests say nothing
// about the lockfile either.
//
// CI installs from scratch on every run, so this never fires there. It runs
// first in `validate` so a stale checkout fails in seconds, naming
// `bun install --frozen-lockfile`, instead of later on a test.
//
// It reads ground truth: each installed copy's own `package.json` `version`.
//
//   - `stale`: present, at a version other than the lockfile's.
//   - `missing`: absent, although REQUIRED on this host.
//
// Limits, accepted. It checks that what the lockfile requires is installed at
// the locked version, and nothing else: it does not report a package that is
// installed and not locked, and it does not compare `package.json`'s declared
// dependencies with the lockfile's root (CI's `--frozen-lockfile` install into
// an empty tree is the control for both). It trusts each installed copy's own
// `version`, and it reads registry-shaped entries: an npm alias fails closed
// (key and ident disagree, in `lib/bun-lock.mjs`), and a git or tarball entry
// would be compared by a string that is not a version.
//
// What is required (Codex design r1 #2, r2 #4, r3 #1) is computed by walking
// the lockfile's dependency graph from the root workspace:
//
//   - An edge from an entry at install path `p1/…/pk` to name `d` resolves the
//     way Node resolves: the first existing key among `p1/…/pk/d`, …, `p1/d`,
//     `d`. So two locked versions of one package are never confused.
//   - `dependencies`, and `peerDependencies` not named in `optionalPeers`, are
//     required edges. `optionalDependencies` are optional edges. A name in
//     `optionalPeers` is no edge at all (Bun need not install it).
//   - The root's `dependencies` and `devDependencies` are required edges; its
//     `optionalDependencies` are optional ones.
//   - A target reached by a required edge from the root, or from a PRESENT
//     required entry, is required. One reached only by optional edges is
//     required when its `os`, `cpu` and `libc` admit this host. Only present
//     entries are walked further: an absent package's own dependencies are not
//     expected (that is how `@emnapi/*`, wanted only by wasm bindings this host
//     never installs, stays out of the report).
//   - A required edge whose target the lockfile does not lock is itself a
//     failure: the lockfile is inconsistent, and nothing it says can be
//     trusted to pass.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBunLock, splitInstallPath } from "./lib/bun-lock.mjs";
import { isMainModule } from "./lib/main-module.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** This host's libc, as package metadata spells it, or null off Linux. */
export function hostLibc() {
  if (process.platform !== "linux") return null;
  const header = process.report?.getReport?.().header;
  return header?.glibcVersionRuntime ? "glibc" : "musl";
}

/**
 * Whether a package's platform field admits a value. A field may be absent
 * (admits everything), a string, or an array; an entry may be negated (`!x`).
 * An unknown shape fails closed by throwing.
 *
 * @param {unknown} field
 * @param {string | null} value
 */
export function admits(field, value) {
  if (field === undefined) return true;
  const list =
    typeof field === "string"
      ? [field]
      : Array.isArray(field) && field.every((s) => typeof s === "string")
        ? field
        : null;
  if (list === null)
    throw new Error(`unreadable platform field ${JSON.stringify(field)}`);
  if (value === null) return list.length === 0;
  const negated = list.filter((s) => s.startsWith("!")).map((s) => s.slice(1));
  const positive = list.filter((s) => !s.startsWith("!"));
  if (negated.includes(value)) return false;
  return positive.length === 0 || positive.includes(value);
}

const names = (obj, what, key) => {
  if (obj === undefined) return [];
  if (obj === null || typeof obj !== "object" || Array.isArray(obj))
    throw new Error(`bun.lock: ${key}: ${what} is not a map`);
  return Object.keys(obj);
};

/**
 * Compare a parsed lockfile against an install.
 *
 * @param {{
 *   lock: ReturnType<typeof parseBunLock>,
 *   readVersion: (dir: string) => string | undefined,
 *   host?: { platform: string, arch: string, libc: string | null },
 * }} args
 * @returns {{ stale: string[], missing: string[], errors: string[], checked: number }}
 */
export function checkInstall({ lock, readVersion, host }) {
  const here = host ?? {
    platform: process.platform,
    arch: process.arch,
    libc: hostLibc(),
  };
  const byKey = new Map(lock.entries.map((e) => [e.key, e]));
  const stale = [];
  const missing = [];
  const errors = [];

  const resolve = (fromKey, dep) => {
    const chain = fromKey === "" ? [] : splitInstallPath(fromKey);
    for (let k = chain.length; k >= 0; k--) {
      const key = [...chain.slice(0, k), dep].join("/");
      if (byKey.has(key)) return byKey.get(key);
    }
    return undefined;
  };

  const fits = (entry) =>
    admits(entry.meta.os, here.platform) &&
    admits(entry.meta.cpu, here.arch) &&
    (entry.meta.libc === undefined || admits(entry.meta.libc, here.libc));

  /** @type {Array<[string, string, boolean]>} [fromKey, dep, optional] */
  const edgesOf = (fromKey, deps, optionalDeps, peers, optionalPeers) => {
    const skip = new Set(optionalPeers);
    return [
      ...deps.map((d) => [fromKey, d, false]),
      ...peers.filter((d) => !skip.has(d)).map((d) => [fromKey, d, false]),
      ...optionalDeps.map((d) => [fromKey, d, true]),
    ];
  };

  const queue = edgesOf(
    "",
    [
      ...names(lock.root.dependencies, "dependencies", "root"),
      ...names(lock.root.devDependencies, "devDependencies", "root"),
    ],
    names(lock.root.optionalDependencies, "optionalDependencies", "root"),
    [],
    [],
  );
  const visited = new Set();

  while (queue.length > 0) {
    const [fromKey, dep, optional] = queue.shift();
    const target = resolve(fromKey, dep);
    if (target === undefined) {
      if (!optional)
        errors.push(
          `${fromKey || "the root project"} requires "${dep}", which bun.lock does not lock`,
        );
      continue;
    }
    if (visited.has(target.key)) continue;
    let required;
    try {
      required = !optional || fits(target);
    } catch (error) {
      errors.push(`${target.key}: ${error.message}`);
      continue;
    }
    if (!required) continue;
    visited.add(target.key);

    const installed = readVersion(target.dir);
    if (installed === undefined) {
      missing.push(`${target.dir} (${target.name}@${target.version})`);
      continue;
    }
    if (installed !== target.version)
      stale.push(
        `${target.dir}: installed ${installed}, bun.lock has ${target.version}`,
      );

    try {
      const m = target.meta;
      const optionalPeers = m.optionalPeers ?? [];
      if (!Array.isArray(optionalPeers))
        throw new Error(`bun.lock: ${target.key}: optionalPeers is not a list`);
      queue.push(
        ...edgesOf(
          target.key,
          names(m.dependencies, "dependencies", target.key),
          names(m.optionalDependencies, "optionalDependencies", target.key),
          names(m.peerDependencies, "peerDependencies", target.key),
          optionalPeers,
        ),
      );
    } catch (error) {
      errors.push(error.message);
    }
  }

  return { stale, missing, errors, checked: visited.size };
}

/** The installed copy's version, or undefined when absent. */
function versionReader(root) {
  return (dir) => {
    const manifest = path.join(root, dir, "package.json");
    if (!existsSync(manifest)) return undefined;
    const { version } = JSON.parse(readFileSync(manifest, "utf8"));
    return typeof version === "string" ? version : "(no version)";
  };
}

/**
 * @param {{ root?: string }} [opts]
 * @returns {{ failures: string[], checked: number }}
 */
export function run({ root = repoRoot } = {}) {
  let result;
  try {
    const lock = parseBunLock(
      readFileSync(path.join(root, "bun.lock"), "utf8"),
    );
    result = checkInstall({ lock, readVersion: versionReader(root) });
  } catch (error) {
    return { failures: [error.message], checked: 0 };
  }
  const failures = [
    ...result.errors,
    ...result.stale.map((s) => `stale: ${s}`),
    ...result.missing.map((m) => `missing: ${m}`),
  ];
  return { failures, checked: result.checked };
}

// The symlink-safe entry check (see lib/main-module.mjs).
if (isMainModule(import.meta.url)) {
  const { failures, checked } = run();
  if (failures.length > 0) {
    console.error(`verify:install-fresh — ${failures.length} problem(s):\n`);
    for (const f of failures) console.error(`  ${f}`);
    console.error(
      "\nnode_modules does not match bun.lock. Run `bun install --frozen-lockfile`, then the gate again.",
    );
    process.exit(1);
  }
  console.log(
    `verify:install-fresh — OK: ${checked} package(s) required on this host, each installed at its locked version.`,
  );
}
