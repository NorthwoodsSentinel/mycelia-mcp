// Guard: every tracked first-party source file is format-gated.
//
// In this repo: the MCP Inspector's `scripts/verify-format-coverage.mjs`
// (`modelcontextprotocol/inspector` `main` eb54b44, its #1789/#1792), adapted.
// Its reason is the Inspector's: a `prettier --check` glob that stops covering
// a file fails silently (the file is skipped, not reported), so a new
// directory or extension can reopen the gap unnoticed. The adaptation comes
// through a reviewed port of that guard in a private sibling repository; a
// comment below that cites a review round ("Codex audit r3", "design r2 #3")
// means a round of that port's review. Record: `PROVENANCE.md`.
//
// What the port changed from the Inspector, kept here: one manifest, and
//
//   - The globs are harvested ONLY from `prettier --check` invocations that
//     `validate` actually reaches through ENFORCING edges (`enforcingReach`:
//     plain `&&` chains, no masking; Codex audit r3). A `format:check` nothing
//     runs is not evidence of enforcement, and if `validate` reaches no
//     `prettier --check` at all, the guard fails (design r2 #3).
//   - Ignores are resolved by Prettier itself, with the ignore files its CLI
//     reads by default (`.gitignore`, `.prettierignore`), through its public
//     `getFileInfo`. A positive-glob-only check would pass a tracked file a
//     later `.gitignore` entry makes Prettier skip (design r1 #3).
//
// What this repo changed from the port: THERE IS NO ALLOWED EXCLUSION. The
// port carried a map of tracked folders Prettier may ignore; it is removed,
// with its branch. `.prettierignore` here names only `coverage/` and
// `.scratch/`, both untracked output, and there is no vendored folder, so a
// tracked source file that Prettier ignores, or that no reached glob matches,
// always fails.
//
// The guard errs toward failing. A format chain that uses `||`, `;` or a pipe,
// a check with its own `--ignore-path`, and a target that is not a plain glob
// are each refused or not followed, where deciding would need a shell or CLI
// grammar: a false fail, never a false pass.
//
// Glob matching uses Node's `path.matchesGlob`, whose `**` does not enter a
// directory whose name starts with a dot. Prettier's does (measured in a
// scratch directory with this repo's Prettier 3.8.4, 2026-11-20 UTC: an
// unformatted `.dotprobe/probe.ts` was reported by
// `prettier --check "**/*.{ts,…}"`). So a file also matches when the glob
// matches its path with each leading dot replaced by a NUL character, which
// no glob can contain, so no real name can collide (Codex audit r5). A glob
// that names a dot-directory literally still matches the real path.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./lib/main-module.mjs";
import { tokenize } from "./lib/npm-scripts.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Extensions Prettier formats as first-party source here. */
export const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

/** The ignore files Prettier's CLI reads by default, in its order. */
export const IGNORE_FILES = [".gitignore", ".prettierignore"];

/**
 * Prettier CLI options that take NO value, from `prettier --help` (3.8.4,
 * read 2026-11-19; the ones it shows with a `<…>` take one). After any other
 * option written without `=`, the next token is that option's VALUE, not a
 * target (Codex audit r1: `--ignore-path scripts/x.ts` had been
 * harvested as a glob, a false pass). An option this list does not know
 * therefore swallows the token after it, which can only make the guard
 * under-count globs: a false fail, never a false pass.
 */
export const PRETTIER_FLAGS = new Set([
  "-c",
  "--check",
  "-l",
  "--list-different",
  "-w",
  "--write",
  "-u",
  "--ignore-unknown",
  "--bracket-same-line",
  "--no-bracket-spacing",
  "--experimental-ternaries",
  "--no-experimental-ternaries",
  "--jsx-single-quote",
  "--no-semi",
  "--single-attribute-per-line",
  "--single-quote",
  "--use-tabs",
  "--vue-indent-script-and-style",
  "--no-config",
  "--no-editorconfig",
  "--with-node-modules",
  "--cache",
  "--check-ignore-pragma",
  "--no-color",
  "--no-error-on-unmatched-pattern",
  "--insert-pragma",
  "--require-pragma",
]);

/**
 * The target arguments of one tokenized prettier invocation (everything after
 * `prettier`), skipping options and the values they take.
 *
 * @param {string[]} args
 * @returns {string[]}
 */
export function prettierTargets(args) {
  const targets = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      targets.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith("-")) {
      if (!a.includes("=") && !PRETTIER_FLAGS.has(a)) i++;
      continue;
    }
    targets.push(a);
  }
  return targets;
}

/** How prettier itself may be named as the executed command. */
const PRETTIER_BINS = new Set([
  "prettier",
  "node_modules/.bin/prettier",
  "./node_modules/.bin/prettier",
]);

/**
 * The arguments of `prettier` when it is the command a segment EXECUTES, or
 * null when it is not (Codex audit r2: `echo prettier --check …`
 * runs nothing, yet its glob had been harvested, a false pass).
 *
 * Accepted: leading `NAME=value` assignments, then `prettier` (or its
 * `node_modules/.bin` path), or `npx`/`bunx` (with `-y`/`--yes`) or `bun x`
 * followed by it. Anything else is not an invocation; a real one written some
 * other way is then not counted, which can only cause a false fail.
 *
 * @param {string[]} tokens
 * @returns {string[] | null}
 */
export function prettierInvocation(tokens) {
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  if (tokens[i] === "npx" || tokens[i] === "bunx") {
    i++;
    while (tokens[i] === "-y" || tokens[i] === "--yes") i++;
  } else if (tokens[i] === "bun" && tokens[i + 1] === "x") {
    i += 2;
  }
  return PRETTIER_BINS.has(tokens[i]) ? tokens.slice(i + 1) : null;
}

/**
 * Anything in a script that can run a command without its exit status failing
 * the script, or hide what runs: `||`, `;`, a pipe, a background `&`, command
 * substitution. A script containing one is not followed (Codex audit r3).
 */
const MASKING = /\|\||;|(?<!&)&(?!&)|\||\$\(|`/;

/**
 * The scripts `validate` reaches through ENFORCING edges only (Codex audit
 * r3). `reachableScripts` (the shared helper) follows `npm run X`
 * anywhere in a script's text, so `echo npm run fc` or `npm run fc || true`
 * still "reached" a check whose failure could not fail the gate: a false pass.
 * Here a script is followed only if it is a plain `&&` chain (no `MASKING`
 * construct), and an `npm run X` counts only as the command a segment runs.
 * A real chain written any other way is then not followed, which can only
 * cause a false fail. Without a shell parser this is the conservative reading.
 *
 * @param {Record<string, string>} scripts
 * @returns {string[]} reached script names, in visit order
 */
export function enforcingReach(scripts) {
  const reached = [];
  const queue = ["validate"];
  const seen = new Set();
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const cmd = scripts[name];
    if (typeof cmd !== "string" || MASKING.test(cmd)) continue;
    reached.push(name);
    for (const segment of cmd.split("&&")) {
      const t = tokenize(segment.trim());
      if (t[0] === "npm" && (t[1] === "run" || t[1] === "run-script") && t[2])
        queue.push(t[2]);
    }
  }
  return reached;
}

/**
 * The globs of every `prettier --check` that `validate` reaches through
 * enforcing edges, where prettier is the command a segment runs.
 *
 * @param {Record<string, string>} scripts
 * @returns {string[]}
 */
export function reachedCheckGlobs(scripts) {
  // A leading `./` names the same files to Prettier; the matcher compares
  // against `git ls-files` paths, which never carry one (Codex audit r8).
  return enforcingChecks(scripts)
    .flatMap(prettierTargets)
    .map((g) => g.replace(/^(\.\/)+/, ""));
}

/** The argument lists of every enforcing `prettier --check`. */
function enforcingChecks(scripts) {
  const checks = [];
  for (const name of enforcingReach(scripts)) {
    for (const segment of scripts[name].split("&&")) {
      const args = prettierInvocation(tokenize(segment.trim()));
      if (args === null || !(args.includes("--check") || args.includes("-c")))
        continue;
      checks.push(args);
    }
  }
  return checks;
}

/**
 * Every `--ignore-path` an enforcing check passes that is not one of the
 * defaults this guard resolves with (Codex audit r6). Prettier's
 * `--ignore-path` replaces the defaults, so a check naming its own file would
 * skip files the guard, asking only about the defaults, reports as gated: a
 * false pass. Rather than model each one, the guard refuses them.
 *
 * @param {Record<string, string>} scripts
 * @returns {string[]}
 */
export function customIgnorePaths(scripts) {
  const custom = [];
  for (const args of enforcingChecks(scripts)) {
    const given = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      const value = a.startsWith("--ignore-path=")
        ? a.slice("--ignore-path=".length)
        : a === "--ignore-path"
          ? (args[i + 1] ?? "")
          : null;
      if (value !== null) given.push(value.replace(/^\.\//, ""));
    }
    // None given: Prettier's defaults, which is the guard's own model. Given
    // explicitly: they REPLACE the defaults, so only exactly both defaults is
    // the same model (Codex audit r7: `--ignore-path=.gitignore` alone drops
    // `.prettierignore`, and modeling both would be a false fail).
    const same =
      given.length === 0 ||
      (new Set(given).size === IGNORE_FILES.length &&
        IGNORE_FILES.every((f) => given.includes(f)));
    if (!same) custom.push(given.join(" + "));
  }
  return custom;
}

// What a target may be made of for this guard to read it: path characters and
// the plain glob characters. No `!`, `$`, backslash, quote, space or bracket
// negation.
const PLAIN_GLOB = /^[A-Za-z0-9_./*?{},[\]@+~-]+$/;

/**
 * Every target of an enforcing check that is not a plain glob (Codex audits
 * r12 and r13). Prettier leaves out the files a negated pattern matches, so
 * in `prettier --check <glob> "!scripts/**"` nothing under `scripts/` is
 * checked, while the positive glob still matches every file there: a false
 * pass. A negation can also be spelled `\!scripts/**`, come from a variable, or
 * sit inside a pattern, so the rule is what a target MAY contain, not which
 * spellings are refused. As with a custom `--ignore-path`, the guard refuses
 * what it cannot read rather than model it.
 *
 * @param {Record<string, string>} scripts
 * @returns {string[]}
 */
function unreadableTargets(scripts) {
  return enforcingChecks(scripts)
    .flatMap(prettierTargets)
    .filter((target) => !PLAIN_GLOB.test(target));
}

/** Whether a tracked path matches a glob the way Prettier's expansion does. */
export function matchesLikePrettier(file, glob) {
  if (path.matchesGlob(file, glob)) return true;
  const undotted = file
    .split("/")
    .map((s) => (s.startsWith(".") ? `\0${s.slice(1)}` : s))
    .join("/");
  return path.matchesGlob(undotted, glob);
}

/**
 * @param {{
 *   scripts: Record<string, string>,
 *   tracked: string[],
 *   ignored: (file: string) => Promise<boolean>,
 * }} args
 * @returns {Promise<{ failures: string[], checked: number }>}
 */
export async function checkCoverage({ scripts, tracked, ignored }) {
  const custom = customIgnorePaths(scripts);
  if (custom.length > 0)
    return {
      failures: [
        `a \`prettier --check\` that validate runs uses its own --ignore-path (${custom.join(", ")}); this guard resolves ignores with ${IGNORE_FILES.join(" and ")} only, so it would not see what that file skips. Use the defaults.`,
      ],
      checked: 0,
    };
  const unreadable = unreadableTargets(scripts);
  if (unreadable.length > 0)
    return {
      failures: [
        `a \`prettier --check\` that validate runs has a target that is not a plain glob (${unreadable.join(", ")}). A \`!\` leaves files out, and a \`$\`, a backslash or a quote can spell one, so this guard would count the files it skips as checked. Use plain globs, and exclude files through .prettierignore, which this guard asks Prettier about.`,
      ],
      checked: 0,
    };
  const globs = reachedCheckGlobs(scripts);
  if (globs.length === 0)
    return {
      failures: [
        "`validate` reaches no `prettier --check`, so nothing is format-gated",
      ],
      checked: 0,
    };

  const sources = tracked.filter((f) =>
    SOURCE_EXTENSIONS.includes(path.extname(f)),
  );
  const failures = [];
  for (const file of sources) {
    if (!globs.some((g) => matchesLikePrettier(file, g))) {
      failures.push(
        `${file} — matched by no \`prettier --check\` glob that validate runs (${globs.join(", ")})`,
      );
      continue;
    }
    if (await ignored(file))
      failures.push(
        `${file} — Prettier ignores it (${IGNORE_FILES.join(" / ")}) or has no parser for it; this repo allows no exclusion`,
      );
  }
  return { failures, checked: sources.length };
}

/**
 * @param {{ root?: string }} [opts]
 * @returns {Promise<{ failures: string[], checked: number }>}
 */
export async function run({ root = repoRoot } = {}) {
  let scripts;
  let tracked;
  let prettier;
  try {
    scripts = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    ).scripts;
    tracked = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\0")
      .filter((f) => f !== "");
    prettier = await import("prettier");
  } catch (error) {
    return { failures: [error.message], checked: 0 };
  }
  const ignorePath = IGNORE_FILES.map((f) => path.join(root, f));
  return checkCoverage({
    scripts: scripts ?? {},
    tracked,
    ignored: async (file) =>
      notGated(
        await prettier.getFileInfo(path.join(root, file), { ignorePath }),
      ),
  });
}

/**
 * Whether Prettier's verdict on a file leaves it unchecked: ignored, OR with
 * no parser for it (design §2; Codex audit r8: an extension Prettier cannot
 * parse is checked by nothing, even when nothing ignores it).
 *
 * @param {{ ignored: boolean, inferredParser: string | null }} info
 */
export function notGated(info) {
  return info.ignored || info.inferredParser === null;
}

// The symlink-safe entry check (see lib/main-module.mjs).
if (isMainModule(import.meta.url)) {
  const { failures, checked } = await run();
  if (failures.length > 0) {
    console.error(`verify:format-coverage — ${failures.length} problem(s):\n`);
    for (const f of failures) console.error(`  ${f}`);
    console.error(
      "\nEvery tracked source file must be checked by a `prettier --check` that `validate` runs. Widen the glob, or fix the ignore. See AGENTS.md.",
    );
    process.exit(1);
  }
  console.log(
    `verify:format-coverage — OK: all ${checked} tracked source file(s) are format-gated.`,
  );
}
