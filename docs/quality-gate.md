# The quality gate

This page says what each gate script in this repo checks, in what order the scripts run, and what a failure of each one means. It is the one description of the split between GitHub CI and the local pre-push gate; `AGENTS.md`, `README.md` and the header of `.github/workflows/main.yml` point here. The rules themselves (the pre-push requirement, the coverage bar, where tests go) are in [`AGENTS.md`](../AGENTS.md). The page is adapted from the MCP Inspector's `docs/quality-gate.md` (`modelcontextprotocol/inspector`, `main` at eb54b44; record: [`PROVENANCE.md`](../PROVENANCE.md)). The Inspector has several clients, a browser bundle and a build; this repo is one Bun package with no build, so most of the Inspector's page has no counterpart here (see the last section).

## Two tiers: GitHub CI and the local gate

| Tier | How it runs | What it runs |
| --- | --- | --- |
| **GitHub CI** (`.github/workflows/main.yml`, job `validate`) | Automatically, on every pull request and on every push to `main` | `bun install --frozen-lockfile --ignore-scripts`, then `npm run validate && npm run verify:skills:cli && npm run smoke` |
| **The local gate** (`npm run local:gate`) | By hand, before a push | `validate`, then `local:dco`, then `verify:skills:cli`, then `smoke`. The install is yours to run first |

The local gate runs every check CI runs, and one step CI does not:

| Local-only step | Why it is local-only |
| --- | --- |
| `local:dco` | It checks sign-offs over `origin/main..HEAD`. CI's checkout is shallow and has no `origin/main`, so the range cannot be read there. |

A pull request's commits are checked for sign-off in CI by a separate workflow, `.github/workflows/dco.yml`, which runs the same script (`scripts/dco-check.mjs`). It has two jobs: `DCO`, on every pull request, over that pull request's commits; and `DCO (main push)`, on every push to `main`, as a backstop. Its header records what it does and does not protect against.

**`.github/workflows/codeql.yml`** runs CodeQL code scanning (`actions` and `javascript-typescript`, default query suite) on every push to `main` and every pull request into it, plus a weekly schedule. It is the Inspector's workflow with the branch list changed (record: [`PROVENANCE.md`](../PROVENANCE.md), "Sweeps"). CodeQL *default* setup is a repository setting and must stay **off**: GitHub rejects an advanced-setup upload while it is on. The job holds `security-events: write`, so `verify:action-pins` counts it as credentialed; its actions are SHA-pinned, as every job's are here. It has no local-gate counterpart: the local gate does not run it, and its findings arrive as code-scanning alerts, not as a stage of `validate`.

**`.github/workflows/dependency-refresh.yml`** is the monthly dependency sweep. On the 1st of each month, or on a manual run, it installs from `bun.lock` and runs `scripts/dependency-refresh.mjs`, which lists every npm package (`npm outdated`) and every workflow action that is behind and files one GitHub issue, or edits the one it filed before. It opens no pull request and closes no issue. It is the Inspector's workflow and script, adapted (record: [`PROVENANCE.md`](../PROVENANCE.md), "Sweeps"; the edits are in each file's header). Its job holds `issues: write` and no secret but `GITHUB_TOKEN`. It is not a gate: a red run means the sweep could not read something or could not write its issue, not that a change is wrong. The gate does cover it in three places: `verify:action-pins` reads its pins, the workflow scan reads it with the others, and the script's tests run in `test:scripts`. **The issue is filed with the labels `factory`, `chore` and `dependabot`, and the run is red until all three exist**; creating a label is the owner's.

**`.github/workflows/dependabot-alerts.yml`** is the daily alert sweep. Once a day, or on a manual run, it installs from `bun.lock` and runs `scripts/dependabot-alerts.mjs`, which reads this repository's open Dependabot alerts, checks each against the versions `bun.lock` holds, and files one GitHub issue per bump, or edits the one it filed before. It also asks GitHub's advisory listing about every version locked in `bun.lock` (`scripts/lib/lock-advisories.mjs`; design: [`DESIGN-nor-695-lockfile-advisories.md`](./DESIGN-nor-695-lockfile-advisories.md)) and files an advisory that applies the same way, under the manifest `bun.lock`, unless a Dependabot alert, open or dismissed, already names it; a new advisory for a bump that already has an issue becomes a comment on it. It opens no pull request and closes no issue: an issue whose alert is gone is rewritten to say so and left open. It is the Inspector's workflow and script, adapted (record: [`PROVENANCE.md`](../PROVENANCE.md), "Sweeps"; the edits are in each file's header). Its job holds `issues: write` and `vulnerability-alerts: read`, and no secret but `GITHUB_TOKEN`. It is not a gate, and the gate covers it in the same three places as the monthly sweep. Three things it does not do: it files nothing for an advisory that has no patched version yet, and asks about no malware or unreviewed advisory; it cannot read the Dependabot security updates setting with the job's token, so each run logs UNVERIFIED; and an alert that is not npm is logged and not filed. **A red run of it means one of three things.** A read failed or came back malformed (the alerts, the open issues, a comment listing, a write). Or the lock file check could not be completed: `bun.lock` could not be read or holds an entry that is not a registry version, the advisory listing could not be reached or answered something misshapen, or an answer did not hold a control advisory (the check's two known-positive pairs, which are what tell an empty answer from "nothing found"); the run then stopped before any write. Or the run did its work and then failed on purpose: an npm bump could not be checked (a manifest path other than `package.json` or `bun.lock`), or one of the two control advisories has been withdrawn upstream and needs replacing in `scripts/lib/lock-advisories.mjs`. In that third case every other bump was still processed, and the run's last lines name what was not. **It needs the same three labels as the monthly sweep to file an issue**; with no open alert it files nothing, and the run is green without them.

### Nothing named `local:*` runs in a workflow

The `local:` prefix marks a script as local-only. `scripts/lib/workflow-gate.mjs` enforces it: its test, which `test:scripts` runs, parses every `.yml` and `.yaml` file in `.github/workflows/` and fails if a `run:`, a custom `shell:`, or a value in an `env:`, `container.env:` or `with:` mapping runs a `local:*` script through `npm`, `pnpm`, `bun` or `yarn`. A name spelled through an expression or a shell variable (`npm run local:${{ … }}`, `npm run local:$TASK`) counts as one. A `uses:` that starts with `./` is also a finding, because the scan does not enter that file. The test fails if the directory holds no workflow file, and an unparseable workflow is an error, not an empty result.

Its limits, stated in its header and accepted:

- **It knows a stage by its script name.** A step that runs `node scripts/dco-check.mjs --base origin/main` directly, without the `local:dco` name, is not reported.
- **It does not follow a script into its own commands.** A workflow that runs `npm run validate` is clean even if `validate`, or a script it calls, were changed to run a `local:*` script.
- It errs toward a finding: a `local:` script named in echoed text or after an inline `#` inside a `run:` is reported.
- It is not a defence against deliberate evasion: whoever can edit a workflow can edit the guard in the same pull request, and review of that diff is the control.

## Installs and the lockfile

**CI installs with `--frozen-lockfile --ignore-scripts`** (`main.yml`, step "Install dependencies"): from `bun.lock` exactly, and without running any dependency's install script.

**A local install follows Bun's built-in default trust list**, because `package.json` defines no `trustedDependencies`. No guard checks install-time scripts here yet. The reason is in the design note for these guards, [`DESIGN-nor-615-gates.md`](./DESIGN-nor-615-gates.md), section 2.3: the Bun version CI pins reads an empty trust list as no list.

**The lockfile rule: `bun.lock` is rewritten only with the Bun version CI pins.** That version is `CI_BUN_VERSION` in `.github/workflows/main.yml` (1.3.14 when this was written).

- Why: a newer Bun can write a lockfile the pinned Bun refuses. Measured on 2026-11-20 with Bun 1.3.14 and Bun 1.4.4, in scratch projects (the design note, section 2.3): Bun 1.4.4 writes `"lockfileVersion": 2` and Bun 1.3.14 writes `1`, and `bun install --frozen-lockfile` on 1.3.14 refuses a lock written by 1.4.4 ("lockfile had changes, but lockfile is frozen"). This repo's `bun.lock` is version 1, and both versions install it frozen. Not measured: whether the pinned Bun accepts a version-1 lock that a newer Bun has edited in place. The rule is the safe side either way.
- So a change that adds, removes or bumps a dependency runs its `bun install` with the pinned Bun. A lock rewritten by a newer Bun fails CI at the install step, on a change that may have touched no code.
- **`bun install --frozen-lockfile` is safe on any Bun version**: it fails instead of rewriting the lock.

`verify:install-fresh` (below) reads lockfile version 1 only and fails on any other, naming the version.

## `validate`, stage by stage

`npm run validate` is the fast inner-loop check and is not a substitute for `local:gate` (`AGENTS.md`). Its stages, in the order `package.json` runs them. Each stops the chain when it fails.

| # | Script | What it checks | A failure means |
| --- | --- | --- | --- |
| 1 | `verify:install-fresh` | `node_modules` matches `bun.lock`: every package the lock requires on this host is installed at its locked version. It walks the lock's dependency graph from the root, so a platform build for another host is not required | The install is stale, or a package is missing: the tests that follow would say nothing about the lockfile. Run `bun install --frozen-lockfile`. It cannot fire in CI, which installs from scratch |
| 2 | `verify:action-pins` | Every `uses:` in every job of every workflow is pinned to a commit SHA with an exact `# vX.Y.Z` comment | A workflow runs an action by a movable tag, or a repository-local `./…` action, or there is no workflow file to read |
| 3 | `verify:skills` | Every `.claude/skills/*/SKILL.md` parses the way Claude Code parses it and declares its invocation mode; every model-invoked skill has committed eval cases, positives and negatives; the skill listing is inside its character budget; and no script that `validate`, `local:gate` or CI reaches starts `skills:eval` | A skill would load with empty metadata and never fire by itself again, or lacks its cases, or the listing would be truncated, or a gate could spend metered model calls |
| 4 | `format:check` | `prettier --check` over `**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}` | A file is not formatted. Run `npm run format` |
| 5 | `verify:format-coverage` | Every tracked file with one of those eight extensions is matched by a `prettier --check` glob that `validate` actually reaches through plain `&&` chains, and Prettier, asked with `.gitignore` and `.prettierignore`, neither ignores it nor lacks a parser for it. This repo allows no exclusion. It reads the script's text: a `prettier --check` that also carries a flag making Prettier print help or its version and exit is still taken as a check | The format check stopped covering a file: a narrowed glob, a new ignore entry, a format chain that masks its exit status, a custom `--ignore-path`, or a target that is not a plain glob. Stage 4 would have skipped the file without saying so |
| 6 | `lint` | `eslint . --max-warnings 0` over the TypeScript files and the lint config itself. The lint config ignores `scripts/**` | A lint finding, at any severity (`AGENTS.md`, "Lint has no warning tier") |
| 7 | `typecheck` | `tsc --noEmit -p tsconfig.json`, then `scripts/verify-typecheck-coverage.mjs`: every tracked TypeScript file is in the program `tsc` lists, or named with a reason in the guard's `EXCLUDED` (empty) | A type error; or a tracked TypeScript file that no program holds, which `tsc --noEmit` passes without checking. The `include` does not enter a directory whose name starts with a dot |
| 8 | `test` | See the next section | See the next section |

## `test:scripts` and `test`

`npm run test` is four steps in one `&&` chain:

1. **`npm run test:scripts`**: the `node --test` suites, each named by path in `package.json`. `node --test` exits 0 on a glob that matches nothing, so the list is explicit. In groups:
   - **the guards' own tests**: one suite per guard under `scripts/` (the pin guard, the skills guard and its command-line validator, the sign-off check, the smoke's own logic, the manual eval runner's stubbed test, and the install-fresh, format-coverage, typecheck-coverage and coverage-scope guards) and one per shared helper under `scripts/lib/`;
   - **the workflow scan** (`scripts/lib/workflow-gate.test.mjs`): the table of cases, then the scan of this repo's real workflows described above;
   - **the test-list completeness test** (in `scripts/verify-skills.main.test.mjs`): fails when a tracked test-named file under `scripts/` is missing from `test:scripts`. It reads tracked files, so a test file not yet added to git is invisible to it;
   - **the two attack suites** (`scripts/inventory-attack.test.mjs`, `scripts/coverage-attack.test.mjs`): adversarial cases for the TypeScript inventory, the typecheck-coverage guard and the coverage-scope guard, each in throwaway directories;
   - **the monthly sweep's suites**: `scripts/dependency-refresh.test.mjs` (the script, driven through a fake `spawnSync`, so no `npm` or `gh` is started), the tests of its two helpers under `scripts/lib/` (`sweep-author`, `paced-writes`), and `scripts/dependency-refresh-attack.test.mjs`, the review model's eight adversarial cases for it. Two of those cases read this checkout's `AGENTS.md` and the sweep's workflow file, so an edit to either can fail them;
   - **the daily sweep's suites**: `scripts/dependabot-alerts.test.mjs` (the pure helpers, and the script driven through a fake `spawnSync` in a throwaway directory that holds a `bun.lock`, so no `gh` is started and no test waits out the one-second pause), `scripts/lib/markdown-cell.test.mjs` (the table-cell escape), `scripts/lib/lock-advisories.test.mjs` (the lock file check: its queries, every check on an answer, the control pairs), `scripts/dependabot-alerts-attack.test.mjs`, the review model's eight adversarial cases for the alert path, and `scripts/dependabot-alerts-lock-attack.test.mjs`, its five for the lock file check. One of the eight is not met, and one variant of one of the five is not met as written. Each is marked `todo`: it runs and is reported on every run without failing the suite, with the proposed amendment beside it;
   - **the entry-points harness** (`scripts/entry-points.test.mjs`): runs each guard that has a command line, and both sweeps, through a symlinked path to this checkout and requires the script's own end-of-run line with the matching exit status, so a script that exits 0 having checked nothing fails.
2. **`node scripts/verify-coverage-scope.mjs --prepare`**: removes `coverage/coverage-summary.json`, so the check in step 4 cannot read a summary left by an earlier run. It fails if the path is a directory or cannot be removed.
3. **`vitest run --coverage`**: the tests named in `test.include` in `vitest.config.ts`, with V8 coverage over `src/**/*.ts` minus the test files, and a per-file bar of 90 on lines, statements, functions and branches. A failure is a failing test or a file under the bar.
4. **`node scripts/verify-coverage-scope.mjs`**: reads the new summary and fails, by name, on a file the coverage `include` declares that the report does not hold, and on a tracked TypeScript file that is outside the declaration and not named with a reason in the guard's `EXCLUDED` or `EXCLUDED_PATTERNS`. A failure means the per-file bar judged fewer files than it should have. A missing, empty or unreadable summary is a failure too.

What `test:scripts` does not do: it does not measure coverage of the guards. The guards under `scripts/` are tested by their own suites and are not in the coverage gate.

## The stages after `validate`

| Script | Runs in | What it checks | A failure means |
| --- | --- | --- | --- |
| `local:dco` | local only | `node scripts/dco-check.mjs --base origin/main`: every commit in `origin/main..HEAD` carries a `Signed-off-by:` line matching its author or committer. Merge commits and bot-authored commits are exempt | A commit about to be pushed is not signed off; the `DCO` check on the pull request would fail on it |
| `verify:skills:cli` | CI and local | `claude plugin validate`, the authoritative skill schema, at the exact pinned CLI version: an installed CLI only when it matches the pin exactly, otherwise the pinned package fetched with `npx -y`. It needs no authentication; it can need the network | A skill the reimplemented parse in `verify:skills` accepted is rejected by the real validator |
| `smoke` | CI and local | `scripts/smoke-inspector.mjs`: the pinned MCP Inspector command line, fetched with `npx`, drives `bun src/index.ts` over stdio against a fake Mycelia API on 127.0.0.1. Every request is judged by the Inspector's exit code. The legacy protocol era gates; the modern era runs and is reported without failing the run | The real server and a real client no longer fit together: a tool missing from the case table or the listing, a wrong route, a refusal that is not a refusal. The unit tests spy on the client and cannot see this. How to read a red smoke is the `client-smoke` skill |

CI's job has a 10-minute `timeout-minutes`, stated in `main.yml` as a hung-job guard with its reasoning.

## Not in any gate

**`skills:eval`** (`scripts/skill-eval.mjs`) runs the skills' committed trigger cases against a real model. It spends metered model calls, its result is a hit rate and not a verdict, and the owner approved that spending as standing on 2026-11-22 (`AGENTS.md`, "Maintaining the skills"), but it is still metered, so it is run by hand, never from `validate`, `local:gate` or CI. `verify:skills` fails if a script any of those reach names it (`AGENTS.md`, "Maintaining the skills", rule 3).

**The three `pr-flow` helpers** are run by an agent at a step of that skill, not by a gate. Their tests are in `test:scripts`.

- **`gate:run`** (`scripts/gate-run.mjs`) runs `local:gate` and ends with `gate passed on <sha>` only when the tree was clean before, the gate exited 0, the tree was clean after and the head was the same commit both times. A git probe that fails is a `NO PASS`, never a clean answer, and the gate is not run when the first probes cannot be read. It does not see a tracked file changed and put back while the gate ran, and it writes no record.
- **`handoff:check`** (`scripts/handoff-check.mjs`) reads, against one head of a pull request, the workflow runs, their jobs, the combined commit status, whether the pull request changes a workflow, and the mergeability, and ends with `head unchanged: <sha>` only when every read came back whole and the head did not move. It reads and does not judge: it does not say the runs are green.
- **`audit:verdict`** (`scripts/audit-verdict.mjs`) reads a review round's final message as `pass`, `fail` or `no verdict` by a closed rule (its header), and exits 0 only for `pass`.

## What the Inspector's page has that this one does not

Recorded so their absence is not read as an omission. The verdicts are in the design note, section 2.

- **A machine-wide gate lease.** The Inspector's exists because two of its gates collide on fixed smoke ports. This repo's smoke binds an ephemeral port.
- **Browser-engine tiers, Storybook, a build gate and a bundle-externals guard.** There is no browser client, no build step and no bundle here.
- **A dependency-lockstep guard.** It compares one install's lockfile with another's; this repo has one install.
- **An install-scripts guard.** Not brought in yet, for the reason under "Installs and the lockfile".
- **A separate `coverage` stage.** Coverage is measured inside `validate` here, in `test`.
