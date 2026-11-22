# mycelia-mcp: the AI software factory

This document is the overview of how work gets done in this repository: the rules, the procedures and the gate that let a coding agent take an approved ticket to a reviewed pull request, which the owner then merges. It is written for someone who was not part of building it. It explains and does not rule: the rules live in [`AGENTS.md`](../AGENTS.md) and the procedures in [`.claude/skills/`](../.claude/skills), and where this page and those disagree, they win.

The model was adapted from the [MCP Inspector](https://github.com/modelcontextprotocol/inspector)'s, by way of the method the [MCP reference servers](https://github.com/modelcontextprotocol/servers) used to adopt it. This page takes its section order from the servers' document of the same name (`modelcontextprotocol/servers`, commit `ec089ce1`). What was taken, adapted or left behind, file by file and with the source commit, is [`PROVENANCE.md`](../PROVENANCE.md). The adoption was tracked in Linear under NOR-535.

Every count of what is in this repository, its history or its GitHub settings was taken on 2026-11-22 at `main` `007915d`, and the command that produced it is printed with it. A number that only restates a rule or counts items listed on this page (the four public acts, the three scripts of the PR flow) has no command, because the list is beside it. The ones that use `gh` read this repository on GitHub; the rest can be re-run in a checkout. A count that could not be taken is not here. Values that are configuration and not counts, such as the coverage bar, are stated from the files that set them. Ticket states were read in Linear on the same day and cannot be re-read from a checkout.

## What is not built yet

This table lists every part of the source's factory that is not working on `main`. It is meant to be complete: every step marked partial or missing in the step table below appears here. Each part is described as what it is today, not as what it is meant to become. A part with no ticket of its own says so.

| Part | State on 2026-11-22 | Ticket |
| --- | --- | --- |
| The triage procedure (`issue-triage`) and its priority rubric | Not on `main`. Pull request 15 is open; one review point, that a score comment is recognized by its marker alone, is carried there as a known limitation. Until it lands, `AGENTS.md` says no rubric exists and an agent sets no Priority. | NOR-672; the known limitation is recorded on NOR-688 |
| The CodeQL workflow | Not on `main`. Pull request 16 is open. | NOR-683 |
| The monthly dependency sweep | Not on `main`. Pull request 17 is open. | NOR-684; a known weakness in its release lookup is NOR-689 |
| The daily Dependabot-alert sweep | Not started. | NOR-685 |
| Timeouts for those three workflows | They will be provisional until the first scheduled runs can be measured. | NOR-686 |
| The labels the two sweeps file under (`chore`, `dependabot`) | Neither exists in this repository. Creating a label is the owner's act, and a sweep cannot file until both exist. | None of its own; recorded on NOR-673 |
| The upstream watch (an issue per upstream release this repository is behind) | Not built, and no design exists for this repository. | None of its own; it waits on a design decision tracked as NOR-674 |
| A model's analysis of an upstream release, run in CI | Not built. No model runs in CI here. | None of its own; the same decision, NOR-674 |
| A skills eval on `main` | No whole-suite run has been made on `main`. One was made on an open pull request's branch (pull request 14). The eval spends metered model calls, and no standing approval for that spend exists here: each run is the owner's to approve. | NOR-614 for that pull request; none for a standing approval |
| A skills eval on a non-Claude agent | The Copilot runner is ported and has never been run, so whether the skills fire for another vendor's agent is unmeasured. | None of its own |
| The gate and the sign-off check as required checks | Both workflows run on every pull request: `validate` in `main.yml` and `DCO` in `dco.yml`. Neither is a required check, because the repository has no ruleset (`gh api repos/NorthwoodsSentinel/mycelia-mcp/rulesets --jq length` gives `0`). So GitHub would let a pull request merge with either one red or missing; what prevents that today is the owner reading the hand-off before merging. A ruleset is the owner's setting. | None of its own |

One thing in the step table is a recorded departure and not a gap: the `CLAUDE.md` pointer stays. The step table says why.

## The adoption, step by step

The adoption was planned as numbered steps in six waves. The plan is kept outside this repository. This table is the state of each step on `main` on 2026-11-22. Steps S3 and S4 do not appear in the plan's wave list, so they have no row.

| Step | What it was | State here | Evidence |
| --- | --- | --- | --- |
| S1 | `AGENTS.md`; the owner names the process label; a fresh-session test, then the `CLAUDE.md` pointer is deleted | Done, with one recorded departure | `AGENTS.md` arrived in pull request 3 (`38242b3`, NOR-381). The label is `factory`, named by the owner on 2026-11-16. `CLAUDE.md` is still present, one line: `@./AGENTS.md`. The fresh-session test was run on 2026-11-16 on one of the two machines the agents work from, with another repository's checkout: a session loaded `AGENTS.md` without a pointer in one parent folder and did not in another. The cause was not proven, and the second machine was not tested. So the pointer stays, which departs from the source's step. |
| S2 | The skills harness: `verify:skills:cli`, `skills:eval` on Claude and on a non-Claude agent, `docs/skill-authoring.md` | Partial | Pull request 5 (`02fc02c`, NOR-559). Both scripts and the guide are present. No eval has run on `main`, and none on a non-Claude agent anywhere. |
| S5 | `issue-create` and `board-ops` for Linear | Done | Pull request 6 (`681d79d`, NOR-602). |
| S6 | `pr-flow` | Done | Pull request 8 (`4c121d3`, NOR-604). Three of its steps became tested scripts in pull request 12 (`007915d`, NOR-610). |
| S7 | `issue-triage` | Missing | No `.claude/skills/issue-triage/` on `main`. NOR-672. |
| S8 | The contribution model: issues, not pull requests | Done | Pull request 7 (`76e6379`, NOR-605): `CONTRIBUTING.md`, the two issue forms and `SECURITY.md`. |
| S9 | `security-advisory` | Done | Pull request 9 (`ccbab72`, NOR-611). |
| S10 | The CI and pre-push gate guards, `docs/quality-gate.md`, the `pre-push-gate` skill | Done | Pull request 11 (`7c53bba`, NOR-615). The source's gate lease was judged not applicable; the reason is in `docs/DESIGN-nor-615-gates.md`. |
| S11 | `project-structure`, `local-dev`, `testing` | Done | Pull request 10 (`bc3f1b1`, NOR-613). |
| S12 | A release as a credential-free build with a receipt | Not applicable | The plan scopes it to a repository that deploys. This one has no build step and no release procedure; see "Releases" below. |
| S13 | The scheduled workflows; the hardened upstream watch job; this page | Partial | No scheduled workflow is on `main` (`ls .github/workflows` prints `dco.yml` and `main.yml`). The pieces are NOR-683, NOR-684 and NOR-685. The watch job has no ticket here. This page is NOR-690. |

How the table was produced. A step's pull request and merge commit: `gh pr list -R NorthwoodsSentinel/mycelia-mcp --state merged --base main --limit 500 --json number,body,mergeCommit | jq -r '.[] | "\(.number) \(.mergeCommit.oid[0:7]) \((.body // "") | split("\n")[0])"'`, read for the step's ticket number. Pull request 3 refers to its ticket with `Refs NOR-381` and predates the closing-line rule. Whether a file exists: `ls` on the path in a checkout of `main` `007915d`.

## The headline change

- **Outside contributors file issues, never pull requests.** The owner handles design and implementation through a prompt-driven workflow, so someone who has built a change shares the prompt and not a diff. The policy is [`CONTRIBUTING.md`](../CONTRIBUTING.md). An issue from outside is a report; when the owner takes it up it gets a Linear ticket of its own.
- **The process is written down precisely enough for an agent to run.** It is not a tool beside the repository. It is the repository's own process, `AGENTS.md` plus the skills, loaded by Claude Code, versioned and tested like code.
- **Nothing happens without a ticket.** Every pull request closes a Linear issue in team `NOR`. The one exception to "every item of work is an ordinary issue" is a vulnerability, which is tracked privately until its fix is ready.
- **A gate strict enough to trust.** `npm run local:gate` runs every check CI runs before anything is pushed.
- **The owner merges.** The repository is public, so an agent opens a pull request and never merges one.

## Results

| What | Count | Command |
| --- | --- | --- |
| Pull requests merged into `main`, 2026-10-31 to 2026-11-21 | 12 | `gh pr list -R NorthwoodsSentinel/mycelia-mcp --state merged --base main --limit 500 --json number \| jq length` |
| Of those, with `Closes NOR-<n>` as the first line of the body | 10 | `gh pr list -R NorthwoodsSentinel/mycelia-mcp --state merged --base main --limit 500 --json body \| jq '[.[] \| select((.body // "") \| split("\n")[0] \| test("^Closes NOR-[0-9]+"))] \| length'` |
| Commits on `main`, merges excluded | 49 | `git rev-list --no-merges --count origin/main` |
| Of those, carrying a `Co-Authored-By` trailer | 34 | `git log --no-merges --format='%H %(trailers:key=Co-Authored-By,valueonly,separator=%x2C)' origin/main \| awk 'NF>1' \| wc -l` |
| Of those, carrying a `Signed-off-by` trailer | 43 | `git log --no-merges --format='%H %(trailers:key=Signed-off-by,valueonly,separator=%x2C)' origin/main \| awk 'NF>1' \| wc -l` |
| CI runs on `main`, by workflow and result | `CI success: 11`, `DCO success: 11` | `gh run list -R NorthwoodsSentinel/mycelia-mcp --branch main --limit 100 --json workflowName,conclusion --jq 'group_by(.workflowName+" "+.conclusion) \| map("\(.[0].workflowName) \(.[0].conclusion): \(length)") \| .[]'` |

The date range in the first row is the earliest and the latest `mergedAt` in that listing (`gh pr list -R NorthwoodsSentinel/mycelia-mcp --state merged --base main --limit 500 --json mergedAt | jq -r '[.[].mergedAt] | min, max'`).

Two limits on reading these. The two merged pull requests without the closing line are pull requests 1 and 3, both from before the rule was in the repository; this page does not examine them further. And the repository's history starts before the process did, so the trailer counts cover commits the process never governed.

## One server, one transport, one process

mycelia-mcp is a small MCP server, written in TypeScript and run on Bun, that wraps the Mycelia mutual-aid HTTP API. It serves eight tools over stdio (`grep -c "name: \"mycelia_" src/index.ts` gives `8`) from two source files, `src/index.ts` and `src/mycelia-client.ts` (`ls src/*.ts | grep -v -F .test. | wc -l` gives `2`). It has no UI and no build step.

That shape is what the adaptation was about. The Inspector is several clients over a shared core, and the servers repository is seven servers in two languages. Here the questions were smaller and different: how a tracker that is Linear replaces a GitHub project board, how the server is exercised without a real Mycelia API, and what an agent may do in public when the owner merges everything.

## Two layers of documentation: rules and procedures

| Layer | Where | Holds | Loaded |
| --- | --- | --- | --- |
| **Rules** | [`AGENTS.md`](../AGENTS.md) | The conventions a reviewer cites against a diff: branches, dependencies, testing, the gate, what only the owner does | In full, at the start of every session |
| **Procedures** | [`.claude/skills/*/SKILL.md`](../.claude/skills) (nine, by `ls .claude/skills \| wc -l`) | Multi-step recipes with live commands: filing a ticket, board moves, the PR flow | On demand, when a description matches or by `/<name>` |

The split exists because the two fail differently. A skill loads conditionally and can drop out of a long session's context, so a rule that must never silently disappear lives in `AGENTS.md`. A recipe that can be re-read from disk whenever it is needed lives in a skill.

| Skill | Covers |
| --- | --- |
| `project-structure` | The two source files and which side code goes on, what a new tool touches, where a new file goes |
| `local-dev` | Installing and running the server, the environment it needs, dependencies |
| `testing` | Where a test goes and which runner picks it up, the coverage gate |
| `client-smoke` | Driving the server with the pinned Inspector CLI by hand, against a local fake of the Mycelia API |
| `issue-create` | Filing a Linear issue: the duplicate check, the labels, the state, the read-back |
| `board-ops` | Linear state moves and their preconditions, closing as duplicate or canceled, labels |
| `pr-flow` | A ticket to an open, reviewed pull request, the hand-off to the owner, the close-out |
| `pre-push-gate` | Running the gate and reading a failed stage |
| `security-advisory` | A privately reported vulnerability, and every act in it that is the owner's alone |

All nine declare `disable-model-invocation: false`, so the model may fire any of them, and all nine carry committed eval cases (`ls .claude/skills/*/evals/evals.json | wc -l` gives `9`).

Whether a skill fires when it should is meant to be measured, not assumed. `npm run skills:eval` runs the committed cases against real agent sessions and scores the hit rate. It spends model calls, so it is run by hand and never from the gate or CI, and each run is the owner's to approve. `verify:skills`, which is in the gate, parses every skill's frontmatter the way Claude Code does and keeps the listing inside its budget. [`skill-authoring.md`](./skill-authoring.md) is how a description gets tuned.

On `main` that measurement has not been made: `PROVENANCE.md` records the `pre-push-gate` cases as "Trigger rates are unmeasured". One whole-suite run exists, on the branch of open pull request 14 and with the owner's approval; its figures are in that pull request and describe that branch, not `main`.

## Issue-driven work, end to end

There is one tracker, Linear team `NOR`, and one long-lived branch, `main`. There is no release branch.

A ticket's life:

1. **Filed and labeled.** Three labels in the one call that creates it: `factory` (the work is tracked by this process), exactly one type (`bug`, `enhancement`, `documentation`, `chore`, `question`), and exactly one owner label, `agent:<name>`. The owner label matters because every write through the tracker's connector acts as one account, so the assignee cannot say which agent carries the work.
2. **In Backlog.** Filed is not approved.
3. **Approved.** Moving a ticket to `Todo` is the approval. The owner does it for new work. An agent may do it for a follow-up it filed inside work the owner already approved, and says which.
4. **Worked.** The ticket moves to `In Progress` from `Todo` only, and a branch `nor-<N>-<slug>` is cut from `origin/main` into a new git worktree.
5. **Sent for review.** The gate passes on a clean, committed tree, every commit is signed off, and a pull request opens against `main` with `Closes NOR-<N>` as the first line of its body. The ticket moves to `In Review`.
6. **Reviewed.** A review loop runs with every finding answered on the pull request. It stops on the first clean round, on a round holding only findings declined as out of scope, or after two rounds in a row that end without an audit (a timeout or no verdict).
7. **Handed to the owner, who merges.** The agent reports, read against one head commit, what the owner is merging, and gives the merge as one command that refuses a head that moved.
8. **Closed by hand, after the merge.** `Done` means the work shipped, and two things earn it: the ticket's pull request is merged with its merge commit on `origin/main`, or the ticket is a parent whose last sub-issue closed. A duplicate or a won't-fix shipped nothing, so it goes to `Duplicate` or `Canceled`, never `Done`.

Between filing and approval the source has triage: a pass that labels and scores every new ticket so the owner reviews an ordered queue. That is not on `main` here. Until it is, a ticket's Priority is the owner's to set or stays unset.

A GitHub issue from outside is not yet a ticket. No issue has been opened on this repository (`gh issue list -R NorthwoodsSentinel/mycelia-mcp --state all --limit 100 --json number --jq length` gives `0`), so that path is written down and has not been used.

### How a working session starts

Nothing in the repository starts a session. The owner, or an agent he has asked to direct the work, names a ticket that is in `Todo`. Each session works in its own git worktree, because several sessions share the primary checkout and a branch switch there would move the branch out from under the others.

## The PR flow and its reviewer

The steps are the `pr-flow` skill's: branch in a new worktree, sign off every commit, run `npm run format`, commit, run the gate, open the pull request, run the review loop, hand off to the owner, close out after the merge.

Three of those steps compute their own result, each with a script under test:

- `npm run gate:run` prints `gate passed on <commit>` only when the tree was clean before and after, the gate exited 0, and the commit did not move.
- `npm run audit:verdict` reads a review round's final message and prints `pass`, `fail` or `no verdict`.
- `npm run handoff:check` reads the pull request's runs, statuses and mergeability against one head and prints `head unchanged` only when every read came back whole.

None of the three is enforced: nothing stops an agent that skips a script. CI and the owner's merge are the controls.

The difference from the source that matters most is the reviewer. The Inspector's is Copilot. Here it is a model from a different vendor than the author's, because two reviewers from the same vendor share blind spots. A round is one read-only run against the pull request's exact head commit, in a clean detached worktree made at that commit, with a fixed brief the author may not steer. The wrapper that runs it is the owner's tooling and is not in this repository.

Four public acts are an agent's, and only these four: pushing a branch, opening a pull request from it, commenting on that pull request, and sending the change's diff to the review model, after checking that it carries nothing private. Everything else public is the owner's.

## The quality gate

`npm run local:gate` is the mandatory pre-push command, and its exit code is the verdict. It is `validate` (the install guard, the action-pin guard, the skills guard, the format check and a guard on what it covers, lint, the typecheck and a guard on what it covers, the guards' own tests, and the Vitest tests with per-file coverage and a coverage-scope guard), then the local sign-off check, the pinned skills validator, and a smoke of the server through the pinned Inspector over stdio against a fake Mycelia API on 127.0.0.1. CI runs every stage except the local sign-off check; the pull request's commits are checked by the `DCO` workflow. Among its rules:

- **Per-file coverage of at least 90** on lines, statements, functions and branches, over every file in `src/`. A branch that cannot be reached is annotated at the source with its reason; the gate is never lowered.
- **No test may retry**, so a flaky test cannot pass on a second attempt.
- **Lint has no warning tier.** A warning fails the gate exactly as an error does.
- **Every action in every workflow job is pinned to a commit SHA**, with the release it came from in a comment. The source requires this only in credentialed jobs. Here it is every job.
- **`npm run validate` is the fast inner check and is not a substitute** for the gate.

The smoke gates on one protocol era, 2025-11-25. It also tries the 2026-07-28 era and reports the result without failing on it.

[`quality-gate.md`](./quality-gate.md) is the stage-by-stage reference.

## Releases

There is no release procedure in this repository. The server is run from a clone: `bun src/index.ts`, with no build step. No GitHub release exists (`gh release list -R NorthwoodsSentinel/mycelia-mcp --limit 5 | wc -l` gives `0`). `AGENTS.md` lists "publishing the package, or any release" among the owner's acts; nothing here automates one. No repository Actions secret is configured (`gh secret list -R NorthwoodsSentinel/mycelia-mcp --json name --jq length` gives `0`), so the only credential a workflow holds is the `GITHUB_TOKEN` GitHub issues to every run, and both workflows scope it to `contents: read` (`grep -A1 "^permissions:" .github/workflows/*.yml`).

## Scheduled automation: none on `main`

In the source, three scheduled sweeps file issues in place of Dependabot's pull requests: a monthly one for version updates, a daily one for security alerts, and a watch for upstream releases. `AGENTS.md` here carries those rules, marked "[No sweeps yet in this repo]", and that is still true: the only workflows on `main` are `main.yml` (the gate) and `dco.yml` (the sign-off check), and neither has a schedule (`grep -c cron .github/workflows/*.yml` gives `0` for each).

What exists today is the setting the rules depend on, read from GitHub on 2026-11-22:

- Dependabot alerts are on (`gh api repos/NorthwoodsSentinel/mycelia-mcp/vulnerability-alerts -i` answers `204`).
- Dependabot security-update pull requests are off (`gh api repos/NorthwoodsSentinel/mycelia-mcp/automated-security-fixes` gives `"enabled":false`).
- There is no `.github/dependabot.yml`, so no version-update pull requests are configured.

So Dependabot opens no pull requests here, as the rule says, and nothing yet files the issues that are meant to replace them. An alert is visible only to someone who looks at the repository's security tab. The pieces that close that gap are listed under "What is not built yet".

The sweeps planned for this repository file GitHub issues, as the source's do, and not Linear tickets. A sweep that filed in Linear would need a tracker credential in a public repository's secrets.

### No model runs in CI

In the source, the upstream watch has a second half: a model reads the upstream release notes and writes an analysis comment. Nothing of that kind exists here, and no design for it exists for this repository. `AGENTS.md` carries the source's rules for such a job, and they bind the day one is added.

## Security reports: a separate, human-gated track

A vulnerability is never reported in a public issue or pull request. [`SECURITY.md`](../SECURITY.md) routes a report to GitHub's private advisory form, and the issue chooser offers no security template on purpose.

Inside the process it is tracked as a private `[SEC]` Linear ticket, never a GitHub issue. Until the fix is ready to land, nothing about it is pushed, opened or commented in this repository, and nothing about it is sent to the review model or any other outside service. The `security-advisory` skill covers the ticket, establishing whose code the fault is in, the owner's accept or close, the private fork, landing the fix through `pr-flow`, and the owner's publish. **Accepting, closing and publishing an advisory, every message to a reporter, creating the advisory's private fork and any report to an upstream are the owner's acts.** An agent recommends and drafts.

## What makes it work

1. **Every piece of work is a ticket with a recorded approval.** `Todo` means the owner signed off, and an agent starts only there.
2. **The gate predicts CI**, because it runs every stage CI runs. The source also rules that a check added to one is added to the other in the same change; this repository's rules do not state that, so it is not claimed here.
3. **Rules and procedures are built for their own failure modes.** Rules stay resident and survive a compacted context. Procedures are meant to stay reachable through descriptions whose firing is measured; on `main` that measurement has not been made.
4. **Automation that could bypass review files issues instead.** That is the design. None of that automation is on `main` yet.
5. **Everything public stays with the owner, with four named exceptions.** The list below is `AGENTS.md`'s, and it is a list, not a principle.
6. **The reviewer is not the author's kind.** A model from another vendor reads the exact commit.

The source's sixth point is that the one model running in CI treats its input as hostile and is limited by capability. No model runs in CI here, so that point is not claimed.

## What stays with the owner

The list is `AGENTS.md`'s, "Only the owner does", gathered here for a reader:

- Picking new work: a new direction or a new repository effort.
- Merging a pull request in this public repository.
- Publishing the package, or any release.
- Spending.
- Secrets, including any real Mycelia agent key.
- Repository settings, including rulesets.
- Anything public or sent to other people, except the four acts named under "The PR flow and its reviewer".

## Where this is headed

Not written. The direction is the owner's to state, and this section is left for his words.

What can be said without a promise is what exists and what does not. The process is started by a person or a directing agent, one ticket per session, and ends at the owner's merge. The parts listed in "What is not built yet" are the distance between this repository and the source it was adapted from, as far as the adoption plan measures it.

## Where the record is

- [`PROVENANCE.md`](../PROVENANCE.md): what came from which commit of the source repositories, and each verdict.
- The `DESIGN-*.md` files beside this one: the design and review rounds of each piece that needed one.
- Linear, team `NOR`: NOR-535 is the adoption's parent ticket, and each piece is a child of it or of one of its children.
