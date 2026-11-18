---
name: client-smoke
description: "Drive this repo's MCP server (bun src/index.ts over stdio) with the pinned Inspector CLI against a local fake of the Mycelia API, and read the result. Use when smoke-testing a change to mycelia-mcp; when calling one of its tools from the command line; when choosing a protocol era; when `npm run smoke` fails; or when the Inspector CLI will not connect to, or misreads, the server command."
disable-model-invocation: false
---

# Client smoke

A change to mycelia-mcp is checked against a real client before its PR opens:
the MCP Inspector CLI. This skill is how to run it by hand against this
checkout, and what the output means. `npm run smoke`
(`scripts/smoke-inspector.mjs`) runs the same client over the same target as a
gate stage; this skill is for the request you make yourself, and for reading a
red `smoke`. Where each part came from is in `PROVENANCE.md`.

Copied from the reference servers' `client-smoke` skill
(`modelcontextprotocol/servers` `e1d154ee`) and adapted to this server's one
target. Two of the source's three clients are not used here:

| Client               | Here                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Inspector **CLI**    | **Used.** The scripted path: one request, one JSON result, judged by its exit code                                                         |
| Inspector **web** UI | **Not used.** The source drives it for elicitation, sampling, tasks, notifications and progress. None of this server's tools asks the client for anything |
| An **LLM client**    | **Left out**: it spends model calls, which is the owner's to approve                                                                       |

There is no build step. Bun runs the TypeScript source, so every command below
runs your working tree as it is.

**Never point a smoke at the real Mycelia API or give it a real key.** The
server is a client of that API; a smoke runs it against a fake on 127.0.0.1
with a placeholder token. A result from it is a **local** result.

## The fake Mycelia API

`npm run smoke` starts one itself. By hand, start the same fake from the smoke
script's own export, so the routes and replies are the ones the gate uses:

```sh
node -e '
  import("./scripts/smoke-inspector.mjs").then(async (m) => {
    const fake = await m.startFakeMycelia();
    console.log(fake.url);
  });
' &
FAKE_PID=$!
# It prints its URL, http://127.0.0.1:<port>. Stop it with: kill "$FAKE_PID"
```

It answers every route the client uses (`GET /v1/requests`, `GET
/v1/requests/<id>`, `POST /v1/requests`, `POST .../claims`, `POST
.../responses`, `POST /v1/responses/<id>/ratings`, `GET /v1/feed`), tags each
reply with the route it matched in a top-level `fake` field, answers
`/v1/requests/smoke-nonjson` with an HTML 502, and refuses (401) any request
without the placeholder token `SMOKE_AGENT.key` from the script.

## The Inspector CLI

```sh
npx --yes @modelcontextprotocol/inspector@2.16.0 --cli <server command> <inspector options>
```

It starts the server command over stdio, sends one request, prints the result
and exits. Always name the exact version: 2.16.0 is the pin `npm run smoke`
uses, and the reason for it (every earlier 2.x release is inside a published
advisory) is beside `INSPECTOR_VERSION` in `scripts/smoke-inspector.mjs`.
Change the pin there, not here. `--cli --help` is the reference for the
options.

Run the examples in `bash` or `sh`. zsh does not split an unquoted `$INSPECT`
into words, so there the whole string is taken as one command name ("no such
file or directory").

```sh
INSPECT="npx --yes @modelcontextprotocol/inspector@2.16.0 --cli"
FAKE=http://127.0.0.1:<port>          # the URL the fake printed

# Keep the Inspector off your real state (see Environment).
S=$(mktemp -d)
export MCP_STORAGE_DIR="$S/inspector" \
  MCP_INSPECTOR_OAUTH_STATE_PATH="$S/inspector/oauth.json" \
  MCP_INSPECTOR_SECRET_STORE=memory MCP_AUTO_OPEN_ENABLED=false
ENV="-e MYCELIA_MCP_AGENT_NAME=SMOKE -e MYCELIA_PERSONAL_AGENT_ID_SMOKE=smoke-agent \
  -e MYCELIA_PERSONAL_KEY_SMOKE=smoke-placeholder-not-a-credential \
  -e MYCELIA_PERSONAL_API_BASE=$FAKE"

# Connect only, then list
$INSPECT bun src/index.ts $ENV --method initialize --format json --protocol-era legacy
$INSPECT bun src/index.ts $ENV --method tools/list --format json --protocol-era legacy
# → the eight mycelia_* tools

# Call a tool. Pass arguments as JSON: --tool-args-json is passed verbatim
$INSPECT bun src/index.ts $ENV \
  --method tools/call --tool-name mycelia_feed \
  --tool-args-json '{"limit":5}' --format json --protocol-era legacy
# → {"result":{"content":[{"type":"text","text":"{ \"ok\": true, \"fake\": \"GET /v1/feed\", … }"}]}}   exit 0

# Schema portability: exit 6 on a schema error
$INSPECT bun src/index.ts $ENV --method tools/list --strict --format json --protocol-era legacy
```

**The server command comes first and the Inspector's options after it.** An
option placed before the command is read as the command, and the CLI then
complains that a method is required.

`--format json` prints a result as one JSON object, `{"result": …}`, on
**stdout**, and a failure as `{"error": …}` on **stderr**. The server's own
stderr passes through on stderr too. So capture stdout alone for the result,
never `2>&1` into the same parse, and read the error envelope from the **last**
stderr line.

## Environment

The Inspector passes the spawned server only the SDK's safelist of variables
(`HOME`, `PATH`, and a few more), so the server's own variables go on the
command line with `-e`, never through an `export`. Point the Inspector's OAuth
state at a scratch directory with **both** `MCP_STORAGE_DIR` and
`MCP_INSPECTOR_OAUTH_STATE_PATH` (the first alone is not isolation), and use
the memory secret store so nothing touches your keychain. `npm run smoke` goes
further: every child sees only an allowlist of variables, and HOME is a
scratch directory (`baseEnv` in the script says why each one is there).

## Exit codes

| What happened                      | stdout                                       | stderr (last line)                          | Exit |
| ---------------------------------- | -------------------------------------------- | ------------------------------------------- | ---- |
| Success                            | `{"result": …}`                              |                                             | 0    |
| Any other failure                  |                                              | `{"error":{"code":"error", …}}`             | 1    |
| Server unreachable or did not start |                                             | `{"error":{"code":"unreachable", …}}`       | 4    |
| The tool returned `isError: true`  | `{"result": {…, "isError": true}}`           | `{"error":{"code":"tool_is_error", …}}`     | 5    |
| No such tool                       |                                              | `{"error":{"code":"tool_not_found", …}}`    | 5    |
| `--strict`: a schema problem       |                                              | `{"error":{"code":"schema_unportable", …}}` | 6    |

The table is the Inspector's (`clients/cli/README.md`, "Exit codes & error
envelopes"), cut to the rows a smoke of this server can produce. A refusal is
asserted as **exactly 5 with its envelope code**, so a crash (1) or an
unreachable server (4) does not pass for one.

`npm run smoke` runs these refusals; the table of cases is `CASES` in
`scripts/smoke-inspector.mjs`:

- a path-traversal `request_id` (`tool_is_error`: the client's id guard throws
  before any request is sent),
- a generic write (`write_file`), which is not a tool (`tool_not_found`).

An upstream failure is **not** a refusal: a non-JSON reply from the API comes
back as a successful call whose result is `{"ok": false, "error": {"code":
"HTTP_502_NON_JSON", …}}`, exit 0.

## Protocol eras

The Inspector connects in one of three eras, chosen with `--protocol-era`:

| Era                    | What the Inspector does                                     |
| ---------------------- | ----------------------------------------------------------- |
| `legacy` (the default) | A plain `initialize`. Negotiates 2025-11-25 or older        |
| `modern`               | Pins 2026-07-28 through `server/discover`, with no fallback |
| `auto`                 | Probes `server/discover`, and falls back to `initialize`    |

**This server answers `legacy` only, today.** Its SDK
(`@modelcontextprotocol/sdk` 1.32.2) does not implement `server/discover`, so
`modern` fails at negotiation, exit 1:

```
{"error":{"code":"error","message":"Version negotiation failed: the server did not offer pinned protocol version 2026-07-28 via server/discover (no fallback in pin mode)"}}
```

Run every command with `--protocol-era legacy` and expect success. `npm run
smoke` runs the modern era too and reports it without letting it fail the gate
(`MODERN_ERA_GATES` in `scripts/smoke-inspector.mjs`). When the modern era
starts answering, that flag turns on and both eras gate, as they do in the
source. Do not use `auto` for evidence: it does not say which era answered.

## What to write down

For each request: the command, the era, that the target was local (stdio,
against the fake), the exit code, and the result trimmed to what shows the
change. For a bug fix, run the same command against `main` and against the
branch, and keep both outputs. A green `npm run smoke` is the gate's record;
it does not replace the request that shows your change.
