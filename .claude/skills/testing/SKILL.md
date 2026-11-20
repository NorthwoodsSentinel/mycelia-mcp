---
name: testing
description: "Add, place, run and fix tests in this repo. Use when writing a test and choosing where it goes and which runner picks it up; when a test run says no test files found for a file that exists; when a new test must be added to Vitest's include list or to test:scripts; when running one test file or one test by name; when testing a tool or a Mycelia API call without the network; or when deciding which run exercises a change."
disable-model-invocation: false
---

# Testing

In this repo: adapted from the MCP Inspector's `testing` skill (`modelcontextprotocol/inspector` at commit d330df96). The record is in `PROVENANCE.md`, under "Knowledge skills". The rules (every change has tests, 90 per file on all four dimensions, keep a test file's exact name, `retry` unset, suppress expected error output) are in [`AGENTS.md`](../../../AGENTS.md), "Always test new or modified code". This skill covers where a test goes, which runner picks it up, how to run it, and **what a green result proves**.

## Two runners, two explicit lists

| Runner | Runs | How a file gets in | A green result proves |
| --- | --- | --- | --- |
| **Vitest** (`vitest run --coverage`, the second half of `npm run test`) | The tests of `src/` | **Only if named** in `test.include` in `vitest.config.ts`: a list of paths, not a glob | The listed files ran and every file in `src/` cleared the coverage bar |
| **node --test** (`npm run test:scripts`, the first half of `npm run test`) | The tests of the guards under `scripts/` | **Only if named** in the `test:scripts` script in `package.json` | The named files ran |

`npm run test` runs both, in that order. The lists are explicit on purpose: a renamed test file then fails the run instead of being skipped.

### What catches a missing list entry, and what does not

- **`test:scripts` is guarded.** One of its own tests ("test:scripts names every tracked test file under scripts/", in `scripts/verify-skills.main.test.mjs`) fails when a tracked `*.test.mjs` under `scripts/` is not named. ⚠️ It reads **tracked** files: a test you have not `git add`ed is invisible to it.
- **Vitest's `include` is not guarded.** A `src/<name>.test.ts` that is missing from the list is simply not run, and nothing says so. The coverage bar catches it only when the code under test drops below 90 without it. **Add the `include` entry in the same change as the file, and look for the file's name in the run's output before calling it tested.**

## Where a new test goes

| The test exercises… | It goes… | And is added to |
| --- | --- | --- |
| A tool, or anything in `src/index.ts` | `src/index.test.ts` | nothing: the file is already listed |
| A Mycelia API call, or anything in `src/mycelia-client.ts` | `src/mycelia-client.test.ts` | nothing |
| A new module in `src/` | beside it, `src/<name>.test.ts` | `test.include` in `vitest.config.ts` |
| A guard or helper under `scripts/` | beside it, `scripts/<name>.test.mjs` (or `scripts/lib/`) | `test:scripts` in `package.json` |
| The server end to end, through a real client | not a unit test: a case in the smoke (`/client-smoke`, and `/project-structure` for the case table) | `CASES` in `scripts/smoke-inspector.mjs` |

Keep the exact filename (`*.test.ts`, `*.test.mjs`).

## Testing without the network

Nothing a test does leaves the machine. The two source files are tested in two different ways, and a new test follows the file it sits in:

- **`src/index.test.ts` drives the real server with a real MCP client** over the SDK's in-memory transport, with every client method spied. A case asserts which method a tool call reached and with which arguments, and what came back as content. Use it for anything about tools: a schema, the routing, an error result. A new client method needs a spy in `fakeClient`, or a call to it would try the network.
- **`src/mycelia-client.test.ts` replaces `fetch` with a recorder.** A case asserts the request the client built (method, URL, headers, body) and how it read the reply. Use it for anything about HTTP: a path, a guard on an id or a limit, a timeout, a non-JSON reply.

A test that expects an error printed to the console suppresses it (`AGENTS.md`); `src/index.test.ts` shows the way with a spy on `console.error`.

## Running one file, or one test

```sh
npx vitest run src/index.test.ts                     # one file; it must be in the include list
npx vitest run src/index.test.ts -t "unknown tool"   # only the tests whose name matches
node --test scripts/lib/main-module.test.mjs         # one guard's tests
```

A file passed to `vitest run` that is not in `include` is **not run**: Vitest prints `No test files found`, shows the include list, and exits 1. The fix is the `include` entry, not a different command.

These one-file runs do not measure coverage. Coverage comes from the full `npm run test`.

## The coverage gate

`npm run test` ends with Vitest's V8 coverage over `src/**/*.ts`, **90 per file on lines, statements, functions and branches**, test files excluded.

- **A source file no test loads is measured at 0 and fails.** A new module in `src/` needs tests in the same change.
- **A module outside `src/` is not measured at all** (`AGENTS.md`). Keep source in `src/`.
- **The guards under `scripts/` are not in the coverage gate.** They are tested by their own `node --test` suites, and not measured.
- A genuinely unreachable branch gets a justified ignore annotation at the source (`AGENTS.md`), never a lowered bar.

## Which run exercises a change

- **inner loop:** the one-file commands above;
- **before committing:** `npm run format`, then `npm run validate` (both runners with coverage, plus the guards, the format check, lint and the typecheck);
- **before pushing:** `npm run local:gate`, which adds the sign-off check, the skill validator and the smoke. `validate` alone is not an acceptable substitute (`AGENTS.md`).

**The unit tests and the smoke prove different things.** The unit tests spy on the client or replace `fetch`, so they pass when the server and the SDK no longer fit together. The smoke starts the real server and drives it through the pinned Inspector. A change to a tool, to the transport or to the SDK version is not exercised until the smoke has run.
