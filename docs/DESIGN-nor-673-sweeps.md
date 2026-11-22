# DESIGN: NOR-673: the Inspector's three scheduled sweeps

Status: design, reviewed by the review model in two rounds before any code was written (section 9). Built: the CodeQL workflow, which arrives with the pull request that brings this note to `main`; the monthly dependency refresh, in the pull request after it (what was built, and where it goes beyond this note, is section 10); and the daily alert sweep, in the pull request after that (section 11). Nothing in section 2 is left to build.
Source: `modelcontextprotocol/inspector`, branch `v2/main`, commit `7df76f6eea9ea425891289333837878ebb31ae6a`. Read in full for this design: `scripts/dependabot-alerts.mjs` (1,478 lines), `scripts/dependency-refresh.mjs` (713), `.github/workflows/dependency-refresh.yml`, `dependabot-alerts.yml` and `codeql.yml`, `scripts/lib/markdown-cell.mjs`, `scripts/lib/gh.mjs`. Read in part: see "Not read" in section 5.
Target: a branch cut at `007915d`, this repository's `main` when this was written.

Words used below. **Measured**: run for this design on 2026-11-21 (UTC), on macOS arm64, Node 26.12.1, npm 11.20.0. CI runs Ubuntu and Node 22.x; nothing below was run there. **Read**: read in the named file at the commit above. **Reported**: stated by a named source and not re-checked. **INFERRED** and **UNKNOWN** say so. Line numbers are in the file at the commit above.

## 1. Outcome, and the evidence that shows it is done

**Outcome.** This repository learns about a dependency that is behind, a dependency with a known advisory and a code-scanning finding from a scheduled job that files a GitHub issue or a code-scanning alert, with no Dependabot pull request and no stored secret. The source's reason, kept: "A Dependabot PR carries no `Closes #N` and no board card, so it was the one standing exception to Issue-driven Work Style, enforced by nothing" (Inspector `AGENTS.md`:123). This repository's `AGENTS.md` already states the rule ("Dependency updates are issue-driven, like everything else") and marks it "[No sweeps yet in this repo]".

**Evidence, reasoned back from that outcome:**

| # | Evidence | How it is read |
| --- | --- | --- |
| E1 | The three workflows and their scripts are on `main`, each with a `PROVENANCE.md` row | `git ls-tree origin/main`; the rows of section 2 |
| E2 | `npm run local:gate` exits 0 at each pull request's head and CI is green; `verify:action-pins` reports 5 workflow files once all three are in | exit code; the guard's OK line |
| E3 | Each workflow has one completed run **with event `schedule`** and conclusion `success` | `gh run list --workflow <file> --json event,conclusion`. A manual run alone does not count: it shows the job can pass, not that the schedule fires |
| E4 | The monthly sweep's first run matches the state it read in that run. If its log lists a package or an action that is behind, exactly one open issue exists afterwards, authored by `github-actions[bot]`, labelled `factory` + `chore` + `dependabot`, with those rows. If the list is empty, no issue is filed and the log says so. A second run straight after leaves the number of open sweep issues unchanged | The run's log beside `gh issue list --label dependabot --json number,author,labels`. Six of the 11 direct dependencies were behind on the design day (Measured, section 3); that is a measurement, not the expected result |
| E5 | The daily sweep's first run matches the alerts it read in that run: with no open alert it exits 0 and files nothing; with one, it files one issue per bump | The run's log beside the alerts listing. There were 0 open alerts on the design day (Measured: the listing returned `[]`, exit 0). **Its filing path is shown by its tests only, until a real alert exists** |
| E6 | CodeQL has an analysis for `refs/heads/main` in both languages | `gh api repos/<owner>/<repo>/code-scanning/analyses` |
| E7 | `AGENTS.md` no longer says "[No sweeps yet in this repo]" under "Dependency updates are issue-driven"; the same marker under "The upstream watch is the third sweep" stays | the diff |

## 2. Inventory and verdicts

The source's way first; copy, then edit; one pull request per piece. **PR A**: CodeQL. **PR B**: the monthly dependency refresh. **PR C**: the daily alert sweep. The two labels of section 6 must exist before B or C runs.

| Inspector file at `7df76f6e` (blob) | Verdict | Edits, each with its reason |
| --- | --- | --- |
| `.github/workflows/codeql.yml`, 77 lines (`f2cd576c`) | **Adapt** (PR A) | Branch list `[main, v2/main]` → `[main]` on `push` and `pull_request`. Header reworded: the source's second branch does not exist here, and the line naming its pin-resolving script goes, since that script is not in this repository. Two comments are reworded for this repository: the timeout's, and the cron line's. Nothing else: it is already SHA-pinned, has `timeout-minutes: 10`, job-level permissions and `persist-credentials: false`. Pin checked (Measured): tag `v4.39.3` of `github/codeql-action` dereferences to commit `33d7b85da1a04171e211befe2c739303b9a4c066`, the SHA in the source file |
| `.github/workflows/dependency-refresh.yml`, 70 lines (`74b1da8d`) | **Adapt** (PR B) | `ref: v2/main` dropped. `actions/checkout@v7` and `actions/setup-node@v7` become the SHA pins `main.yml` already carries (`AGENTS.md`: the pin is required in every job here). `cache: npm` dropped: there is no `package-lock.json`. The step that installs a pinned npm is dropped: its stated reason is `allowScripts`, and this install runs no scripts. `npm install` → setup-bun (the pin in `main.yml`) and `bun install --frozen-lockfile --ignore-scripts`. `persist-credentials: false` on checkout, as in `main.yml`. `timeout-minutes` added (`AGENTS.md`: every CI job declares one). Permissions moved to the job. A `concurrency` block added (addition A2 below) |
| `scripts/dependency-refresh.mjs`, 713 lines (`cd042802`) | **Adapt** (PR B) | `INSTALLS` → the root only. **The Docker half is removed** (`DOCKERFILE`, `BASE_IMAGE_ARG`, `INDEX_MEDIA_TYPES`, `parseDockerBaseImage`, `parseDigestHeader`, `shortDigest`, `currentImageDigest`, `staleBaseImage`): there is no Dockerfile here and `parseDockerBaseImage` throws without one. That also removes the script's only `curl` call. `currentMilestone` removed: this repository has no milestones (Measured: 0), the same call the Linear adaptation of `issue-create` made (`PROVENANCE.md`, "milestones dropped"). Label `v2` → `factory` (the mapping `PROVENANCE.md` records). Issue text: the source's issue numbers, branch name and `AGENTS.md` link are replaced. `npm outdated --json` is **kept** (section 3). The lookup of its own issue changes from issue search to a labelled listing, and marker trust is added: addition A1 below |
| `scripts/dependency-refresh.test.mjs`, 720 lines (`b014cc13`) | **Adapt** (PR B) | Cases for the removed halves go (the file has 10 `curl`, 3 `Dockerfile` and 11 `milestone` matches; Measured, counts only). Cases for A1 are added. Joined to `test:scripts` |
| `.github/workflows/dependabot-alerts.yml`, 103 lines (`46d28541`) | **Adapt** (PR C) | `ref: v2/main` dropped. The `PROJECT_TOKEN` line removed. `npm ci --ignore-scripts` → setup-bun and `bun install --frozen-lockfile --ignore-scripts`. `cache: npm` dropped. `persist-credentials: false` on checkout. `timeout-minutes` added. Permissions moved to the job. The `concurrency` block is kept as written. It is already SHA-pinned |
| `scripts/dependabot-alerts.mjs`, 1,478 lines (`3df0252a`) | **Adapt** (PR C) | (1) **The board write is removed**: `PROJECT_ID`, both field ids, `BOARD_STATUS`, `BOARD_PRIORITY`, `optionId`, `addToBoard`, `boardProblems`. (2) `currentMilestone` and `pickMilestone` removed. (3) `TARGET_BRANCH` → `main`. (4) **`readManifest` reads `bun.lock`** through the existing `scripts/lib/bun-lock.mjs` and hands the source's functions the shape they already read: `packages[""]` is the root workspace, `packages[<dir>]` is `{version}`, where `<dir>` is that reader's `node_modules/a/node_modules/b` form. So `lockfileEntries`, `isDirectDependency`, `narrowToApplicable`, `remediation`, `overrideAncestors` and their tests carry over unchanged. (5) The alert's `manifest_path` is **compared with a fixed list** (`package.json`, `bun.lock`) and is no longer opened as a file; anything else is `indeterminate`: logged, never cleared. (6) `checkSecurityPrsStillDisabled` loses its second-token argument; with the job's token it logs UNVERIFIED, which `AGENTS.md` already describes ("where the sweep's token cannot read the setting, it logs **UNVERIFIED** and carries on"). (7) Labels as above. (8) Issue text: the source's issue numbers, the board and Priority note, and its placement link. (9) Addition A1 |
| `scripts/dependabot-alerts.test.mjs`, 1,894 lines (`8493d3c4`) | **Adapt** (PR C) | Board and milestone cases go (7 `PROJECT_TOKEN` and 14 `milestone` matches; Measured, counts only). The `main()` fixtures write a `bun.lock`. Cases for A1 are added. Joined to `test:scripts` |
| `scripts/lib/markdown-cell.mjs`, 19 lines (`c97d2d0a`), and its test, 31 lines (`c9b760dc`) | **Transfer** (PR C) | Unchanged below a provenance note |
| `scripts/sdk-watch.mjs` (`39222ca6`), lines 133 to 289 only: `AUTOMATION_LOGIN`, `normalizeLogin`, `hasSweepAuthor`, `hasSweepLabels`, `isSweepAuthored`, `isAutomationComment` | **Adapt, as addition A1** (PR B; reused by C) | A new file, `scripts/lib/sweep-author.mjs`, copied then edited: the label list becomes a parameter. The rest of `sdk-watch.mjs` is not in this design |
| The second token and the board write; the Docker half; `.github/dependabot.yml` | **Not applicable** | No project board; no Dockerfile; neither repository has a `dependabot.yml` (Read) |
| `dco.yml`, `main.yml` | **No action** | Present and recorded in `PROVENANCE.md`; neither is a sweep |

**Already in this repository, and which copy is used:**

- **`scripts/lib/gh.mjs`** (this repository's, from the source's blob `84752059`). The source's two sweep scripts do not import it at `7df76f6e`: `dependabot-alerts.mjs` has private `gh` and `ghJson` functions (lines 701 to 714), and `dependency-refresh.mjs` calls `spawn("gh", …)` directly. **Used here: this repository's `gh` and `ghJson`, in `dependabot-alerts.mjs`.** Reason: once the second token is gone, the private pair differs from this repository's only by lacking the stated 64 MiB buffer. The source's tests match calls on the argument list, not on spawn options (0 matches for `encoding` or `maxBuffer` in either test file; Measured). `dependency-refresh.mjs` keeps its direct calls: there is no duplicate helper in it to remove. **`ghPaginatedList`**, the source's list reader in the same file (it throws unless every page is an array), was removed here as unused and is restored from the same blob: both scripts' listings of open sweep issues go through it.
- **`scripts/lib/main-module.mjs`** (this repository's). Both scripts import `isMainModule`; the copy here also resolves a symlinked entry path. Used as it is.
- **`scripts/verify-action-pins.mjs`** (this repository's). Two sentences of its header become stale: that the monthly sweep is one "this repo does not have", and edit 5. PR B corrects the comment only; the local `SHA_REF` constant stays.
- **`semver`.** The source's alert sweep imports it (its root `package.json`: `^7.8.5`). It is not declared here; `bun.lock` already holds `semver@7.8.6` as a transitive package (Read). PR C declares it in `devDependencies` and rewrites `bun.lock` with the Bun version CI pins, as the `local-dev` skill requires.

**Addition A1, marked as an addition: trust a marker only on what the automation wrote.** The reason in one line: this repository's own rule requires it (`AGENTS.md`: "the sweep trusts a marker **only** on something the automation wrote"), and at the recorded commit the source's two plain sweeps do not yet apply it. `findExistingIssue` (`dependency-refresh.mjs`:578 to 602) accepts any open issue whose body starts with the marker, and `announcedAdvisories` (`dependabot-alerts.mjs`:928 to 945) accepts a marker in any comment. The source states the rule itself for its third sweep: "A marker is not evidence — this repo is public … an issue must be authored by `github-actions` _and_ carry the … labels an outsider cannot set, and a comment must come from `github-actions[bot]`" (Inspector `AGENTS.md`:176). A1 applies the source's own helper to the other two. **The monthly lookup no longer uses issue search** (`gh issue list --search … --limit 10` in the source): search can lag behind an issue that was just created, and the result was capped at 10. It lists every open issue labelled `dependabot` through the REST listing the source's daily sweep already uses (`repos/<o>/<r>/issues?state=open&labels=dependabot&per_page=100`, read to the last page), drops pull requests, and keeps the issue that passes `isSweepAuthored` and whose body starts with the marker. The REST fields `user.login` and `user.type` are what the helper's author check reads. The daily listing, already filtered to `labels=dependabot`, keeps only bot-authored issues. A comment marker counts only from the bot. Measured on the source repository: its sweep issues are authored by `github-actions[bot]`, type `Bot`.

**Addition A2, marked as an addition: the monthly workflow gets the daily workflow's `concurrency` block**, with its own group name and `cancel-in-progress: false`. The reason is the source's own, written in its daily workflow: "The marker check is a read-before-write, not an atomic one … Two overlapping runs would both see no open issue and both file one" (`dependabot-alerts.yml`:58 to 61; a manual dispatch can start while the scheduled run is still going). The source's monthly workflow does not have the block. Without it the count in E4 could not be relied on.

**Addition A3, marked as an addition: one second between consecutive issue writes, in both scripts.** The reason is this repository's rule (`AGENTS.md`, Issue-driven Work Style): "Pace bulk GitHub writes: 1 s between requests, never in parallel". The source's rules carry the same line (its `AGENTS.md`:402) and its sweeps do not pace. Both scripts are synchronous, so their writes are never parallel. The pause goes through an injected function, so the tests do not wait. The rule's other half, "a refused create can still go through, so look before retrying", is already how the sweeps behave: a failed write throws, nothing is retried inside a run, and the next run reads the listing of its own issues before it creates anything.

**`PROVENANCE.md` gains a section "Sweeps"**: the table above with full blob ids and the source commit, and one sentence on which `gh` helper each script uses.

## 3. What each sweep does here

Common to all three: `runs-on: ubuntu-latest`; workflow-level `permissions: contents: read`; the grant below on the job; every `uses:` a 40-hex SHA with a `# vX.Y.Z` comment, which is what `scripts/verify-action-pins.mjs` checks in every job (`unpinnedRefs`). The pins: `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`, `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0` and `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0`, all three as in `main.yml` today, and `github/codeql-action/init` and `/analyze` at `33d7b85da1a04171e211befe2c739303b9a4c066 # v4.39.3`. Each sweep workflow states the Bun version with a comment to keep it equal to `CI_BUN_VERSION` in `main.yml`, the source's own pattern for its npm pin (`dependency-refresh.yml`:59 to 60). No secret other than `GITHUB_TOKEN` is named anywhere. **Timeouts.** No run of a workflow can be observed before the workflow exists, so each first value is provisional. The source's CodeQL job declares `timeout-minutes: 10`, from its own observed runs, and that value is kept. Its two sweep jobs declare none, so they get `timeout-minutes: 5`. Each is marked PROVISIONAL in its file, as `main.yml` marks its own first value, and each is re-sized from the first scheduled runs by the rule's formula (`AGENTS.md`: roughly twice the slowest run observed, rounded up to the next five minutes, with the range stated). That re-sizing is a known limitation until it is done, and it has a follow-up ticket.

| | Monthly dependency refresh | Daily alert sweep | CodeQL |
| --- | --- | --- | --- |
| Trigger | `schedule` `23 6 1 * *` and `workflow_dispatch` (the source's) | `schedule` `17 6 * * *` and `workflow_dispatch` (the source's) | `push` and `pull_request` on `[main]`; `schedule` `23 16 * * 6` (the source's) |
| Job permissions | `contents: read`, `issues: write` | `contents: read`, `issues: write`, `vulnerability-alerts: read` | `contents: read`, `security-events: write` (the source's, already per job) |
| Reads | `npm outdated --json` over the Bun-installed tree; every `uses:` ref in `.github/workflows` against that action's release list (`gh api repos/<o>/<r>/releases`); open issues labelled `dependabot` | Open Dependabot alerts (`gh api --paginate --slurp`); this repository's `bun.lock`; open issues labelled `dependabot` and their comments; the security-updates setting (expected UNVERIFIED) | The checkout |
| Writes | One issue: create it, or edit its body | Per bump: create an issue, edit its title and body, add a comment | Code-scanning results |
| Duplicates | The marker `<!-- dependency-refresh:monthly-sweep -->` as the body's first line, on a bot-authored, labelled issue found by the labelled listing (A1); the `concurrency` group, so two runs cannot both create (A2) | A marker naming the package, manifest, fixed version and advisory ids; a comment marker per advisory; the `concurrency` group, so two runs cannot both create | A concurrency group per ref and language (the source's) |
| On failure | The script throws and the job is red, with nothing partial. Every lookup failure throws by the source's design: "a failed run also prints nothing to stdout, so accepting it parses to an empty package list and reports a clean no-op" (lines 382 to 388) | "Every failure here throws; none degrades to 'no alerts'" (lines 808 to 814): the alert listing runs before any write. An unreadable lockfile or an unknown manifest is `indeterminate`: logged, and the issue is left alone | The job is red; nothing is uploaded |
| Never does | Close an issue; open a pull request | Close an issue ("a judgement the sweep cannot make", lines 611 to 615); open a pull request | n/a |

A red scheduled run notifies "the user who last modified the cron syntax in the workflow file" (Reported: GitHub's documentation of the `schedule` event, fetched 2026-11-21). Who that is here is UNKNOWN.

**The experiment: does `npm outdated` work over a tree installed by Bun? Yes (Measured).**

- Setup: a scratch directory; `git archive origin/main | tar -x`; Bun **1.3.14** (the CI pin, installed from the `bun` npm package); `bun install --frozen-lockfile --ignore-scripts` → exit 0, "248 packages installed". The sha256 of `bun.lock` was the same after the run, and no `package-lock.json` appeared.
- **`npm outdated --json` → exit 1**, standard error empty, standard output one JSON object keyed by package name, each value `{current, wanted, latest, dependent, location}`. Six entries: `@types/bun`, `@vitest/coverage-v8`, `prettier`, `typescript`, `typescript-eslint`, `vitest`. The source's `parseOutdated` reads exactly `current`, `wanted` and `latest`, and its `runOutdated` treats exit 0 and exit 1 as success.
- Checked against two other sources: each `current` equals the version in `bun.lock`, and the 5 direct dependencies it did not list are at the registry's latest (`npm view <pkg> version`). 6 + 5 = 11, every direct dependency.
- **Bun's equivalent:** `bun outdated` on 1.3.14 → exit **0**, with the same six rows and the same three versions in each, as a text table. `bun outdated --json` printed the same table, exit 0: this version has no JSON output. So the source's parser and its exit-code rule fit `npm outdated` and do not fit `bun outdated`. **`npm outdated` is kept.**
- Control: the same `package.json` and `bun.lock` with no `node_modules` → exit 1, **one** entry and no `current`. So the install step is required, and a tree that was not installed gives a small wrong answer with a normal exit code.
- Not measured: Linux, Node 22 and the npm it bundles. The first CI run is that evidence.

## 4. Threat model, with its upper bound

**Subject.** Three jobs in a public repository. Two run on a schedule or a manual dispatch, holding a `GITHUB_TOKEN` with `issues: write`. One runs on push, pull request and schedule with `security-events: write`. None is passed any other secret. No model runs in any of them.

**Upper bound: the worst case if every control below failed and an attacker held a job's token.** The token is scoped to this one repository and ends with the job.

| Job | The attacker could | The attacker could not |
| --- | --- | --- |
| Monthly, daily | Create, edit, close, lock, label and comment on any issue here; with the daily job, also read this repository's Dependabot alerts | Push, merge, change a workflow or a setting, read another secret (none is passed), reach another repository, or publish anything outside the issue tracker |
| CodeQL | Upload forged code-scanning results, or cause real findings to be missing | The same list |

Whether `issues: write` also covers creating labels and milestones was not re-read for this design; assume it does.

**What stops untrusted text from steering a job or being executed.**

1. **The sweeps never run a pull request's code.** Their triggers are `schedule` and `workflow_dispatch`. A scheduled run uses the default branch's file ("Scheduled workflows will only run on the default branch"; Reported, GitHub's documentation). A dispatch needs write access.
2. **No dependency code runs.** The install is `bun install --frozen-lockfile --ignore-scripts`. The monthly script imports only Node built-ins and this repository's `scripts/lib/`; the daily script adds `semver`. `npm outdated` reads manifests and the registry.
3. **No shell.** Every `gh` and `npm` call is `spawnSync` with an argument array. Advisory text, package names and versions reach `gh` only as the value of `--title` or `--body`. No `run:` line contains an expression: the only expressions are `secrets.GITHUB_TOKEN` and `github.repository` in `env:`, the Bun version in `with:`, and in CodeQL `matrix.language` and `github.ref` (the source's).
4. **Advisory fields are data.** Package, advisory id, CVE, severity, summary, range, patched version and URL come from GitHub's alert API. They are grouped, compared with `semver.satisfies`, and written into Markdown. Table cells are escaped, backslash first and then pipe (`markdown-cell.mjs`).
5. **`manifest_path` is no longer a file path** (edit 5 of section 2). The source passes it to `readFileSync`; here it selects from a fixed list, and the only file read is this repository's own `bun.lock`.
6. **Issue and comment text from outside is not a marker** (A1). It is only pattern-matched and compared. It is never executed, never a path, and never an argument other than a body.
7. **Action tags are filtered.** A release tag reaches the issue only if it matches `^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$` (`parseVersionRef`).
8. **Pinned actions.** A moved tag cannot replace the code that runs beside the token.
9. **CodeQL on a pull request from a fork** gets a read-only token from GitHub, so it cannot upload; that run fails, which is the safe side. INFERRED from GitHub's rule for forks, not tested here.

**Out of scope, stated plainly.** A compromise of GitHub, of the runner image, of the `gh` or `npm` binaries on it, or of the content of an action at its pinned SHA. A harmful change merged by the owner. Markdown that renders inside an issue (a link or an `@mention` carried in an advisory summary). The model job of the upstream watch, which is designed separately.

## 5. Accepted limitations and settled decisions

**Settled before this design.**

1. **Findings are filed as GitHub issues by the workflows, as the source does.** It is the source's way, and the alternative would put a tracker credential into a public repository's secrets. The triage flow, a separate change, picks the issues up.
2. **A sweep issue may say in public that this repository is in range of a named public advisory, before the fix.** The owner's merged rule already says so: `AGENTS.md`, "Dependency updates are issue-driven": "Both halves are replaced by scheduled workflows that file **issues**", and Dependabot alerts stay on so the sweep can read them. It is also the source's practice. The private-until-fixed rule in `AGENTS.md` is about a vulnerability in this repository's own code and is untouched.
3. **CodeQL is part of this change.**
4. Carried from the reading that preceded this design: `v2` → `factory`; `ref: v2/main` dropped; no second token; one install; `timeout-minutes` on every job; SHA pins in every job.
5. `AGENTS.md`, "Only the owner does" (a GitHub issue, a comment on one and a label are not an agent's) is not changed. The writes here are made by a workflow the owner merged, as `github-actions[bot]`.

**Accepted limitations.**

- **GitHub's dependency graph for this repository holds the 11 direct dependencies only (Measured).** The manifests it parsed are `package.json` and the two workflow files. Its SBOM lists 11 npm packages (as ranges), 3 actions and the repository itself; `express`, `zod`, `ajv` and `hono` are in `bun.lock` and not in the SBOM. GitHub's page of supported ecosystems lists `package-lock.json` and `package.json` for npm and does not mention Bun (Reported, fetched 2026-11-21). So an advisory on a transitive package, 237 of the 248 installed, raises no alert, and the daily sweep cannot see it. This stands where the source's branch blind spot stood (alerts computed from one branch, shipping from another), which does not exist here.
- **The `manifest_path` of an alert on this repository is INFERRED to be `package.json`.** No alert exists to read it from.
- **Whether a job token with `vulnerability-alerts: read` can read the alerts here is Reported**: GitHub's workflow-syntax page lists the key ("Read Dependabot alerts", read or none) and the source's workflow header says the same. The reads for this design were made with an administrator's token, not a job token.
- The security-updates read-back stays UNVERIFIED under the job's token, as the source's does without a second token.
- **The daily sweep clears an issue's body by absence**, as the source does: an advisory that is no longer in the open-alert listing is taken as fixed or dismissed. The listing throws on a failed call, on a malformed answer and on zero pages, and it is paged by the cursor GitHub returns (Reported, GitHub's documentation of the endpoint: `before`, `after`, `per_page` up to 100), so a change of state during the read does not shift the items after it. It is still not a snapshot with a total to check against. The bound on a wrong clear: one open issue's body says "no longer applicable" until the next daily run, which finds the alert, matches the issue by the marker the cleared body keeps, and rewrites it; the sweep never closes an issue. GitHub's graph holds 11 packages for this repository, so the listing is one page here. Reading each tracked alert's own state before clearing was proposed in review (section 9) and is not added: it is new logic the source does not have.
- The listing of open sweep issues is checked for page shape only, as the source's list reader does; it is one page while fewer than 100 sweep issues are open.
- The issue's parent-scoped `overrides` example is npm's syntax. Whether the pinned Bun honours a nested override was not tested. The text is checked against the pinned Bun while PR C is built, or reduced to the top-level form.
- "In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days", and scheduled runs "can be delayed" or "dropped" under load (Reported, GitHub's documentation). Nothing in the source's design or in this one reports a sweep that stopped running.
- The first evidence on Linux, Node 22 and CI's npm is the first run.
- **The three jobs' timeouts are provisional** until they are re-sized from the first scheduled runs (section 3, "Timeouts"); a follow-up ticket holds that work.
- An alert that is not npm (an action, for example) is logged for a human and not filed: `SUPPORTED_ECOSYSTEM = "npm"`, the source's.
- The source files a security bump at High on its board. Here priority belongs to the triage flow; the sweep sets none.

**Not read.** The two sweep test files and the `markdown-cell` test: literal counts and imports only. `sdk-watch.mjs` outside lines 126 to 300. Inspector `AGENTS.md` outside lines 112 to 206. Whether pull-request creation is limited to collaborators (a setting). The quotations from GitHub's documentation were taken through a page-summarising fetch, not from the raw pages.

## 6. Owner's hands (one block)

**Checked against the source, not against an earlier count.** Its files require three settings and apply three labels (`v2`, `chore`, `dependabot`; `v2` is `factory` here). Read from this repository's API on 2026-11-21 (Measured):

| Thing | Required | Today | The owner does |
| --- | --- | --- | --- |
| Settings → Security and quality → Advanced Security → **Dependabot alerts** | Enabled | On (`GET …/vulnerability-alerts` → 204) | Nothing. Leave it on |
| The same page → **Dependabot security updates** | Disabled | Off (`GET …/automated-security-fixes` → `{"enabled":false}`) | Nothing. Leave it off |
| The same page → Code Security → **CodeQL analysis** (default setup) | Not set up | `not-configured` | Nothing. Do not choose **Set up → Default** |
| Label **`factory`** | Exists | Exists | Nothing |
| Label **`chore`** | Exists | **Missing** | Create |
| Label **`dependabot`** | Exists | **Missing** | Create |
| Secrets | None | n/a | None |

So: **0 settings to change, 2 labels to create, 0 secrets.** The setting names are from GitHub's current pages (Reported, fetched 2026-11-21). The repository's labels today, all ten (Measured): `bug`, `documentation`, `duplicate`, `enhancement`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`, `factory`.

```sh
gh label create chore --repo NorthwoodsSentinel/mycelia-mcp --color 89bf0f \
  --description "Maintenance: deps, build tooling, CI, cleanup — no user-facing behavior change"
gh label create dependabot --repo NorthwoodsSentinel/mycelia-mcp --color 1a0924 --description ""
```

The colours and the description are the source repository's values for the same two labels (Measured). Optional, after PR B and PR C merge: Actions → the workflow → **Run workflow**, once each, instead of waiting for the cron slot. Merging the three pull requests is the owner's, as always.

## 7. Open questions

None open for this design. One addition was referred to the owner and is not part of it: a second advisory signal for the transitive packages that GitHub's alerts do not cover here (the first accepted limitation).

## 8. Not in this design

- The model job of the upstream watch, designed separately. Only six small helpers from its script are reused (A1).
- A closing page that describes the whole process.
- Also not proposed, since each would be an addition with no requirement behind it: the source's pin-resolving script, a watchdog for a sweep that stopped, and removing the token from the environment of the `npm outdated` child process.

## 9. Design review

Two rounds by the review model, before any code. Both returned a review; both verdicts were fail. The second round said "The approach can work" and accepted the answers to the first round's findings 1, 2, 3 and 5. There is no third round: every finding below is fixed or answered here.

- **Round d1 (`4e193ea`): fail, 5 findings.** The five files to be written were marked not reviewed, because they do not exist yet.
  1. HIGH, the monthly sweep can file a duplicate (overlapping runs; search lag): **fixed**, by A2 and by the change under finding 3.
  2. HIGH, absence from the alert listing is not enough to clear an issue: **declined, and recorded as an accepted limitation with its bound** (section 5). The mechanism the finding names, offset paging that drops an item, is not this endpoint's documented paging (Reported). It is new logic the source does not have, so it is listed for the owner's decision and is not part of this design.
  3. HIGH, the monthly lookup by issue search is neither complete nor authoritative: **fixed**: the labelled REST listing, read to the last page (A1). Its further ask, a uniqueness and stability check on that listing, is **declined**: the source's list reader checks page shape only, and the listing is one page here (section 5).
  4. MEDIUM, the two 5-minute timeouts are not sized from observed runs: declined in that round; raised again in d2 and answered there.
  5. MEDIUM, E4 and E5 asserted the design day's state: **fixed**: both now assert behaviour against the state read in the run.
- **Round d2 (`273ced2`): fail, 2 findings.**
  1. MEDIUM, the note said pacing of issue writes had no requirement behind it, while `AGENTS.md` requires one second between bulk GitHub writes: **fixed**: addition A3, and the sentence is corrected (section 8).
  2. MEDIUM, the timeouts are not sized from observed runs: **answered** (section 3, "Timeouts"). No run of a workflow can be observed before the workflow exists. The first values are provisional: the source's own 10 minutes for CodeQL, 5 for the two sweeps, which the source leaves unbounded. Each is re-sized from the first scheduled runs by the rule's formula; that is a stated limitation with a follow-up ticket.

## 10. As built: the monthly dependency refresh (PR B)

Built as section 2 lists it, with these points decided or found while building. Each is also in the header of the file it concerns, and in `PROVENANCE.md`, "Sweeps".

- **The author check asks for two labels, `chore` and `dependabot`.** The issue is filed with three (`factory` as well, as E4 says). The source's own check for its upstream watch leaves its process label out in the same way.
- **The author check reads the REST shape and requires `user.type` to be `Bot`.** The source's helper tolerates a missing bot flag, for `gh` versions that leave it out; the REST listing always states the type.
- **Addition A3 is `scripts/lib/paced-writes.mjs`.** A run of the monthly sweep makes one issue write, so its pause does not fire; the writer is on the write path so that a second write cannot be added without it.
- **Found while building, and fixed: a failed `npm outdated` can exit 1.** Section 3's "On failure" row quotes the source: every lookup failure throws. Measured with npm 11.20.0 on 2026-11-21, with the registry made unreachable: exit **1**, the status that also means "something is outdated", and an `error` object on standard output, which the source's parse reads as one outdated package. The script here throws on that report, on JSON that is not an object of package objects, and when npm printed nothing at all: a clean `npm outdated` prints `{}` (measured with npm 11.20.0 and with npm 10.9.11, the line Node 22 bundles), so an empty answer is a short read. A release list that printed nothing throws for the same reason: a repository with no release still prints a line break (measured). The error report was measured with npm 11.20.0 only.
- **Found by the review model's test cases, and fixed:** a listing answered with no pages at all was read as "no issue exists" (`ghPaginatedList` now throws on it; an empty listing is one empty page, measured).
- **E7 as built:** the marker under "Dependency updates are issue-driven" is replaced by a note that the monthly sweep is here and the daily one is not, since that paragraph speaks of both halves. PR C makes it plain.
- **Not built, and still needed before a run can file:** the labels `chore` and `dependabot` (section 6).

## 11. As built: the daily alert sweep (PR C)

Built as section 2 lists it, with these points decided or found while building. Each is also in the header of the file it concerns, and in `PROVENANCE.md`, "Sweeps".

- **The `overrides` text is reduced to the top-level form**, the second of the two outcomes section 5 allows. Measured on 2026-11-21 with Bun 1.3.14, the version CI pins, in scratch projects with `ajv` 8.17.1 and its dependency `fast-uri`: a nested entry (`"ajv": {"fast-uri": "3.0.1"}`) left `fast-uri` at 3.1.9, with the warning "Bun currently does not support nested "overrides""; a top-level entry (`"fast-uri": "3.0.1"`) was applied; and a top-level entry beside a direct dependency on `fast-uri` `^3.0.3` was accepted, exit 0, and decided the version (3.0.1). npm refuses that last one with `EOVERRIDE`, which is why the source reaches for the nested form. **So `scopedOverrideExample` and `overrideAncestors` are removed, where section 2 lists `overrideAncestors` among the functions carried over unchanged**: both exist only to build a parent-scoped example, and the pinned Bun ignores one.
- **The source's "manifest is gone" case is removed with edit 5.** It cleared an issue when the file the alert named was missing. With a fixed list there is no such file to miss, and this repository's own `bun.lock` being absent is a broken checkout, not a fixed alert.
- **Comments are read from the REST comments listing**, every page, where the source uses `gh issue view --json comments`. The REST answer states each author's account type, which the author check needs; it is how the source's upstream watch reads comments.
- **The author check is the monthly sweep's**: the two labels `chore` and `dependabot`, and the REST account type `Bot` (section 10).
- **Addition A3 does fire here.** A run can make several writes, and `main` takes the writer as its fourth parameter. The tests pass one that does not wait.
- **Reads are checked before they are acted on**, applied from the monthly sweep's review, from the review model's test cases for this one and from its audit of the pull request. The alert listing: each entry must be an object in the state `open` that states its package, ecosystem, manifest, advisory, vulnerable range and patched version (or `null` for none yet), because the source's grouping has a default for each that turns a missing field into an answer ("not npm", "every version", "no patch yet"); the package, the advisory id and the patched version must be free of the characters the markers are split on, or the next run could not read its own marker back; and no alert may be listed twice. The issue listing and each comment listing: no pages at all throws, and so does an entry that is not an object or does not state its author's login and account type; an issue entry must state its labels as a list of named labels. Not checked, and rendered as the listing gives them: an alert's severity, summary, scope and URL, none of which decides anything. An issue of the sweep's own must have a positive integer number and state its body; a comment of its own must state its body. A readable answer about the security-updates setting must say `enabled` as true or false: the source read an empty answer as "still off".
- **An npm bump the run could not check ends the run red.** Section 3 says an unknown manifest or an unreadable lockfile is `indeterminate`: logged, and the issue left alone. That is kept, every other bump is still processed, and then the run fails naming the ones it could not check; a locked copy whose version is not a semver version (a git or file source) counts as a third such case. The source ends such a run green. Here there is one lockfile, and the manifest path of an alert on this repository is only inferred (section 5), so a green run could be a sweep that skipped every alert there is. An alert that is not npm is still logged with the run green, as section 5 says.
- **`semver` is declared as the source declares it**: `^7.8.5`, in `devDependencies`. The range resolves to the 7.8.6 the lockfile already held. **Observed while rewriting `bun.lock` with Bun 1.3.14:** the rewrite also dropped `libc` from ten entries and `hasInstallScript` from one, fields that version does not write, so the lockfile it replaced was last written by another Bun. No version or integrity hash changed. A frozen install exits 0 with Bun 1.3.14 and with Bun 1.4.4 and leaves the file unchanged (measured on macOS). `docs/quality-gate.md`, "Installs and the lockfile", lists "whether the pinned Bun accepts a version-1 lock that a newer Bun has edited in place" as not measured; this is one measurement of it.
- **The review model's test cases.** A tests round on `cca0638` returned eight. All eight failed on that commit. Seven are met by fixes; one, which asks that a 403 other than an authorization refusal stop the run at the setting lookup, is not met and is kept in the suite as written, marked as an open item, with a proposed amendment beside it: the refusal text a job token gets on that endpoint has not been measured, and matching on a guessed text could make every scheduled run fail at its first call.
- **E7 as built:** the note under "Dependency updates are issue-driven" says both sweeps are here. The marker under "The upstream watch is the third sweep" stays.
- **E5 as built:** the sweep's filing path is shown by its tests only. No alert was open on this repository when this was written, so the first scheduled run is expected to read an empty listing, file nothing and end green; it will also be the first evidence that a job token with `vulnerability-alerts: read` can read the alerts.
- **Not built, and still needed before a run can file:** the labels `chore` and `dependabot` (section 6).
