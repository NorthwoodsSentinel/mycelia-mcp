// Attack cases 11 to 20 for the tracked-TypeScript inventory
// (scripts/lib/ts-inventory.mjs) and the typecheck-coverage guard
// (scripts/verify-typecheck-coverage.mjs).
//
// In this repo: the cases were written by the review model (Codex) for a
// reviewed port of the MCP Inspector's guard in a private sibling repository,
// and are kept in its order, under its numbers and names, which is why each
// test is called "Codex case N". They are translated here from that port's
// test runner to `node --test`: the assertions are `node:assert/strict`, the
// type annotations are gone, and the imports point at this repo's modules.
// The inputs and what each case asserts are the port's, with three
// differences, each marked "Local edit:" where it is made:
//
//   - Case 12 names this repo's build-output directories.
//   - Case 14 holds the typecheck half only. The port's case ran the same two
//     failures through its coverage-scope guard as well.
//   - Case 19's fixture paths and reasons are neutral text.
//
// Record: PROVENANCE.md.
//
// Each case uses a throwaway Git repository (files `git add`ed, never
// committed). The guard's command line always checks this repository, so the
// cases call its exported `run()` with the throwaway root, and with a
// stand-in compiler where the case substitutes one. Case 20 uses the real
// TypeScript compiler from this repository's install. Run via
// `npm run test:scripts`, which names this file by path.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { trackedTypeScript } from "./lib/ts-inventory.mjs";
import { run as runTypecheck, tscEntry } from "./verify-typecheck-coverage.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const made = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

function repo(tracked, untracked = []) {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "inventory-attack-")),
  );
  made.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  for (const f of [...tracked, ...untracked]) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    writeFileSync(path.join(root, f), "export {};\n");
  }
  if (tracked.length > 0)
    execFileSync("git", ["add", "-f", "--", ...tracked], { cwd: root });
  return root;
}

/** A stand-in compiler: a Node script whose body is the given code. */
function fakeTsc(body) {
  const dir = mkdtempSync(path.join(tmpdir(), "fake-tsc-"));
  made.push(dir);
  const file = path.join(dir, "tsc.mjs");
  writeFileSync(file, body);
  return file;
}
const listing = (lines) =>
  fakeTsc(`process.stdout.write(${JSON.stringify(lines.join("\n") + "\n")});`);

/** The runner's stand-in for "the text contains this part"; shows the text. */
const assertContains = (text, part) => assert.ok(text.includes(part), text);

describe("Codex attack cases 11-20: inventory and typecheck coverage", () => {
  test("Codex case 11: All four extensions at arbitrary depths are inventoried", () => {
    const root = repo([
      "root.ts",
      "lib/a.tsx",
      "src/deep/b.mts",
      "odd/c.cts",
      "types/x.d.ts",
      "types/y.d.mts",
      "types/z.d.cts",
    ]);
    assert.deepEqual(trackedTypeScript(root), [
      "lib/a.tsx",
      "odd/c.cts",
      "root.ts",
      "src/deep/b.mts",
    ]);
  });

  test("Codex case 12: Untracked and generated TypeScript are not required", () => {
    // Local edit: the directories are this repo's build-output list
    // (`GENERATED_DIRS`, which is tsconfig.json's `exclude`).
    const generated = [
      "dist/bundle.ts",
      "build/state.ts",
      "coverage/generated.ts",
      ".scratch/generated.ts",
      "node_modules/pkg/index.ts",
    ];
    // created only, never tracked
    const a = repo(["src/a.ts"], ["scratch.ts", ...generated]);
    assert.deepEqual(trackedTypeScript(a), ["src/a.ts"]);
    // and even if someone force-adds build output, it is not required
    const b = repo(["src/a.ts", ...generated]);
    assert.deepEqual(trackedTypeScript(b), ["src/a.ts"]);
  });

  test("Codex case 13: Inventory handles spaces, tabs, leading dashes, Unicode, and newlines", () => {
    const names = [
      "space name.ts",
      "tab\tname.ts",
      "-leading.ts",
      "é.ts",
      "line\nbreak.ts",
    ];
    const root = repo(names);
    assert.deepEqual(trackedTypeScript(root), [...names].sort());
  });

  test("Codex case 14: Git failure and empty inventory fail closed", () => {
    const shimDir = mkdtempSync(path.join(tmpdir(), "git-shim-"));
    made.push(shimDir);
    const shim = path.join(shimDir, "git");
    writeFileSync(shim, "#!/bin/sh\nexit 73\n");
    chmodSync(shim, 0o755);
    const root = repo(["src/a.ts"]);
    const failingInventory = (r) => trackedTypeScript(r, shim);

    const typecheck = runTypecheck({ root, inventory: failingInventory });
    assert.match(
      typecheck.failures.join("\n"),
      /inventory failed: git ls-files exited 73/,
    );

    // Local edit: the port's case also ran this failing inventory, and the
    // empty one below, through its coverage-scope guard and asserted the same
    // two messages. That half is not here: this repo has no coverage-scope
    // guard to run them through.

    const empty = repo(["README.md"]);
    assert.match(
      runTypecheck({ root: empty }).failures.join("\n"),
      /inventory is empty/,
    );
  });

  test("Codex case 15: New file outside the historic directories is rejected by typecheck coverage", () => {
    const root = repo(["src/a.ts", "new-top-level.mts"]);
    const { failures } = runTypecheck({
      root,
      tsc: listing([path.join(root, "src/a.ts")]),
      excluded: {},
    });
    assertContains(
      failures.join("\n"),
      "new-top-level.mts — in no tsconfig project",
    );
  });

  test("Codex case 16: Compiler paths reconcile canonically", () => {
    const root = repo(["src/a.ts"]);
    const dotted = runTypecheck({
      root,
      tsc: listing([`${root}/./src/a.ts`]),
      excluded: {},
    });
    assert.deepEqual(dotted, { failures: [], checked: 1 });
    const linkDir = mkdtempSync(path.join(tmpdir(), "inv-link-"));
    made.push(linkDir);
    const link = path.join(linkDir, "repo");
    symlinkSync(root, link);
    const viaLink = runTypecheck({
      root: link,
      tsc: listing([path.join(link, "src/a.ts")]),
      excluded: {},
    });
    assert.deepEqual(viaLink, { failures: [], checked: 1 });
  });

  test("Codex case 17: A similarly prefixed external path cannot satisfy an in-repo file", () => {
    const root = repo(["src/a.ts"]);
    const copy = `${root}-copy`;
    made.push(copy);
    mkdirSync(path.join(copy, "src"), { recursive: true });
    writeFileSync(path.join(copy, "src/a.ts"), "");
    const { failures } = runTypecheck({
      root,
      tsc: listing([path.join(copy, "src/a.ts")]),
      excluded: {},
    });
    assertContains(failures.join("\n"), "src/a.ts — in no tsconfig project");
  });

  test("Codex case 18: Compiler failure, signal, invalid output, and empty file list fail closed", () => {
    const root = repo(["src/a.ts"]);
    const cases = [
      ["process.exit(2);", /compiler exited 2/],
      ['process.kill(process.pid, "SIGKILL");', /killed by SIGKILL/],
      [
        `process.stdout.write(${JSON.stringify(`${root}/src/a\0.ts\n`)});`,
        /unusable path record/,
      ],
      [
        `process.stdout.write(${JSON.stringify(`${root}/src/�.ts\n`)});`,
        /unusable path record/,
      ],
      ["", /listed no files/],
    ];
    for (const [body, expected] of cases) {
      const { failures } = runTypecheck({
        root,
        tsc: fakeTsc(body),
        excluded: {},
      });
      assert.match(failures.join("\n"), expected, body);
    }
  });

  test("Codex case 19: Reasonless, untracked, and stale typecheck exclusions fail", () => {
    // Local edit: the excluded file's folder and the reason strings are
    // neutral text.
    const root = repo(["src/in-program.ts", "old/legacy.ts"]);
    const tsc = listing([path.join(root, "src/in-program.ts")]);
    const reasonless = runTypecheck({
      root,
      tsc,
      excluded: { "old/legacy.ts": "" },
    });
    assertContains(
      reasonless.failures.join("\n"),
      "old/legacy.ts without a reason",
    );
    const untracked = runTypecheck({
      root,
      tsc,
      excluded: { "old/legacy.ts": "a reason", "missing.ts": "a reason" },
    });
    assertContains(
      untracked.failures.join("\n"),
      "missing.ts, which is not a tracked TypeScript file",
    );
    const stale = runTypecheck({
      root,
      tsc,
      excluded: {
        "old/legacy.ts": "a reason",
        "src/in-program.ts": "a reason",
      },
    });
    assertContains(
      stale.failures.join("\n"),
      "src/in-program.ts, which the program now typechecks",
    );
  });

  test("Codex case 20: Config-only exclusion must still be named by the guard", () => {
    const root = repo(["src/a.ts", "lib/hidden.ts", "tsconfig.json"]);
    writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { noEmit: true, types: [], strict: true },
        include: ["**/*.ts"],
        exclude: ["lib/hidden.ts"],
      }),
    );
    const tsc = tscEntry(REPO);
    const compiled = spawnSync(
      process.execPath,
      [tsc, "--noEmit", "-p", "tsconfig.json"],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    assert.equal(compiled.status, 0);
    const { failures } = runTypecheck({ root, tsc, excluded: {} });
    assertContains(
      failures.join("\n"),
      "lib/hidden.ts — in no tsconfig project",
    );
  });
});
