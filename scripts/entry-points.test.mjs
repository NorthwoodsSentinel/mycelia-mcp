// Every guard reports a verdict when run through a symlinked checkout path.
//
// Node builds the entry module's `import.meta.url` from the file's REAL path,
// while `process.argv[1]` keeps the path as typed. A guard whose entry check
// compares the two directly (`import.meta.url === pathToFileURL(argv[1])`, or
// `path.resolve(argv[1]) === fileURLToPath(import.meta.url)`) is therefore
// never "main" when the checkout is reached through a symlink: it skips its
// work and exits 0 having printed nothing, and a green gate then means nothing
// was checked. The fix is `isMainModule` from `lib/main-module.mjs`, which
// also compares the symlink-resolved path (see its header).
//
// `main-module.test.mjs` tests the helper; this tests that each guard USES it,
// at process level, the way `npm run` runs it: `node <path>/scripts/<guard>.mjs`
// with the checkout reached through a symlink. Each case asserts a TERMINAL
// verdict: the guard's own end-of-run success line with exit 0, or its own
// failure line with exit 1 — never a start banner or header, which a guard can
// print and then exit 0 having checked nothing. Pass or fail does not matter
// here; silence, or a banner alone, does.
//
// Each invocation is chosen to reach a verdict quickly and without the network
// or writes: `dco-check --base HEAD` checks an empty range, which always
// passes; `smoke-inspector` runs with an empty PATH, so its first step (the
// registry integrity check) fails at once and `main()` returns 1 on that line
// instead of starting the Inspector. `verify-skills-cli` runs with a stub
// `claude` alone on PATH (below), so it takes its local-CLI branch and never
// reaches the network. Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import { fileURLToPath } from "node:url";
import { PINNED_CLI_VERSION } from "./lib/skill-manifest.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The one budget for a guard run in this file: a guard against a hung child,
// not a pacing value. Each case finishes in about a second.
const GUARD_TIMEOUT_MS = 120_000;

/**
 * Each guard, the arguments that reach its verdict, any environment override,
 * and its terminal verdicts: an exit status paired with a line the guard prints
 * only once its checks have completed (or a check has failed). The lines are
 * the scripts' own end-of-run strings; a run must match one pair exactly.
 *
 * @type {{ script: string, args: string[], env?: Record<string, string>, terminal: { status: number, line: RegExp }[] }[]}
 */
const GUARDS = [
  {
    script: "verify-action-pins.mjs",
    args: [],
    terminal: [
      { status: 0, line: /^verify:action-pins — OK \(/m },
      { status: 1, line: /^verify:action-pins — \d+ problem\(s\);/m },
    ],
  },
  {
    script: "verify-skills.mjs",
    args: [],
    terminal: [
      { status: 0, line: /^verify:skills — OK: \d+ skills/m },
      {
        status: 1,
        line: /^verify:skills — (\d+ problem\(s\):|no skills found;|.+ does not exist\.)/m,
      },
    ],
  },
  {
    script: "dco-check.mjs",
    args: ["--base", "HEAD"],
    terminal: [
      {
        status: 0,
        line: /^dco: OK — 0 commit\(s\) signed off in HEAD\.\.HEAD$/m,
      },
    ],
  },
  {
    script: "smoke-inspector.mjs",
    args: [],
    env: { PATH: path.join(tmpdir(), "mycelia-mcp-entry-points-no-such-dir") },
    terminal: [
      {
        status: 1,
        line: /^smoke — FAIL {2}the registry's integrity for @modelcontextprotocol\/inspector@/m,
      },
    ],
  },
];

const linkDir = mkdtempSync(path.join(tmpdir(), "mycelia-mcp-entry-points-"));
const LINK = path.join(linkDir, "checkout");
symlinkSync(REPO, LINK, "dir");
process.on("exit", () => rmSync(linkDir, { recursive: true, force: true }));

test("the symlinked checkout path is not its real path (the fixture holds)", () => {
  const typed = path.join(LINK, "scripts", "verify-skills.mjs");
  assert.notEqual(realpathSync(typed), typed);
});

for (const { script, args, env, terminal } of GUARDS) {
  test(`${script} reports a terminal verdict when run through a symlinked checkout`, () => {
    const res = spawnSync(
      process.execPath,
      [path.join(LINK, "scripts", script), ...args],
      {
        cwd: LINK,
        encoding: "utf8",
        env: { ...process.env, ...env },
        timeout: GUARD_TIMEOUT_MS,
      },
    );
    assert.equal(res.error, undefined, `${script} did not run: ${res.error}`);
    const output = `${res.stdout}${res.stderr}`;
    assert.ok(
      terminal.some(
        ({ status, line }) => res.status === status && line.test(output),
      ),
      `${script} exited ${res.status} without a matching terminal verdict ` +
        `(${terminal.map((t) => `exit ${t.status} + ${t.line}`).join(" | ")}); ` +
        `a silent exit, or a banner alone, means it checked nothing. Output:\n${output}`,
    );
  });
}

// verify-skills-cli prints no end-of-run line of its own on success (the
// Inspector's script ends with the validator's own output), so its banner
// alone cannot be the verdict. A stub `claude`, alone on PATH, reports the
// pinned version, so the guard takes its local-CLI branch (no network); its
// `plugin validate` prints a line naming the directory it was handed and
// exits with STUB_STATUS. The pass needs that stub line, which appears only if
// the guard really spawned the validator; the fail needs the guard's own
// rejection line, which it prints only after propagating the validator's
// exit status.
const STUB_BIN = path.join(linkDir, "stub-bin");
mkdirSync(STUB_BIN);
writeFileSync(
  path.join(STUB_BIN, "claude"),
  [
    "#!/bin/sh",
    `if [ "$1" = "--version" ]; then echo "${PINNED_CLI_VERSION} (Claude Code)"; exit 0; fi`,
    'if [ "$1 $2" = "plugin validate" ]; then',
    '  echo "stub-validate: $3"',
    '  exit "${STUB_STATUS:-0}"',
    "fi",
    "exit 2",
    "",
  ].join("\n"),
);
chmodSync(path.join(STUB_BIN, "claude"), 0o755);

for (const [stubStatus, status, line] of [
  ["0", 0, /^stub-validate: \.claude\/skills$/m],
  [
    "1",
    1,
    /^verify:skills:cli — `claude plugin validate` rejected the skills\.$/m,
  ],
]) {
  test(`verify-skills-cli.mjs reports a terminal verdict through a symlinked checkout (validator exits ${stubStatus})`, () => {
    const res = spawnSync(
      process.execPath,
      [path.join(LINK, "scripts", "verify-skills-cli.mjs")],
      {
        cwd: LINK,
        encoding: "utf8",
        env: { ...process.env, PATH: STUB_BIN, STUB_STATUS: stubStatus },
        timeout: GUARD_TIMEOUT_MS,
      },
    );
    assert.equal(res.error, undefined, `did not run: ${res.error}`);
    const output = `${res.stdout}${res.stderr}`;
    assert.match(
      output,
      /^verify:skills:cli — validating \.claude\/skills via local claude .+ \(matches the pin\)…$/m,
    );
    assert.equal(res.status, status, output);
    assert.match(output, line);
  });
}
