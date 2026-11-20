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
