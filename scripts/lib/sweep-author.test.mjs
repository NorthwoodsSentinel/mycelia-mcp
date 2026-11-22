// Tests for scripts/lib/sweep-author.mjs: the author checks a scheduled sweep
// applies before it trusts a marker.
//
// In this repo: the first two tests are lines 148 to 225 of the MCP Inspector's
// `scripts/sdk-watch.test.mjs` (modelcontextprotocol/inspector at commit
// 7df76f6eea9ea425891289333837878ebb31ae6a, blob
// b1543bb15a5c7a914ca7fab02c02b0b838564024), by copy then edit: the unchanged
// excerpt is this file's first commit here. Edits: the imports; the label list
// is passed in (`LABELS`, this repository's pair) where the source read its
// constant; and each fixture's author is the REST shape, `user.login` and
// `user.type`, where the source's was `author.login` and `author.is_bot`. The
// logins tried, and what each must give, are the source's. The tests after
// those two are written here, for the edits the library's header lists.
// Record: PROVENANCE.md, "Sweeps".
//
// Run via `npm run test:scripts`, which names this file by path.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTOMATION_LOGIN,
  hasSweepAuthor,
  hasSweepLabels,
  isAutomationComment,
  isSweepAuthored,
} from "./sweep-author.mjs";

/** The pair the monthly sweep passes; any non-empty list would do here. */
const LABELS = ["chore", "dependabot"];

test("isSweepAuthored requires both the automation author and the sweep's labels", () => {
  const owned = {
    user: { login: "github-actions[bot]", type: "Bot" },
    labels: LABELS.map((name) => ({ name })),
  };
  assert.equal(isSweepAuthored(owned, LABELS), true);
  // The SAME account has three spellings; all three must be accepted, or
  // suppression silently stops working (#2377). See `AUTOMATION_LOGIN`.
  for (const login of [
    "github-actions", // older `gh issue list --json author`
    "github-actions[bot]", // REST issues and comments endpoints
    "app/github-actions", // newer `gh issue list --json author` — the #2377 miss
    "App/GitHub-Actions[bot]", // nothing promises a casing or one form at a time
  ]) {
    assert.equal(
      isSweepAuthored({ ...owned, user: { login, type: "Bot" } }, LABELS),
      true,
      `login spelling ${JSON.stringify(login)} must be recognized as the sweep's own`,
    );
  }
  // The prefix strip must not become a way in for an account that is NOT ours.
  // `/` is not legal in a GitHub username, so these cannot exist — but the
  // predicate should not be the reason we believe that.
  for (const login of [
    "app/someone",
    "notapp/github-actions",
    "app/github-actions-nightly",
    "github-actions-nightly",
    "app//github-actions",
  ]) {
    assert.equal(
      isSweepAuthored({ ...owned, user: { login, type: "Bot" } }, LABELS),
      false,
      `login spelling ${JSON.stringify(login)} must NOT be accepted`,
    );
  }
  // An outsider's issue carrying a forged marker: right shape, wrong provenance.
  assert.equal(
    isSweepAuthored(
      { ...owned, user: { login: "someone", type: "User" } },
      LABELS,
    ),
    false,
  );
  // A human account named to look official is still a human account.
  assert.equal(
    isSweepAuthored(
      { ...owned, user: { login: "github-actions", type: "User" } },
      LABELS,
    ),
    false,
  );
  // Right author, but missing a label only someone with write access can set.
  assert.equal(
    isSweepAuthored({ ...owned, labels: [{ name: "chore" }] }, LABELS),
    false,
  );
  assert.equal(isSweepAuthored({ ...owned, labels: [] }, LABELS), false);
  assert.equal(isSweepAuthored({}, LABELS), false);
});

test("hasSweepAuthor and hasSweepLabels are the two independent halves", () => {
  const owned = {
    user: { login: "app/github-actions", type: "Bot" },
    labels: LABELS.map((name) => ({ name })),
  };
  assert.equal(hasSweepAuthor(owned), true);
  assert.equal(hasSweepLabels(owned, LABELS), true);
  // Each half ignores the other's input entirely.
  assert.equal(hasSweepAuthor({ ...owned, labels: [] }), true);
  assert.equal(
    hasSweepLabels({ ...owned, user: { login: "someone" } }, LABELS),
    true,
  );
  assert.equal(
    hasSweepLabels({ ...owned, labels: [{ name: "chore" }] }, LABELS),
    false,
  );
  assert.equal(hasSweepAuthor({}), false);
  assert.equal(hasSweepLabels({}, LABELS), false);
});

// ---- written here ----

test("hasSweepAuthor requires the REST account type to be exactly Bot", () => {
  const login = "github-actions[bot]";
  assert.equal(hasSweepAuthor({ user: { login, type: "Bot" } }), true);
  for (const type of [
    undefined,
    null,
    "",
    "User",
    "Organization",
    "bot",
    true,
  ]) {
    assert.equal(
      hasSweepAuthor({ user: { login, type } }),
      false,
      `account type ${JSON.stringify(type)} must not count as the automation`,
    );
  }
});

test("hasSweepAuthor does not read the gh-list author shape", () => {
  // The source's shape. An issue described that way has no `user`, so it is
  // not ours: the sweep here lists through REST and nothing else.
  assert.equal(
    hasSweepAuthor({ author: { login: AUTOMATION_LOGIN, is_bot: true } }),
    false,
  );
});

test("hasSweepAuthor and hasSweepLabels survive a malformed issue", () => {
  for (const issue of [null, undefined, "x", 7, [], { user: null }]) {
    assert.equal(hasSweepAuthor(issue), false);
    assert.equal(hasSweepLabels(issue, LABELS), false);
  }
  for (const labels of [null, "chore,dependabot", { name: "chore" }, 7]) {
    assert.equal(hasSweepLabels({ labels }, LABELS), false);
  }
  // A label entry that is not an object names nothing.
  assert.equal(
    hasSweepLabels({ labels: [null, "chore", { name: "chore" }] }, LABELS),
    false,
  );
});

test("an empty or malformed label list throws instead of passing every issue", () => {
  // "Every one of no labels is present" is true of any issue: the author check
  // would then pass on the login alone.
  const owned = {
    user: { login: "github-actions[bot]", type: "Bot" },
    labels: LABELS.map((name) => ({ name })),
  };
  for (const labels of [undefined, null, [], "chore", [""], ["chore", 7]]) {
    assert.throws(
      () => hasSweepLabels(owned, labels),
      /non-empty list of label names/,
    );
    assert.throws(
      () => isSweepAuthored(owned, labels),
      /non-empty list of label names/,
    );
    // The list is checked before the author, so a wrong author cannot hide it.
    assert.throws(
      () => isSweepAuthored({}, labels),
      /non-empty list of label names/,
    );
  }
});

test("isAutomationComment accepts the automation's spellings and nothing else", () => {
  for (const author of [
    "github-actions",
    "github-actions[bot]",
    "app/github-actions",
  ]) {
    assert.equal(isAutomationComment({ author, isBot: true }), true);
    // `isBot` absent is tolerated; only an explicit `false` disqualifies.
    assert.equal(isAutomationComment({ author }), true);
    assert.equal(isAutomationComment({ author, isBot: false }), false);
  }
  assert.equal(isAutomationComment({ author: "someone", isBot: true }), false);
  assert.equal(
    isAutomationComment({ author: "dependabot[bot]", isBot: true }),
    false,
  );
  assert.equal(isAutomationComment({}), false);
  assert.equal(isAutomationComment(undefined), false);
});
