# Provenance

Where this repo's rules, gate and guards came from. Everything listed here was
copied from a public source at a recorded commit and then edited; nothing was
rewritten from a summary. Each copied file also says what was changed in its
own header.

Sources:

- **Inspector**: `modelcontextprotocol/inspector`, branch `v2/main`, commit
  `d330df9617e44ec893bc1a53618662239342d433`.
- **Servers**: `modelcontextprotocol/servers`, commit `e1d154ee`.

## Rules file

| This repo                | Source                                | How                                                                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`              | Inspector `AGENTS.md`                 | Section by section. Kept: issue-driven work, review handling, testing and the per-file 90 bar, timeouts, the pre-push gate, waiting, build output, lint with no warning tier, TypeScript rules, skills maintenance. Left out: his folder tree, web, React, auth-token and release sections (no such parts here). Adapted: Linear for the board, `main` as the only branch, owner-merged PRs. |
| `CLAUDE.md`              | Inspector `CLAUDE.md`                 | Same one line: `@./AGENTS.md`.                                                                                                                                                                                                                                            |

**One sentence of `AGENTS.md` is this repository's own and changed with NOR-648.** The opening statement that the server "acts with one agent identity's bearer token, read from the environment, and nothing else" described the server before it could read its key from a key file. It now says the token comes from the environment or, when a key file is present, that one value comes from the file, and that the agent id and the API's address come from the environment only. It is not from the Inspector; the design is `docs/DESIGN-nor-648-fleet-key-file.md`.

## Gate

| This repo                          | Source                                                                         | Edits                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.github/workflows/main.yml`       | Inspector `.github/workflows/main.yml`                                         | One `validate` job running `validate` and `smoke`; Bun pinned for the server; pushes limited to `main`; every action SHA-pinned.                   |
| `.github/workflows/dco.yml`        | Inspector `.github/workflows/dco.yml`                                          | Branch `main`; PR job on every base; the PR's commits fetched from a second credential-free checkout.                                            |
| `scripts/dco-check.mjs`, test      | Inspector `scripts/dco-check.mjs`, `.test.mjs`                                 | The `--base` example names `origin/main`.                                                                                                       |
| `scripts/lib/main-module.mjs`, test | Inspector `scripts/lib/main-module.mjs`, `.test.mjs`                          | Also compares the symlink-resolved entry path, so a guard run through a symlinked checkout does not exit 0 having checked nothing.                |
| `scripts/entry-points.test.mjs`    | Written here                                                                   | Runs each guard through a symlinked checkout and asserts a terminal verdict line, never a banner.                                                |
| `scripts/verify-action-pins.mjs`, test | Inspector `scripts/verify-action-pins.mjs`, `.test.mjs`                    | Every job checked (not only credentialed ones); local `./` refs, zero workflow files and non-regular entries are findings; one descriptor per file. |
| `scripts/verify-skills.mjs`, test  | Servers `scripts/verify-skills.mjs`, `verify-skills.main.test.mjs`             | Wiring questions asked of this repo, including that CI runs on `pull_request`; the `claude plugin validate` bonus run removed; `isMainModule` entry check.                                   |
| `scripts/lib/skill-manifest.mjs`, `npm-scripts.mjs`, tests | Servers, same paths                                  | Unchanged below a provenance note.                                                                                                              |
| `scripts/smoke-inspector.mjs`, test | Inspector `docs/cli-smoke-testing.md`, `scripts/smoke-cli.mjs`; Servers `scripts/smoke-servers.mjs`, `.claude/skills/client-smoke/SKILL.md` | The Inspector CLI pinned at 2.16.0 with its registry integrity checked; stdio only; a fake Mycelia API on 127.0.0.1; an environment allowlist; process-group kills. |
| `.claude/skills/client-smoke/`     | Servers `.claude/skills/client-smoke/`                                         | Adapted to this server's one target and its fake upstream; the web UI and LLM-client paths left out.                                             |
| `vitest.config.ts`                 | Inspector `clients/launcher/vitest.config.ts` (thresholds)                     | Test files named by path; coverage over `src/**/*.ts`; 90 on all four, per file.                                                                  |
| `eslint.config.js`                 | Inspector `eslint.config.js`                                                   | One TypeScript scope; `no-floating-promises` at `error`; `--max-warnings 0`.                                                                      |

## Issue and board skills

The Inspector's `issue-create` and `board-ops` skills (commit `d330df96`; both
files are unchanged at Inspector `eb54b44`, read 2026-11-19) drive a GitHub
project board. Work for this repo is tracked in Linear, so both were adapted
to the Linear MCP tools. That adaptation was written and reviewed in a private
sibling repository of the same owner, and its four files were copied here from
its commit `7add9c6` and then edited for this repo.

| This repo | Source (Inspector) | What the Linear adaptation changed | Edits made here |
| --- | --- | --- | --- |
| `.claude/skills/issue-create/SKILL.md` | `.claude/skills/issue-create/SKILL.md` (137 lines) | GitHub issue and project board became a Linear issue (team NOR). Kept: the step table, "created only when every step is done", everything set at create time, the duplicate check over every state, the five-type table and "don't force the binary". Changed: the version label became the process label `factory`; milestones dropped; an owner label `agent:<name>` added; state per the Backlog/Todo rule; priority only when the owner gave one. Added: a read-back of every field and a post-create duplicate re-check. | The header; no agent names; no pointer to a helper-script ticket that belongs to the sibling repository; the source's exception for a private vulnerability restored (the Linear adaptation had dropped it), pointing at this repo's rule. |
| `.claude/skills/board-ops/SKILL.md` | `.claude/skills/board-ops/SKILL.md` (363 lines) | Kept: rules in `AGENTS.md`, mechanics in the skill; Done means shipped; the truncation hazard (here `hasNextPage`); every change verified by reading it back. Dropped as not applicable to Linear: board and option IDs, the option-deletion hazard, snapshot and recover scripts, the two-Priority-fields hazard, draft cards. Added: `labels` replaces the whole set; closing as `Duplicate` needs `duplicateOf`; preconditions for `Todo`, `In Progress` and `Done`; label invariants checked after every edit. | The header; the `Done` check names this repo's pull requests, which the owner merges; a rule about security tickets that exists only in the sibling repository's rules file is left out; the same ticket pointers removed. Three read-back gaps closed (Codex audit of ac8f16a): `In Review` needs an open pull request; the duplicate read-back asks for relations (`includeRelations: true`), which a bare `get_issue` does not return; a cancel reads its reason comment back with `list_comments`. |
| both `evals/evals.json` | the source's `evals/evals.json` | The source's case shapes, in Linear terms. | `issue-create`: the five positive prompts name this server's tools. `board-ops`: unchanged. |
| `AGENTS.md` Skills index, Issue-driven Work Style intro, process label | Inspector `AGENTS.md` | — | Two index rows; the intro names the two skills; the process label is `factory`, named by the owner 2026-11-16 (the source's is `v2`); a new rule, the owner label `agent:<name>` (the owner's convention of 2026-11-11), so the label both skills require is a rule here and not only a line in a skill. |

Known limitations, recorded in both skills and the same as the source's:
search-then-create is not atomic, and a prose recipe cannot prove who approved
a `Todo` move. One more, specific to Linear and recorded in `board-ops`:
`assignee: "me"` resolves to the connector's account, so it cannot tell agents
apart.

## PR flow

The Inspector's `pr-flow` skill (commit `d330df96`, blob
`528d9a4b97ea63960ff60464aed4625583997dd1`; unchanged at `eb54b44`, read
2026-11-19) takes an issue to a merged pull request on a GitHub project board,
with a Copilot review loop. It was adapted for Linear and a Codex review loop in
a private sibling repository of the same owner; that file was copied here from
its commit `7b91d61` and then edited for this repo. The evidence step is the
MCP reference servers' adaptation of the Inspector's screenshot rule
(`modelcontextprotocol/servers`, `docs/agent-guidance-inception.md` at
`e1d154ee`, section 3.2).

| This repo | Source | What the earlier adaptation changed | Edits made here |
| --- | --- | --- | --- |
| `.claude/skills/pr-flow/SKILL.md` | Inspector `.claude/skills/pr-flow/SKILL.md` | Linear tickets through `/board-ops` and `/issue-create` in place of the project board; branch `nor-<N>-<slug>` from `origin/main`; client evidence in place of screenshots; a Codex round on a detached worktree at the exact head in place of the Copilot loop, with one PR comment per round in place of per-thread replies; the loop's exits as a table. | **The merge is the owner's.** The sibling's last step has the agent merge its own PR; here an agent never merges, so that step became two: what the agent checks and hands the owner (with one merge command that refuses a moved head), and the close-out after the owner merges. Also: the `In Progress` move and the worktree are stated as one start, and the order before `In Review` is stated, since `/board-ops` cannot check either; one transport and the eras the server serves; the round is run through the `codex-review` wrapper only, with no host-specific command; a check of the commit identity before the first commit, because the repository is public; "a pushed branch and a PR body are public"; a commit pushed after the last audited one is named; rules that exist only in the sibling's rules file are left out. From the review of `36d5b04`: the gate result is tied to a commit by a clean-tree check before and after; the hand-off resolves the head once and confirms it has not moved; the hand-off says when a PR changes the workflows it is checked by (the sibling refuses to self-merge such a PR; here the owner is told); a timeout counts as one round without a verdict, and two in a row stop the loop, as the rule says. From the review of `24cfb52`: the gate block prints its pass line only when the gate's exit code was 0 (the first form printed it after a failed gate); the hand-off reads each workflow run's file and jobs, so a job named like the gate in another workflow does not count; the head check needs a full SHA read twice, so a failed lookup cannot print the pass line. Both blocks were run against stand-ins before they were committed. |
| `.claude/skills/pr-flow/evals/evals.json` | the source's `evals/evals.json` | The source's case shapes, in this flow's terms. | Unchanged. |
| `AGENTS.md`: Skills index row; Issue-driven Work Style intro; the evidence rule; the exception in Only the owner does | Inspector `AGENTS.md` ("Attach screenshots as proof of functionality"); servers inception doc, section 3.2 | — | The index row; the intro names `pr-flow`; a new rule, client evidence in place of screenshots, so the evidence step is a rule here and not only a step in a skill. "Only the owner does" listed anything public as the owner's while Contributing has an agent open pull requests and run the review; the owner settled it on 2026-11-19 with a named exception for four acts (push a branch, open a pull request, comment on it, send the diff to the review model), written into that list (Codex audit of `36d5b04`, finding 1). |
| `.claude/skills/board-ops/SKILL.md`, and its index row | (already recorded above) | — | Three wording fixes: the description and the index row name all four preconditioned states (`In Review` was added to the skill and not to its summaries); in "Close as Duplicate" the instruction to save anything worth keeping now comes before the step that closes the issue. |

### The pr-flow helper scripts (NOR-610)

Three steps of `pr-flow` carried their checks as shell blocks or prose, and the
last audit of the skill found a probe that fails could read as a pass in each.
The Inspector answers the same class of defect with helper scripts under test
(its `scripts/lib/gh.mjs` header: the scripts "replace command blocks that the
skills previously transcribed inline"). Its library was copied; the three
scripts are this repository's own, because the Inspector has no step that ties
a gate result to a commit and no hand-off to an owner who merges (its
`gate-lease.mjs` is a lease between concurrent gates, a different thing). The
design, the measurements behind the verdict rule and the review log are in
`docs/DESIGN-nor-610-pr-flow-scripts.md`.

| This repo | Source at `d330df96` | Edits |
| --- | --- | --- |
| `scripts/lib/gh.mjs` | Inspector `scripts/lib/gh.mjs`, blob `84752059afe75329c5936cf91772795c2e6b4873` | Copy then edit. `OWNER` and `REPO` name this repository. Removed, unused here: `COPILOT_REVIEWER_LOGIN`, `ghGraphql`. `ghPaginatedList` was removed with them and is back for the monthly sweep (see "Sweeps"). Added: `ghPaginatedObject`, for endpoints that answer with one object per page and a `total_count`; it throws unless the pages agree on the total, the items match it, and every item has an integer `id` seen once. |
| `scripts/lib/gh.test.mjs` | Inspector `scripts/lib/gh.test.mjs`, blob `5aead316c1f39705cb7b971573d5b28787929da2` | Copy then edit. The tests of the removed exports are removed; the tests of `ghPaginatedObject` are added. The two tests of `ghPaginatedList` are back with it (see "Sweeps"). Joined to `test:scripts`. |
| `scripts/gate-run.mjs`, test | none | Written here. Replaces the shell block of `pr-flow` step 4. |
| `scripts/handoff-check.mjs`, test | none | Written here. Replaces the shell block of `pr-flow` step 7. Reads the combined commit status where the block read the plain statuses listing. |
| `scripts/audit-verdict.mjs`, test | none | Written here. Defines the verdict of `pr-flow` step 6a. |
| `.claude/skills/pr-flow/SKILL.md` | as in the table above | Steps 4 and 7 name the scripts in place of their blocks; step 6a reads the verdict with the script; the first known limitation says what the scripts do and do not enforce. |

## Security advisory

Copied from the Inspector at `eb54b44` (the skill is unchanged there since
`d330df96`), then edited. This repository is public and has private
vulnerability reporting, so the source's flow applies: private tracking,
ownership before severity, accept or close, a private fork, an ordinary public
pull request when the fix is ready, publication after it has shipped.

| This repo | Source (Inspector) | Git blob id | Edits |
| --- | --- | --- | --- |
| `.claude/skills/security-advisory/SKILL.md` | same path (378 lines) | `d70f393ca7baf6e49a992a199be830f78ad86eb9` | **One maintainer, and an agent that works for the owner.** Every outward act the source gives a maintainer is the owner's here and is listed as such: accept, close, each message to a reporter, the private fork, a report upstream, the merge, the publish, the CVE and the credits. The source's private draft card became a private `[SEC]` Linear ticket (the wording of that step, of the reporter reply and of the ownership table's shape follows a private sibling repository's version of this skill, its commit `d749997`). Added: nothing about an unpublished vulnerability goes to the review model or any outside service until its branch is public, since the reviewer here is another vendor's model and the source's outside reviewer also runs only on the public pull request; the four public acts an agent may do are not available before that step; branch names, commit subjects and PR titles are not written from the `[SEC]` title. Two guarded push blocks replace the source's fork helper script: one pushes to the fork only when the remote's one push address is exactly the fork the advisory names, on `github.com`; the other publishes the branch, once, only when `advisory` is that fork, `origin` is exactly this repository, the fork holds the same commit and the name is free here (the push itself is conditional on the name still being free), and it reads the result back. The ticket stays `In Progress` through the private phase, because `board-ops` allows `In Review` only for a pull request in this repository. Left out because they are not true here: the two release lines and their boards, milestones, the priority rubric, the helper script for the fork, the release step. The API facts are the source's, marked as not re-verified here except the listing read. |
| `.claude/skills/security-advisory/evals/evals.json` | same path | `06743379e93d669051c34df7136fa5a5b0985212` | The source's cases, with "release" read as "on main", one case naming the MCP SDK, and one for a vulnerability found in a review. |
| `.claude/skills/issue-create/SKILL.md`, the exception sentence | (already recorded above) | — | It said "stop and tell the owner", which would contradict a procedure that files the private ticket with this recipe. It now sends a vulnerability to `security-advisory`. |
| `AGENTS.md`: Skills index row; Issue-driven Work Style intro; the vulnerability exception | Inspector `AGENTS.md`, the advisory exception | — | The index row; the intro names the skill; the exception names the private ticket, what stays out of this repository and away from outside services until the fix is ready, and the owner-only acts. |

## Knowledge skills

Copied from the Inspector at `eb54b44`, then edited. Each file's blob id is the
same at `d330df96`, the commit the rest of this record names (read from GitHub
at that commit). The Inspector is several clients over a shared core, with a
build per client; this repository is one package with two source files and no
build, so each skill keeps the source's purpose and shape and almost none of
its content.

| This repo | Source (Inspector) | Git blob id | Edits |
| --- | --- | --- | --- |
| `.claude/skills/project-structure/SKILL.md` | same path (116 lines) | `1c34cfb172468c3675c1deeecb096e864c7915a7` | Kept: a map of what owns what, a "where a new file goes" table, model-invoked background knowledge with no slash entry (`user-invocable: false`), "read the file's header, not a second copy here". The map is this repository's: the two source files and which side a piece of code belongs on, the six places a new tool touches, the folders. Dropped: the clients, `core/`, the web backend and the web source layout. |
| `.claude/skills/local-dev/SKILL.md` | same path (363 lines) | `4dbae97651a8923fddbee26f9ffadf0b824e0156` | Kept: install, run, do a real install in a git worktree, runtime consumption decides `dependencies`, the test runner and its coverage provider pinned exactly and bumped together, `overrides` over `npm audit fix`. Added: the versions CI states, the four environment variables and that a real key is the owner's, `client-smoke` as the way to run without one. Dropped, and listed in the skill as absent: the install cascade, the builds, the shared-code alias, bundler externals, the published-tarball check, and the reasoning that belongs to those. |
| `.claude/skills/testing/SKILL.md` | same path (307 lines) | `519e64e2a4e4c83dfb35b7ccb59fcd6fdab178cf` | Kept: where a test goes, how to run it, the per-file coverage gate, keep the exact filename, a real server and client in tests where the tier calls for it. The source's "a runner silently skips a file its glob misses" became this repository's two explicit lists and what guards each (one is guarded by a test, one by nothing). Added: what each kind of run proves. Dropped: the per-client commands, the tiers, React and Storybook, and the test-server fixtures. |
| `.claude/skills/*/evals/evals.json` for the three | same paths | `241aa26f02229ad125344bad9eec0e8b1ef1d184`, `62c70f250d61f3f755bdd5801d7a8dcda7927f46`, `2271ebfb4265d8cb933a995195fc0f70d30e2818` | The source's shape (positives, then negatives; the source's negatives kept). The positives are this repository's, written to the prompt shapes `docs/skill-authoring.md` reports as firing, and none asks what `AGENTS.md` already answers. A private sibling repository's adaptation of the same three skills was read for its shape and for which prompt shapes measured well there; no text from it that names its hosts or systems is carried over. **Trigger rates here are unmeasured**: `skills:eval` has not been run. |
| `AGENTS.md`: three Skills index rows | Inspector `AGENTS.md`, Skills index | — | The rows. |

## Gate guards

The MCP Inspector's CI and pre-push gate guards (its `main` at `eb54b44`). Each
file here was copied from a reviewed port of the same guard in a private
sibling repository (that port merged at its commit `0f02d42`; the files were
read at `f2fa210`, where they are unchanged), then edited before its first
commit here. The design, its two review rounds and the limitations accepted
from them are in `docs/DESIGN-nor-615-gates.md`.

Not ported, with the reason in that design: the Inspector's `verify-install-scripts` (on the pinned Bun an empty trust list is read as unset, and the empty list is the only true one here), `gate-lease`, `verify-build-gate`, `verify-bundle-externals` and `verify-dep-lockstep`.

| This repo | Inspector file and blob at `eb54b44` | Blob in the sibling at `f2fa210` | Edits |
| --- | --- | --- | --- |
| `scripts/lib/workflow-gate.mjs` | same path, `570a1fbdde0afd74b3c50b787393946372e360d0` | `5d0b821b687816bdacf2050bf9850d55cc01a2c7` | The header, rewritten for this repository. One message loses a ticket reference. No logic edit. The Inspector's rules 2 to 4 (browser engines) were already dropped by the port, which also added: a repository-local `uses:` is a finding. |
| `scripts/lib/workflow-gate.test.mjs` | same path, `dbc04bd814d61c667a169d518d1f0541c802df75` | `38e3b771dfc26d6f78e45ea1c27ba379d8c7556c` | The header. One fixture line drops a script this repository does not have. Every case is kept. Joined to `test:scripts`. |
| `scripts/verify-install-fresh.mjs` | same path, `46e03e55db49ef2e516f20249b21e3be607ff3cb` (it reads npm's `package-lock.json`) | `cb1dabb3cc93d644585392afb7bbb4c0b4e92a3a` | The header, rewritten: the Inspector's own reason for the guard, and the limits accepted in the design. One inline comment loses a ticket reference. No logic edit. The port had already changed the lockfile it reads to `bun.lock` and added the walk that decides what this host requires. First in `validate`; a row in `scripts/entry-points.test.mjs`. |
| `scripts/verify-install-fresh.test.mjs` | none (the Inspector's test is for npm's lockfile) | `d9c847faee39e74ba14db658556e2024a2921da4` | The header. Every case is kept. Joined to `test:scripts`. |
| `scripts/lib/bun-lock.mjs` | none: not an Inspector file | `e17da63eae93093e7a87d0858ff9185881dd0bc1` | The header only. The reader for Bun's text lockfile, `lockfileVersion` 1. |
| `scripts/lib/bun-lock.test.mjs` | none | `320d4d0af442b1f7394f3533d7efb036b93cb360` | The header only. Joined to `test:scripts`. |
| `scripts/verify-format-coverage.mjs` | same path, `f617cac5eb763a76ba958dbcb46790aa8df857a9` | `b387afdffb18c47772ab66b14cafa115fc59160d` | The header. **The one logic edit of this port:** the port's map of tracked folders Prettier may ignore is removed with its two uses, so both failures are unconditional here; one message and the OK line are reworded to match. The port had already made it one manifest, taken globs only from a `prettier --check` that `validate` reaches, and asked Prettier itself which files it ignores. After `format:check` in `validate`; a row in `scripts/entry-points.test.mjs`. |
| `scripts/verify-format-coverage.test.mjs` | none kept | `01c49e162b797dc1c4abbb42f3a1dfe80c7d5055` | The header. The allowed-exclusion case is removed; the fixture folder is `scripts/`. Eighteen tests, as in the port. Joined to `test:scripts`. |
| `scripts/verify-typecheck-coverage.mjs` | same path, `1f71e2c4bed881dbb63fa6b85f37d33e719c9548` (its second phase) | `d7de07a30cf410efdd051f01c34c394be4e37bfc` | The header. One message: the failure footer said a file outside the program "is excluded" in `tsconfig.json`, which is false for a file under a dot-directory, the case this guard catches here. No other edit. Run by `typecheck`, after `tsc`; a row in `scripts/entry-points.test.mjs`. |
| `scripts/verify-typecheck-coverage.test.mjs` | none kept | `719fcbcbf856e2fb06c743ea062c4ddd9e928f24` | The header. Fixture reasons are neutral text. The port's test of its shipped exclusions becomes "EXCLUDED is empty". Joined to `test:scripts`. |
| `scripts/lib/ts-inventory.mjs` | the inventory part of the same Inspector file | `03fbcc1eafcbd9954cea717a25b6034977b0b51e` | The header. The build-output list is this repository's `tsconfig.json` `exclude`. |
| `scripts/ts-inventory.test.mjs` | none | `752a615b9ccd75a3746e96cb72d563c0319ae410` | The header only. Joined to `test:scripts`. |
| `scripts/inventory-attack.test.mjs` | none | `4db70d0a62c555fe62915902102ddc2ee5669007` (a TypeScript suite for the port's test runner) | Ten attack cases the review model wrote for the port, translated to `node --test`: same names, order, inputs and assertions. Two local edits, each marked in the file: this repository's build-output directories, and neutral fixture paths and reasons. Joined to `test:scripts`. |
| `scripts/verify-coverage-scope.mjs` | same path, `ec119f3d5bc1b91ecdd0b674335abda2ae466237` | `f2beedce9eb8d131b548526a4c5f4c070b407714` | This repository's header above the Inspector's own. The exclusion lists are this repository's: one exact path (`vitest.config.ts`) and one pattern (`src/**/*.test.ts`, the configuration's own `exclude`); the label in messages is this repository's name. No other edit. The port had already reduced it to one root run and added the tracked-file inventory. It brackets the Vitest run inside `test`; a row in `scripts/entry-points.test.mjs`. |
| `scripts/verify-coverage-scope.test.mjs` | same path, `4f4f97e528e88b1472fb44d35e6abd4552b4060c` | `34d5bb9a0dd2accf33ffbd51557b7f9a009ecb0e` | The header, and the label in one assertion. Joined to `test:scripts`. |
| `scripts/coverage-attack.test.mjs` | none | `0b087f145110eae821e6608b83c37525fa0dbd5e` (a TypeScript suite for the port's test runner) | Ten attack cases the review model wrote for the port (one has a Windows-only half, skipped elsewhere), translated to `node --test`: same names, order, inputs and assertions. Two local edits, each marked in the file: a neutrally named environment variable, and neutral reasons and pattern. Joined to `test:scripts`. |
| `docs/quality-gate.md` | same path, `81bd6e7cdea552c428be71c9cb6d9ea3e5c0603a` | `ad55908ba62a52ec495593c65ab354f6d0254cb0` | Rewritten for this repository from its own `package.json` and workflows: the two tiers, the one local-only step, each stage of `validate` and of `test` with what a failure means, the lockfile rule, and what the Inspector's page has that this one does not. `AGENTS.md`, `README.md`, the `main.yml` header and the `local-dev` and `project-structure` skills point to it or are brought up to date with it. |
| `.claude/skills/pre-push-gate/SKILL.md` | same path, `c43fbdde9a72e665c54560716093f649cd1360fa` | `e82a660a98b1d890e5e22d887d27ad6ca25b7038` | Rewritten for this repository's stages. Kept from the Inspector: verify by exit code, wait in the background without polling, one triage section per stage. Its run command printed the gate's status and ended with `echo`'s; here it also ends with the gate's status. Each stage's failure line is quoted from the script that prints it. Left out: the browser, Storybook, per-client, gate-lease and publish sections. |
| `.claude/skills/pre-push-gate/evals/evals.json` | same path, `63b4309f8b2aaf4dfccccb81b1379639f6170432` | none kept | Five positive cases written for this repository, and the Inspector's two negatives unchanged. Trigger rates are unmeasured: `skills:eval` has not been run. |

## Sweeps

The Inspector's scheduled workflows, copied from its branch `v2/main` at commit
`7df76f6eea9ea425891289333837878ebb31ae6a` (blob ids read with
`git rev-parse 7df76f6e:<path>`) and then edited. The design for all three
pieces, its two review rounds and the limitations accepted from them are in
`docs/DESIGN-nor-673-sweeps.md`. The pieces arrive one pull request at a time,
and this table gains a row with each. The first is CodeQL and the second the
monthly dependency refresh; the daily alert sweep is not in this repository
yet.

| This repo | Source (Inspector) | Git blob id | Edits |
| --- | --- | --- | --- |
| `.github/workflows/codeql.yml` | same path (77 lines) | `f2cd576c6204cf5764e3090e93a033b12589b5ca` | The unchanged file is its first commit here. Edits: the branch list is `main` only, on `push` and on `pull_request` (the source also names its second branch); the header, which says why the source's reason for the file does not apply to a repository with one branch and why it is adopted all the same; the timeout's comment, which marks the source's 10 minutes as provisional here until this repository's runs can size it; the comment on the cron line, which the source words as "default setup's old slot" (its own history) and this file words as "the source's slot". Those four are every edit. Unchanged: the languages, the query suite, the permissions, the concurrency group, the cron expression and the pins. Both pins were looked up again on 2026-11-21: tag `v7.0.1` of `actions/checkout` is commit `3d3c42e5aac5ba805825da76410c181273ba90b1`, and tag `v4.39.3` of `github/codeql-action` is commit `33d7b85da1a04171e211befe2c739303b9a4c066`. |
| `docs/quality-gate.md`, the CodeQL paragraph | same path, its CodeQL paragraph | `81bd6e7cdea552c428be71c9cb6d9ea3e5c0603a` | The source's paragraph with this repository's one branch. Left out: its issue links and the history of its second branch. Added: what "no local-gate counterpart" means here. |
| `.claude/skills/project-structure/SKILL.md`, the workflows row; the header of `scripts/lib/workflow-gate.test.mjs` | (already recorded above) | — | Each names the third workflow file. |
| `.github/workflows/dependency-refresh.yml` | same path (70 lines) | `74b1da8d53f358d4d5be439adc86f07159ff9d09` | The unchanged file is its first commit here. Edits: the checkout is `main` (the source's `ref:` names its second branch); every action pinned to the commit and release `main.yml` carries (the source has `@v7` tags), each looked up again from its tag on 2026-11-21: `actions/checkout` `v7.0.1` is `3d3c42e5aac5ba805825da76410c181273ba90b1`, `actions/setup-node` `v7.1.0` is `949feb2413d6458794dcd2491c4babbbce0c15c1`, `oven-sh/setup-bun` `v2.2.0` is `0c5077e51419868618aeaa5fe8019c62421857d6`; the install is `bun install --frozen-lockfile --ignore-scripts`, with the Bun version stated beside a note to keep it equal to `CI_BUN_VERSION` (the source's `npm install`, its `cache: npm` and its pinned-npm step go); `persist-credentials: false`; `timeout-minutes: 5`, marked provisional; `issues: write` on the job, `contents: read` on the workflow; three step names; the header. **Addition A2:** the `concurrency` block the source has on its daily sweep, with this workflow's group name. Unchanged: the name, the two triggers, the cron slot, the job's name, Node 22 and the two environment values. |
| `scripts/dependency-refresh.mjs` | same path (713 lines) | `cd04280227e82f8416c1218e842a1e3723181415` | The unchanged file is its first commit here; its header lists nine edits with their reasons. One install, the root. The Docker half removed, and with it the only `curl` call. The milestone lookup removed. Labels `factory`, `chore`, `dependabot`. The issue text names this repository and carries none of the source's issue numbers; it no longer says the alerts are swept daily (that sweep is not here yet); the cleared body's sentence on SHA pins is corrected, since a SHA pin with a version comment is ranked. **Addition A1:** the sweep's own issue is found with the labelled REST listing read to the last page, in place of issue search capped at 10, and a marker counts only on an issue `github-actions[bot]` wrote that carries `chore` and `dependabot`; an entry of the listing that is not an object throws, and the number of the issue the sweep takes must be a positive integer before it reaches `gh`. **Addition A3:** every issue write goes through the paced writer. **Edit 8, found while this was built:** a failed `npm outdated` is recognised by its output too. Measured with npm 11.20.0 on 2026-11-21: with the registry unreachable it exits 1, the status that also means "something is outdated", and prints an `error` object, which the source's parse reads as one outdated package; so the parse throws on npm's error report, on JSON that is not an object and on an entry that is not an object or has none of the three version fields, and the read throws when npm printed nothing at all (a clean npm prints `{}`: measured with npm 11.20.0 and 10.9.11). **Edit 9:** a release list that printed nothing throws; a repository with no release still prints a line break (measured). Unchanged: `npm outdated --json`, the rest of the action half, the marker, the title, and that the sweep never closes an issue. |
| `scripts/dependency-refresh.test.mjs` | same path (720 lines) | `b014cc13ded0d1adacf2c6fc981bcbbabf3cd47c` | The unchanged file is its first commit here. The cases for the Docker half and the milestone lookup are removed with the code; the fake answers the REST listing, and a fixture's existing issue is the REST shape; cases written here for A1, A3, a failed write, the issue text and edits 8 and 9. The fake's clean answers are what the real programs print (`{}`, and a line break for no releases), where the source's fake printed nothing. Joined to `test:scripts`. |
| `scripts/lib/sweep-author.mjs` | `scripts/sdk-watch.mjs`, lines 133 to 289 of 942 | `39222ca6b8cfa0c7a279e2c830666c21916b39f5` (the whole file's) | The unchanged excerpt is its first commit here; an excerpt has no blob id of its own, and `sed -n '133,289p'` over the source file reproduces it. Edits: the label list is a parameter, and an empty or malformed one throws; the author is read from the REST issue shape (`user.login`, `user.type`) and the type must be `Bot`; `warnOnUnrecognizedAuthors` is not brought in (it calls a marker parser of the rest of that script); the header. `isAutomationComment` is unchanged and has no caller here yet. |
| `scripts/lib/sweep-author.test.mjs` | `scripts/sdk-watch.test.mjs`, lines 148 to 225 of 1,626 | `b1543bb15a5c7a914ca7fab02c02b0b838564024` (the whole file's) | The unchanged excerpt (two tests) is its first commit here. Edits: imports; the label list passed in; fixtures in the REST shape. Five tests written here for the library's edits. Joined to `test:scripts`. |
| `scripts/lib/gh.mjs`, `ghPaginatedList`; its tests in `scripts/lib/gh.test.mjs` | `scripts/lib/gh.mjs`, `scripts/lib/gh.test.mjs` (the same blobs at this commit as at `d330df96`, recorded under "The pr-flow helper scripts") | `84752059afe75329c5936cf91772795c2e6b4873`, `5aead316c1f39705cb7b971573d5b28787929da2` | The function and its two tests are back as the source has them; they were removed here while nothing used them. One edit, marked in the function: an answer of no pages throws (a list endpoint with nothing to list answers one empty page), with a test written here. |
| `scripts/lib/paced-writes.mjs`, test | none | — | Written here, for addition A3: one second before every GitHub write after the first in a run (`AGENTS.md`, "Pace bulk GitHub writes"). The pause is a parameter. Joined to `test:scripts`. |
| `scripts/dependency-refresh-attack.test.mjs` | none | — | Eight adversarial cases the review model wrote for this sweep, in a tests round on this change before its pull request was opened. Each case's text is in the file unchanged, above the test that renders it for `node --test`; none was dropped or amended. Five failed on the commit the round read and were fixed in the commit that brought the file in: `AGENTS.md` (case 1), the three `npm outdated` shapes of edit 8 (cases 2 to 4) and the no-pages listing (case 5). Joined to `test:scripts`. |
| `scripts/entry-points.test.mjs`, one row; the header of `scripts/verify-action-pins.mjs`; the header of `scripts/lib/workflow-gate.test.mjs` | (already recorded above) | — | The harness runs the sweep through a symlinked checkout with no repository named and requires its own refusal. The pin guard's header said this repository does not have the monthly sweep; that sentence and its note on `SHA_REF` are corrected, and the local constant stays. The workflow scan's header names the fourth workflow file. |
| `AGENTS.md`, "Dependency updates are issue-driven"; `docs/quality-gate.md`; `.claude/skills/project-structure/SKILL.md` | (already recorded above) | — | The rule's "[No sweeps yet in this repo]" marker becomes a note that the monthly sweep is here and the daily one is not; the same marker under "The upstream watch is the third sweep" stays. The gate guide gains a paragraph on the workflow and names the sweep's suites. The skill's rows name the script, the two helpers and the workflow. |

Which `gh` helper each script uses: the monthly sweep lists its own open issues
through this repository's `ghPaginatedList`, and keeps the source's direct
`spawn("gh", …)` calls for the release lists and for its one issue write.

One repository setting makes the CodeQL workflow work, and it is the owner's:
CodeQL default setup stays not set up. It was `not-configured` when this was
written. The monthly sweep needs two labels that only the owner can create,
`chore` and `dependabot`: it files its issue with `factory`, `chore` and
`dependabot`, and while one is missing the run is red and nothing is filed.
The commands are in the design note, section 6.

## Contribution policy, issue forms and security policy

Copied from the Inspector at `eb54b44` (blob ids read with
`git rev-parse eb54b44:<path>`), then edited. The policy is the source's:
issues, not pull requests; a prompt rather than a diff; no public form for a
vulnerability.

| This repo | Source (Inspector) | Git blob id | Edits |
| --- | --- | --- | --- |
| `CONTRIBUTING.md` | `CONTRIBUTING.md` (154 lines) | `1976d078e00fcaedfdedbd235693f0d056d761fa` | One maintainer, not a team. The conventions named are this repo's gate, not the source's component rules. Left out because they are not true here: the two version lines and their labels, the Discord, the community calls, the code-of-conduct link, the three clients. Added: pull requests reference the tracker's `NOR-<number>`, and a GitHub issue that is taken up is linked to its tracked item; a pointer to `SECURITY.md`; the maintainer decides which issues are taken up (the source says a maintainer will pick one up); an issue is public, so keys, secrets and private details are removed before pasting, including from a prompt. |
| `SECURITY.md` | `SECURITY.md` (53 lines) | `f0ec359ff180a1d2529d9b9368799bead446ae29` | One supported line, `main`. The advisory link is this repository's. Added: never put a live agent key in a report. |
| `.github/pull_request_template.md` | same path (35 lines) | `5ce2a7ee1be017ec83f501e203783377a4291843` | This repo's links; the version-label line and the Discord paragraph left out; a line for a vulnerability; the maintainer note names `Closes NOR-<number>`; absolute links, since the banner is rendered as a pull request body; a prompt is shared with keys, secrets and private details replaced by placeholders; "if it is taken up". |
| `.github/ISSUE_TEMPLATE/config.yml` | same path (57 lines) | `f2dddef164352dcb65e2daff7a1ef4c6defb3730` | This repo's links; the Discord link left out. |
| `.github/ISSUE_TEMPLATE/1-bug_report.yml` | same path (163 lines) | `fa6b804c2f5af0f24fa8505b77a8c68efbde30ff` | Fields for this server: which tool, the commit or version, Bun version, the MCP host. Left out: version line, client, transport (stdio only), Node version, screenshots. Added: a public-issue warning, placeholders for a home-directory path and an agent name, and a required box that keys, secrets and private details were removed, including from any prompt. |
| `.github/ISSUE_TEMPLATE/2-feature_request.yml` | same path (88 lines) | `a5d3fefcb8ce14d13168e11dea40cf14e26942d0` | The client dropdown and the `v2` label left out; the checkbox names this server. Added: the same public-issue warning and required box as the bug form, since a pasted prompt can carry a key. |
| `AGENTS.md` Contributing | Inspector `AGENTS.md`, Contributing | — | The source's two paragraphs (issues not pull requests; the forms and no security template), with this repo's facts. Added: a GitHub issue from outside becomes a Linear ticket when the owner takes it up, and the two are linked. |

Two repository settings make these files true, and both are the owner's to
set: pull-request creation limited to collaborators, and private vulnerability
reporting enabled.

## Changes to the server's own code

- `src/index.ts`: `TOOLS`, `asContent`, `createServer`, `main` and `fatal`
  are exported, and the server starts only when the file is run as the
  program (`import.meta.main`), so the tests can import it. `main()` takes
  its transport as a parameter, defaulting to stdio. What the server does
  when started is unchanged.
- `src/*.ts`: reformatted by Prettier; no other change.

## Skill validator and skill eval

Copied from the Inspector at `d330df96` (blob ids read with
`git rev-parse d330df96:<path>`). `skills:eval` is run by hand only.

| This repo | Source (Inspector) | Git blob id | Edits |
| --- | --- | --- | --- |
| `scripts/verify-skills-cli.mjs` | `scripts/verify-skills-cli.mjs` (129 lines) | `13c91b4cf08390b3d673df189f0b3dc53fabef55` | A header; `isMainModule` entry check. The local-CLI trust of a version banner is the source's, kept. |
| `scripts/verify-skills-cli.test.mjs` | same path (114 lines) | `2c93a77d5f355d70e413c7c4b5fd1541e7ee3246` | Unchanged below a provenance note. |
| `scripts/skill-eval.mjs` | `scripts/skill-eval.mjs` (1078 lines) | `615e7594d260fd1c096bd21b3d5d1fd02f638a36` | A header; `isMainModule` entry check. Both runners kept; isolation left to the caller, as in the source. |
| `scripts/skill-eval.test.mjs` | same path (1159 lines) | `d0ec5d9ecfb0b00018efd1391826b481822aaf96` | A provenance note; the placeholder home directory in the `agentEnv` case is `/home/dev`. |
| `scripts/lib/claude-cli.mjs`, test | same paths (105, 106 lines) | `060fa37681afcc49ce664194b003af0b6c0b28e0`, `b590da109dec04c8bba2c2de99462de3ff29805c` | Unchanged below a provenance note. |
| `scripts/lib/win-shell-args.mjs`, test | same paths (62, 61 lines) | `05b4ecd5315a18afc79138bce326a4b89d10fbdd`, `2cfd0b8aa7c1cfd40f7a1d3ccb7bead62fa89bc7` | Unchanged below a provenance note. |
| `docs/skill-authoring.md` | same path (587 lines) | `945b472736dffbf949ca77faa7d4f8ec6e44b4f5` | Method kept as written. Runnable commands name this repo's skill (`client-smoke`); "Measuring GitHub Copilot" cut to what applies here; a banner says the remaining worked examples and numbers are the Inspector's. |
| `package.json` `verify:skills:cli`, `skills:eval`; `local:gate` | Inspector `package.json` scripts of the same names | — | `verify:skills:cli` sits after `local:dco` and before `smoke`. `test:scripts` stays an explicit list and gains the four new test files. A test in `scripts/verify-skills.main.test.mjs` (written here) requires every tracked test-named file under `scripts/` to be on that list. |
| `.github/workflows/main.yml` gate line | Inspector `main.yml` step "Validate the skills with the authoritative CLI (#2163)" | — | A stage of the one gate line (the CI line is `local:gate` minus `local:dco`), not a separate step. |
| `scripts/verify-skills.mjs` `checkWiring`, test | Servers: the source's two `verify:skills:cli` links (`local:gate`, CI) | — | Restored beside this repo's links. Added here: `checkEvalNotWired`, which fails if an npm script reachable from `validate`, `local:gate` or a CI step, or a CI step's `run:`, names `skills:eval` or `skill-eval.mjs`. It does not follow a script that starts the eval through another file. |
| `scripts/entry-points.test.mjs` | Written here | — | Two cases for `verify-skills-cli.mjs` through the symlinked checkout, with a stub `claude` on PATH that reports the pin: one where the validator passes, one where it rejects. |

## The overview page

`docs/ai-software-factory.md` (NOR-690) was written here, not copied. Its section order follows the servers' page of the same name (`modelcontextprotocol/servers`, commit `ec089ce1`, `docs/ai-software-factory.md`, 247 lines, blob `85e46296abfffb672cbc747183f4e6aa1e3ad653`), read in part: its headings, its opening, "The headline change" and "What makes it work". The other sections of that page were not read for this one, and the Inspector's own page was not read.

Every count on the page was taken from this repository's tree at `007915d` or from GitHub on 2026-11-22, with its command beside it. Ticket states were read in Linear; the wording of the plan's steps, who named the process label, and the fresh-session test in the S1 row come from the adoption's own record, kept outside this repository. Two sections have no counterpart in the source: "What is not built yet" and "The adoption, step by step". Where the source's point does not hold here, the page says so in place: no sweeps on `main`, no model in CI, no release procedure, and no measured trigger rates on `main`.
