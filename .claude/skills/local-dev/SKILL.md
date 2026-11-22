---
name: local-dev
description: "Install and run this server on your own machine, and change what it depends on. Use when setting the repo up in a fresh clone or a new git worktree; when asking whether a code change needs a rebuild before running again; when choosing which Bun version to use so results match CI; when bun install --frozen-lockfile fails; when pointing an MCP host at a local copy; or when adding, bumping or pinning a dependency."
disable-model-invocation: false
---

# Local development

In this repo: adapted from the MCP Inspector's `local-dev` skill (`modelcontextprotocol/inspector` at commit d330df96). The record is in `PROVENANCE.md`, under "Knowledge skills". The Inspector has several clients, a root install that cascades into each, a build per client and a shared-code alias. This repo is **one package with no build step**, so most of the source skill does not apply and what remains is short. The rules are in [`AGENTS.md`](../../../AGENTS.md), "Development setup" and "Dependency placement".

## Install

```sh
bun install --frozen-lockfile
```

It needs only this repo and the npm registry. `--frozen-lockfile` fails rather than rewriting `bun.lock`. **Read the error before acting on it.** A lockfile error (the lockfile would change) means `bun.lock` and `package.json` disagree: fix that in a change of its own. A registry, network, integrity, permission or Bun-version error is something else, and changing the lockfile is not the fix.

**Which Bun, which Node.** `package.json` declares neither. CI states its versions once, in `.github/workflows/main.yml`: Bun `CI_BUN_VERSION` (1.3.14 when this was written) and Node 22. Use that Bun when a local result has to match CI's. A change to `bun.lock` must be made with that Bun (see "Dependencies"). Node is needed as well as Bun: the guards under `scripts/` and their tests run with `node`, and the smoke and the skill validator run through `npx`.

⚠️ **A new git worktree has no `node_modules`.** Run the install in each worktree before the first `npm run` there; without it the first gate stage, `verify:install-fresh`, fails naming the missing packages and `bun install --frozen-lockfile`.

## Run the server

```sh
bun src/index.ts        # or: npm start
```

**There is no build.** Bun runs the TypeScript directly, so a code change needs no rebuild: stop the process and start it again. An MCP host that launched the server keeps the old process until the host restarts it.

The server reads its whole configuration from the environment when it starts, and exits at once with `mycelia-mcp fatal:` when a value is missing:

| Variable | Is |
| --- | --- |
| `MYCELIA_MCP_AGENT_NAME` | Which agent identity this process is. Upper-cased, it is the `<NAME>` in the next two |
| `MYCELIA_PERSONAL_AGENT_ID_<NAME>` | That agent's id |
| `MYCELIA_PERSONAL_KEY_<NAME>` | That agent's bearer token. **A real one is a secret and the owner's** (`AGENTS.md`); it is never written into a file in this repo, a test, a command in a pull request or a ticket |
| `MYCELIA_PERSONAL_API_BASE` | The Mycelia API's base URL |
| `MYCELIA_ENV_FILE` (optional) | A key file, default `~/.config/fleet/mycelia.env`, or `none` to switch it off. If the file exists, this agent's key is read from it and wins over the inherited one; if it exists and is unusable, the server refuses to start (`README.md`, "A rotated key"). **The file holds a real key: never read it, print it or copy it.** Tests run with it switched off (`vitest.config.ts`) |

**To try a change without a real key or the real API, do not start the server by hand: use `/client-smoke`.** It drives the server over stdio with the pinned Inspector against a fake Mycelia API on 127.0.0.1, with invented values for all four variables. `npm run smoke` is the same thing run as a gate stage.

**To try a change from an MCP host**, register the working copy with the host as `README.md` describes ("Registering with Claude Code"), with the command pointing at this checkout's `src/index.ts`. That uses a real identity, so it is the owner's to do or to hand over.

## Dependencies

- **One `package.json`.** There is no second install, so a dependency is declared once.
- **`dependencies` vs `devDependencies` follows from runtime consumption.** What `src/` imports when the server runs is a `dependency`: today that is the MCP SDK and nothing else. Lint, format, typecheck and test tooling is a `devDependency`, and so is a package only a script under `scripts/` imports (`yaml`, for the guards; `semver`, for the daily alert sweep). A package the server imports at run time and that sits in `devDependencies` passes every local check, because a development install has both, and breaks for whoever installs the package without them.
- **Pins that move together.** `vitest` and `@vitest/coverage-v8` are pinned to the same exact version; bump both in one change, or the tests run on one version while the coverage provider was built against another. `prettier` is pinned exactly so the format check gives one verdict everywhere.
- **Pin a transitive dependency with an `overrides` entry, never `npm audit fix`** (`AGENTS.md`). `audit fix` resolves an advisory that has no upward escape by silently downgrading; an `overrides` entry moves the one package and nothing else. Write the entry at the top level of `overrides`: the pinned Bun ignores a nested (parent-scoped) one with a warning, and applies a top-level one to every copy, a direct dependency of the same name included (measured with Bun 1.3.14, 2026-11-21). Drop the entry once no consumer's range admits the vulnerable versions.
- **A bump is issue-driven** (`AGENTS.md`): a ticket, then the change through `/pr-flow`. After a bump run the full `npm run local:gate`, not `validate` alone: the smoke drives the real server through the SDK and catches a break the unit tests, which spy on the client, do not.
- **The lockfile is `bun.lock`**, committed. Change it only by changing `package.json` and running `bun install` **with the Bun version CI pins** (`CI_BUN_VERSION` in `.github/workflows/main.yml`), and commit both together. A newer Bun can write a lockfile the pinned one refuses in a frozen install, so CI can then fail at its install step. `bun install --frozen-lockfile` never rewrites the lockfile and is safe on any Bun version. The measurement is in `docs/quality-gate.md`, "Installs and the lockfile".

## What is not here

Things the source skill covers that this repo does not have, so that their absence is not read as an omission: a build or a bundler, a client to choose between, a shared-code alias, bundler externals, a published-tarball check. If one of those arrives, this skill is where its procedure goes.
