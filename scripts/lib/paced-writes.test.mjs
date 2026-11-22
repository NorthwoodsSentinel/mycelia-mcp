// Tests for scripts/lib/paced-writes.mjs: one second between consecutive
// GitHub writes (AGENTS.md, "Pace bulk GitHub writes"). Written in this repo.
// Every case but the last passes a recorder as the pause, so nothing waits.
// Run via `npm run test:scripts`, which names this file by path.

import { test } from "node:test";
import assert from "node:assert/strict";
import { pacedWrites, sleepSync, WRITE_PAUSE_MS } from "./paced-writes.mjs";

/** A pause that records what it was asked for, and the order of events. */
function recorder() {
  const events = [];
  const pause = (ms) => events.push(`pause ${ms}`);
  return { events, pause };
}

test("the gap is the one second the rule names", () => {
  assert.equal(WRITE_PAUSE_MS, 1000);
});

test("a single write goes straight through, with no pause", () => {
  const { events, pause } = recorder();
  const write = pacedWrites(pause);
  assert.equal(
    write(() => {
      events.push("write 1");
      return "result";
    }),
    "result",
  );
  assert.deepEqual(events, ["write 1"]);
});

test("every write after the first waits one second, before it starts", () => {
  const { events, pause } = recorder();
  const write = pacedWrites(pause);
  for (const n of [1, 2, 3]) write(() => events.push(`write ${n}`));
  assert.deepEqual(events, [
    "write 1",
    "pause 1000",
    "write 2",
    "pause 1000",
    "write 3",
  ]);
});

test("a write that throws still counts, so the next one waits", () => {
  const { events, pause } = recorder();
  const write = pacedWrites(pause);
  assert.throws(
    () =>
      write(() => {
        events.push("write 1");
        throw new Error("refused");
      }),
    /refused/,
  );
  write(() => events.push("write 2"));
  assert.deepEqual(events, ["write 1", "pause 1000", "write 2"]);
});

test("two runs do not share a pause", () => {
  const { events, pause } = recorder();
  pacedWrites(pause)(() => events.push("run A write"));
  pacedWrites(pause)(() => events.push("run B write"));
  assert.deepEqual(events, ["run A write", "run B write"]);
});

test("the default pause really blocks, for at least what it was asked", () => {
  // A lower bound only, on a short wait: it shows the default is a real
  // sleep and cannot race, since nothing here depends on an upper bound.
  const started = performance.now();
  sleepSync(30);
  assert.ok(performance.now() - started >= 25);
});
