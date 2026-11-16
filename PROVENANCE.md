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
| `scripts/smoke-inspector.mjs`, test | Inspector `docs/cli-smoke-testing.md`, `scripts/smoke-cli.mjs`; Servers `scripts/smoke-servers.mjs`, `.claude/skills/client-smoke/SKILL.md` | The Inspector CLI pinned at 2.15.0 with its registry integrity checked; stdio only; a fake Mycelia API on 127.0.0.1; an environment allowlist; process-group kills. |
| `.claude/skills/client-smoke/`     | Servers `.claude/skills/client-smoke/`                                         | Adapted to this server's one target and its fake upstream; the web UI and LLM-client paths left out.                                             |
| `vitest.config.ts`                 | Inspector `clients/launcher/vitest.config.ts` (thresholds)                     | Test files named by path; coverage over `src/**/*.ts`; 90 on all four, per file.                                                                  |
| `eslint.config.js`                 | Inspector `eslint.config.js`                                                   | One TypeScript scope; `no-floating-promises` at `error`; `--max-warnings 0`.                                                                      |

## Changes to the server's own code

- `src/index.ts`: `TOOLS`, `asContent`, `createServer`, `main` and `fatal`
  are exported, and the server starts only when the file is run as the
  program (`import.meta.main`), so the tests can import it. `main()` takes
  its transport as a parameter, defaulting to stdio. What the server does
  when started is unchanged.
- `src/*.ts`: reformatted by Prettier; no other change.
