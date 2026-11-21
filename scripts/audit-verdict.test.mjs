// Tests for scripts/audit-verdict.mjs (NOR-610): the reading of one Codex
// audit round's final message. Run via `npm run test:scripts`.
//
// The first three cases are the SHAPES of three real final messages measured
// before the rule was written (the bodies here are stand-ins; only the shape
// of the verdict line and where it sits are kept). The rest are the odd
// messages the audit named as having no defined outcome, and the attack cases
// of design review r1. Every odd message must read as "no verdict", never as
// a pass.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAIL, main, NO_VERDICT, PASS, readVerdict } from "./audit-verdict.mjs";

const lines = (...rows) => rows.join("\n");

test("measured shape 1: a bold verdict as the last line", () => {
  const text = lines(
    "## Findings",
    "",
    "1. **MEDIUM** an odd verdict has no defined outcome:",
    "   - `AUDIT: unknown`;",
    "   - a quoted `AUDIT: pass` plus a real `AUDIT: fail` in one message.",
    "",
    "**AUDIT: fail**",
  );
  assert.equal(readVerdict(text), FAIL);
});

test("measured shape 2: the verdict first, with a dash and a sentence, prose last", () => {
  const text = lines(
    "AUDIT: fail — one in-scope race remains; all other rows hold.",
    "",
    "## Findings",
    "",
    "1. HIGH: the wait can end early.",
    "",
    "The round's changes repair the four earlier defects, but one remains.",
  );
  assert.equal(readVerdict(text), FAIL);
});

test("measured shape 3: a bare verdict as the last line", () => {
  const text = lines("No findings. Every row reviewed.", "", "AUDIT: pass");
  assert.equal(readVerdict(text), PASS);
});

test("the forms inside the grammar", () => {
  for (const [line, verdict] of [
    ["AUDIT: pass", PASS],
    ["AUDIT: fail", FAIL],
    ["AUDIT: pass   ", PASS],
    ["   AUDIT: pass", PASS],
    ["**AUDIT: pass**", PASS],
    ["__AUDIT: fail__", FAIL],
    ["*AUDIT: fail*", FAIL],
    ["_AUDIT: pass_", PASS],
    ["AUDIT: fail.", FAIL],
    ["AUDIT: pass, with notes below", PASS],
    ["AUDIT: fail; see finding 2", FAIL],
    ["AUDIT: fail: one finding", FAIL],
    ["AUDIT: fail—one finding", FAIL],
    ["AUDIT: fail – one finding", FAIL],
    ["AUDIT: fail - one finding", FAIL],
    ["AUDIT: pass (no findings)", PASS],
    ["**AUDIT: fail** — one finding", FAIL],
    ["AUDIT: pass\r", PASS],
  ]) {
    assert.equal(readVerdict(`Review.\n\n${line}\n`), verdict, line);
  }
});

test("a malformed candidate is no verdict", () => {
  for (const line of [
    "AUDIT: unknown",
    "AUDIT: passed",
    "AUDIT: failed",
    "AUDIT: pass|fail",
    "AUDIT: pass/fail",
    "AUDIT: pass or fail",
    "AUDIT: pass-fail",
    "AUDIT: pass_x",
    "AUDIT: PASS",
    "AUDIT:pass",
    "AUDIT:  pass",
    "AUDIT:",
    "AUDIT: pass***",
    "AUDIT: pass(no space)",
  ]) {
    assert.equal(readVerdict(`Review.\n\n${line}\n`), NO_VERDICT, line);
  }
});

test("a malformed candidate beside a real verdict is still no verdict", () => {
  // Design review r1, case 3: the first word of a format note is not a verdict,
  // and a message that holds one cannot be read by this script at all.
  assert.equal(
    readVerdict(lines("The final line should use:", "", "AUDIT: pass or fail")),
    NO_VERDICT,
  );
  assert.equal(
    readVerdict(lines("AUDIT: pass or fail", "", "AUDIT: pass")),
    NO_VERDICT,
  );
  assert.equal(
    readVerdict(lines("AUDIT: unknown", "", "AUDIT: pass")),
    NO_VERDICT,
  );
});

test("a quoted pass beside a real fail is a fail, and never a pass", () => {
  const text = lines(
    "The repository contains the string `AUDIT: pass` in a fixture.",
    "- AUDIT: pass",
    "> AUDIT: pass",
    "",
    "AUDIT: fail",
  );
  assert.equal(readVerdict(text), FAIL);
});

test("two agreeing verdict lines are that verdict; both kinds are no verdict", () => {
  assert.equal(readVerdict(lines("AUDIT: fail", "text", "AUDIT: fail")), FAIL);
  assert.equal(
    readVerdict(lines("AUDIT: pass", "text", "**AUDIT: pass**")),
    PASS,
  );
  assert.equal(
    readVerdict(lines("AUDIT: pass", "text", "AUDIT: fail")),
    NO_VERDICT,
  );
});

test("lines that are not candidates are not verdicts", () => {
  for (const line of [
    "- AUDIT: pass",
    "* AUDIT: pass",
    "+ AUDIT: pass",
    "1. AUDIT: pass",
    "> AUDIT: pass",
    "`AUDIT: pass`",
    "    AUDIT: pass",
    "\tAUDIT: pass",
    "The verdict is AUDIT: pass",
    "***AUDIT: pass***",
    "** AUDIT: pass**",
    "audit: pass",
  ]) {
    assert.equal(readVerdict(`Review.\n\n${line}\n`), NO_VERDICT, line);
  }
});

test("a verdict inside a fenced block is not a verdict", () => {
  const fenced = [
    ["```", "AUDIT: pass", "```"],
    ["```text", "AUDIT: pass", "```"],
    ["~~~text", "AUDIT: pass", "~~~"],
    ["````", "```", "AUDIT: pass", "```", "````"],
    ["   ```", "AUDIT: pass", "   ```"],
    ["~~~", "```", "AUDIT: pass", "~~~"],
    // A shorter run, or the other character, does not close the fence.
    ["````", "AUDIT: pass", "```", "AUDIT: pass"],
    ["```", "AUDIT: pass", "~~~", "AUDIT: pass"],
    // Text after the run does not close it either.
    ["```", "AUDIT: pass", "``` end", "AUDIT: pass"],
    // A fence that never closes runs to the end.
    ["```", "AUDIT: pass"],
    ["Review.", "~~~", "quoted", "", "AUDIT: pass"],
  ];
  for (const rows of fenced) {
    assert.equal(readVerdict(lines(...rows)), NO_VERDICT, rows.join("\\n"));
  }
});

test("a verdict after a closed fence is read; one inside it is not", () => {
  const text = lines("```", "AUDIT: pass", "```", "", "AUDIT: fail");
  assert.equal(readVerdict(text), FAIL);
  // A malformed candidate inside a fence is skipped with the rest of it.
  assert.equal(
    readVerdict(lines("~~~", "AUDIT: pass|fail", "~~~", "", "AUDIT: pass")),
    PASS,
  );
});

test("nothing to read is no verdict", () => {
  for (const text of ["", "   \n\t\n", undefined, null, 7]) {
    assert.equal(readVerdict(text), NO_VERDICT);
  }
  assert.equal(
    readVerdict("A review with no verdict line at all."),
    NO_VERDICT,
  );
});

function quiet() {
  const out = [];
  const err = [];
  return {
    out,
    err,
    io: { log: (line) => out.push(line), error: (line) => err.push(line) },
  };
}

test("main prints one line and exits 0 for pass, 1 for fail, 2 for no verdict", () => {
  const dir = mkdtempSync(join(tmpdir(), "audit-verdict-"));
  try {
    for (const [body, line, code] of [
      ["Fine.\n\nAUDIT: pass\n", "audit verdict: pass", 0],
      ["Not fine.\n\nAUDIT: fail\n", "audit verdict: fail", 1],
      ["AUDIT: unknown\n", "audit verdict: no verdict", 2],
      ["", "audit verdict: no verdict", 2],
    ]) {
      const file = join(dir, "last-message.txt");
      writeFileSync(file, body);
      const { out, io } = quiet();
      assert.equal(main([file], io), code, body);
      assert.deepEqual(out, [line]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("main reads a missing file, no argument and extra arguments as no verdict", () => {
  const dir = mkdtempSync(join(tmpdir(), "audit-verdict-"));
  try {
    const good = join(dir, "good.txt");
    writeFileSync(good, "AUDIT: pass\n");
    for (const argv of [[join(dir, "absent.txt")], [], [good, good]]) {
      const { out, err, io } = quiet();
      assert.equal(main(argv, io), 2, JSON.stringify(argv));
      assert.deepEqual(out, ["audit verdict: no verdict"]);
      assert.equal(err.length, 1);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
