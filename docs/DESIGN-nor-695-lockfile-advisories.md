# DESIGN: NOR-695: the daily sweep also checks the lock file

Status: design, reviewed by the review model in two rounds before any code was written (section 10), then corrected in two places before the build (section 11). Where section 11 differs from a sentence above it, section 11 is the design.
Parent: NOR-673, whose design note (`docs/DESIGN-nor-673-sweeps.md`) recorded what this closes as its first accepted limitation and referred it to the owner. The owner was asked "Should the daily sweep also read mycelia-mcp's lock file?" and answered yes on 2026-11-22.
Target: a branch cut at `3eda5c9`, this repository's `main` when this was written.

This is an addition of this repository's, wanted for a security reason. The sweep it extends was adapted from the MCP Inspector's (`modelcontextprotocol/inspector`, commit `7df76f6eea9ea425891289333837878ebb31ae6a`), and the source's sweep has no such step. Its header, kept in `scripts/dependabot-alerts.mjs`, names a release-time `npm audit` report as its own partial second signal (Read).

Words used below. **Measured**: run for this design on 2026-11-22 (UTC), on macOS arm64, with Bun 1.3.14 (the version CI pins, installed from the `bun` npm package into a scratch directory), Node 26.12.1, npm 11.20.0 and `gh` 2.91.0, against an export of `main` at `3eda5c9` installed with `bun install --frozen-lockfile --ignore-scripts` (exit 0, "248 packages installed", `bun.lock` unchanged by its sha256). CI runs Ubuntu and Node 22.x; nothing below was run there. **Read**: read in the named file at that commit. **Reported**: stated by a named source and not re-checked. **INFERRED** and **UNKNOWN** say so.

## 1. Outcome, and the evidence that shows it is done

**The gap, measured.** `bun.lock` holds 284 entries: 271 package names at 279 distinct name-and-version pairs. `package.json` declares 12 of those names; 259 are not declared. GitHub's dependency graph for this repository holds the declared ones only (`docs/DESIGN-nor-673-sweeps.md`, section 5). On the design day the repository had 0 Dependabot alerts in any state and 0 open issues labelled `dependabot`, and the daily sweep had not yet run. Asked about the same lock file on the same day, two advisory sources each named the same 8 advisories, on 3 packages that `package.json` does not declare: `hono` (5), `@hono/node-server` (2) and `minimatch` (1), seven of moderate severity and one low. So the first accepted limitation was not a hypothetical: on the design day it hid eight known advisories. **That was true when this was written and is not true now.** Pull request 22, merged on 2026-11-22, moved the three packages out of range. Re-measured on `main` at `0124fd7` the same day: 283 entries, 278 pairs, and no locked version in range of any advisory that has not been withdrawn.

**Outcome.** A package version locked in `bun.lock` that is in range of a GitHub-reviewed advisory that has not been withdrawn and has a patched version gets one GitHub issue from the daily job, whether or not GitHub's dependency graph holds the package. A run that could not read the lock file or the advisory source files nothing, edits nothing, clears nothing and ends red.

**Evidence, reasoned back from that outcome:**

| # | Evidence | How it is read |
| --- | --- | --- |
| E1 | The new helper, its test and the sweep's edit are on `main`, with a `PROVENANCE.md` row saying they were written here | `git ls-tree origin/main`; the row |
| E2 | `npm run local:gate` exits 0 at the pull request's head, and CI is green on it | `npm run gate:run`; the checks on the head |
| E3 | With a fake `gh`: an advisory on a package the manifest does not declare produces exactly one `gh issue create`, whose marker says `manifest=bun.lock`; a second run with the same answers makes no write | The sweep's tests |
| E4 | With a fake `gh`: a (package, advisory) pair that an open or a dismissed Dependabot alert already names produces no second issue from the lock file | The sweep's tests |
| E5 | With a fake `gh` and a prepared `bun.lock`: every failed read of section 4 throws with **zero** write calls recorded. One case each: `gh` exits non-zero; no pages; an entry that is not an object; an entry without a usable advisory id, type, `withdrawn_at` or `vulnerabilities`; a range `semver` cannot read; a patched version that is not a version; the control advisory missing; a lock file that will not parse; a lock entry whose name or version cannot be checked | The helper's tests and the sweep's tests |
| E6 | The review model's attack cases for this change are in the suite, unchanged | The attack-case file; its header |
| E7 | A targeted probe in the pull request body: the reader run by hand at the head against the real endpoint, writing nothing, with its findings beside `bun audit`'s for the same lock file | The two listings, with the head they ran against |
| E8 | `AGENTS.md` ("Dependency updates are issue-driven") and the workflow's header no longer say that an advisory on a transitive package is reported by no sweep | The diff |

**What only the first scheduled runs can show:**

- That the job's own token is accepted by `GET /advisories`. It is INFERRED from the measurements in section 3: the endpoint answered a request with no token at all.
- The same reads on Linux, Node 22 and the `gh` the runner image carries.
- That the issues are filed by `github-actions[bot]` with the three labels, and that the next run finds them again and files no second one.
- The run's duration against the job's provisional 5-minute timeout (NOR-686). The three advisory reads took 2.2 seconds together when measured.

On the design day the first run would have filed three issues: `hono` to 4.13.16, `@hono/node-server` to 2.1.6 and `minimatch` to 11.0.1. With the lock file as it is on `main` since pull request 22, the first run finds nothing in range and files nothing. Either is a measurement of one day, not the expected result; the run is judged against the state it read (the rule E4 and E5 of the parent design follow).

## 2. What is added, and what it reuses

Small on purpose. One new file with its test, one edit to the sweep, and the records.

| Piece | What it is |
| --- | --- |
| `scripts/lib/lock-advisories.mjs` (new), with `scripts/lib/lock-advisories.test.mjs` joined to `test:scripts` | The lock file check: the list of name-and-version pairs from the parsed lock file; the split into queries; the read of each answer; every check of section 4; and the conversion of an advisory that applies into a record of the shape the alert listing gives |
| `scripts/dependabot-alerts.mjs`, one more numbered edit in its header | `main` reads the lock file and the advisory source with its other reads, before any write; drops what a Dependabot alert already covers; hands the remaining records, together with the alerts, to the grouping it already has. The issue text says where an advisory was found |
| A listing of dismissed alerts, in the same script | One more read of this repository's alerts (section 4, step 3) |
| The sweep's two test files, and a new file for the review model's cases | Cases for E3 to E6 |
| `.github/workflows/dependabot-alerts.yml` | Its header comment only ("What it cannot see"). No line that runs changes: not the triggers, the `concurrency` block, the permissions, the steps or the timeout |
| `AGENTS.md`, `PROVENANCE.md`, the `project-structure` skill, and a pointer from the parent design's first accepted limitation | The records (E1, E8) |

**Reused unchanged:** `scripts/lib/bun-lock.mjs` (the lock file reader), `gh` and `ghPaginatedList` from `scripts/lib/gh.mjs`, `scripts/lib/sweep-author.mjs` (a marker is trusted only on what the automation wrote), `scripts/lib/paced-writes.mjs` (one second between issue writes), `scripts/lib/markdown-cell.mjs`, and in the sweep: `groupAlerts`, `lockfileEntries`, `narrowToApplicable`, `remediation`, the two markers, the title, "comment first, then the marker", the reconciliation of an issue whose advisory has left the feed, and "never closes an issue, never opens a pull request".

**That the existing functions can carry it was measured**, with a scratch script that writes nothing: it read the lock file with `parseBunLock`, asked the recommended source in three queries, built alert-shaped records with `manifest_path` `bun.lock`, and handed them to the sweep's own `groupAlerts`, `lockfileEntries`, `narrowToApplicable` and `buildIssueTitle` as they are on `main`. Result: 12 advisories returned, 2 of them withdrawn, 8 records that apply, 3 groups, and three titles of the form ``chore(deps): bump `hono` to `4.13.16` in `bun.lock` (5 advisories)``, each with the locked copy that is in range (for `minimatch`, the nested 10.2.6 and not the hoisted 11.0.8). `bun.lock` is already one of the two manifest names the sweep knows (`KNOWN_MANIFESTS`).

## 3. Which advisory source

Seven candidates. Five were measured; the commands are given so each can be run again. `<pairs>` stands for the 279 name-and-version pairs, comma-separated (6,079 characters; 7,501 once percent-encoded).

| Candidate | New secret | Where the dependency list goes | What it returns for a known advisory | How it fails | Can an empty answer be told from "none"? |
| --- | --- | --- | --- | --- | --- |
| **A. GitHub's advisory listing**, `gh api "advisories?ecosystem=npm&affects=<pairs>"`, with the job's token | None. A request with no token was answered 200; the authenticated answer's `X-Accepted-OAuth-Scopes` header is empty | GitHub, which hosts this public repository and its `bun.lock` | One object per advisory with `ghsa_id`, `cve_id`, `severity`, `summary`, `type`, `withdrawn_at`, and per package a `vulnerable_version_range` and a `first_patched_version` | Unreachable: `gh` exit 1. Too long a URL: HTTP 414, exit 1. Both non-zero | Not from the answer alone: a name that does not exist gives `[[]]`, exit 0. With a control pair in each query, yes (section 4) |
| B. `bun audit --json`, the pinned Bun's own command | None | The npm registry (`POST /-/npm/v1/security/advisories/bulk`), which the install step already contacts for every package | Per package name a list of `{id, url, title, severity, vulnerable_versions, cwe, cvss}`. **No patched version, and no advisory id field**: the GHSA is inside `url` | Exit 1 for "advisories found" **and** for a failed request. Exit 0 for none **and** for an empty answer | No: a 200 with an empty body gives exit 0 and prints a line break |
| C. The registry's bulk endpoint, called directly | None | The npm registry | The same objects as B | An HTTP status | A package with nothing known is left out of the object, as is a name that does not exist |
| D. `npm audit --json` | None | n/a | Nothing: exit 1, `ENOLOCK`, "This command requires an existing lockfile" | n/a | n/a |
| E. OSV (`POST https://api.osv.dev/v1/querybatch`) | None | A third party | Advisory ids and a modification time only; a second request per advisory for anything else | Not measured | A name that does not exist gives `{}`, as does a package with nothing known |
| F. GitHub's dependency submission API: upload the lock file's packages so Dependabot raises the alerts itself | None, but the job needs `contents: write` (Reported: GitHub's guide to the API shows that grant in its workflow examples) | GitHub | Not measured: a submission changes what GitHub holds for the repository | Not measured | Not measured |
| G. GitHub's GraphQL `securityVulnerabilities`, one lookup per package name | None | GitHub | Not measured: A answers for every pair in one to three requests | Not measured | Not measured |

**Measured, candidate A.**

- One query with all 279 pairs: exit 0, one page, 9 advisories, 54 KB, under one second. Its cost is one request: `X-RateLimit-Used` on the `core` resource read 12 before and 14 after, with one probe request beside it.
- The known example, `gh api -X GET advisories -f ecosystem=npm -f per_page=100 -f affects=minimist@0.0.8`: three advisories. `GHSA-xvch-5gv4-984h`, critical, lists two ranges for `minimist`, `< 0.2.4` fixed in `0.2.4` and `>= 1.0.0, < 1.2.6` fixed in `1.2.6`. `GHSA-vh95-rmgr-6w4m`, medium. And `GHSA-7fhm-mqm4-2wp7`, whose `withdrawn_at` is a date in 2020.
- **Withdrawn advisories are in the answer.** Of the 9 for this lock file, one (on `picomatch`, high) was withdrawn on 2026-11-18. The other 8 are the 8 that `bun audit` names, by GHSA id.
- It answers for the exact version: `affects=hono@4.13.16` gives 0 advisories, `affects=hono@4.13.15` gives 5.
- The answer is paged by a cursor (`Link: …&after=…; rel="next"`).
- Failures: through a proxy that refuses the connection, `gh api --paginate --slurp` exits 1 and prints `[]`. With 1,001 pairs (10,901 characters) GitHub answers HTTP 414, "Request-URL that is too long", exit 1. So one query for the whole lock file works today at 7,501 encoded characters and stops working somewhere below 10,901. The queries are therefore split (section 4).
- GitHub's page for the endpoint (Reported, through a page-summarising fetch on 2026-11-22): "If specified, only return advisories that affect any of package or package@version"; "A maximum of 1000 packages can be specified"; by default only GitHub-reviewed advisories that are not malware are returned; `per_page` is at most 100. The page read does not say which token the endpoint needs.

**Measured, candidate B.**

- The command exists at 1.3.14 with three flags (`--json`, `--audit-level`, `--ignore`). On this repository: exit 1, 8 advisories on 3 packages. It gives the same output with `node_modules` moved aside, so it reads the lock file.
- Pointed at a local stand-in for the registry (`BUN_CONFIG_REGISTRY`), it sent one `POST /-/npm/v1/security/advisories/bulk`, a gzip body `{name: [versions]}` with 271 names and 279 versions, and no `Authorization` header. Those are the counts `scripts/lib/bun-lock.mjs` gives for the same file, so the two readers agree on what is locked.
- What it does with each answer from the stand-in:

  | The registry answers | Exit | Standard output |
  | --- | --- | --- |
  | 200, `{}` | 0 | `{}` |
  | 200, an empty body | **0** | a line break |
  | 500 | 1 | nothing |
  | 429 | 1 | nothing |
  | 200, JSON cut short | 1 | the cut-short text |
  | 200, HTML | 1 | the HTML |
  | 200, `[]` | 1 | `[]`, and no message |
  | the connection closed | 1 | nothing |

**Recommendation: candidate A.** Two measurements decided it.

1. **Its answer carries the patched version and the advisory id as fields, in the words the alert path already reads.** The sweep files one issue per bump, grouped by package and first patched version, and remembers by GHSA id what it has announced. With A the dry run of section 2 produced those issues from the sweep's unchanged functions. B and C give neither field, so they could say "this package has an advisory" and not "move it to this version".
2. **Its failures have their own exit code.** With B, exit 1 is both "advisories found" and "the request failed", and an empty answer from the registry is exit 0. Every one of those would have to be told apart by parsing what was printed.

A also needs no secret, no new permission, no new program on the runner and no new host: the job already talks to `api.github.com` through `gh`. Its two weaknesses are handled in section 4: an empty answer looks like "nothing found" (the control pair), and withdrawn advisories are returned (the `withdrawn_at` check).

F is the platform's own mechanism and would make the existing alert path cover every package with no advisory query at all. It is not recommended, because it needs a write grant on the repository's contents, which turns the job's upper bound (section 6) from "its issues" into "its code". It is named in section 9 for the owner.

## 4. What a run does

It runs **inside the existing daily job and inside the existing script**: one job, one token, one `concurrency` group, one set of labels, one issue format. The lock file check is a second source of the same records the sweep already handles.

**The reads, in order, all before the first write.** A failure in any of them throws; nothing has been written, every issue is as it was, and the job is red. The next scheduled run is the retry.

1. The security-updates setting (unchanged).
2. The open Dependabot alerts (unchanged).
3. **New: the dismissed Dependabot alerts** (`repos/<o>/<r>/dependabot/alerts?state=dismissed,auto_dismissed&per_page=100`, every page, through `gh api --paginate --slurp`; measured on this repository: `[[]]`, exit 0). Each entry must be an object in one of those two states that names its package, its ecosystem and its advisory id; anything else throws. Its only use is the rule "the alert path wins" below.
4. **New: `bun.lock`**, read once through `scripts/lib/bun-lock.mjs`, which throws on a file that is missing, will not parse, is a lock file version it does not know, or holds an entry whose key and name disagree. Then every entry is checked: its name must be an npm package name (lower-case letters, digits, `.`, `_`, `-`, with an optional `@scope/`), and its version must be a `semver` version. **An entry that fails either check stops the run here.** A copy that is not a registry version (a git or file source) cannot be asked about, and a run that skipped it would be green having not checked it. On the design day all 284 entries pass.
5. **New: the advisory source.** The pairs are sorted and split into queries of at most 100 pairs and at most 4,000 percent-encoded characters of `affects` value: three queries today, of 100, 100 and 79 pairs (measured). Each is `advisories?ecosystem=npm&per_page=100&affects=<value>`, with **one** `affects` parameter whose value is the pairs joined by commas (section 11 says why it must be one), read to the last page through `ghPaginatedList`, which throws on a non-zero exit, on an answer that is not a list of pages, and on no pages at all.
6. The open issues labelled `dependabot` (unchanged), and each comment listing just before the one comment it guards (unchanged).

**The checks on each answer of step 5.** Every one throws; none skips an entry.

- Each entry is an object whose `ghsa_id` matches `GHSA-xxxx-xxxx-xxxx` (lower-case letters and digits), whose `type` is `reviewed`, whose `withdrawn_at` is present and is `null` or a string, whose `severity` and `summary` are strings, whose `cve_id` is a string or `null`, and whose `vulnerabilities` is a non-empty list of objects, each stating a `package` with a string `ecosystem` and `name`, a string `vulnerable_version_range`, and a `first_patched_version` that is present and is a string or `null`.
- No advisory id twice in one query's answer. (The same advisory in two queries' answers is expected, and is taken once.)
- For a vulnerability whose ecosystem is `npm` and whose package name is in the lock file: the range must be one `semver` reads (after the sweep's existing `toSemverRange`, and not empty), and the patched version must be a `semver` version or `null`. This is the check the alert path makes on an npm alert, for the same reason: `semver` answers "does not satisfy" for a range it cannot read, which would read as "not exposed".
- **The control pairs** (two since section 11, which is the rule; this is its reason). Every query's `affects` value also carries pairs that are known to be in range of a long-standing advisory, and the answer must hold those advisories. An answer that leaves out an advisory known to apply cannot be read as "nothing found". This is what tells an empty answer from "no advisories" (measured: a name that does not exist gives `[[]]`, exit 0, and the control advisory is in the answer when its pair is added).

**From answers to records.** A withdrawn advisory is dropped. For each remaining advisory, each of its vulnerabilities that is `npm`, names a package in the lock file, and whose range some locked version of that package satisfies becomes one record in the shape the alert listing gives: `state` `open`, the package, ecosystem `npm`, `manifest_path` **`bun.lock`**, the advisory id, CVE id, severity and summary, the range, the patched version, and a link built from the checked id (`https://github.com/advisories/<ghsa_id>`; no URL is taken from the answer). The scope is written as "not determined": whether a package serves the running server or only the tooling is not computed (section 9). A record with no patched version is logged by name and files nothing, as an alert with none does today.

**A package reported by both paths: the alert path wins.** A record from the lock file is dropped when a Dependabot alert, open (step 2) or dismissed (step 3), names the same npm package and the same advisory id.

- An open alert means the alert path files or keeps that issue, and it already lists every locked copy in range, nested ones included (`lockfileEntries`).
- A dismissed alert is a person's decision about that advisory on that package. Without step 3 the lock file check would file it again the next day and undo the dismissal.
- An alert in the state `fixed` does **not** cover a record. GitHub calls an alert fixed from the manifest it reads; a nested copy that is still in range is exactly what this addition exists to report.

**What it writes.** The remaining records join the open alerts, and from there the run is the existing one: grouping by package, manifest and patched version; the re-check of each range against the locked copies; one issue per bump, labelled `factory`, `chore` and `dependabot`, with the marker as its first line; a comment for an advisory that joins an open issue; every write through the one-second pacer. So an issue from the lock file has the marker `<!-- dependabot-alerts: pkg=…; manifest=bun.lock; fixed=…; ghsas=… -->`, and the next run finds it by that marker on an issue the automation wrote. Three small differences in its text:

- its first sentence says the advisories were found by checking `bun.lock` against GitHub's advisory database and that no Dependabot alert exists for them;
- each advisory links to its advisory page (a Dependabot alert links to the alert);
- the fix it names is the top-level `overrides` entry or the raised range, chosen by the existing `remediation` from which copies are in range.

**When an advisory leaves the answer** (the lock file moved out of range, the advisory was withdrawn, or a Dependabot alert now covers it), the existing reconciliation rewrites that issue's body to its cleared form and keeps the marker. The cleared sentence for an issue whose marker says `bun.lock` names those three causes without choosing one. The issue is not closed: that stays a person's call, as in the source.

**When a read fails.** Stated once more, because it is the rule this change was reviewed against: a run that could not read the lock file, could not reach the advisory source, got an answer that fails any check above, or did not find the control advisory, throws before the first write. It never clears or rewrites an issue, and it ends red. One consequence for the alert path: today an unreadable `bun.lock` is found when the first alert needs it, each bump is logged as not checked and the run then fails; with this change the same lock file stops the run at step 4. Either way nothing is written and the run is red.

## 5. Permissions and secrets

**Nothing changes.** The job keeps `contents: read`, `issues: write` and `vulnerability-alerts: read`, and holds only its own `GITHUB_TOKEN`. No `permissions:` line, no secret, no action and no step is added.

- The dismissed-alert listing is the endpoint the job already reads, with another `state` value; `vulnerability-alerts: read` covers it.
- `GET /advisories` is public data. Measured: answered 200 with no token; with a token, `X-Accepted-OAuth-Scopes` is empty. That a job token is accepted is INFERRED; the first run shows it (section 1). If it were refused, the run would be red at step 5 with nothing written.
- The only new outbound request goes to `api.github.com`, the host of every other call the job makes. What it carries is the list of package names and versions in a file this public repository already publishes.
- Cost: three requests a run today, on the `core` resource. The hourly limit of a job token was not read for this design.

## 6. Threat model, with its upper bound

**Subject.** The one daily job of a public repository, on a schedule or a manual dispatch, holding a `GITHUB_TOKEN` with `issues: write` and `vulnerability-alerts: read`. No other secret. No model runs in it.

**Upper bound: the worst case if every control below failed and an attacker held the job's token.** Unchanged from the parent design, because this change adds no permission, no secret and no host: the attacker could create, edit, close, lock, label and comment on any issue here and read this repository's Dependabot alerts. The attacker could not push, merge, change a workflow or a setting, read another secret, reach another repository, or publish anything outside the issue tracker.

**The worst a wrong or hostile advisory answer can do without the token:** an issue that names an advisory that does not apply; an advisory that applies and is not reported; or an open issue's body rewritten to its cleared form until the next run. It cannot run anything, name a path, close an issue or reach anything but this repository's issues.

**Untrusted text in this change:** every package name and version in `bun.lock`, and every field of every advisory answer. What stops it steering the job or being executed:

1. **No shell, as today.** Every `gh` call is `spawnSync` with an argument array.
2. **A value from the lock file is checked before it reaches `gh`** (section 4, step 4): a name outside the npm pattern or a version that is not a version stops the run. So no pair can hold a comma, an ampersand, an equals sign, a space, a brace or a leading dash.
3. **The pairs travel percent-encoded inside the path of a GET**, never as a `-F` field. `gh api -F` reads a file when a value starts with `@` (Read: `gh api --help`), and every scoped package name starts with `@`. Encoding also means no character of a name can end the value, add a parameter, or stand as one of the `{owner}`-style placeholders `gh` fills in.
4. **The path begins with a constant** (`advisories?…`), so nothing from the lock file can be read as an option.
5. **Every field of an answer that decides anything is checked first**, and a failed check throws (section 4): the id that goes into the marker and the link; the type; `withdrawn_at`; the range and the patched version, which are used as `semver`.
6. **No URL from an answer is used.** The link is built from the checked id.
7. **Fields that decide nothing are data.** Severity, summary and CVE id are written into a table through the existing cell escape.
8. **The source's own matching is not trusted to include.** A record is made only when a locked version satisfies the range, by `semver`, here; and the sweep's existing narrowing checks again before an issue is filed.
9. **The source's silence is not trusted either**, as far as the control pairs in each query can show (section 7 says how far that is).
10. **A marker is trusted only on what the automation wrote**, pacing, and the `concurrency` group: unchanged.
11. **No dependency code runs, and no new program**: `bun audit` is not used; the install stays `--frozen-lockfile --ignore-scripts`.

**Out of scope, stated plainly.** A compromise of GitHub, of its advisory database, of the runner image or of the `gh` binary on it. A harmful change merged by the owner, a harmful `bun.lock` included. Markdown that renders inside an issue (a link or an `@mention` carried in an advisory summary), as in the parent design.

## 7. Accepted limitations and settled decisions

**Settled before this design.**

1. The daily sweep also reads this repository's lock file: the owner's yes of 2026-11-22.
2. Findings are filed as GitHub issues by the workflow, and a sweep issue may say in public that this repository is in range of a named public advisory before the fix (`docs/DESIGN-nor-673-sweeps.md`, section 5, settled decisions 1 and 2; `AGENTS.md`, "Dependency updates are issue-driven").
3. No stored secret. The sweeps were built to hold none.
4. An addition beyond the source is made only where marked, with its reason. This note is one such addition; inside it, the dismissed-alert listing and the control pair are marked as parts the design needs.

**Accepted limitations.**

- **An issue from the lock file is cleared by absence**, as an issue from an alert is: an advisory that is no longer in the answer is taken as no longer applying. The answers are checked for shape, and each must hold the control advisory. That shows the source answered the question for one pair in that query. It does not show the answer is whole, and the endpoint gives no total to check against. The bound on a wrong clear is the parent design's: one open issue's body says "no longer applicable" until the next daily run, which finds the advisory, matches the issue by the marker the cleared body keeps, and rewrites it. The sweep never closes an issue.
- **A lock-file issue that a person closes while its advisory still applies is filed again by the next run.** The sweep lists open issues only, as the source does. For an alert there is a lever, dismissing the alert; a package GitHub's graph does not hold has no alert to dismiss. Until the owner chooses a way to dismiss one (section 9), an advisory he has decided to live with keeps its issue open.
- **An advisory with no patched version files nothing**; it is logged by name in a green run. That is the alert path's rule too ("an issue asking for an unavailable upgrade is noise").
- **Only what GitHub has reviewed for npm is asked about.** Malware advisories and unreviewed ones are separate types of the same endpoint and are not queried.
- **The lock file is checked, not the installed tree.** It holds 284 entries where an install on one platform puts down 248, so an advisory on a package built for another platform is reported too.
- **A lock entry that is not a registry version stops every run** until the change that introduced it says how it is to be checked. There is none today.
- **An outage of the advisory endpoint stops the alert path for that run as well**, since all reads come before the first write. Alerts are not minute-sensitive (the source's reason for a daily schedule).
- **A package that moves from "not declared" to "declared" while still in range** gets a new issue from its Dependabot alert, and its lock-file issue is rewritten to the cleared form: one live issue, one cleared.
- **The query split is sized from two measurements**, 7,501 encoded characters accepted and 10,901 refused. 4,000 is a budget below the first, not a known limit.
- That the job token is accepted by the advisory endpoint is INFERRED until the first run. Nothing here was run on Linux, on Node 22 or with the runner's `gh`.
- **The job's timeout stays the provisional 5 minutes** until it is re-sized from scheduled runs (NOR-686), as the parent design left it. `AGENTS.md` asks for a value sized from observed runs, and there is none to observe: the workflow had no run of any kind on the design day (Measured: `gh run list --workflow dependabot-alerts.yml` gave an empty list), and a run of the changed job cannot be observed before the change is on `main`. What this addition adds to a run was measured where it could be, on the design machine: 2.2 seconds for the three advisory reads together and 0.44 seconds for the listing of dismissed alerts (an empty one); each issue it files adds one write and a one-second pause. How long a write takes on the runner was not measured. So the addition's reads come to about three seconds, and the first run, with three issues to file, adds three writes and two pauses to a job whose other steps are a checkout, two tool set-ups and an install. A run the timeout did stop between two writes would be the case the sweep's write order is already built for ("comment first, then the marker"): the next run reads the issues and comments again before it writes anything. **The re-sizing under NOR-686 has to be made from runs that include this addition.**
- Nothing reports a sweep that stopped running. That is the parent design's too.

**Not read.** GitHub's pages were taken through a page-summarising fetch, not from the raw pages. The source's two sweep test files were not re-read for this note. Which `gh` version the runner image carries is UNKNOWN.

## 8. Owner's hands (one block)

**None.** Verified by reading this repository's API on 2026-11-22 (Measured):

| Thing | Required | Today | The owner does |
| --- | --- | --- | --- |
| Labels `factory`, `chore`, `dependabot` | Exist | All three exist (12 labels in the listing) | Nothing |
| Secrets | None | 0 configured | Nothing |
| Dependabot alerts | Enabled | On (`GET …/vulnerability-alerts` → 204) | Nothing. Leave it on |
| Dependabot security updates | Disabled | Off (`{"enabled":false,"paused":false}`) | Nothing. Leave it off |
| Job permissions, workflow triggers | Unchanged | n/a | Nothing |

Merging the pull request that builds this is the owner's, as always. With the lock file as it is on `main` since pull request 22, the first run files nothing (section 1).

## 9. Not proposed

Each would be an addition beyond what the security reason needs. One line each.

- A way to dismiss a lock-file advisory (a closed "not planned" issue that keeps suppressing it, as `AGENTS.md` rules for the upstream watch, or a committed ignore list): the owner's decision; until then the issue stays open.
- GitHub's dependency submission API in place of the advisory query: it needs `contents: write` on the job.
- Malware and unreviewed advisories; an issue for an advisory with no patched version; a severity threshold.
- Runtime or development scope for a package found in the lock file, which needs a walk of the lock file's dependency graph.
- A second advisory source as a cross-check in the job (`bun audit` agreed with candidate A on the design day; it is used in the pull request's probe, E7, and not in the job).
- A change to the monthly sweep, a pull request that makes the fix, a watchdog for a sweep that stopped, and a pin of the runner's `gh`.

## 10. Design review

By the review model, before any code. Each round's verdict and findings are recorded here with what was done about each. A finding is the reviewer's report until it is reproduced.

- **Round d1 (`2928433`): fail, 1 finding.** The round returned a review. It said "The approach can work" and "The advisory-query architecture is workable", called candidate A "the best of the seven evaluated choices", called candidate F "correctly rejected" for its `contents: write`, and reported no way for untrusted text to reach `gh` as an option, a file, a placeholder or a path, no failed read ending clean, and no second issue from the two paths. The files to be written were marked not reviewed, because they do not exist yet.
  1. MEDIUM, the job's 5-minute timeout is provisional, while `AGENTS.md` requires a value sized from observed runs, and the addition gives the job more to do; a run stopped by the timeout would be a false failure and could stop between two writes: **answered, not fixed** (section 7, the timeout item, rewritten for this). It is the parent design's finding, raised there in both of its rounds and answered there the same way: no run of the workflow exists to size from (re-measured for this note: an empty run list), and none of the changed job can exist before the change is merged. What could be measured is now stated: the addition's reads took about three seconds, and each issue adds a write and a one-second pause. A run stopped between writes is what the existing write order already allows for. Nothing in the finding is a security point or shows the design would not work. The re-sizing stays with NOR-686, which must use runs that include this addition.
- **Round d2 (`e7d5700`): fail, 1 finding.** The round returned a review. It repeated the first round's judgments: "Can the approach work? Yes. No replacement mechanism is required"; candidate A "is the best evaluated choice under the settled constraints"; no route at design level from untrusted text to execution, a file, a `gh` option, a placeholder or a forged marker; the both-paths rule "is sufficient in the design"; no permission beyond what the job uses. It listed nothing as out of the stated scope. It marked the files to be written as not reviewed.
  1. MEDIUM, the same finding: the answer above "explains the violation but does not resolve it", because the rule in `AGENTS.md` has no exception for a workflow that has not run, and deferring to NOR-686 does not make this change meet it: **explicitly answered; not fixed; there is no third round.** What the reviewer says of the rule is right, and it is true of the job as it is on `main` today: this change does not touch the timeout line and does not make the job meet the rule. It is not a security point and does not show the design would not work. Two things bound it. The time this change adds is stated as measured (section 7). And the order of work can close most of it: the existing job is scheduled daily at 06:17 UTC, so once those runs exist the timeout can be sized from them under NOR-686 before the pull request that builds this is merged, and checked again from the first runs that include this addition. Whether the build waits for that re-sizing is the owner's decision when the build is taken up; the finding stays open until NOR-686 is done.

**Where the design stands after two rounds.** Both rounds returned a review and both verdicts were fail, each on the one timeout finding. No finding was raised against the choice of advisory source, the order of reads, the checks, the both-paths rule, the permissions or the threat model. Nothing in section 2 was built when the rounds ended.

## 11. Design corrections after review

Two corrections, made after the two rounds and before the build. Both tighten the design; neither changes the source, the permissions or the threat model. They were not sent back for a third design round: the review of the built change reads them.

**Correction 1: the query carries ONE `affects` parameter.** The pairs are joined by commas into a single value, and that value is percent-encoded as a whole: `advisories?ecosystem=npm&per_page=100&affects=a%401.0.0%2Cb%402.0.0`. Repeating the parameter looks equivalent and is not: the endpoint keeps only the last one. Measured on 2026-11-22 with two pairs that each have advisories, `minimist@0.0.8` and `lodash@4.17.20`:

| Request | Advisories returned |
| --- | --- |
| `affects=minimist@0.0.8,lodash@4.17.20` (one parameter) | 8: both packages' |
| `affects=minimist@0.0.8&affects=lodash@4.17.20` (repeated) | 5: `lodash`'s only |
| `affects=lodash@4.17.20&affects=minimist@0.0.8` (repeated, other order) | 3: `minimist`'s only |

A query built the repeated way would ask about one pair in a hundred and report the rest clean, with exit 0. The measurements of section 3 all used the one-parameter form, so they stand. A test pins it: the path built for two pairs holds exactly one `affects=`. The control pairs below would also catch it at run time, because their advisories would be missing from the answer.

**Correction 2: two control pairs, and what each outcome means.** Section 4 had one control pair and a red run if its advisory was ever withdrawn. Every query now carries two pairs that are known to be in range of an advisory, on two unrelated packages:

| Control pair | Advisory | Published | Range it is in |
| --- | --- | --- | --- |
| `minimist@0.0.8` | `GHSA-xvch-5gv4-984h` | 2022-03-18 | `< 0.2.4` |
| `lodash@4.17.20` | `GHSA-35jh-r3h4-6jhm` | 2021-05-06 | `< 4.17.21` |

Both were read from the endpoint on 2026-11-22: reviewed, not withdrawn. For each query's answer, each control is in one of three states:

- **good**: its advisory is in the answer, is not withdrawn, and lists a range for the control's package that the control's version satisfies;
- **stale**: its advisory is in the answer, but is marked withdrawn or no longer lists such a range;
- **absent**: its advisory is not in the answer at all.

What the run does:

| The two controls are | The read | The run |
| --- | --- | --- |
| both good | stands | carries on |
| either one absent | **failed** | stops before any write: no issue is filed, edited or cleared, and the job is red |
| both stale | **failed** | the same: nothing is left to vouch for the answer |
| one good, one stale | stands, on the good one | does all its work, then ends red naming the control to replace |

Why absent is a failed read even when the other control is good: a withdrawn advisory stays in the listing with its `withdrawn_at` date (measured: advisories withdrawn in 2020 and 2021 are still returned), so a control that is missing altogether was left out by the answer, and an answer that leaves out one advisory known to apply may have left out others. Why one stale control does not stop the work: the other still shows the query was answered, and stopping would blind the sweep for a reason that has nothing to do with this repository. Why the run is red all the same: a control that needs replacing must not wait in a log nobody reads until the second one goes too.

A control is an ordinary pair to the rest of the run. Its advisory becomes a record only if the lock file itself holds that package at a version in range, like any other advisory; nothing is dropped by name.

Each query is at most 100 pairs from the lock file plus the two controls, and its whole `affects` value stays under the 4,000-character budget of section 4.
