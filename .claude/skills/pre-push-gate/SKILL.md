---
name: pre-push-gate
description: "Diagnose a failing stage of this repo's pre-push gate. Use when npm run local:gate or npm run validate fails; when an install guard, test:scripts, the format check, lint, typecheck, the coverage bar or the smoke goes red; or when checking whether a backgrounded gate really passed."
disable-model-invocation: false
---

# The pre-push gate

In this repo: adapted from the MCP Inspector's `pre-push-gate` skill (`modelcontextprotocol/inspector` at commit eb54b44). The record is in `PROVENANCE.md`, under "Gate guards". The Inspector's browser, Storybook, per-client, gate-lease and publish sections have no counterpart here and are left out.

The rules are in [`AGENTS.md`](../../../AGENTS.md): "Mandatory pre-push gate" and "Waiting on long-running work". What each script checks, the order of the stages, and the split between CI and the local gate are in [`docs/quality-gate.md`](../../../docs/quality-gate.md), in one place only. This skill is the procedure: how to run the gate, how to know whether it passed, and what to do first when a stage is red.

## Before you run it

- **Format first:** `npm run format`. The gate only checks formatting; it does not fix it.
- **A new worktree needs its own install:** `bun install --frozen-lockfile` (`/local-dev`).
- **The gate judges the working tree, not a commit.** A repair left uncommitted passes the gate while the commit that gets pushed is still broken. When the result has to vouch for a commit, commit first and use the block in `/pr-flow`, step 4, which ties a pass to one commit. Do not copy that block from memory.
- `npm run validate` is the fast inner loop and is not a substitute (`AGENTS.md`).

## Run it, and keep its exit status

```sh
(npm run local:gate; s=$?; echo "EXIT=$s"; exit $s)
```

- **Read the `EXIT=` line, not the tail of the log.** `EXIT=0` is the only pass. The last lines of a red run are not a reliable verdict: Prettier reports an unformatted file as `[warn]` lines with no "error" in them, and most guards print their failure to stderr, away from the stage's last line.
- **The command itself ends with the gate's status.** The parentheses run it in a subshell, so `exit` there cannot close your shell, and whatever started the command sees the same status the `EXIT=` line states.
- The gate runs `validate`, then `local:dco`, then `verify:skills:cli`, then `smoke`, and stops at the first stage that fails.

## Wait for it in the background

Start the command above as one background task and **wait for its completion notification. Do not poll** (`AGENTS.md`, "Waiting on long-running work"): no repeated `tail`, no `echo` each turn. When the notification arrives, read the `EXIT=` line in the task's output. If it is missing, the run did not finish; that is not a pass.

## Find the stage that failed

Each `npm run` prints a line of the form `> @northwoodssentinel/mycelia-mcp@<version> <script>` when the script starts. The chain stops at the first failure, so **the failing stage is the last such line in the log.** Then look for that stage's own failure line, below.

## Triage, stage by stage

In the order the gate runs them.

### `verify:install-fresh`

Its failure starts `verify:install-fresh — N problem(s):`, lists lines that begin `stale:` or `missing:`, and ends with `node_modules does not match bun.lock. Run`.

- **First:** run `bun install --frozen-lockfile`, then the gate again. The install is behind the lockfile, usually after a pull.
- Do not edit a test to get past this stage. With a stale install the tests say nothing about the lockfile.
- `lockfileVersion … is not the 1 this reader knows` means `bun.lock` was rewritten by another Bun. See "A red CI install step" below.
- `… requires "<name>", which bun.lock does not lock` means the lockfile itself is inconsistent. Re-lock in a change of its own, with the pinned Bun.

### `verify:action-pins`

Its failure starts `verify:action-pins — N problem(s); every action ref must be SHA-pinned:` and lists `<file> → <job>: <uses>`.

- **First:** pin that action as `uses: owner/repo@<40-hex sha> # vX.Y.Z`, taking the SHA and the release from the same tag lookup. A local `./…` action and a YAML alias are findings too.
- `no workflow files were found` means `.github/workflows/` was moved or emptied.

### `verify:skills`

Its failure starts `verify:skills — N problem(s):`, lists one problem per line, and ends `See AGENTS.md → Maintaining the skills.`

- **First:** read the listed line; it names the skill and the rule.
- The usual causes: a description with an unquoted `#` or `:`; a skill with no `disable-model-invocation`; a model-invoked skill without its eval cases; the listing over its character budget; an argument placeholder (a dollar sign and a digit) in a skill body; a script the gate reaches that starts `skills:eval`.

### `format:check`

Prettier prints `[warn] <file>` for each unformatted file and then a `[warn] Code style issues found` line. Nothing says "error".

- **First:** `npm run format`, then look at what it changed.

### `verify:format-coverage`

Its failure starts `verify:format-coverage — N problem(s):`.

- `<file> — matched by no` means the format check's glob does not cover a tracked source file. Fix the glob.
- `<file> — Prettier ignores it` means an ignore entry covers a tracked source file, or Prettier has no parser for it. Fix the ignore entry. This repo allows no exclusion.
- `uses its own --ignore-path`, `not a plain glob` and `reaches no` mean the format script was written in a form this guard refuses to read. Write it as a plain `prettier --check` with plain globs, joined with `&&`.

### `lint`

ESLint prints the file, then lines of the form `<line>:<column>  error  <message>  <rule>`, then `✖ N problem(s)`.

- **First:** fix the finding. There is no warning tier (`AGENTS.md`): do not widen an ignore or drop a rule. A waiver on one line is the rule's inline disable comment with a one-line reason.

### `typecheck`

Two different failures:

- **The compiler:** lines of the form `<file>(<line>,<column>): error TS<number>: <message>`. Fix the type error.
- **The coverage guard**, when the compiler printed no error: `verify:typecheck-coverage — N failure(s):` and then `<file> — in no tsconfig project`. A tracked TypeScript file is in no program, so the compiler passed without checking it. The `include` does not enter a directory whose name starts with a dot.
  - **First:** move the file to where the `include` reaches it. Widening the `include`, or naming the file in the guard's `EXCLUDED` with a reason, are the other two ways, in that order.

### `test:scripts`

These are `node --test` suites, one command per file. A failed case is a line `✖ <test name>`; the summary has `ℹ fail N` and a `✖ failing tests:` block. To run one file again: `node --test <path of that test file>`.

- **A guard's own test.** Read the assertion. If you changed that guard, this is the change.
- **The workflow scan.** The failed test is `never invokes a local-only script`, and its message starts `GitHub CI must not run a local-only script`, followed by `<file>:<line>` and the rule. **First:** take the `local:*` script, or the local `./…` action, out of the workflow. The rule and its reason are in `docs/quality-gate.md`.
- **The test-list check.** The failed test is `test:scripts names every tracked test file under scripts/`, and its message is `tracked but not in test:scripts:` with the paths. **First:** add `node --test <path>` for each to `test:scripts` in `package.json`. ⚠️ It reads **tracked** files. A new test file that is not yet added to git is invisible to it, so it cannot remind you: check the `test:scripts` line yourself when you add a test.
- **The attack suites.** Their tests are named `Codex case <number>: …`. Each is an adversarial case for the TypeScript inventory, the typecheck-coverage guard or the coverage-scope guard, run in throwaway directories. A failure means one of those guards changed behaviour. One of them runs the real Vitest and matches the wording of its threshold message, so a Vitest bump can fail it with no guard changed.
- **The entry-points harness.** Its message is `<script> exited <status> without a matching terminal verdict`. It runs each guard through a symlinked path and requires the guard's own end-of-run line with the matching exit status. **First:** if you reworded a guard's last line, update that guard's row in the harness. If you added a guard with a command line, add its row. If the guard printed nothing, its "was this file run directly" check is wrong.

### The coverage steps inside `test`

After `test:scripts`, `npm run test` runs three more steps. They print in this order.

- **Before the tests:** `verify:coverage-scope --prepare — coverage/coverage-summary.json is absent` is the passing line. A failure here is `✗ N coverage-scope failure(s):` and says the summary path is a directory or cannot be removed. Remove it by hand.
- **A failing test:** Vitest prints `FAIL  <file> > <test name>` with the assertion, and `Tests  N failed`. Fix the test or the code.
- **A file under the bar:** every test passed, and Vitest prints `ERROR: Coverage for <dimension> (<n>%) does not meet global threshold (90%) for <file>`. **First:** write the missing tests (`/testing`). An ignore annotation is only for a branch that cannot be reached, with its reason (`AGENTS.md`).
- **After the tests:** `✗ N coverage-scope failure(s):`, in one of three forms.
  - `mycelia-mcp: N of M file(s) its coverage include declares are missing from coverage-summary.json`: the run measured fewer files than the configuration declares. Fix the coverage `include`. Never excuse the files.
  - `N tracked TypeScript file(s) are outside the expanded coverage declaration`: a TypeScript file is tracked outside `src/`. Move it into `src/`.
  - `cannot open … coverage-summary.json`: the test run wrote no summary. Check that the coverage reporters still include `json-summary`.

### `local:dco`

- **An unsigned commit:** `dco: FAIL — N of M commit(s) in origin/main..HEAD lack a matching signoff:`, then each commit and a `Repair` block. The repair and how to prevent it are in `/pr-flow`, step 3.
- **No `origin/main`:** `dco: git log origin/main..HEAD failed:` followed by git's own `unknown revision` error. **First:** `git fetch origin`, then run again.
- If it lists commits that are not yours, your `origin/main` is behind the branch point. `git fetch origin` and run again.

### `verify:skills:cli`

It prints `verify:skills:cli — validating .claude/skills via …` and then the validator's own output.

- `verify:skills:cli — \`claude plugin validate\` rejected the skills.`: read the validator's output above that line; it names the skill and the field.
- `verify:skills:cli — could not run`: the validator did not start. When the installed `claude` is not exactly the pinned version, this stage fetches the pinned package with `npx -y`, so it needs the network. A fetch error is the network, not your skill.
- The pin is `PINNED_CLI_VERSION`. A newer `claude` on your machine is not used, on purpose: it would be a different schema from CI's.

### `smoke`

Failures are lines `smoke — FAIL  <case>: <reason>`, and the run ends `smoke — N gating check(s) failed`. A `smoke — report …` line marked "not gating" is not a failure.

- **First:** load `/client-smoke`. It holds the exit codes, the protocol eras and how to run one case by hand.

## A red CI install step

When CI fails at "Install dependencies" on a change that touched `bun.lock`, the first thing to check is which Bun rewrote the lock: a Bun newer than the one CI pins can write a lockfile the pinned one refuses. Restore `bun.lock` and make the change again with the pinned Bun. The rule and its measurement are in `docs/quality-gate.md`, "Installs and the lockfile".

## Known limitations

What a green gate does not prove. The reasons are in `docs/quality-gate.md` and in the design note it points to.

- **The workflow scan knows a stage by its script name.** It does not see a local-only command run directly, without its `local:*` name. It does not follow a script into the commands that script runs.
- **`verify:install-fresh` checks that what the lockfile requires is installed, and nothing else.** It does not report a package that is installed and not locked. It does not compare the dependencies `package.json` declares with the lockfile.
- **No guard checks install-time scripts.** A local install follows Bun's default trust list. CI installs with `--ignore-scripts`.
- **The test-list check reads tracked files only** (above).
- **The guards added with this skill were measured on macOS only.** CI runs Ubuntu, Node 22 and the pinned Bun, and a CI run is the first evidence there.
- **A green gate is the strongest predictor of a green CI this repo has, not a proof** (`AGENTS.md`).
- **These steps describe; they do not enforce.** Nothing checks that the gate was run before a push.
