---
name: project-structure
description: "Decide where code belongs in this server and which files a change touches. Use when adding a new MCP tool or a call to a new Mycelia API endpoint; when deciding whether code goes in the tool file or the HTTP client file; when changing a tool's input schema versus what it does; when placing a new script, gate check or helper; or when working out everything a new tool has to touch before the gate passes."
user-invocable: false
disable-model-invocation: false
---

# Project structure

In this repo: adapted from the MCP Inspector's `project-structure` skill (`modelcontextprotocol/inspector` at commit d330df96). The record is in `PROVENANCE.md`, under "Knowledge skills". The Inspector is several clients over a shared `core/`. This repo is **one package with two source files**. The rules are in [`AGENTS.md`](../../../AGENTS.md); this skill is the map.

Every TypeScript, JavaScript and workflow file here starts with a header comment saying what it is for and why. **Read that header** rather than looking for a second copy of the reasoning here. A JSON file cannot carry one: what a skill's `evals/evals.json` is for is in `AGENTS.md`, "Maintaining the skills", rule 3.

## The server: two files

| File | Owns |
| --- | --- |
| `src/index.ts` | **The MCP side.** `TOOLS`: each tool's name, description and input schema. `createServer()`: answers `tools/list` from `TOOLS`, and answers `tools/call` with a `switch` on the tool name that hands the arguments to one client method and wraps the reply as text content; an unknown tool name, or anything the client throws, comes back as an `isError` result. `main()`: builds the client from the environment and connects stdio. The entry check at the bottom starts the server only when the file is run as the program. No HTTP here |
| `src/mycelia-client.ts` | **The Mycelia side.** `MyceliaClient`: its configuration from the environment (`fromEnv`), one private `request()` that every call goes through (the bearer header, the timeout, a typed error for a transport failure or a non-JSON reply), and one public method per API call. The guards live here: `assertSafeId` on every id that reaches a URL path, `boundLimit` on every list limit. No MCP types here |

**A tool is three parts in two files**: its entry in `TOOLS`, its `case` in the `switch`, and the client method the case calls. With only the first, the tool is listed and answers "unknown tool". With only the last two, it works and no client can see it.

**Which side a piece of code belongs on:** what a tool is called, what arguments it takes and how its result is shaped are the MCP side. What URL is built, what is sent, how the reply is read, and every check on a value before it reaches the network are the Mycelia side. A check that lives in `src/index.ts` protects one tool; the same check in the client protects every caller of that method.

## What a new tool touches

| # | Where | What |
| --- | --- | --- |
| 1 | `src/mycelia-client.ts` | The method. An id that goes into the path passes through `assertSafeId`; a list limit through `boundLimit` |
| 2 | `src/index.ts` | The `TOOLS` entry and the `case` |
| 3 | `src/mycelia-client.test.ts` | The request the method builds, and how it reads the reply |
| 4 | `src/index.test.ts` | That a call to the tool reaches the method with those arguments. Add the method to the spies in `fakeClient` |
| 5 | `scripts/smoke-inspector.mjs` | A `call(...)` entry in `CASES`, and a route in `fakeReply` when the method calls a path the fake does not serve yet. The smoke compares the server's `tools/list` with the case table **both ways**, so a listed tool with no case fails it |
| 6 | The tool count and the tool table | `README.md` (the table under "What this is", and "the eight tools"), the first paragraph of `AGENTS.md`, and the header comment of `src/index.ts` |

**What the gate does and does not check about this list.** `npm run validate` typechecks rows 1 and 2, runs whatever tests rows 3 and 4 hold, and holds each source file to 90 coverage. It does **not** check that a new tool has a test: a small addition can leave both files above the bar with rows 3 and 4 never written, and the run stays green. Those two rows are yours to write and a reviewer's to look for. `npm run smoke` does check row 5, in one direction that matters: a listed tool with no case fails it. Row 6 is checked by nothing; it is on this list because it is the one that gets forgotten.

A change to **what an existing tool does** is usually row 1 and row 3. A change to **its schema or description** is row 2, and row 5 too when a required argument changes, because the smoke's case passes arguments.

## Everything else

| Path | Holds |
| --- | --- |
| `scripts/` | The gate's guards, run with `node`: `verify-install-fresh`, `verify-action-pins`, `verify-skills`, `verify-skills-cli`, `verify-format-coverage`, `verify-typecheck-coverage`, `verify-coverage-scope`, `dco-check`, `smoke-inspector`, each with a `*.test.mjs`; and two suites of attack cases, `inventory-attack.test.mjs` and `coverage-attack.test.mjs`. What each checks is `docs/quality-gate.md`. Also `skill-eval`, the **manual** eval runner (`npm run skills:eval`), never part of the gate or CI, with its stubbed test. And the three helpers `pr-flow` runs, each with a test and none a gate stage: `gate-run` (the gate, and the commit its result belongs to), `handoff-check` (the hand-off reads, against one head) and `audit-verdict` (the reading of a review round's verdict); `lib/gh.mjs` holds their `gh` calls. `entry-points.test.mjs` checks that every guard reports a verdict when the checkout is reached through a symlink, and that each helper prints its deciding line |
| `scripts/lib/` | Helpers the guards share (the skill manifest, npm-script parsing, the Claude CLI runner, main-module detection, Windows shell arguments, the workflow scan, the `bun.lock` reader, the tracked-TypeScript inventory), each with its test |
| `docs/` | Guides (`skill-authoring.md`, `quality-gate.md`) and the design note for the gate guards |
| `.claude/skills/` | The procedures (the index is in `AGENTS.md`) |
| `.github/workflows/` | `main.yml` (the gate in CI), `dco.yml` (sign-off on a pull request's commits) and `codeql.yml` (CodeQL code scanning, on pushes to `main`, pull requests into it and a weekly schedule) |
| `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md` | The public issue forms and the PR template |
| `AGENTS.md`, `CLAUDE.md` | The rules, and the one-line pointer that loads them |
| `PROVENANCE.md` | Where each adopted file and rule came from, and what was edited |
| `KINTSUGI.md` | The append-only ledger of marked repairs |
| `CONTRIBUTING.md`, `SECURITY.md` | The public contribution and vulnerability-reporting policies |

There is no `test/` folder, no build output that is committed, and no second package.

## Where a new file goes

| It is… | It goes in |
| --- | --- |
| A new tool, or a change to one | the two source files (above) |
| A call to a Mycelia endpoint this server does not use yet | a method in `src/mycelia-client.ts`; nothing else builds a URL |
| A new source module | `src/`. Coverage measures `src/**/*.ts`; a TypeScript module anywhere else fails `npm run test`, which names it (`AGENTS.md`) |
| A test of source code | beside it, `src/<name>.test.ts`, **and** in the `include` list (`/testing`) |
| A gate guard or a build helper run with Node | `scripts/<name>.mjs` + `scripts/<name>.test.mjs`, **and** in `test:scripts` (`/testing`) |
| Logic two guards share | `scripts/lib/` |
| A procedure | `.claude/skills/<name>/SKILL.md` with `evals/evals.json`, and its row in the `AGENTS.md` index |

Which runner picks up a new test file, and the list it must be added to, are in `/testing`. Installing and running are in `/local-dev`.
