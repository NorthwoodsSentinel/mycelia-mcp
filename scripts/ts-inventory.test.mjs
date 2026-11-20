// Unit tests for scripts/lib/ts-inventory.mjs: which tracked files the
// inventory requires, that it reads Git's NUL-delimited output (a name
// containing a newline stays one path), that build output is dropped, and
// that a Git failure throws instead of reading as an empty inventory.
//
// In this repo: the cases come, unchanged, from a reviewed port of the MCP
// Inspector's typecheck-coverage guard in a private sibling repository (see
// the module's header). That port kept further attack cases for the inventory
// in a separate test file; they are in `scripts/inventory-attack.test.mjs`. Record: PROVENANCE.md.
// Run via `npm run test:scripts`, which names this file by path.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isRequiredSource,
  parseNulList,
  trackedTypeScript,
} from "./lib/ts-inventory.mjs";

test("the four TypeScript extensions are required; declarations are not", () => {
  for (const f of ["a.ts", "a.tsx", "a.mts", "a.cts"])
    assert.equal(isRequiredSource(f), true, f);
  for (const f of ["a.d.ts", "a.d.mts", "a.d.cts", "a.js", "a.mjs", "a.json"])
    assert.equal(isRequiredSource(f), false, f);
});

test("NUL-delimited output splits exactly, keeping newlines inside names", () => {
  assert.deepEqual(parseNulList("a.ts\0b\nc.ts\0"), ["a.ts", "b\nc.ts"]);
  assert.deepEqual(parseNulList(""), []);
});

test("the inventory lists tracked TypeScript, sorted, without build output", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "ts-inventory-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  for (const f of ["z.ts", "a/b.mts", "dist/out.ts", "x.d.ts", "y.js"]) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    writeFileSync(path.join(root, f), "");
  }
  execFileSync("git", ["add", "-f", "."], { cwd: root });
  assert.deepEqual(trackedTypeScript(root), ["a/b.mts", "z.ts"]);
});

test("a git that cannot start or exits non-zero throws, never returns empty", () => {
  assert.throws(
    () => trackedTypeScript(tmpdir(), "/no/such/git"),
    /could not run git ls-files/,
  );
  assert.throws(
    () => trackedTypeScript(path.join(tmpdir(), "no-such-dir-for-git")),
    /inventory/,
  );
});
