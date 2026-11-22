// In this repo: copied from modelcontextprotocol/inspector at commit d330df96,
// scripts/lib/gh.test.mjs, by copy then edit. Edits: the tests of the two
// exports removed from the library are removed with them, and the tests of
// `ghPaginatedObject` are added (NOR-610). The two tests of `ghPaginatedList`
// are the source's, back with the function (NOR-684). Record: PROVENANCE.md.
//
// Tests for scripts/lib/gh.mjs (#2558) — the shared `gh` invocation helpers
// under the maintainer-workflow scripts. Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gh,
  ghJson,
  ghPaginatedList,
  ghPaginatedObject,
  requirePositiveInt,
  GH_MAX_BUFFER,
} from "./gh.mjs";

function spawnReturning(result) {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return result;
  };
  spawn.calls = calls;
  return spawn;
}

test("gh passes args through and returns the raw result", () => {
  const spawn = spawnReturning({ status: 0, stdout: "x", stderr: "" });
  const result = gh(spawn, ["api", "whatever"]);
  assert.equal(result.stdout, "x");
  assert.deepEqual(spawn.calls[0].args, ["api", "whatever"]);
  assert.equal(spawn.calls[0].cmd, "gh");
});

test("gh raises maxBuffer above spawnSync's 1 MiB default", () => {
  // A whole-board or all-issue listing can exceed 1 MiB, and ENOBUFS would
  // kill the call before itemListComplete could validate the dump.
  const spawn = spawnReturning({ status: 0, stdout: "x", stderr: "" });
  gh(spawn, ["api", "whatever"]);
  assert.equal(spawn.calls[0].opts.maxBuffer, GH_MAX_BUFFER);
  assert.ok(GH_MAX_BUFFER > 1024 * 1024);
});

test("gh throws on a spawn-level error (gh not installed)", () => {
  const spawn = spawnReturning({ error: new Error("ENOENT") });
  assert.throws(() => gh(spawn, ["api"]), /ENOENT/);
});

test("ghJson parses stdout and throws on non-zero exit with stderr", () => {
  const ok = spawnReturning({ status: 0, stdout: '{"a":1}', stderr: "" });
  assert.deepEqual(ghJson(ok, ["api", "x"]), { a: 1 });

  const bad = spawnReturning({ status: 1, stdout: "", stderr: "auth broke" });
  assert.throws(() => ghJson(bad, ["api", "x"]), /auth broke/);
});

test("ghPaginatedList slurps and flattens pages", () => {
  const spawn = spawnReturning({
    status: 0,
    stdout: "[[1,2],[3]]",
    stderr: "",
  });
  assert.deepEqual(ghPaginatedList(spawn, "repos/o/r/things"), [1, 2, 3]);
  assert.deepEqual(spawn.calls[0].args, [
    "api",
    "--paginate",
    "--slurp",
    "repos/o/r/things",
  ]);
});

test("ghPaginatedList rejects a non-list response", () => {
  const notList = spawnReturning({ status: 0, stdout: '{"x":1}', stderr: "" });
  assert.throws(() => ghPaginatedList(notList, "p"), /non-list/);
  const mixedPages = spawnReturning({
    status: 0,
    stdout: "[[1],2]",
    stderr: "",
  });
  assert.throws(() => ghPaginatedList(mixedPages, "p"), /non-list/);
});

/** A slurped two-page answer of an object-per-page endpoint. */
function pagesOf(...pages) {
  return spawnReturning({
    status: 0,
    stdout: JSON.stringify(pages),
    stderr: "",
  });
}

test("ghPaginatedObject slurps, and returns the items of every page", () => {
  const spawn = pagesOf(
    { total_count: 3, things: [{ id: 1 }, { id: 2 }] },
    { total_count: 3, things: [{ id: 3 }] },
  );
  const { items, pages } = ghPaginatedObject(
    spawn,
    "repos/o/r/things",
    "things",
  );
  assert.deepEqual(items, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.equal(pages.length, 2);
  assert.deepEqual(spawn.calls[0].args, [
    "api",
    "--paginate",
    "--slurp",
    "repos/o/r/things",
  ]);
});

test("ghPaginatedObject accepts a whole read of nothing", () => {
  const spawn = pagesOf({ total_count: 0, things: [] });
  assert.deepEqual(ghPaginatedObject(spawn, "p", "things").items, []);
});

test("ghPaginatedObject rejects a response that is not pages of objects", () => {
  for (const stdout of [
    "[]",
    '{"total_count":0,"things":[]}',
    "[[1,2]]",
    "[null]",
    '[{"things":[]}]',
    '[{"total_count":"1","things":[{"id":1}]}]',
    '[{"total_count":1}]',
    '[{"total_count":1,"things":{"id":1}}]',
    '[{"total_count":1,"other":[{"id":1}]}]',
  ]) {
    const spawn = spawnReturning({ status: 0, stdout, stderr: "" });
    assert.throws(
      () => ghPaginatedObject(spawn, "p", "things"),
      /unexpected response/,
      stdout,
    );
  }
});

test("ghPaginatedObject rejects pages that disagree on total_count", () => {
  const spawn = pagesOf(
    { total_count: 2, things: [{ id: 1 }] },
    { total_count: 3, things: [{ id: 2 }] },
  );
  assert.throws(
    () => ghPaginatedObject(spawn, "p", "things"),
    /total_count changed/,
  );
});

test("ghPaginatedObject rejects fewer or more items than total_count", () => {
  const fewer = pagesOf({ total_count: 2, things: [{ id: 1 }] });
  assert.throws(
    () => ghPaginatedObject(fewer, "p", "things"),
    /incomplete read of p: 1 of 2 things/,
  );
  const more = pagesOf({ total_count: 1, things: [{ id: 1 }, { id: 2 }] });
  assert.throws(
    () => ghPaginatedObject(more, "p", "things"),
    /incomplete read of p: 2 of 1 things/,
  );
});

test("ghPaginatedObject rejects a repeated id even when the count is right", () => {
  // Design review r1, case 1: paging over a listing that changes can repeat
  // one item and drop another, and the count still equals total_count.
  const spawn = pagesOf(
    { total_count: 2, things: [{ id: 101 }] },
    { total_count: 2, things: [{ id: 101 }] },
  );
  assert.throws(
    () => ghPaginatedObject(spawn, "p", "things"),
    /id 101 appears twice/,
  );
});

test("ghPaginatedObject rejects an item without an integer id", () => {
  for (const item of [{}, { id: "7" }, { id: 1.5 }, null, 7, "x"]) {
    const spawn = pagesOf({ total_count: 1, things: [item] });
    assert.throws(
      () => ghPaginatedObject(spawn, "p", "things"),
      /without an id/,
      JSON.stringify(item),
    );
  }
});

test("ghPaginatedObject throws on a non-zero exit, a spawn failure and bad JSON", () => {
  const bad = spawnReturning({ status: 1, stdout: "", stderr: "HTTP 502" });
  assert.throws(() => ghPaginatedObject(bad, "p", "things"), /HTTP 502/);
  const gone = spawnReturning({ error: new Error("ENOENT") });
  assert.throws(() => ghPaginatedObject(gone, "p", "things"), /ENOENT/);
  const cut = spawnReturning({ status: 0, stdout: '[{"total_co', stderr: "" });
  assert.throws(() => ghPaginatedObject(cut, "p", "things"));
});

test("requirePositiveInt accepts positives and rejects everything else", () => {
  assert.equal(requirePositiveInt("42", "--pr"), 42);
  for (const bad of [undefined, "0", "-1", "1.5", "abc", "", "07"]) {
    assert.throws(() => requirePositiveInt(bad, "--pr"), /--pr/);
  }
});
