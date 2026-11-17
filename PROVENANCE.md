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
| `package.json` `verify:skills:cli`, `skills:eval`; `local:gate` | Inspector `package.json` scripts of the same names | — | `verify:skills:cli` sits after `local:dco` and before `smoke`. `test:scripts` stays an explicit list and gains the four new test files. |
| `.github/workflows/main.yml` gate line | Inspector `main.yml` step "Validate the skills with the authoritative CLI (#2163)" | — | A stage of the one gate line (the CI line is `local:gate` minus `local:dco`), not a separate step. |
| `scripts/verify-skills.mjs` `checkWiring`, test | Servers: the source's two `verify:skills:cli` links (`local:gate`, CI) | — | Restored beside this repo's links. Added here: `checkEvalNotWired`, which fails if anything `validate`, `local:gate` or a CI step runs reaches `skills:eval` or `skill-eval.mjs`. |
| `scripts/entry-points.test.mjs` | Written here | — | Two cases for `verify-skills-cli.mjs` through the symlinked checkout, with a stub `claude` on PATH that reports the pin: one where the validator passes, one where it rejects. |
