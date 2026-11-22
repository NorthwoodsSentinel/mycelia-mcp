---
name: issue-create
description: "File a new Linear issue (ticket) for this repo end to end: the duplicate check, the factory, type and owner labels, the state, the parent, and a read-back. Use when asked to file, create, open or raise an issue or ticket; when a bug or task found mid-work needs tracking; or when checking whether an issue already exists before filing one."
disable-model-invocation: false
---

# Creating an issue

In this repo: adapted from the MCP Inspector's `issue-create` skill (`modelcontextprotocol/inspector` at commit d330df96; record: `PROVENANCE.md`, "Issue and board skills"). The Inspector files GitHub issues onto a GitHub project board; this repo tracks work in **Linear, team NOR**, through the Linear MCP tools (`list_issues`, `save_issue`, `get_issue`). The rules this recipe follows are in [`AGENTS.md`](../../../AGENTS.md), **Issue-driven Work Style**; this skill is the mechanics.

An issue **you** create is not "created" until every step below is done. A Linear issue is its own card: there is no separate board step, but the labels, the state and the parent are separate fields, and each one has to be set and then **read back**.

**The single exception is a vulnerability.** Never file one as an ordinary issue through this flow, under any label or title: a vulnerability starts from `/security-advisory`. That procedure files the private `[SEC]` ticket as its own first step, using this recipe's mechanics, and it governs what the ticket may say and where its words may go (`AGENTS.md`, Issue-driven Work Style). If you reached this skill with a vulnerability in hand, stop here and open that one.

| # | Step | Required |
|---|---|---|
| 0 | Duplicate check across **every** state | ✅ |
| 1 | **Process label** `factory` | ✅ every issue |
| 2 | **Type label**, exactly one of `bug` / `enhancement` / `documentation` / `chore` / `question` | ✅ |
| 3 | **Owner label**, `agent:<name>` of whoever will carry it | ✅ |
| 4 | **State**: `Backlog`, or `Todo` only under the rule below | ✅ |
| 5 | **Parent**, when it is part of a larger issue | when one applies |
| 6 | **Priority**: only when the owner gave one | owner's only |
| 7 | **Read-back** of all of the above, then the post-create re-check | ✅ |

Set everything in the **one** `save_issue` call that creates the issue, never by backfilling: an unlabeled issue drops out of every label-filtered query.

## 0. Check for a duplicate first

Search **all** states, not just open ones. A `Done`, `Canceled` or `Duplicate` issue is still a match: refiling it loses its history. When one matches, the call is whether to reopen it or file genuinely new work, and either way you have to have seen it.

```
list_issues  team: "Northwoods-Sentinel"  query: "<keywords>"  includeArchived: true
```

⚠️ **Read to the end.** The result pages: `hasNextPage: true` means you have not seen every match. Pass the returned `cursor` back until `hasNextPage` is false. A first page that shows no match is not "no duplicate".

## 1–3. Pick the labels

**Process.** `factory` on every issue and every PR, no exceptions (`AGENTS.md`; named by the owner 2026-11-16).

**Type.** Exactly one, independent of the others:

| Type | Use for | Not for |
|---|---|---|
| `bug` | Something is broken, wrong, or regressed against its intended behavior | A missing capability that was never built |
| `enhancement` | A new capability, or extending an existing one | A cleanup with no behavior change |
| `documentation` | Prose deliverables: READMEs, guides, `AGENTS.md` rules | Code that happens to need a doc update |
| `chore` | Maintenance with no user-facing change: deps, build/CI tooling, refactors | Anything a user would notice |
| `question` | An open question or discussion with no agreed deliverable yet | Work someone has already decided to do |

**Don't force the binary.** Pressing a docs task or a dependency pin into `enhancement` degrades it to "not a bug", and filtering by it stops telling you anything. (`Bug` is the team's label for `bug`. `Feature` and `Improvement` are retired: never apply them.)

**Owner.** One `agent:<name>` label for whoever carries it.

## 4. Pick the state

- **`Backlog`** is the default: filed, not approved.
- **`Todo`** is the owner's approval. Only the owner moves new work there. An agent may file into `Todo` only a follow-up it found **inside** a parent the owner already approved. Say which parent, and quote the owner's approval, in the description. Anything else goes to `Backlog`.
- **Never file straight into `In Progress`.** An agent starts work only on a ticket that is already in `Todo` (`AGENTS.md`). Starting it is a separate move, through `/board-ops`.

## 5–6. Parent and priority

- **Parent:** set `parentId` when the issue is a piece of a larger one. A sub-issue inherits nothing automatically, so give it its own labels.
- **Priority:** the priority rubric is in `/issue-triage`, and an agent never asserts one without it. At filing, pass `priority` only when the owner gave a value, and quote them; otherwise leave it unset, and the ticket is scored by that skill.

## Create it

```
save_issue
  team: "Northwoods-Sentinel"
  title: "<title>"
  description: "<the problem in its own words; for a follow-up, the parent and the owner's approval quoted>"
  labels: ["factory", "<type>", "agent:<name>"]
  state: "Backlog"            # or Todo, only per step 4
  parentId: "NOR-<n>"         # when one applies
  priority: <n>               # only when the owner gave one
```

`labels` on **create** sets the whole set, which is what you want here. On an **existing** issue it replaces the whole set; edit labels there with `/board-ops`.

## 7. Read it back, then re-check

1. `get_issue` on the new id. Confirm the state, the label set (exactly one type label, `factory`, one owner label, nothing else you did not intend), the parent, and the priority when one was given. **A mismatch is a failure: report it as one.** Never report the issue as filed until the read-back matches.
2. **Re-check for a duplicate.** Run step 0's search again. If an issue that matches yours was filed meanwhile, close the **later** of the two as a duplicate of the earlier with `/board-ops` ("Close as Duplicate").

## Known limitations (the same as the source's)

- **The duplicate check is not atomic.** Search-then-create can race between two agents, as the Inspector's `gh issue list --search` then `gh issue create` can. Linear gives the MCP no uniqueness constraint. The post-create re-check catches a race after the fact; telling the other agents before filing narrows the window. No enforcing helper exists in this repo.
- **Approval cannot be authenticated here.** This recipe takes the owner's word or an approved parent as the `Todo` precondition; it cannot prove who said the word or who moved the parent. Nothing in this repo reads that from Linear's history.
