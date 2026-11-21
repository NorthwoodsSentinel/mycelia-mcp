# DESIGN: NOR-610: pr-flow's gate and hand-off blocks as tested scripts

Status: design, for review by the review model before any code is written.
Ticket: NOR-610 (a follow-up of NOR-604, inside NOR-535). It records three findings from the last audit of the `pr-flow` skill, all in command blocks written as prose, and names the remedy: tested helper scripts in place of the blocks.
Source: `modelcontextprotocol/inspector`, branch `v2/main`, commit `d330df9617e44ec893bc1a53618662239342d433` (the commit `PROVENANCE.md` already records). Read for this design: `scripts/lib/gh.mjs` and `scripts/lib/gh.test.mjs` in full; the file list of `scripts/`; the header of `scripts/gate-lease.mjs`; the script references in its `.claude/skills/pr-flow/SKILL.md`.
Target: a branch cut at `7c53bba` (`origin/main`).

Words used below. **Measured**: run or counted for this design on 2026-11-21 (UTC) on macOS arm64, Node 26.12.1, Bun 1.4.4, `gh` 2.91.0. **Read**: read in the named file. **UNKNOWN**: not established; each one says what would establish it.

## 1. Goal and the evidence that it is done

The two command blocks in `pr-flow` (step 4, the gate; step 7, the hand-off) become scripts with tests, and the audit verdict of step 6a gets one defined reading. Each script fails closed on the defect its finding names: a probe that fails is never read as a clean answer.

Done when:

- Each of the three findings on NOR-610 has a negative test that reproduces it against the new script, and the test passes.
- `pr-flow` steps 4, 6a and 7 name the scripts; the two prose blocks are gone; the skill's "Known limitations" no longer says that no helper script exists.
- `npm run local:gate` exits 0, and CI is green on the pull request.
- The pull request body carries one targeted probe per script: the script made to fail on a planted defect, and its clean run (`AGENTS.md`, evidence for gate tooling).
- The review model's audit is clean on the exact commit.

## 2. The pieces

### 2.1 `scripts/lib/gh.mjs`, copied from the source

The source keeps its `gh` calls in one small library whose header says why: its scripts "replace command blocks that the skills previously transcribed inline" (Read). Every function takes its spawn function as a parameter, so tests start no `gh` process.

Copied by copy then edit, with its test. Kept: `gh` (throws only on a spawn failure), `ghJson` (throws on a non-zero exit, with stderr in the message), `ghPaginatedList` (`gh api --paginate --slurp`, every page must be an array), `requirePositiveInt`, `GH_MAX_BUFFER`. Edits: `OWNER`, `REPO` and `REPO_SLUG` name this repo; `COPILOT_REVIEWER_LOGIN` and `ghGraphql` are removed (nothing here uses them); one function is added, `ghPaginatedObject(spawn, path, key)`, for the two endpoints below that answer with an object per page.

`ghPaginatedObject` returns the items only when every page is an object, every page carries an integer `total_count` and an array under `key`, all pages report the same `total_count`, and the number of items collected equals it. Anything else throws. Measured: `gh` 2.91.0 has `--slurp`. UNKNOWN: the `gh` version on the CI runner; it does not matter, because CI runs only the tests, which inject the spawn function.

### 2.2 `scripts/gate-run.mjs` (`npm run gate:run`): finding 1

It takes no arguments. Any argument is a usage error (exit 2), so there is no flag that swaps the gate for another command.

1. Tree probe: `git status --porcelain=v1 --untracked-files=all --ignore-submodules=none`. The probe **failed** when git could not be started, was killed by a signal or exited non-zero. The tree is clean only when the probe did not fail and printed nothing. The explicit flags stop a user's git configuration from hiding untracked files or submodule changes.
2. Head probe: `git rev-parse --verify HEAD^{commit}`. It failed on the same three conditions, or when its output, trimmed, is not exactly 40 lowercase hex characters.
3. If either probe failed or the tree is not clean: no gate is run.
4. Gate: `npm run local:gate`, output inherited, exit code read directly. Passed only when npm started, was not killed by a signal and exited 0.
5. Both probes again. The head must equal the head of step 2.
6. The last line on stdout is `gate passed on <40-hex sha>` with exit 0, or `NO PASS: <reason>` with exit 1. The reason names the first condition that failed, and says "could not be read" for a failed probe, which is a different reason from "not clean" or "moved".

The exported function takes its git runner and its gate runner as parameters. The command line cannot set them.

### 2.3 `scripts/handoff-check.mjs` (`npm run handoff:check -- <PR>`): finding 2

One argument: the pull request number (`requirePositiveInt`). The repository is the constant in `lib/gh.mjs`. Reads, in order, each through `lib/gh.mjs`:

1. Head: `gh pr view <PR> -R <repo> --json headRefOid`. Must be 40 lowercase hex characters.
2. Workflow runs on that head: `ghPaginatedObject` on `repos/<repo>/actions/runs?head_sha=<sha>&per_page=100`, key `workflow_runs`. Every run must carry an integer `id`, strings `path`, `event` and `status`, a `conclusion` that is a string or null, and a `head_sha` equal to the head.
3. Jobs of every run: `ghPaginatedObject` on `repos/<repo>/actions/runs/<id>/jobs?per_page=100`, key `jobs`. Every job must carry strings `name` and `status` and a `conclusion` that is a string or null.
4. Commit statuses: `ghPaginatedList` on `repos/<repo>/commits/<sha>/statuses?per_page=100`. Every entry must carry strings `context` and `state`. Those whose context is exactly `validate` or `DCO` are printed as statuses named like a required job.
5. Workflows changed: `git fetch origin` must exit 0; `git cat-file -e <sha>^{commit}` must exit 0; then `git diff --quiet origin/main...<sha> -- .github/workflows/`. Exit 0 prints `workflows unchanged by this PR`. Exit 1 prints `THIS PR CHANGES THE WORKFLOWS`. Any other result is a failed read. The block it replaces printed one line for "changed" and "could not compare"; these are now two outcomes.
6. Mergeability: `gh pr view <PR> -R <repo> --json mergeable,mergeStateStatus`. Both must be non-empty strings.
7. Head again, as in 1. It must equal the first.

Evidence lines are printed as they are read, in the block's present format (`run=<id> <path> <event> <status> <conclusion>`, `run=<id> job=<name> <status> <conclusion>`). A count line follows: runs, jobs, and statuses named like a required job.

The last line on stdout is `head unchanged: <sha>` with exit 0 only when every read above succeeded whole and the two heads are equal. Otherwise it is `NO HAND-OFF: <the read that failed>` with exit 1. A thrown error from `lib/gh.mjs` is caught at the top and printed as that line. A bad argument exits 2.

### 2.4 `scripts/audit-verdict.mjs` (`npm run audit:verdict -- <final message file>`): finding 3

The ticket's own smallest change was "the verdict is the last line of the final message, exactly one of the two strings". Measured against three real final messages from this wrapper before designing: one ends with `**AUDIT: fail**`; one **begins** with `AUDIT: fail` followed by a dash and a sentence, and ends in prose; one ends with a bare `AUDIT: pass`. A last-line, exact-string rule reads two of those three as no verdict. So the rule is fitted to what is written:

- A **verdict line** is a line outside any fenced code block, indented by at most three spaces, that begins with `AUDIT: pass` or `AUDIT: fail` after at most one emphasis opener (`**`, `__`, `*` or `_`, with no space after it), where the next character is not a letter, a digit, `_`, `-`, `|` or `/`. So `AUDIT: passed`, `AUDIT: pass|fail`, `AUDIT: unknown`, a bullet (`- AUDIT: pass`, `* AUDIT: pass`), a block quote, a backticked quotation and a verdict mentioned in the middle of a sentence are not verdict lines.
- No verdict line: **no verdict**. One or more, all the same: that verdict. Both kinds present: **no verdict**.
- A file that is missing, unreadable, empty or only whitespace: **no verdict**.

It prints `audit verdict: pass`, `audit verdict: fail` or `audit verdict: no verdict`, and exits 0, 1 or 2 in that order, so exit 0 means pass and nothing else.

### 2.5 The skill, the wiring and the records

- `pr-flow` step 4: the block is replaced by `npm run gate:run`. Step 7: the block is replaced by `npm run handoff:check -- <PR>`. Step 6a: the outcome table keeps its four outcomes; "verdict line" is defined by `npm run audit:verdict`, and anything it calls no verdict is the **no verdict** outcome. The two rules the script cannot apply stay as prose: the wrapper's exit code and timeout come first, and a pass that lists a finding is a fail.
- "Known limitations": the first item is replaced by what the scripts do and do not enforce (section 4).
- `package.json`: the three scripts, and the four new test files in `test:scripts`. `scripts/entry-points.test.mjs` gains a case for each new entry script.
- `PROVENANCE.md`: a row for `scripts/lib/gh.mjs` and its test; the `pr-flow` row's list of edits.

## 3. Tests: what each script must fail on

All with `node --test`, every external command injected.

- **`lib/gh.mjs`**: the source's tests for the kept functions. For `ghPaginatedObject`: a page that is not an object; a page with no `total_count`; pages that disagree on `total_count`; fewer items than `total_count`; more items than `total_count`; a non-zero exit; a spawn failure; a clean two-page read.
- **`gate-run`** (finding 1): the first tree probe exits 128 with empty output (the case the block read as clean); the same on the second tree probe; git cannot be started; a probe killed by a signal; `rev-parse` exits non-zero with empty output on the first read, and on the second (the case the block read as "equal"); `rev-parse` prints a short or non-hex string; tree not clean before, so the gate runner is never called; gate exits non-zero; gate killed by a signal; npm cannot be started; tree dirtied during; head moved during; an argument given; the clean pass. One process-level test in a temporary repository with real git and a stub gate, for the pass and for a head that moves.
- **`handoff-check`** (finding 2): each of the seven reads failing alone with a non-zero exit, and no `head unchanged` line in any of them; the runs listing reporting more than it returned; a run whose `head_sha` is another commit; a job without a `status`; the fetch failing; the head commit absent from the clone; the diff exiting 2; the head moved between the first and last read; a head that is not 40 hex characters; a bad argument; zero runs on the head (a successful read, reported as zero); the workflows-changed case (reported, and the line still printed); the clean read.
- **`audit-verdict`** (finding 3): the three measured shapes; `AUDIT: unknown`; a quoted pass beside a real fail; two agreeing lines; both kinds; a verdict only inside a fenced block; a bullet; a block quote; `AUDIT: pass|fail`; `AUDIT: passed`; an empty file; a missing file.

## 4. Threat model, accepted limitations, settled decisions

- **Threat model:** an honest agent that reports a pass the evidence does not support, because a read failed or came back incomplete and the failure looked like a clean answer. The three findings on NOR-610 are the cases. The actor is not an attacker.
- **Accepted limitations:**
  - **Nothing here stops an agent that types a pass line by hand**, runs the gate another way, or pushes without it. The scripts make the honest path correct; CI and the owner's merge are the controls on the rest. The skill said "these steps describe; they do not enforce"; after this change the steps compute their own pass lines, and still enforce nothing on an agent that skips them.
  - **`handoff-check` reads; it does not judge.** Its last line says the evidence was read whole against one head that did not move. It does not say the runs are green, that the two required workflows ran, or that the pull request is mergeable. Zero runs on a head is a successful read. The judgement stays where step 7 puts it: reported item by item to the owner, who merges. Encoding "green" is a separate decision with its own cases (re-runs, the push-only job that may be skipped) and is not one of the three findings.
  - **`gate-run` records its result on stdout only.** No file is written, so nothing later can check that a given commit was gated. The pull request body carries the line.
  - `gate-run` trusts the environment it is started in. A `GIT_DIR` or `GIT_WORK_TREE` set in the shell, or a start directory that is not the checkout, makes git answer about another tree. Inside the threat model this is a mistake the agent would have to make before the script starts, and the block it replaces had the same property.
  - `git status` does not report ignored files. A gate that passes because of an ignored, uncommitted file is not seen. The block had the same property.
  - `audit-verdict` reads one file. It does not know the wrapper's exit code, whether the run timed out, or whether the file belongs to this round, and it cannot tell a pass that lists findings from one that does not. Those four readings stay in step 6a as prose.
  - `audit-verdict` takes `AUDIT: pass or fail` at the start of a line as a pass line. A reviewer explaining the format in those words, with no real verdict, would be read as pass. Not seen in the three measured messages.
  - The owner's `codex-review` wrapper computes its own verdict field differently (the last line containing `AUDIT:` anywhere). That wrapper is not in this repository; this script is the reading this skill defines, and the two can disagree on an odd message. When they do, the skill's reading is the stricter one.
  - A 40-character rule assumes SHA-1 object names, which is what GitHub serves.
  - Measured on macOS arm64 with Node 26 only. The first CI run is the first evidence on Linux and Node 22.x. Windows is not tested: `npm` is started without a shell.
- **Settled decisions:** the source's shape wherever it has one (`lib/gh.mjs`, injected spawn functions, `isMainModule`, `node --test`). No new dependency. The pass lines keep their present wording (`gate passed on`, `head unchanged:`), so the skill's rules that quote them stand. Three scripts where the ticket said two: the third exists because the measured messages showed the ticket's one-line rule for finding 3 was wrong for two of three.

## 5. Order of work

1. `lib/gh.mjs` and its test, copied and edited; `PROVENANCE.md`.
2. `audit-verdict`, `gate-run`, `handoff-check`, each with its test.
3. `package.json`, `entry-points.test.mjs`.
4. The skill's three steps and its limitations.
5. `npm run format`, commit, `npm run gate:run` (the first real use of the script), the pull request with its probes, the audit on the exact commit.

## 6. Outside this scope (one mention each)

- A script that judges the hand-off evidence as green or not.
- A recorded gate result that a later step can verify.
- The same blocks in the private sibling repository's skill.

## 7. Review log

- Design review r1: (not yet run)
