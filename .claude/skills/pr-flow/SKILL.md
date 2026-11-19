---
name: pr-flow
description: "Take a NOR ticket through to an open, reviewed PR in this repo, hand it to the owner to merge, and close it out afterwards. Use when asked to create, open or submit a PR for a ticket; when a DCO or sign-off check fails; when running the Codex review loop after opening a PR or answering its findings; when naming a branch or setting up its worktree; or when a PR is ready for the owner or has merged and needs closing out."
disable-model-invocation: false
---

# PR flow

In this repo: adapted from the MCP Inspector's `pr-flow` skill (`modelcontextprotocol/inspector` at commit d330df96). The record is in `PROVENANCE.md`, under "PR flow".

The rules this procedure follows are in [`AGENTS.md`](../../../AGENTS.md): **Issue-driven Work Style**, **Contributing**, and the **Mandatory pre-push gate**. The board mechanics are in `/board-ops`, and filing a ticket is `/issue-create`.

**The owner picks the work and merges it. An agent carries a ticket to an open, reviewed PR, and closes out after the merge.** An agent starts only on a ticket in `Todo`, and never merges a pull request here (`AGENTS.md`, Contributing; Only the owner does).

**Four public acts in this procedure are the agent's, and only these four**, by the named exception in `AGENTS.md`, Only the owner does: pushing a branch (step 5), opening a pull request from it (step 5), commenting on that pull request (steps 6 and 7), and sending the change's diff to the review model (step 6). Everything else public stays the owner's. A step here that seems to need another public act (creating a label, replying to someone outside, changing a setting) is a hand-off to the owner, not a step.

## 1. Start from a ticket

**Every PR references a ticket, with no exceptions.** If there is none yet, file one with `/issue-create` before you branch. Never open the PR and backfill the ticket.

**Read the ticket: its description _and every comment_.** The comments are where the owner narrows the ask, rules out an approach or records a decision the description was never updated to show.

```
get_issue      id: "NOR-<N>"
list_comments  issueId: "NOR-<N>"     # read to the end: hasNextPage
```

When a comment contradicts the description, follow it **only if the owner wrote it or endorsed it**. When the scope is still unclear after reading everything, ask before starting.

**Then move it to `In Progress`, and cut the worktree in step 2 straight after.** `/board-ops` does the move. It is allowed only from `Todo`, assigns the ticket in the same call, and reads both back. ⚠️ **The move and the worktree are one start.** `/board-ops` checks the state and the assignee only; it cannot see a worktree. A ticket `In Progress` with no worktree, or with a branch cut in the primary checkout, is a start that broke `AGENTS.md` (When work begins). Do not stop between this step and the next.

## 2. Branch, in a new worktree

**The branch is `nor-<N>-<slug>`**, for example `nor-604-pr-flow`. Cut it from `origin/main`, the one long-lived branch (`AGENTS.md`, Project Status and Direction).

**Always cut it into a new git worktree, never by switching branches in the primary checkout.** Several agent sessions share the primary checkout. A `git switch` there moves the branch out from under every other session and carries one task's uncommitted edits into another's.

Run it from the primary checkout. The worktree is a **sibling** directory, never one inside the repo, where every lint, format and typecheck scope would see a second copy of the source:

```sh
git fetch origin
git worktree add --no-track ../mycelia-mcp-<N> -b nor-<N>-<slug> origin/main
cd ../mycelia-mcp-<N>
bun install --frozen-lockfile
```

- `--no-track` keeps the branch from tracking `origin/main`, so the first push is an explicit `git push -u origin nor-<N>-<slug>`.
- ⚠️ **The install is part of the step.** A worktree starts with no `node_modules`, and the gate needs a real install.
- Every later step (edits, the gate, commits, the push) runs **inside the worktree**.

## 3. Sign off every commit

**The `DCO` check fails the PR on any unsigned commit**, with no partial credit (`.github/workflows/dco.yml`, job `DCO`). Every commit needs a `Signed-off-by:` trailer matching its author or committer. Merge and bot commits are exempt.

- **Prevent it:** `git commit -s`. ⚠️ `git config format.signOff true` does nothing for `git commit`.
- **Check before you push:** `npm run local:gate` runs it (`local:dco`, over `origin/main..HEAD`). To check alone: `npm run dco:check -- --base origin/main`.
- **Repair pushed commits** by rewriting them, when you are the branch's only author:

  ```sh
  git rebase --rebase-merges --signoff origin/main
  git push --force-with-lease
  ```

A sign-off certifies the commit in **your own name**. Never fabricate someone else's.

⚠️ **This repository is public, and a commit's author and committer are published with it.** Before the first commit in a worktree, read `git config user.name` and `git config user.email` there and confirm they are the identity this repository's commits carry. A rebase and an amend write the committer from that configuration too, so read `git log -1 --format='%an <%ae> | %cn <%ce>'` after either one, before pushing.

⚠️ `DCO` is not yet a _required_ check in this repo; that is a ruleset, and the owner's setting (`AGENTS.md`). Until it is, a PR showing `DCO` missing or "expected" is an outage, not a pass.

## 4. Run the gate

`npm run format`, **commit**, then `npm run local:gate`. `npm run validate` is **not** a substitute (`AGENTS.md`, Mandatory pre-push gate).

⚠️ **A gate result belongs to a commit only when the tree was clean.** The gate reads the working tree, not the commit: a repair left uncommitted passes the gate while the commit that gets pushed is still broken. So:

```sh
[ -z "$(git status --porcelain)" ] && GATED=$(git rev-parse HEAD) && npm run local:gate; echo "gate exit=$?"
[ -z "$(git status --porcelain)" ] && [ "$(git rev-parse HEAD)" = "$GATED" ] && echo "gate passed on $GATED"
```

No `gate passed on` line, no push. `$GATED` is the only commit the result covers; if anything is committed afterwards, run it again. The gate is judged by its exit code, read directly: a pipe into `tail` or `grep` reports the pipe's exit code and hides the gate's.

## 4a. Evidence, in place of screenshots

This repo has no UI, so the source's screenshot step is **evidence** (`AGENTS.md`, Issue-driven Work Style). The PR body carries it:

- **A change to server behavior** (a tool, a schema, the transport, an error) carries **client evidence**. For each client: what it was asked to do, what it returned, and **the commit SHA it ran against**.
  - ⚠️ **Evidence counts only for the head it names.** Produce it from a checkout at that SHA. If the PR's head moves after the evidence was taken, take it again on the new head, or say in the PR that it is for an earlier commit.
  - **Inspector:** `npm run smoke` (the pinned Inspector over stdio against the local fake of the Mycelia API). Add the by-hand runs from `/client-smoke` for any tool the change touches.
  - **Protocol eras:** in each era the server serves. Today that is 2025-11-25 only: the smoke also tries the 2026-07-28 era, reports the result and does not gate on it. Say which eras the evidence covers.
  - **LLM client:** the source asks for a transcript from an LLM client against the local server as well.
  - ⚠️ **An agent working inside an agent session cannot produce the LLM-client half itself**: that would be a second session started from inside the first. Say in the PR exactly what was and was not run; never imply more. The owner merges every PR here, so the owner either runs the client and adds the transcript, or accepts the PR without it.
- **A change with no client-observable surface** (docs, skills, workflows, gate tooling) carries a **targeted probe**: the thing that proves it, such as a guard made to fire, a before/after run, or the skill's own checks.

## 5. Open the PR

**The order is fixed, and `/board-ops` cannot check most of it:** `npm run format`; `npm run local:gate` exits 0 on the commit you are about to push; every commit is signed off; push **that same commit** (`git rev-parse HEAD` still equals the `$GATED` of step 4); open the PR; only then move the ticket to `In Review`. `/board-ops` checks that an open PR exists. It cannot see whether the gate ran. A ticket `In Review` on a head the gate never passed broke `AGENTS.md` (When work is complete).

Target **`main`**. The body's **first line is `Closes NOR-<N>`**, and the body carries the evidence from 4a. The PR gets the process label **`factory` at creation**, never backfilled (`AGENTS.md`).

```sh
git push -u origin nor-<N>-<slug>
gh pr create -R NorthwoodsSentinel/mycelia-mcp --base main --head nor-<N>-<slug> \
  --label factory --title "<title>" --body-file <file>
```

- Write the body to a file and pass `--body-file`, so nothing in it is read as a flag. It also replaces the pull request template, whose banner is for outside contributors.
- ⚠️ **A pushed branch and a PR body are public the moment they exist.** Nothing private goes in either: no host name, no home-directory path, no agent's name, no personal detail, no secret.
- `--label` fails when the label does not exist in the repository. Check with `gh label list -R NorthwoodsSentinel/mycelia-mcp` first. Creating a label is the owner's: ask, and do not open the PR without the label to get around it.

**Then move the ticket to `In Review`** with `/board-ops`, and read it back. Then go straight to step 6.

## 6. Run the Codex review loop: immediately, on every PR

**Opening the PR is not the end of the task.** The next action, without being asked, is a Codex review loop run to exhaustion (`AGENTS.md`). Codex is from a different model vendor than the author. Two reviewers from the same vendor share blind spots.

### 6a. Run a round on the exact head commit

A round is one read-only Codex run against **the PR's current head commit**, through the `codex-review` wrapper and its fixed audit brief (`AGENTS.md`). Fill in the brief's subject (repo, branch, head SHA, the ticket, what governs the change) and its threat model, accepted limitations and settled decisions, as the brief instructs.

⚠️ **A SHA written in the prompt is a claim; a checkout at that SHA is evidence.** A run in your working worktree can see later edits, untracked files or a branch that moved. So every round reads **a clean detached worktree made at the resolved head**. The worktree is named for the SHA, so a leftover from an earlier round can never stand in for this one:

```sh
HEAD_SHA=$(gh pr view <PR> -R NorthwoodsSentinel/mycelia-mcp --json headRefOid -q .headRefOid)
AUDIT=../mycelia-mcp-<N>-audit-${HEAD_SHA:0:12}
git fetch origin \
  && git worktree add --detach "$AUDIT" "$HEAD_SHA" \
  && [ "$(git -C "$AUDIT" rev-parse HEAD)" = "$HEAD_SHA" ] \
  && [ -z "$(git -C "$AUDIT" status --porcelain)" ] \
  && echo "audit tree ready: $AUDIT"
```

**No `audit tree ready` line, no round.** If the path already exists, `git worktree add` fails, and the round must not run against whatever is there. Remove the old tree first. Point the wrapper at `$AUDIT`.

⚠️ **The subject and the diff leave this machine for another vendor's model.** Nothing private goes in the subject either.

Background the run and wait for its notification. Do not re-check by hand (`AGENTS.md`, Waiting on long-running work). Remove the audit worktree when the round is answered (`git worktree remove "$AUDIT"`).

**Reading the result.** A round has exactly one of four outcomes:

| Outcome | How it is recognised |
|---|---|
| **pass** | the wrapper exits 0, the verdict line of **this run's** final message is `AUDIT: pass`, **and** that message lists no findings. A `pass` that lists any finding is treated as **fail**. |
| **fail** | the wrapper exits 0, and that verdict line is `AUDIT: fail` |
| **no verdict** | a non-zero exit other than a timeout, a missing or empty final message, or no `AUDIT:` line in it |
| **timeout** | the run outlived its budget and the wrapper stopped it |

Never take a verdict from an older output file, or from an `AUDIT:` string elsewhere in the log: the model can quote one from the repository. A finding is the reviewer's **report** until you have reproduced it. Reproduce it before you fix it or decline it.

### 6b. Answer the round

Codex posts no inline review threads here. **Post one PR comment per round** that lists every finding with what was done:
- fixed, with the commit;
- declined, with the reason;
- filed, with the ticket.

**Weigh every finding against the ticket the PR closes.** Fix defects in what this PR added. Decline pre-existing behavior, new capabilities and hardening the ticket did not ask for, each with a reason. A real problem worth doing becomes a ticket via `/issue-create`, not a bigger PR.

### 6c. Another round, or stop

| The round… | Next |
|---|---|
| was **pass** with no findings | **Stop.** One clean round is the end. No confirming round "just to be sure". |
| was **fail** with an in-scope finding you fixed and pushed | Run another round on the **new** head. |
| was **fail** holding only findings you declined as out of scope | **Stop.** Nothing changed; another round only re-argues scope. Say so in the PR comment: accepting the declined findings is the owner's decision at merge. |
| was **no verdict** or **timeout** | A round that ended without an audit. Find out why first (a budget too small, a hung process, a bad subject), then run once more. **Two such rounds in a row, of either kind:** stop and report it, because Codex is not producing audits (`AGENTS.md`: two rounds in a row that end without posting). One alone never ends the loop. |

**Two consecutive fail rounds** don't end the loop. Re-read the ticket's goal before the next repair round, and say so in the PR.

When the loop stops, post a PR comment saying which exit fired. ⚠️ **If a commit was pushed after the last audited one, say so in that comment**, with the audited SHA, the head SHA and what the later commits change.

## 7. Hand it to the owner

**An agent never merges a pull request in this repository** (`AGENTS.md`, Contributing; Only the owner does). The agent's last act before the merge is to say, with evidence, what the owner is merging.

**Resolve the head once, read everything against that one SHA, then confirm the head has not moved.** Checks read for one commit and a merge command written for another is a report about the wrong thing.

Check these on that head, and report each as read, not as assumed:

- **The checks are green on the head, from the real workflows:** `validate` and `DCO` are **check runs from the `github-actions` app**, `completed`, with conclusion `success`.
  - A missing, pending, neutral or failed one is reported as that. Only the push-only `DCO (main push)` job may be `skipped` on a PR.
  - ⚠️ Read **every page** (`--paginate`). A first page alone can miss a check run.
  - ⚠️ Read the check runs **with their app**. A commit **status** named `validate` or `DCO` on that SHA is not one of these check runs: report it, and do not count it as green.
  - ⚠️ **The app and the name do not prove the workflow.** A PR that changes `.github/workflows/` is checked by the definitions it changes, so a green `validate` or `DCO` on it says nothing about the workflows on `main`. Say whether the PR touches that folder. If it does, say so first in the hand-off, and say that its checks are not evidence until the owner has read the workflow diff.
- **The last Codex round**: its verdict, the SHA it audited, and which exit of 6c fired. Every declined finding, with its ticket.
- **GitHub reports `mergeable: MERGEABLE` and `mergeStateStatus: CLEAN`.** `MERGEABLE` alone only means no conflicts.
- **Anything the change needs that only the owner can do**: a repository setting, a label, a secret. Name each one and its current value, read from the API.
- **What evidence was and was not run** (step 4a).

```sh
R=NorthwoodsSentinel/mycelia-mcp
HEAD_SHA=$(gh pr view <PR> -R $R --json headRefOid -q .headRefOid)
gh api --paginate repos/$R/commits/$HEAD_SHA/check-runs \
  --jq '.check_runs[] | "\(.name) app=\(.app.slug) \(.status) \(.conclusion)"'
gh api --paginate repos/$R/commits/$HEAD_SHA/statuses \
  --jq '.[] | select(.context == "validate" or .context == "DCO") | .context'   # expect no output
git fetch origin && git diff --quiet origin/main...$HEAD_SHA -- .github/workflows/ \
  && echo "workflows unchanged by this PR" || echo "THIS PR CHANGES THE WORKFLOWS"
gh pr view <PR> -R $R --json mergeable,mergeStateStatus
[ "$(gh pr view <PR> -R $R --json headRefOid -q .headRefOid)" = "$HEAD_SHA" ] \
  && echo "head unchanged: $HEAD_SHA"
```

**No `head unchanged` line, no hand-off.** The head moved while you were reading: start this step again. The audited SHA of step 6 is compared with `$HEAD_SHA` too, and a difference is reported, not smoothed over.

Then give the owner the merge as **one command** that refuses a head that moved:

```sh
gh pr merge <PR> -R NorthwoodsSentinel/mycelia-mcp --merge --match-head-commit <that HEAD_SHA, written out in full>
```

The ticket stays `In Review` until the merge. Do not run that command yourself.

## 8. Close out, after the owner merges

Verify the merge from GitHub and from git, not from the message that says it happened:

```sh
gh pr view <PR> -R NorthwoodsSentinel/mycelia-mcp --json state,mergedAt,baseRefName,mergeCommit,body
git fetch origin && git merge-base --is-ancestor <mergeCommit> origin/main && echo "on main"
gh api --paginate repos/NorthwoodsSentinel/mycelia-mcp/commits/<mergeCommit>/check-runs \
  --jq '.check_runs[] | "\(.name) \(.status) \(.conclusion)"'
```

`state` is `MERGED`, `baseRefName` is `main`, the body's first line is `Closes NOR-<N>`, and the merge commit is on `origin/main`. Wait for `main`'s check runs on the merge commit and report them.

**Then move the ticket to `Done`** with `/board-ops`, whose `Done` check reads the same facts. Leave a closing comment on the ticket: the merge commit, the audited SHA, the checks, and anything accepted at merge. Anything that shipped nothing goes to `Canceled` or `Duplicate`, never `Done`.

**Then remove the worktree and its local branch**, from the primary checkout:

```sh
git worktree remove ../mycelia-mcp-<N>
git branch -D nor-<N>-<slug>
```

`git worktree remove` refuses a worktree with uncommitted or untracked changes. Read what is there before reaching for `--force`.

## Known limitations

- **These steps describe; they do not enforce.** The source backs its steps with helper scripts (inspector#2558). No equivalent exists in this repo.
- **No inline review threads.** Codex answers in one output per round, so the PR comment per round is the whole record. The source's per-thread replies have no counterpart here.
- **The `codex-review` wrapper is the owner's tooling and is not in this repository.** This skill names how a round is run and read; it cannot show the wrapper's own interface.
