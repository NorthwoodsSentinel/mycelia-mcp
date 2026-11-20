// Tests for the bun.lock reader shared by the install guards
// (`bun-lock.mjs`). The decoder cases pin that a scoped key is one name, not a
// nested install. Every unreadable input must THROW, never read as empty. The
// last case reads this repository's own `bun.lock`.
//
// In this repo: not an MCP Inspector file (the Inspector reads npm's
// lockfile). It comes, with only this header changed, from a reviewed port of
// the Inspector's install guards in a private sibling repository; a comment
// below that cites a review round ("Codex audit r5") means a round of that
// port's review. Record: PROVENANCE.md. Run by `npm run test:scripts`, which
// names this file by path: `node --test` exits 0 on a glob that matches
// nothing.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  installDir,
  parseBunLock,
  splitIdent,
  splitInstallPath,
  stripTrailingCommas,
} from "./bun-lock.mjs";

test("decodes install paths: scoped names are one name, nesting is per name", () => {
  assert.equal(installDir("eslint"), "node_modules/eslint");
  assert.equal(installDir("@babel/parser"), "node_modules/@babel/parser");
  assert.equal(
    installDir("qified/hookified"),
    "node_modules/qified/node_modules/hookified",
  );
  assert.equal(installDir("a/@s/n"), "node_modules/a/node_modules/@s/n");
  assert.equal(installDir("@s/n/@t/m"), "node_modules/@s/n/node_modules/@t/m");
});

test("an undecodable install path throws", () => {
  assert.throws(() => splitInstallPath("a//b"), /empty segment/);
  assert.throws(() => splitInstallPath("@scope"), /scope with no package/);
  assert.throws(() => splitInstallPath("a/@scope"), /scope with no package/);
});

test("splits name@version at the last @, keeping a scope", () => {
  assert.deepEqual(splitIdent("@s/n@1.2.3"), {
    name: "@s/n",
    version: "1.2.3",
  });
  assert.deepEqual(splitIdent("zod@4.4.3"), { name: "zod", version: "4.4.3" });
  assert.throws(() => splitIdent("zod"), /not name@version/);
  assert.throws(() => splitIdent("zod@"), /not name@version/);
  assert.throws(() => splitIdent("@s/n"), /not name@version/);
});

test("strips trailing commas outside strings only", () => {
  assert.equal(stripTrailingCommas('{"a": [1, 2,], }'), '{"a": [1, 2] }');
  assert.equal(stripTrailingCommas('{"a": "x,}"}'), '{"a": "x,}"}');
  assert.equal(stripTrailingCommas('{"a": "q\\",]",}'), '{"a": "q\\",]"}');
});

const lock = (packages, extra = "") =>
  `{\n  "lockfileVersion": 1,\n  "workspaces": { "": { "name": "x", "dependencies": {}, }, },${extra}\n  "packages": ${packages},\n}\n`;

test("parses entries with their install dir, name, version and meta", () => {
  const { entries } = parseBunLock(
    lock(
      '{ "@s/n": ["@s/n@1.0.0", "", { "os": "linux" }, "sha"], "a/b": ["b@2.0.0", "", {}, "sha"], }',
    ),
  );
  assert.deepEqual(
    entries.map((e) => [e.key, e.dir, e.name, e.version, e.meta]),
    [
      ["@s/n", "node_modules/@s/n", "@s/n", "1.0.0", { os: "linux" }],
      ["a/b", "node_modules/a/node_modules/b", "b", "2.0.0", {}],
    ],
  );
});

test("fails closed on every unreadable lockfile", () => {
  assert.throws(() => parseBunLock("{ not json"), /could not parse/);
  assert.throws(
    () =>
      parseBunLock(
        '{"lockfileVersion": 2, "workspaces": {"": {}}, "packages": {}}',
      ),
    /lockfileVersion 2/,
  );
  assert.throws(
    () => parseBunLock('{"lockfileVersion": 1, "packages": {}}'),
    /no root workspace/,
  );
  assert.throws(
    () => parseBunLock('{"lockfileVersion": 1, "workspaces": {"": {}}}'),
    /no packages map/,
  );
  // Codex audit r5: arrays are objects too, and read as an empty graph.
  assert.throws(
    () =>
      parseBunLock(
        '{"lockfileVersion": 1, "workspaces": {"": []}, "packages": {}}',
      ),
    /no root workspace/,
  );
  assert.throws(
    () =>
      parseBunLock(
        '{"lockfileVersion": 1, "workspaces": {"": {}}, "packages": []}',
      ),
    /no packages map/,
  );
  assert.throws(
    () => parseBunLock(lock('{ "a": "not-an-array" }')),
    /is not \[ident/,
  );
  // The key says one package, the ident another: neither can be checked.
  assert.throws(
    () => parseBunLock(lock('{ "a/b": ["c@1.0.0", "", {}, "sha"] }')),
    /names "c", not the package its path ends in/,
  );
});

test("reads this repository's own bun.lock", () => {
  const root = path.resolve(import.meta.dirname, "..", "..");
  const { entries } = parseBunLock(
    readFileSync(path.join(root, "bun.lock"), "utf8"),
  );
  assert.ok(entries.length > 0, "the real lockfile must not read as empty");
  assert.ok(
    entries.some(
      (e) => e.name.startsWith("@") && e.dir === `node_modules/${e.name}`,
    ),
    "a top-level scoped package must decode to node_modules/@scope/name",
  );
});
