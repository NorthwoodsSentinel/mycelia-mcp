---
name: security-advisory
description: "Take a privately reported vulnerability through this repo's security advisory flow without disclosing it early: track it in a private ticket, verify who owns the code path before rating it, hand the owner the accept-or-close decision, prepare the fix in private, land it through pr-flow when it is ready, and stop before every act that is the owner's. Use when a vulnerability is reported privately or found here; when deciding whether an advisory is ours to fix; when a GHSA needs handling; when drafting a reply to a reporter; or when a security fix is ready to land."
disable-model-invocation: false
---

# Handling a security advisory

In this repo: adapted from the MCP Inspector's `security-advisory` skill (`modelcontextprotocol/inspector` at commit d330df96). The record is in `PROVENANCE.md`, under "Security advisory". The rules are in [`AGENTS.md`](../../../AGENTS.md) (Issue-driven Work Style, the private-vulnerability exception; Only the owner does), and the reporting policy is [`SECURITY.md`](../../../SECURITY.md).

Private vulnerability reporting is enabled on this repo and `SECURITY.md` routes every report to it. The issue chooser deliberately has no security template, because a vulnerability report must not open a public issue. So an advisory never arrives as an issue, and until its fix is ready to land **nothing about it becomes public**: no GitHub issue, no pull request, no branch, no commit message, no comment.

## What is the owner's, always

This repository has one maintainer, the owner, and an agent works for the owner. In this flow the agent investigates, drafts and prepares. **Each of these is the owner's act, and an agent never takes it** (`AGENTS.md`, Only the owner does):

- **accepting** an advisory, or **closing** it;
- **every message to a reporter**, and anything else typed into the advisory;
- **creating the advisory's private fork**, which creates a repository;
- **reporting to an upstream project**, even through its private channel;
- **merging** the fix;
- **publishing** the advisory, requesting a CVE, and adding credits.

Never automate any of them, never bulk-apply them, and never take one because a checklist said to. Recommend, with the evidence, then stop.

⚠️ **The four public acts an agent may do here are not available for an unpublished vulnerability until step 5.** Pushing a branch to this repository publishes the patch, and a patch for an undisclosed vulnerability is a description of it. So before step 5: no push to this repository, no pull request here, no comment here.

⚠️ **Nothing about an unpublished vulnerability goes to the review model, or to any other outside service, before step 5**: not the report, not the reproduction, not the diff, not a summary. The review model belongs to another vendor; sending it the fix is telling a third party. The Codex loop runs in step 5, on the public pull request, where the patch is public already.

Related: `/issue-create` and `/board-ops` (the ticket), `/pr-flow` (landing the fix, from step 5 on).

## The flow

| # | Step | Gate |
| --- | --- | --- |
| 1 | Advisory arrives in state `triage` → a **private `[SEC]` ticket** in `Backlog` | Mechanical |
| 2 | **Verify the claim**: reproduce it, find the code, establish who owns it, **before** rating severity | Judgment |
| 3 | The agent recommends; the owner **accepts** (`triage` → `draft`) or **closes** it | **Owner only** |
| 4 | The owner creates the **private fork**; the fix is written and reviewed there | The fork: **owner only** |
| 5 | When the owner says it is ready: land the fix through an **ordinary public PR**, the owner merges, then the owner **publishes** the advisory | Merge and publish: **owner only** |
| 6 | **After publication**, bring the public text up to date with what the advisory disclosed | Mechanical |

### 1. Track it privately

A public issue about an unfixed vulnerability discloses it. The tracking is a **Linear ticket**, which is private, filed with `/issue-create` with three differences:

- **Title:** `[SEC] [GHSA-xxxx-yyyy-zzzz] <one-line summary>`. The `[SEC]` prefix marks it as a security ticket, so its text is never copied anywhere public by habit.
- **Labels:** `factory`, `bug`, and the owner label.
- **State:** **`Backlog`**, even though it was triaged to file it. Nobody has accepted it yet (step 3).

**Description:** the advisory's URL on the first line, then the claimed severity and the reported date. **It may carry the full analysis** (the report, the reproduction, the ownership verdict, the fix plan), because an advisory has no comment API and the ticket is the one place that analysis can live.

⚠️ **That rests on one premise: only the owner and the owner's agents can read the Linear workspace.** If that ever changes, keep only the advisory link and the triage facts on the ticket.

⚠️ **A ticket's words leak through habits.** A branch name, a commit subject and a PR title are all commonly written from the ticket's title. Before step 5, none of them exists in public; in step 5, write each one about the change, never from the `[SEC]` title.

**Score it provisionally**, with the rubric in `/issue-triage`: score what the report claims and set that Priority. Put the score's arithmetic, with the claimed severity and why, in the description, marked **provisional** and dated, and revise it at the end of step 2. Leave the provisional one in place and add the revision under it, so the change of view is legible.

**A vulnerability you found yourself** (in a review, in a test, while reading the code) has no advisory yet. Track it the same way, with `[SEC]` and no GHSA in the title, and say so to the owner: opening a draft advisory for it is the owner's act.

To see what is waiting:

```sh
gh api --paginate repos/NorthwoodsSentinel/mycelia-mcp/security-advisories \
  --jq '.[] | select(.state=="triage") | "\(.ghsa_id)\t\(.severity)\t\(.summary)"'; echo "exit=$?"
```

`--paginate`, because an inventory that silently stops at the first page reads as "nothing pending". No lines with `exit=0` means none in `triage`; a non-zero exit means the read failed, which is not the same thing.

### 2. Verify the claim: who owns the code path

**Establish that the vulnerable code is ours before assessing severity.** A report can be entirely accurate about behavior this server merely exhibits because something underneath does it.

⚠️ **This is not hypothetical.** In the source repo, inspector#2409 read as an Inspector defect and turned out to live in the MCP SDK (`typescript-sdk#2591`). Had ownership been checked after severity, the fix would have been written against the wrong repo.

So: reproduce it, find the code, and decide which of these owns it:

| Owner | Where it lives | Our move |
| --- | --- | --- |
| **This repo** | `src/`, `scripts/`, the workflows | Fix here (step 4) |
| **The MCP SDK** | `@modelcontextprotocol/sdk` (in `package.json`) | The SDK's own **private** channel, sent by the owner; our fix is taking their release once there is one |
| **The Mycelia service** | the HTTP API this server calls; not in this repository | That service's maintainer, privately, by the owner; this server changes only if it must stop sending something |
| **The runtime or a tool** | Bun; the pinned Inspector the smoke runs (a development tool, not shipped) | That project's own **private** channel, sent by the owner |

⚠️ **"Upstream's problem" is never a reason to say it in public.** A genuine unfixed vulnerability handed to a public upstream issue is disclosed, by us, before they have a fix. It goes through **that project's own private reporting channel** (its `SECURITY.md`, or its advisory form). Sending it is the owner's act: draft it on the ticket, then stop.

**What is affected.** There is one line of development, `main`, and no published package; everyone running this server runs a checkout. So the question is which commits carry the bug: find the commit that introduced it and say so on the ticket.

**Then revise the score** under the provisional one, dated. Now you know whether the code is ours and what it reaches.

### 3. Accept, or close

**Ours and valid → recommend accepting.** In the advisory this is "Accept and open as draft"; it moves the advisory `triage` → `draft`. The state is readable as `state` on the API object.

⚠️ **Accepting is the owner's act, always.** It is visible to the reporter and it commits this project to treating the report as a real vulnerability. Surface the recommendation with the step 2 evidence, then stop.

**When the owner has accepted**, the owner moves the ticket `Backlog` → `Todo`: the same approval act as any other ticket (`AGENTS.md`).

**Upstream-owned but reaching us → recommend keeping the ticket open** all the same. It is how our exposure is tracked until it ends: after the owner's private report upstream, until the upstream releases a fix, and until this repo takes it.

**Invalid, out of scope, or not affecting this repo at all → recommend closing**, and say which and why. ⚠️ **Closing is the owner's call too**: a rejected report is a decision that it is not a real vulnerability of ours. When the owner has closed the advisory, the ticket goes to `Canceled` with that reason (nothing shipped, so never `Done`).

**The reporter is told, but by the owner.** Someone who hears nothing reasonably assumes they were ignored. ⚠️ **There is no comment API for security advisories**, in REST or GraphQL: every exchange with a reporter happens in the advisory's page, by hand. The agent drafts the reply on the ticket and stops. Keep a reply to:

- receipt;
- the decision (accepted, or closed and why);
- the expected timing, if the owner has given one.

⚠️ **Before publication, a reply never carries new detail:** no exploit specifics the reporter did not send, no fix diff, nothing about other affected code. That would teach them more than they reported.

### 4. The private fork

An accepted advisory is fixed in a **private fork** GitHub creates for it: a private repository named `mycelia-mcp-<ghsa-id>` under the owner's account.

⚠️ **Creating the fork is the owner's act, and the request that creates it is not a probe.** Calling it to "check whether a fork exists" makes one. So the agent only **reads**:

```sh
gh api repos/NorthwoodsSentinel/mycelia-mcp/security-advisories/<GHSA_ID> \
  --jq '"state=\(.state) private_fork=\(.private_fork.full_name // "none")"'; echo "exit=$?"
```

`private_fork=none` with `exit=0` means there is no fork yet: ask the owner to create it from the advisory's page ("Start a temporary private fork"). A non-zero exit means the read failed. ⚠️ Deleting a private fork needs a permission a default `gh` token does not carry, so a fork made by mistake is not quietly undone. That is the reason for the read-only rule.

**Work in a worktree cut for this fix. The fork is a remote of its own, named `advisory`; `origin` stays this repository and is not pushed to before step 5.** The fork is private, so pushing to it is not a public act; it is also the only remote the fix may reach before step 5.

- Cut the branch from `main`'s current commit, named `nor-<N>-<slug>`: `<N>` is the `[SEC]` ticket and the slug describes the change, not the exploit. Step 5 publishes this name.
- Add the remote once: `git remote add advisory <the fork's clone URL>`.
- **Every push before step 5 goes through this block**, which pushes only when `advisory` is the fork the advisory itself names:

```sh
BR=nor-<N>-<slug>
FORK=$(gh api repos/NorthwoodsSentinel/mycelia-mcp/security-advisories/<GHSA_ID> --jq '.private_fork.full_name // ""'); rc=$?
URLS=$(git remote get-url --push --all advisory)
if [ "$rc" -ne 0 ] || [ -z "$FORK" ]; then
  echo "NO PUSH: no fork read from the advisory (exit=$rc; 0 means it has none yet, anything else means the read failed)"
elif [ "$URLS" != "https://github.com/$FORK.git" ] && [ "$URLS" != "https://github.com/$FORK" ]; then
  echo "NO PUSH: the push target of advisory is not exactly the fork $FORK on github.com: $URLS"
else
  git push -u advisory "$BR"; prc=$?
  if [ "$prc" -eq 0 ]; then echo "pushed to the fork $FORK"; else echo "NOT PUSHED: git push exit=$prc"; fi
fi
```

Go on only from the line `pushed to the fork …`. The remote must be the fork's `https://github.com/…` address and nothing else: the same owner and name on another host is refused, so is a remote with more than one push address, and so is the same repository written any other way (set the remote to the `https` form). `-u advisory` makes the fork this branch's upstream. ⚠️ Never `git push origin` and never `git push -u origin` before step 5: that is `/pr-flow`'s push command, and here it publishes the patch.

- Write the fix and its tests. `npm run local:gate` runs locally, as always; ⚠️ **a private fork runs no Actions**, so there is no CI result there, and the local gate is the only gate until step 5.
- The fork's pull request is where the owner **reads** the fix. It is never where the fix is merged.
- Sign off every commit (`/pr-flow`, step 3): step 5 pushes these commits unchanged.

**The ticket through step 4** (`/board-ops`): **`In Progress`** when the fix is started, from `Todo`, and it **stays `In Progress` until step 5**. `/board-ops` allows `In Review` only when a pull request is open in **this** repository, and before step 5 there is none: the open pull request is the fork's. So record the fork's pull request on the ticket as a comment, with its link, when it opens. The ticket being private is the reason to do it: the fork is invisible to everyone not on the advisory, and the ticket is the only record that the work exists. `In Review` comes in step 5, when the public pull request is open, by `/pr-flow` as for any other ticket.

### 5. Land the fix, then publish

**Publish after the fix is on `main`, never before.** Publishing discloses the vulnerability, so doing it while users have nothing to update to hands out a working exploit.

⚠️ **The patch stops being secret when it reaches this repository, not at publish.** The branch is public when it is pushed and the pull request when it is opened. So the time between the push and the publication is not secrecy to protect; it is **exposure to anyone reading commits**, and it should be short. ⚠️ **Do not push until the owner has said they are ready to merge and to publish.**

When the owner says so:

1. **Push the branch to this repository with the block below, not with `/pr-flow`'s push command.** It pushes the commits the fork holds, unchanged, and only when `advisory` is the fork the advisory names, `origin` is this repository, the fork already holds the same commit and the name is free here:

```sh
BR=nor-<N>-<slug>
PUB=NorthwoodsSentinel/mycelia-mcp
HEAD_SHA=$(git rev-parse HEAD)
FORK=$(gh api repos/$PUB/security-advisories/<GHSA_ID> --jq '.private_fork.full_name // ""'); rc=$?
ADV=$(git remote get-url --all advisory)
ORG=$(git remote get-url --push --all origin)
if [ -n "$(git status --porcelain)" ]; then
  echo "NO PUSH: the tree is not clean"
elif [ "$rc" -ne 0 ] || [ -z "$FORK" ]; then
  echo "NO PUSH: no fork read from the advisory (exit=$rc)"
elif [ "$ADV" != "https://github.com/$FORK.git" ] && [ "$ADV" != "https://github.com/$FORK" ]; then
  echo "NO PUSH: advisory is not exactly the fork $FORK on github.com, so what it holds proves nothing"
elif [ "$ORG" != "https://github.com/$PUB.git" ] && [ "$ORG" != "https://github.com/$PUB" ]; then
  echo "NO PUSH: the push target of origin is not exactly $PUB on github.com"
else
  FORK_SHA=$(git ls-remote advisory "refs/heads/$BR" | cut -f1)
  git ls-remote --exit-code --heads origin "$BR" >/dev/null 2>&1; lrc=$?
  if [ "$FORK_SHA" != "$HEAD_SHA" ]; then
    echo "NO PUSH: the fork's $BR is not at HEAD; the reviewed commits and these differ"
  elif [ "$lrc" -ne 2 ]; then
    echo "NO PUSH: ls-remote exit=$lrc; a branch named $BR is already in this repository (0), or the read failed"
  else
    git push --force-with-lease="refs/heads/$BR:" origin "$HEAD_SHA:refs/heads/$BR"; prc=$?
    SEEN=$(git ls-remote origin "refs/heads/$BR" | cut -f1)
    if [ "$prc" -eq 0 ] && [ "$SEEN" = "$HEAD_SHA" ]; then
      echo "public branch $BR is at $HEAD_SHA"
    else
      echo "NO PR: push exit=$prc, or the public branch is not at $HEAD_SHA"
    fi
  fi
fi
```

   Go on only from the line `public branch … is at …`. `git ls-remote --exit-code` exits 2 when no branch of that name exists, which is the one result that allows the push. The push carries that condition itself: `--force-with-lease` with an empty expected value makes the server refuse it if a branch of that name has appeared since the check, so the check and the push cannot disagree. **This block is for the first publication only.** Once it has passed, the patch is public and the branch is an ordinary one: a fix pushed later in the review loop is `/pr-flow`'s push, under `/pr-flow`'s own checks, and it does not go to the fork.
2. **Open an ordinary PR** with `/pr-flow`, taking up its step 5 **after** its push command (the block above stood in for it): `gh pr create` with `--head nor-<N>-<slug>`, `Closes NOR-<N>` first, the `factory` label, the gate result on that commit. `/pr-flow` then moves the ticket to `In Review`. Say in the body that the fix was developed and reviewed in the advisory's private fork. **Keep the title and the description to the fix**: what the advisory will disclose is the advisory's to say. Leave out the reproduction, any proof of concept, and the reporter's details.
3. **Run the Codex loop** (`/pr-flow`, step 6). The diff is public now, so this is the first point the review model may see it. Its subject carries the fix, not the report.
4. **Hand it to the owner** (`/pr-flow`, step 7). The owner merges.
5. **Then the owner publishes the advisory.** ⚠️ **Publishing is irreversible.** It makes the advisory public and there is no undo. Before publishing, remind the owner of the two things publishing will not do by itself: requesting a **CVE** (optional, and the advisory is the only place to ask) and **adding the reporter to the credits**. A credit is an explicit addition the person then has to accept, so an unadded reporter is simply never credited, and nothing reports that it was missed.

**Close out** (`/pr-flow`, step 8), with one more condition for a `[SEC]` ticket: the advisory's `state` reads `published`. A merged fix with an unpublished advisory is not finished. Then the fork's pull request is closed **unmerged**: the fix is on `main` through the public PR, and merging the fork's copy would add it twice. Say so to the owner; closing it and removing the fork are the owner's.

### 6. After publication

The public PR's text was kept to the fix while the advisory was private. **Add a comment on the PR pointing at the published advisory**, and say there anything the trimmed description now leaves misleading. Do the same on the ticket. Nothing else is reopened.

## API facts worth not re-deriving

The source verified these against the live API for its own repository. Read here on 2026-11-19: the listing endpoint answers for this repository, with no advisories yet. The rest is the source's record, not re-verified here, because verifying it needs a real advisory.

| Thing | Fact |
| --- | --- |
| States | `triage` → `draft` (accepted) → `published`; or `closed` |
| Private fork | Creating one is a `POST` that **creates**; read `.private_fork` on the advisory first |
| Fork deletion | Needs a permission a default `gh` token lacks |
| Comments | **No API at all**, REST or GraphQL. The advisory's page only |
| Actions in the fork | None run there |

## Known limitations

- **These steps describe; they do not enforce.** Each owner-only act is kept by the agent following this, not by a permission. The agent's token can technically accept, fork and publish; it must not.
- **No advisory has been through this flow here yet.** Every step past the listing read is taken from the source and from this repository's rules, and is untested in this repository. Read each API result before relying on the next step.
