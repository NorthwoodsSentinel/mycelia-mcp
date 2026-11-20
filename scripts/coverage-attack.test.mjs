// Attack cases 21 to 30 for the coverage-scope guard
// (scripts/verify-coverage-scope.mjs) and the per-file coverage thresholds.
//
// In this repo: the cases were written by the review model (Codex) for a
// reviewed port of the MCP Inspector's guard in a private sibling repository,
// and are kept in its order, under its numbers and names, which is why each
// test is called "Codex case N". They are translated here from that port's
// test runner to `node --test`: the assertions are `node:assert/strict`, the
// type annotations are gone, the Windows-only half of case 28 is skipped
// through the runner's `skip` option, and the imports point at this repo's
// guard. The inputs and what each case asserts are the port's, with two
// differences, each marked "Local edit:" where it is made:
//
//   - Case 26's fixture config reads a neutrally named environment variable.
//   - Case 29's reasons and its reasonless pattern are neutral text.
//
// Record: PROVENANCE.md.
//
// The guard's command line always checks this repository, and `--prepare`
// would delete this repository's coverage summary. So no case runs the command
// line: each calls the exported `run()` and `prepare()` with a throwaway root
// under the system temporary directory, and never without one. Cases 26, 27
// and 30 use the real Vitest from this repository's install: the throwaway
// project gets a `node_modules` symlink to it. Case 30 also resolves this
// repository's own vitest.config.ts, to read its thresholds; it starts no run
// here. Run via `npm run test:scripts`, which names this file by path.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  EXCLUDED,
  EXCLUDED_PATTERNS,
  prepare,
  resolveCoverageOptions,
  run,
} from "./verify-coverage-scope.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUMMARY = "coverage/coverage-summary.json";
const made = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

function project(files) {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "coverage-attack-")),
  );
  made.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  }
  return root;
}

function summary(root, keys) {
  mkdirSync(path.join(root, "coverage"), { recursive: true });
  writeFileSync(
    path.join(root, SUMMARY),
    typeof keys === "string"
      ? keys
      : JSON.stringify(
          Object.fromEntries([["total", {}], ...keys.map((k) => [k, {}])]),
        ),
  );
}

const include =
  (...patterns) =>
  async () => ({
    include: patterns,
    exclude: [],
  });

async function scope(root, opts) {
  return run({
    root,
    resolveOptions: include(...(opts.patterns ?? ["src/**/*.ts"])),
    inventory: () => opts.inventory ?? ["src/a.ts"],
    excluded: opts.excluded ?? {},
    patterns: opts.excludedPatterns ?? {},
    omissions: {},
    log: () => {},
  });
}

/** The runner's stand-in for "the text contains this part"; shows the text. */
const assertContains = (text, part, message) =>
  assert.ok(text.includes(part), message ?? text);

describe("Codex attack cases 21-30: coverage scope and thresholds", () => {
  test("Codex case 21: Inventory file absent from the coverage declaration fails", async () => {
    const root = project({ "src/a.ts": "", "lib/new.mts": "" });
    summary(root, [path.join(root, "src/a.ts")]);
    const failures = await scope(root, {
      inventory: ["lib/new.mts", "src/a.ts"],
    });
    assertContains(
      failures.join("\n"),
      "outside the expanded coverage declaration",
    );
    assertContains(failures.join("\n"), "lib/new.mts");
  });

  test("Codex case 22: Declared file absent from the summary fails", async () => {
    const root = project({ "src/a.ts": "", "src/b.ts": "" });
    summary(root, [path.join(root, "src/a.ts")]);
    const failures = await scope(root, { inventory: ["src/a.ts", "src/b.ts"] });
    assertContains(failures.join("\n"), "src/b.ts");
    assertContains(failures.join("\n"), "narrower scope than it declares");
  });

  test("Codex case 23: Empty declaration, empty inventory, and summary containing only `total` fail", async () => {
    const a = project({ "src/a.ts": "" });
    summary(a, [path.join(a, "src/a.ts")]);
    assertContains(
      (await scope(a, { patterns: ["nothing/**/*.ts"] })).join("\n"),
      "expands to no files at all",
    );
    const b = project({ "src/a.ts": "" });
    summary(b, [path.join(b, "src/a.ts")]);
    assertContains(
      (await scope(b, { inventory: [] })).join("\n"),
      "inventory is empty",
    );
    const c = project({ "src/a.ts": "" });
    summary(c, []);
    assertContains((await scope(c, {})).join("\n"), "reports no files at all");
  });

  test("Codex case 24: Coverage summary must be current regular evidence", async () => {
    const states = [
      ["missing", () => {}, /cannot open/],
      ["empty", (r) => summary(r, ""), /is empty/],
      [
        "directory",
        (r) => mkdirSync(path.join(r, SUMMARY), { recursive: true }),
        /not a regular file/,
      ],
      [
        "symlink to an old summary",
        (r) => {
          writeFileSync(
            path.join(r, "old.json"),
            JSON.stringify({ total: {}, [path.join(r, "src/a.ts")]: {} }),
          );
          mkdirSync(path.join(r, "coverage"));
          symlinkSync(path.join(r, "old.json"), path.join(r, SUMMARY));
        },
        /cannot open/,
      ],
      [
        "FIFO",
        (r) => {
          mkdirSync(path.join(r, "coverage"));
          execFileSync("mkfifo", [path.join(r, SUMMARY)]);
        },
        /not a regular file/,
      ],
      ["invalid JSON", (r) => summary(r, "{not json"), /not JSON/],
      ["wrong top-level type", (r) => summary(r, "[1,2]"), /not a JSON object/],
    ];
    for (const [name, setup, expected] of states) {
      const root = project({ "src/a.ts": "" });
      setup(root);
      const failures = await scope(root, {});
      assert.match(failures.join("\n"), expected, name);
    }
  });

  test("Codex case 25: Coverage `--prepare` removes only its exact artifact", () => {
    const root = project({ "coverage/keep.txt": "keep" });
    writeFileSync(path.join(root, SUMMARY), "{}");
    assert.deepEqual(prepare(root), []);
    assert.equal(existsSync(path.join(root, SUMMARY)), false);
    assert.equal(
      readFileSync(path.join(root, "coverage/keep.txt"), "utf8"),
      "keep",
    );

    const linked = project({
      "coverage/keep.txt": "keep",
      "external.json": "EXTERNAL",
    });
    symlinkSync(path.join(linked, "external.json"), path.join(linked, SUMMARY));
    assert.deepEqual(prepare(linked), []);
    assert.throws(() => lstatSync(path.join(linked, SUMMARY)));
    assert.equal(
      readFileSync(path.join(linked, "external.json"), "utf8"),
      "EXTERNAL",
    );
    assert.equal(
      readFileSync(path.join(linked, "coverage/keep.txt"), "utf8"),
      "keep",
    );

    const dir = project({ [`${SUMMARY}/inner`]: "x" });
    const failures = prepare(dir);
    assertContains(failures.join("\n"), "is a directory");
    assert.equal(statSync(path.join(dir, SUMMARY)).isDirectory(), true);

    assert.deepEqual(prepare(project({})), []); // absent: nothing to do
  });

  test("Codex case 26: Coverage configuration is resolved, not text-scanned", async () => {
    // Local edit: the environment variable the fixture config reads has a
    // neutral name. It is never set, as in the port.
    const root = project({
      "lib/a.ts": "export const a = 1;\n",
      "scope.mjs": 'export const DIRS = ["lib"];\n',
      "vitest.config.mjs":
        'import { DIRS } from "./scope.mjs";\nexport default { test: { coverage: { include: process.env.COVERAGE_ATTACK_NEVER_SET ? ["nothing/**"] : DIRS.map((d) => `${d}/**/*.ts`) } } };\n',
    });
    symlinkSync(
      path.join(REPO, "node_modules"),
      path.join(root, "node_modules"),
    );
    summary(root, [path.join(root, "lib/a.ts")]);
    const failures = await run({
      root,
      config: "vitest.config.mjs",
      inventory: () => ["lib/a.ts"],
      excluded: {},
      patterns: {},
      omissions: {},
      log: () => {},
    });
    assert.deepEqual(failures, []);
  });

  test("Codex case 27: Config resolution failure fails closed and closes Vitest", async () => {
    const root = project({
      "src/a.ts": "",
      "vitest.config.mjs": 'throw new Error("CONFIG_SENTINEL");\n',
    });
    symlinkSync(
      path.join(REPO, "node_modules"),
      path.join(root, "node_modules"),
    );
    summary(root, [path.join(root, "src/a.ts")]);
    const failures = await run({
      root,
      config: "vitest.config.mjs",
      inventory: () => ["src/a.ts"],
      log: () => {},
    });
    assertContains(failures.join("\n"), "CONFIG_SENTINEL");

    // When an instance WAS created and reading its config throws, close runs once.
    let closed = 0;
    const fake = async () => ({
      get config() {
        throw new Error("CONFIG_SENTINEL");
      },
      close: async () => {
        closed += 1;
      },
    });
    await assert.rejects(
      resolveCoverageOptions(root, "vitest.config.mjs", fake),
      /CONFIG_SENTINEL/,
    );
    assert.equal(closed, 1);
  });

  test("Codex case 28: Coverage path normalization neither aliases nor escapes", async () => {
    const root = project({ "src/a.ts": "" });
    const copy = `${root}-copy`;
    made.push(copy);
    const spellings = [
      [`${root}/./src/a.ts`, true],
      [path.join(copy, "src/a.ts"), false],
      ["../outside/src/a.ts", false],
      [`file://${root}/src/a.ts`, false],
    ];
    for (const [key, ok] of spellings) {
      summary(root, [key]);
      const failures = await scope(root, {});
      if (ok) assert.deepEqual(failures, [], key);
      else assertContains(failures.join("\n"), "src/a.ts", key);
    }
  });

  test(
    "Codex case 28 (Windows half): the native separator spelling is the same file",
    { skip: process.platform !== "win32" },
    async () => {
      const root = project({ "src/a.ts": "" });
      summary(root, [path.win32.join(root, "src", "a.ts")]);
      assert.deepEqual(await scope(root, {}), []);
    },
  );

  test("Codex case 29: Coverage exclusions are exact, reasoned, and non-stale", async () => {
    // Local edit: the reasons, and the folder in the reasonless pattern, are
    // neutral text.
    const root = project({ "src/a.ts": "", "lib/b.ts": "" });
    summary(root, [path.join(root, "src/a.ts")]);
    const inventory = ["lib/b.ts", "src/a.ts"];
    const cases = [
      [{ "lib/b.ts": "" }, "lib/b.ts without a reason"],
      [
        { "lib/b.ts": "a reason", "gone.ts": "a reason" },
        "gone.ts, which is not a tracked TypeScript file",
      ],
      [
        { "lib/b.ts": "a reason", "src/a.ts": "a reason" },
        "src/a.ts, which the coverage declaration now selects",
      ],
      [{ "lib/**": "a reason" }, "lib/**, a pattern"],
    ];
    for (const [excluded, expected] of cases) {
      const failures = await scope(root, { inventory, excluded });
      assertContains(failures.join("\n"), expected, expected);
    }
    const reasonlessPattern = await scope(root, {
      inventory,
      excluded: { "lib/b.ts": "a reason" },
      excludedPatterns: { "old/**": " " },
    });
    assertContains(reasonlessPattern.join("\n"), "old/** without a reason");
    const stalePattern = await scope(root, {
      inventory,
      excluded: { "lib/b.ts": "a reason" },
      excludedPatterns: { "nowhere/**": "a reason" },
    });
    assertContains(
      stalePattern.join("\n"),
      "matches no tracked TypeScript file",
    );
    assert.deepEqual(
      await scope(root, { inventory, excluded: { "lib/b.ts": "a reason" } }),
      [],
    );
    // The shipped lists: exact paths with reasons, and reasoned patterns.
    for (const [entry, reason] of Object.entries(EXCLUDED)) {
      assert.doesNotMatch(entry, /[*?[\]{}!]/);
      assert.notEqual(reason.trim(), "");
    }
    for (const reason of Object.values(EXCLUDED_PATTERNS))
      assert.notEqual(reason.trim(), "");
  });

  test("Codex case 30: Each of four coverage dimensions is independently enforced per file", async () => {
    // (a) The resolved thresholds of this repository's own config.
    const { createVitest } = await import("vitest/node");
    const vitest = await createVitest("test", {
      watch: false,
      run: true,
      root: REPO,
      config: path.join(REPO, "vitest.config.ts"),
    });
    try {
      const { perFile, lines, statements, functions, branches } =
        vitest.config.coverage.thresholds;
      assert.deepEqual(
        { perFile, lines, statements, functions, branches },
        {
          perFile: true,
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 90,
        },
      );
    } finally {
      await vitest.close();
    }
    // (b) Real runs with those thresholds: a file short only on branches, a
    // file short on functions, and a fully covered file.
    const runWith = (source) => {
      const root = project({
        "lib/new.ts": source,
        "lib/new.test.ts":
          'import { pick, used } from "./new";\ntest("one way", () => { expect(pick(1)).toBe("pos"); expect(used()).toBe(1); });\n',
        "vitest.config.mjs":
          'export default { test: { globals: true, include: ["lib/new.test.ts"], coverage: { provider: "v8", include: ["lib/new.ts"], reporter: ["text"], thresholds: { perFile: true, lines: 90, statements: 90, functions: 90, branches: 90 } } } };\n',
      });
      symlinkSync(
        path.join(REPO, "node_modules"),
        path.join(root, "node_modules"),
      );
      return spawnSync(
        process.execPath,
        [
          path.join(REPO, "node_modules/vitest/vitest.mjs"),
          "run",
          "--coverage",
          "--config",
          "vitest.config.mjs",
        ],
        { cwd: root, encoding: "utf8" },
      );
    };
    const branchShort = runWith(
      'export const used = () => 1;\nexport function pick(a: number): string { return a > 0 ? "pos" : "neg"; }\n',
    );
    assert.equal(branchShort.status, 1);
    assert.match(
      branchShort.stdout + branchShort.stderr,
      /branches.*does not meet.*lib\/new\.ts/,
    );
    assert.doesNotMatch(
      branchShort.stdout + branchShort.stderr,
      /lines.*does not meet/,
    );
    const functionShort = runWith(
      'export const used = () => 1;\nexport function pick(_a: number): string { return "pos"; }\nexport const never = () => 2;\n',
    );
    assert.equal(functionShort.status, 1);
    assert.match(
      functionShort.stdout + functionShort.stderr,
      /functions.*does not meet.*lib\/new\.ts/,
    );
    assert.doesNotMatch(
      functionShort.stdout + functionShort.stderr,
      /branches.*does not meet/,
    );
    const full = runWith(
      'export const used = () => 1;\nexport function pick(_a: number): string { return "pos"; }\n',
    );
    assert.equal(full.status, 0, full.stdout + full.stderr);
  });
});
