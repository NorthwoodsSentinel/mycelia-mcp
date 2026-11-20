// Unit tests for scripts/verify-typecheck-coverage.mjs: the comparison of the
// inventory with the program, the EXCLUDED rules, the failures of an empty or
// throwing inventory and of a missing compiler, and that the shipped EXCLUDED
// is empty.
//
// In this repo: the cases come from a reviewed port of the MCP Inspector's
// guard in a private sibling repository (see the guard's header). Two edits:
// the fixture reasons are neutral text, and the port's test of its shipped
// EXCLUDED reasons is "EXCLUDED is empty" here. That port kept its cases
// against a real compiler and fake ones (a compiler that exits non-zero, or
// lists nothing) in a separate test file that is not brought in here, so this
// file does not exercise those two failures. Record: PROVENANCE.md. Run via
// `npm run test:scripts`, which names this file by path.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EXCLUDED, diffTypecheck, run } from "./verify-typecheck-coverage.mjs";

test("a tracked file in no program and not excluded fails by name", () => {
  const failures = diffTypecheck({
    tracked: ["a.ts", "b.ts"],
    program: ["a.ts"],
    excluded: {},
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /b\.ts — in no tsconfig project/);
});

test("an excluded file passes; reasonless, pattern, untracked and stale entries fail", () => {
  assert.deepEqual(
    diffTypecheck({
      tracked: ["a.ts", "b.ts"],
      program: ["a.ts"],
      excluded: { "b.ts": "a reason" },
    }),
    [],
  );
  const failures = diffTypecheck({
    tracked: ["a.ts", "b.ts"],
    program: ["a.ts", "b.ts"],
    excluded: {
      "c.ts": "a reason",
      "b.ts": "a reason",
      "x/**": "a reason",
      "a.ts": " ",
    },
  });
  assert.equal(failures.length, 4);
});

test("an empty inventory fails", () => {
  assert.match(
    diffTypecheck({ tracked: [], program: ["a.ts"], excluded: {} })[0],
    /inventory is empty/,
  );
  assert.match(run({ inventory: () => [] }).failures[0], /inventory is empty/);
});

test("an inventory that throws, or a missing compiler, fails", () => {
  const thrown = run({
    inventory: () => {
      throw new Error("git broke");
    },
  });
  assert.deepEqual(thrown.failures, ["git broke"]);
  const noTsc = run({ root: "/", inventory: () => ["a.ts"] });
  assert.match(noTsc.failures[0], /cannot find the TypeScript compiler/);
});

test("EXCLUDED is empty", () => {
  assert.deepEqual(EXCLUDED, {});
});
