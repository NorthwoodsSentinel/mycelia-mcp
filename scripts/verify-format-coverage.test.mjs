// Tests for verify-format-coverage: the pure checker with fake inputs, then
// one real-git, real-Prettier run in a temporary repository, so the ignore
// resolution is Prettier's own, not a stub's; then this repository itself.
//
// In this repo: the cases come from a reviewed port of the MCP Inspector's
// guard in a private sibling repository (see the guard's header); a comment
// or test name that cites a review round ("Codex audit r8", "design r1 #3")
// means a round of that port's review. Two differences from the port: its
// allowed-exclusion case is gone, because this repo allows no exclusion (a
// tracked source file Prettier ignores always fails), and the fixture folder
// is `scripts/`. Record: PROVENANCE.md. Run by `npm run test:scripts`, which
// names this file by path: `node --test` exits 0 on a glob that matches
// nothing.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  checkCoverage,
  notGated,
  matchesLikePrettier,
  reachedCheckGlobs,
  run,
} from "./verify-format-coverage.mjs";

const GLOB = '"**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"';
const SCRIPTS = {
  "format:check": `prettier --check ${GLOB}`,
  validate: "npm run format:check && npm run lint",
  lint: "eslint .",
};
const never = async () => false;

test("a leading ./ in a glob names the same files (Codex audit r8)", async () => {
  const { failures } = await checkCoverage({
    scripts: { validate: "npm run fc", fc: 'prettier --check "./**/*.ts"' },
    tracked: ["src/a.ts", "scripts/b.ts"],
    ignored: never,
  });
  assert.deepEqual(failures, []);
});

test("harvests only prettier --check globs that validate reaches", () => {
  assert.deepEqual(reachedCheckGlobs(SCRIPTS), [
    "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
  ]);
  // A format:check nothing runs is not evidence (Codex design r2 #3).
  assert.deepEqual(
    reachedCheckGlobs({ ...SCRIPTS, validate: "npm run lint" }),
    [],
  );
  // A --write is not a check.
  assert.deepEqual(
    reachedCheckGlobs({ validate: `prettier --write ${GLOB}` }),
    [],
  );
});

test("an option's value is never harvested as a target (Codex audit r1)", () => {
  const harvest = (cmd) =>
    reachedCheckGlobs({ validate: "npm run fc", fc: cmd });
  assert.deepEqual(
    harvest('prettier --check --ignore-path scripts/skipped.ts "src/**/*.ts"'),
    ["src/**/*.ts"],
  );
  assert.deepEqual(
    harvest('prettier --config .prettierrc --check --plugin p "a/**/*.ts"'),
    ["a/**/*.ts"],
  );
  assert.deepEqual(harvest('prettier -c --ignore-path=x "b/**/*.ts"'), [
    "b/**/*.ts",
  ]);
  assert.deepEqual(harvest('prettier --check --no-config -- "c/**/*.ts"'), [
    "c/**/*.ts",
  ]);
  // An option the flag list does not know swallows its next token: the guard
  // under-counts (a false fail), never over-counts.
  assert.deepEqual(harvest('prettier --check --new-thing "d/**/*.ts"'), []);
});

test("prettier must be the executed command, not a word in it (Codex audit r2)", () => {
  const harvest = (cmd) =>
    reachedCheckGlobs({ validate: "npm run fc", fc: cmd });
  const G = '"**/*.ts"';
  // Non-executions: no glob counts.
  for (const cmd of [
    `echo prettier --check ${G}`,
    `true prettier --check ${G}`,
    `printf %s prettier --check ${G}`,
    `node -e 1 prettier --check ${G}`,
  ])
    assert.deepEqual(harvest(cmd), [], cmd);
  // Real invocations: the glob counts.
  for (const cmd of [
    `prettier --check ${G}`,
    `CI=1 prettier --check ${G}`,
    `npx prettier --check ${G}`,
    `npx --yes prettier --check ${G}`,
    `bunx prettier --check ${G}`,
    `bun x prettier --check ${G}`,
    `node_modules/.bin/prettier --check ${G}`,
    `npm run lint && prettier --check ${G}`,
  ])
    assert.deepEqual(harvest(cmd), ["**/*.ts"], cmd);
});

test("a check whose failure cannot fail validate is not enforcement (Codex audit r3)", async () => {
  const fc = 'prettier --check "**/*.ts"';
  for (const scripts of [
    // validate only echoes the reference: prettier never runs.
    { validate: "echo npm run fc && npm run lint", fc },
    // validate swallows the status.
    { validate: "npm run fc || true", fc },
    { validate: "npm run fc; npm run lint", fc },
    // the check itself swallows it.
    { validate: "npm run fc && npm run lint", fc: `${fc} || true` },
    { validate: "npm run fc", fc: `${fc} | cat` },
    { validate: "npm run fc", fc: `${fc} & wait` },
    { validate: "npm run fc", fc: `$(${fc})` },
  ]) {
    const { failures } = await checkCoverage({
      scripts,
      tracked: ["src/unformatted.ts"],
      ignored: never,
    });
    assert.match(
      failures[0] ?? "",
      /reaches no `prettier --check`/,
      JSON.stringify(scripts),
    );
  }
});

test("enforcing && chains are followed through every level", () => {
  assert.deepEqual(
    reachedCheckGlobs({
      validate: "npm run a && npm run lint",
      a: "npm run-script b",
      b: 'CI=1 npx prettier --check "x/**/*.ts"',
    }),
    ["x/**/*.ts"],
  );
});

test("an echoed prettier --check leaves the files uncovered", async () => {
  const { failures } = await checkCoverage({
    scripts: { validate: "npm run fc", fc: 'echo prettier --check "**/*.ts"' },
    tracked: ["src/unformatted.ts"],
    ignored: never,
  });
  assert.match(failures[0], /reaches no `prettier --check`/);
});

test("a check with its own --ignore-path is refused (Codex audit r6)", async () => {
  const G = '"**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"';
  for (const fc of [
    `prettier --check --ignore-path .format-ignore ${G}`,
    `prettier --check --ignore-path=.format-ignore ${G}`,
    `prettier --check --ignore-path .gitignore --ignore-path scripts/x ${G}`,
    // Codex audit r7: one default alone replaces both, so it is not the
    // guard's model either.
    `prettier --check --ignore-path=.gitignore ${G}`,
    `prettier --check --ignore-path .prettierignore ${G}`,
  ]) {
    const { failures } = await checkCoverage({
      scripts: { validate: "npm run fc", fc },
      tracked: ["scripts/unformatted.ts"],
      ignored: never,
    });
    assert.equal(failures.length, 1, fc);
    assert.match(failures[0], /uses its own --ignore-path/, fc);
  }
  // The defaults, named explicitly, are the guard's own model: allowed.
  const { failures } = await checkCoverage({
    scripts: {
      validate: "npm run fc",
      fc: `prettier --check --ignore-path .gitignore --ignore-path ./.prettierignore ${G}`,
    },
    tracked: ["scripts/x.ts"],
    ignored: never,
  });
  assert.deepEqual(failures, []);
});

test("a check with a target that is not a plain glob is refused (Codex audits r12, r13)", async () => {
  const G = '"**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"';
  for (const fc of [
    // A negated target, in each position and spelling.
    `prettier --check ${G} "!scripts/**"`,
    `prettier --check "!scripts/**" ${G}`,
    `prettier --check ${G} !scripts/unformatted.ts`,
    `prettier --check -- ${G} "!scripts/**"`,
    `prettier --check ${G} "!./scripts/**"`,
    // r13: the shell hands Prettier `!scripts/**` for each of these too.
    `prettier --check ${G} \\!scripts/**`,
    `prettier --check ${G} '!'scripts/**`,
    `prettier --check ${G} !"scripts/**"`,
    // A target the guard cannot read at all may be one.
    `prettier --check ${G} $EXCLUDE`,
    `prettier --check ${G} "scripts/!(x).ts"`,
    `prettier --check ${G} "scripts/[!a]*.ts"`,
  ]) {
    const { failures } = await checkCoverage({
      scripts: { validate: "npm run fc", fc },
      tracked: ["scripts/unformatted.ts"],
      ignored: never,
    });
    assert.equal(failures.length, 1, fc);
    assert.match(failures[0], /not a plain glob \(/, fc);
  }
  // Only an ENFORCING check is read: a `--write` that validate also reaches
  // gates nothing, so its negation takes nothing away from the check.
  const { failures } = await checkCoverage({
    scripts: {
      validate: "npm run fc && npm run fmt",
      fc: `prettier --check ${G}`,
      fmt: `prettier --write ${G} "!scripts/**"`,
    },
    tracked: ["scripts/x.ts"],
    ignored: never,
  });
  assert.deepEqual(failures, []);
});

test("validate reaching no prettier --check fails, whatever the files", async () => {
  const { failures } = await checkCoverage({
    scripts: { ...SCRIPTS, validate: "npm run lint" },
    tracked: ["src/a.ts"],
    ignored: never,
  });
  assert.match(failures[0], /reaches no `prettier --check`/);
});

test("a narrowed glob fails, naming the file it no longer covers", async () => {
  const { failures } = await checkCoverage({
    scripts: { ...SCRIPTS, "format:check": 'prettier --check "src/**/*.ts"' },
    tracked: ["src/a.ts", "scripts/x.mjs"],
    ignored: never,
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /^scripts\/x\.mjs — matched by no/);
});

test("a new extension outside the glob fails", async () => {
  const { failures } = await checkCoverage({
    scripts: {
      ...SCRIPTS,
      "format:check": 'prettier --check "**/*.{ts,js}"',
    },
    tracked: ["src/a.ts", "src/b.mts"],
    ignored: never,
  });
  assert.deepEqual(
    failures.map((f) => f.split(" ")[0]),
    ["src/b.mts"],
  );
});

test("a tracked source file Prettier ignores fails", async () => {
  const { failures } = await checkCoverage({
    scripts: SCRIPTS,
    tracked: ["scripts/x.ts"],
    ignored: async () => true,
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /^scripts\/x\.ts — Prettier ignores it/);
});

test("non-source files are not counted", async () => {
  const { failures, checked } = await checkCoverage({
    scripts: SCRIPTS,
    tracked: ["README.md", "package.json", "src/a.ts"],
    ignored: never,
  });
  assert.deepEqual([failures, checked], [[], 1]);
});

test("matches dot-directories the way Prettier's glob does", () => {
  const glob = "**/*.{ts,mjs}";
  assert.equal(matchesLikePrettier(".github/x.mjs", glob), true);
  assert.equal(matchesLikePrettier("a/.hidden/x.ts", glob), true);
  assert.equal(matchesLikePrettier(".github/x.md", glob), false);
  // Codex audit r5: the dot stand-in must not collide with a real name.
  assert.equal(
    matchesLikePrettier(".github/probe.mjs", "**/_github/*.mjs"),
    false,
  );
  assert.equal(matchesLikePrettier(".github/x.mjs", ".github/**/*.mjs"), true);
});

const scratch = mkdtempSync(path.join(tmpdir(), "format-coverage-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

test("real git + real Prettier: a .gitignore entry over a tracked file fails", async () => {
  const root = path.join(scratch, "repo");
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: SCRIPTS }),
  );
  writeFileSync(path.join(root, "scripts", "x.ts"), "export const x = 1;\n");
  writeFileSync(path.join(root, "scripts", "y.ts"), "export const y = 1;\n");
  writeFileSync(path.join(root, ".prettierignore"), "\n");
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    });
  git("init", "-q");
  git("add", "-A");
  assert.deepEqual((await run({ root })).failures, []);

  // Tracked already; a later .gitignore line makes Prettier skip it.
  writeFileSync(path.join(root, ".gitignore"), "scripts/x.ts\n");
  const { failures } = await run({ root });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /^scripts\/x\.ts — Prettier ignores it/);
});

test("no parser counts as not gated, like an ignore (Codex audit r8)", () => {
  assert.equal(
    notGated({ ignored: false, inferredParser: "typescript" }),
    false,
  );
  assert.equal(notGated({ ignored: true, inferredParser: null }), true);
  assert.equal(notGated({ ignored: false, inferredParser: null }), true);
});

test("this repository passes", async () => {
  assert.deepEqual((await run()).failures, []);
});
