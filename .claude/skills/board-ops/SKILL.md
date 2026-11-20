---
name: board-ops
description: "Move, close or relabel a NOR ticket in Linear: change its state (with the Todo, In Progress, In Review and Done checks), close it as Duplicate or Canceled, add or remove a label without stripping the rest, read its comments, page a list to the end. Use when moving a ticket to Todo, In Progress, In Review or Done; when closing one as a duplicate or canceling it; when adding or removing a label; or when reading a ticket's comments or a full listing."
disable-model-invocation: false
---

# Board operations

In this repo: adapted from the MCP Inspector's `board-ops` skill (`modelcontextprotocol/inspector` at commit d330df96; record: `PROVENANCE.md`, "Issue and board skills"). The Inspector's board is a GitHub project with field and option IDs; this repo's is **Linear, team NOR**, driven through the Linear MCP tools. The rules about *what* a ticket's state and labels should be are in [`AGENTS.md`](../../../AGENTS.md), **Issue-driven Work Style**; this skill is the mechanics.

Related: `/issue-create` (filing one).

**Every recipe ends by reading back what it changed** with `get_issue`, as the source's scripts print only after a verified re-read. A mismatch is a failure, reported as one; a successful tool response alone is not evidence.

## States

| State | Type | Means |
|---|---|---|
| `Backlog` | backlog | Filed, not approved (the source's `Incoming`) |
| `Todo` | unstarted | Approved by the owner |
| `In Progress` | started | Work has begun, and the issue is assigned |
| `In Review` | started | A PR is open |
| `Done` | completed | **Shipped**: a merged PR, or a parent whose last sub-issue closed |
| `Canceled` | canceled | Nothing shipped: won't fix, not planned, obsolete, superseded |
| `Duplicate` | duplicate | Nothing shipped: another issue covers it |

## Move a state

```
save_issue  id: "NOR-<n>"  state: "<state>"
get_issue   id: "NOR-<n>"          # confirm the state
```

Four target states have a precondition. Check it first; if it does not hold, **do not move the issue**: say which precondition failed.

- **`Todo`**: the owner's explicit word to move this issue, or the issue is a follow-up you filed **inside** a parent the owner already approved. Name which one you relied on. Otherwise it stays in `Backlog`.
- **`In Progress`**: only from **`Todo`**. An agent starts work only on an approved ticket (`AGENTS.md`), and assigning a ticket is not approving it. Read the current state first (`get_issue`): if it is `Backlog`, stop; the move to `Todo` is the owner's, or the approved-parent case above. Then set `assignee: "me"` in the same `save_issue` call, and confirm both the state and the assignee in the read-back.
- **`In Review`**: only when a pull request for this issue is **open** in `NorthwoodsSentinel/mycelia-mcp`, with `Closes NOR-<n>` as its body's first line (`gh pr view <pr> -R NorthwoodsSentinel/mycelia-mcp --json state,body`; `state` is `OPEN`). No open PR, no move.
- **`Done`**: all of these hold, checked, not assumed:
  1. A pull request in `NorthwoodsSentinel/mycelia-mcp` whose body's **first line** is `Closes NOR-<n>` for this issue (`gh pr view <pr> -R NorthwoodsSentinel/mycelia-mcp --json body,state,baseRefName,mergeCommit`);
  2. its `state` is `MERGED` and its `baseRefName` is `main` (the owner merges here; an agent never does, `AGENTS.md`);
  3. its merge commit is on `origin/main` (`git fetch origin && git merge-base --is-ancestor <mergeCommit> origin/main`).

  **Or** the issue is a parent: it has **at least one** sub-issue, and every one is `Done`, `Canceled` or `Duplicate` (`list_issues` with `parentId: "NOR-<n>"`, read to the end). ⚠️ An empty list is not "all closed": an issue with no sub-issues is not a parent, and "every one of none is closed" is vacuously true (the same empty-set false pass as inspector#2986). Anything else that shipped nothing goes to `Canceled` or `Duplicate`, never `Done`.

## Close as Duplicate

Linear refuses the `Duplicate` state unless a duplicate relation exists. Setting the relation is what moves it (observed 2026-11-16), so it is also what closes the issue. **First** put anything worth keeping from the later issue into the earlier one as a comment. Then:

```
save_issue  id: "NOR-<later>"  duplicateOf: "NOR-<earlier>"
get_issue   id: "NOR-<later>"  includeRelations: true   # confirm state Duplicate and the relation
```

## Close as Canceled

```
save_comment   issueId: "NOR-<n>"  body: "<why nothing shipped>"
save_issue     id: "NOR-<n>"  state: "Canceled"
get_issue      id: "NOR-<n>"          # confirm the state
list_comments  issueId: "NOR-<n>"     # confirm the reason comment is there; get_issue does not show it
```

The reason comment comes first, and a cancel without one is not done. `Canceled` is "nothing shipped", never "done another way".

## Edit labels

⚠️ **`labels` replaces the whole set** on an existing issue: passing `labels: ["Bug"]` strips `factory`, the owner label and everything else. Use the additive forms:

```
save_issue  id: "NOR-<n>"  addLabels: ["<label>"]  removeLabels: ["<label>"]
get_issue   id: "NOR-<n>"
```

The read-back checks the **resulting set**, not just the edit, against `AGENTS.md`:

- `factory` is still present;
- **exactly one** type label (`bug`, `enhancement`, `documentation`, `chore`, `question`);
- one `agent:<name>` owner label;
- `Feature` and `Improvement` (retired) are absent.

An edit that breaks any of these is a failure; put the set right before reporting.

## Read a ticket's comments

`get_issue` does **not** include the discussion. Use `list_comments  issueId: "NOR-<n>"`, and page it like any listing.

## Read a listing to the end

`list_issues`, `list_comments` and the other list tools page. **`hasNextPage: true` means the result is incomplete.** Pass the returned `cursor` back until it is false. Never treat a first page as the whole board, in particular for a duplicate check or an "is anything still open under this parent" check.

## Known limitations (the same as the source's)

- **These recipes describe; they do not enforce.** A precondition is checked by the agent following the recipe. The source's mechanical guarantees came from helper scripts (inspector#2558). No Linear equivalent exists in this repo.
- **Who approved cannot be authenticated here.** The `Todo` precondition takes the owner's word or an approved parent. It cannot prove who spoke, or who moved the parent.
- **`assignee: "me"` cannot tell the agents apart.** Every write through the Linear connector acts as the account it authenticates as (the owner's), so an `In Progress` ticket is assigned to that account whichever agent started it. The `agent:<name>` label is what says who carries it (observed 2026-11-16).
