// Tests for verify-install-fresh. Each case is a fixture lockfile and a
// fixture "installed" map; checkInstall is pure, so no node_modules is built.
// The last case runs the guard over this repository's own install.
//
// In this repo: not the MCP Inspector's test (its guard reads npm's lockfile;
// see the guard's header). It comes, with only this header changed, from a
// reviewed port in a private sibling repository, whose design and design
// review (rounds r1 to r3) chose the cases; all are kept. The package names in
// the fixtures are examples. Record: PROVENANCE.md. Run by
// `npm run test:scripts`, which names this file by path: `node --test` exits 0
// on a glob that matches nothing.

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBunLock } from "./lib/bun-lock.mjs";
import { admits, checkInstall, run } from "./verify-install-fresh.mjs";

const LINUX = { platform: "linux", arch: "x64", libc: "glibc" };

/**
 * @param {{ root?: object, packages: Record<string, [string, object?]> }} spec
 *   packages: key → [ident, meta]
 */
const lockOf = ({ root = {}, packages }) =>
  parseBunLock(
    JSON.stringify({
      lockfileVersion: 1,
      workspaces: { "": { name: "x", ...root } },
      packages: Object.fromEntries(
        Object.entries(packages).map(([k, [ident, meta = {}]]) => [
          k,
          [ident, "", meta, "sha"],
        ]),
      ),
    }),
  );

const check = (spec, installed, host = LINUX) =>
  checkInstall({
    lock: lockOf(spec),
    readVersion: (dir) => installed[dir],
    host,
  });

test("everything installed at its locked version passes", () => {
  const r = check(
    { root: { dependencies: { a: "1" } }, packages: { a: ["a@1.0.0"] } },
    { "node_modules/a": "1.0.0" },
  );
  assert.deepEqual([r.stale, r.missing, r.errors, r.checked], [[], [], [], 1]);
});

test("a version mismatch is stale", () => {
  const r = check(
    { root: { dependencies: { a: "1" } }, packages: { a: ["a@1.1.0"] } },
    { "node_modules/a": "1.0.0" },
  );
  assert.deepEqual(r.stale, [
    "node_modules/a: installed 1.0.0, bun.lock has 1.1.0",
  ]);
});

test("an absent required package is missing, from root deps and devDeps alike", () => {
  for (const field of ["dependencies", "devDependencies"]) {
    const r = check(
      { root: { [field]: { a: "1" } }, packages: { a: ["a@1.0.0"] } },
      {},
    );
    assert.deepEqual(r.missing, ["node_modules/a (a@1.0.0)"], field);
  }
});

test("a scoped key resolves at node_modules/@scope/name, present and absent", () => {
  const spec = {
    root: { dependencies: { "@babel/parser": "7" } },
    packages: { "@babel/parser": ["@babel/parser@7.0.0"] },
  };
  assert.deepEqual(
    check(spec, { "node_modules/@babel/parser": "7.0.0" }).missing,
    [],
  );
  assert.deepEqual(check(spec, {}).missing, [
    "node_modules/@babel/parser (@babel/parser@7.0.0)",
  ]);
});

test("a nested key resolves under its parent, and wins over the hoisted one", () => {
  const spec = {
    root: { dependencies: { qified: "1", hookified: "1" } },
    packages: {
      qified: ["qified@1.0.0", { dependencies: { hookified: "2" } }],
      hookified: ["hookified@1.0.0"],
      "qified/hookified": ["hookified@2.0.0"],
    },
  };
  const r = check(spec, {
    "node_modules/qified": "1.0.0",
    "node_modules/hookified": "1.0.0",
    "node_modules/qified/node_modules/hookified": "1.0.0",
  });
  assert.deepEqual(r.stale, [
    "node_modules/qified/node_modules/hookified: installed 1.0.0, bun.lock has 2.0.0",
  ]);
});

test("a nested scoped key a/@s/n resolves under node_modules/a", () => {
  const r = check(
    {
      root: { dependencies: { a: "1" } },
      packages: {
        a: ["a@1.0.0", { dependencies: { "@s/n": "1" } }],
        "a/@s/n": ["@s/n@1.0.0"],
      },
    },
    { "node_modules/a": "1.0.0" },
  );
  assert.deepEqual(r.missing, [
    "node_modules/a/node_modules/@s/n (@s/n@1.0.0)",
  ]);
});

test("optional and excluded by os: exempt when absent", () => {
  const r = check(
    {
      root: { optionalDependencies: { "bin-darwin": "1" } },
      packages: { "bin-darwin": ["bin-darwin@1.0.0", { os: "darwin" }] },
    },
    {},
  );
  assert.deepEqual([r.missing, r.checked], [[], 0]);
});

test("optional but the host matches: absent is missing", () => {
  const r = check(
    {
      root: { optionalDependencies: { "bin-linux": "1" } },
      packages: {
        "bin-linux": ["bin-linux@1.0.0", { os: "linux", cpu: "x64" }],
      },
    },
    {},
  );
  assert.deepEqual(r.missing, ["node_modules/bin-linux (bin-linux@1.0.0)"]);
});

test("libc decides between gnu and musl builds of the same os/cpu", () => {
  const spec = {
    root: { optionalDependencies: { gnu: "1", musl: "1" } },
    packages: {
      gnu: ["gnu@1.0.0", { os: "linux", cpu: "x64", libc: "glibc" }],
      musl: ["musl@1.0.0", { os: "linux", cpu: "x64", libc: "musl" }],
    },
  };
  assert.deepEqual(check(spec, {}).missing, ["node_modules/gnu (gnu@1.0.0)"]);
});

test("platform metadata alone never exempts a package a present one requires", () => {
  const r = check(
    {
      root: { dependencies: { a: "1" } },
      packages: {
        a: ["a@1.0.0", { dependencies: { "bin-darwin": "1" } }],
        "bin-darwin": ["bin-darwin@1.0.0", { os: "darwin" }],
      },
    },
    { "node_modules/a": "1.0.0" },
  );
  assert.deepEqual(r.missing, ["node_modules/bin-darwin (bin-darwin@1.0.0)"]);
});

test("an absent package's own dependencies are not expected", () => {
  // The @emnapi case: wanted only by a wasm binding this host never installs.
  const r = check(
    {
      root: { optionalDependencies: { "wasm-binding": "1" } },
      packages: {
        "wasm-binding": [
          "wasm-binding@1.0.0",
          { cpu: "wasm32", dependencies: { "@emnapi/core": "1" } },
        ],
        "@emnapi/core": ["@emnapi/core@1.0.0"],
      },
    },
    {},
  );
  assert.deepEqual([r.missing, r.errors], [[], []]);
});

test("two locked versions with mixed edges are attributed by physical path", () => {
  // Root requires dep@1 (hoisted). `opt` reaches its own nested dep@2 only
  // optionally, with a darwin-only build: absent is exempt. The hoisted one
  // must still be checked as required.
  const spec = {
    root: { dependencies: { dep: "1", opt: "1" } },
    packages: {
      dep: ["dep@1.0.0"],
      opt: ["opt@1.0.0", { optionalDependencies: { dep: "2" } }],
      "opt/dep": ["dep@2.0.0", { os: "darwin" }],
    },
  };
  const r = check(spec, { "node_modules/opt": "1.0.0" });
  assert.deepEqual(r.missing, ["node_modules/dep (dep@1.0.0)"]);
});

test("a non-optional peer is a required edge; an optionalPeers name is none", () => {
  const spec = {
    root: { dependencies: { plugin: "1" } },
    packages: {
      plugin: [
        "plugin@1.0.0",
        {
          peerDependencies: { host: "1", extra: "1" },
          optionalPeers: ["extra"],
        },
      ],
      host: ["host@1.0.0"],
      extra: ["extra@1.0.0"],
    },
  };
  const r = check(spec, { "node_modules/plugin": "1.0.0" });
  assert.deepEqual(r.missing, ["node_modules/host (host@1.0.0)"]);
});

test("a required edge to a name bun.lock does not lock is an error", () => {
  const r = check(
    {
      root: { dependencies: { a: "1" } },
      packages: { a: ["a@1.0.0", { dependencies: { ghost: "1" } }] },
    },
    { "node_modules/a": "1.0.0" },
  );
  assert.deepEqual(r.errors, [
    'a requires "ghost", which bun.lock does not lock',
  ]);
});

test("malformed metadata fails closed", () => {
  const r = check(
    {
      root: { dependencies: { a: "1" } },
      packages: { a: ["a@1.0.0", { optionalPeers: "extra" }] },
    },
    { "node_modules/a": "1.0.0" },
  );
  assert.match(r.errors[0], /optionalPeers is not a list/);
  assert.throws(() => admits(42, "linux"), /unreadable platform field/);
});

test("admits: absent, string, array and negation", () => {
  assert.equal(admits(undefined, "linux"), true);
  assert.equal(admits("linux", "linux"), true);
  assert.equal(admits(["darwin", "linux"], "linux"), true);
  assert.equal(admits("none", "linux"), false);
  assert.equal(admits(["!win32"], "linux"), true);
  assert.equal(admits(["!linux"], "linux"), false);
});

test("this repository's install matches its lockfile", () => {
  assert.deepEqual(run().failures, []);
});
