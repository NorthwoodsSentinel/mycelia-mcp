#!/usr/bin/env node
/**
 * The Inspector smoke: drive this server with the pinned MCP Inspector CLI,
 * through `npx`, over stdio, and judge every request by the CLI's exit code.
 *
 *   node scripts/smoke-inspector.mjs     # or: npm run smoke
 *
 * What it runs:
 *
 *   - `initialize` (the connect-only probe; the first line of a smoke job),
 *   - `tools/list`, which must name exactly the tools the case table calls,
 *     and `tools/list --strict` (schema portability; exit 6 on an error),
 *   - one `tools/call` per tool, each answered by a fake Mycelia API this
 *     script serves on 127.0.0.1 (below): the call's result must carry the
 *     route tag the fake put in its reply, so a reply from anywhere else, or
 *     from the wrong route, fails,
 *   - an upstream that answers with non-JSON (the client's typed error),
 *   - the refusal cases: a path-traversal id and a tool that does not exist
 *     (a generic write). A refusal must exit exactly 5 with the expected
 *     error-envelope code, so a crash (1) or an unreachable server (4) does
 *     not pass as one.
 *
 * Protocol eras: every case runs with `--protocol-era legacy` (2025-11-25),
 * and that era gates. Every case runs again with `--protocol-era modern`
 * (2026-07-28) and is reported, but does not fail the run while
 * MODERN_ERA_GATES is false (see its comment). `auto` is never used: it does
 * not say which era answered.
 *
 * The form is copied from the MCP Inspector's own guidance and the reference
 * servers' boot smoke, both by Cliff Hall (record: PROVENANCE.md):
 *
 *   - modelcontextprotocol/inspector d330df96, docs/cli-smoke-testing.md: an
 *     exact pin with `npx --yes` (a range is not a pin; the prompt would hang
 *     an unattended job), `--method initialize` first, `--format json` with
 *     stdout parsed alone and never merged with stderr, the exit code as the
 *     verdict, the error envelope read from the LAST stderr line, a refusal
 *     asserted as exactly 5, a bounded `--connect-timeout`, `--strict`, and
 *     both OAuth state variables pointed at a scratch directory (section 6:
 *     MCP_STORAGE_DIR alone is not isolation).
 *   - the same commit, scripts/smoke-cli.mjs: MCP_INSPECTOR_SECRET_STORE=memory
 *     and an empty MCP_OAUTH_CALLBACK_URL, so the run does not depend on the
 *     host's keychain or on an ambient callback URL.
 *   - modelcontextprotocol/servers e1d154ee, .claude/skills/client-smoke/
 *     SKILL.md: the server command first and the Inspector's options after it,
 *     the server's environment passed with `-e` (the spawned server gets only
 *     the SDK's safelist), the exit-code table, and both eras run explicitly.
 *   - the same commit, scripts/smoke-servers.mjs: the shape of this file. A
 *     hand-written case table with a completeness check (there a server
 *     directory with no entry; here a listed tool with no call), every target
 *     reported before the exit code, and servers given nothing outside the
 *     machine and none of the user's files.
 *
 * Where this departs from those, and why:
 *
 *   - The Inspector is run through `npx`, not the SDK client the servers'
 *     smoke uses: the Inspector is the client under test, and `npx` is the
 *     source's runner for its tools.
 *   - The pinned package's registry integrity is checked against the value
 *     recorded here before anything runs. npm verifies the tarball it fetches
 *     against that registry value, so a republished or substituted 2.15.0
 *     fails here rather than running.
 *   - This server is a client of the Mycelia HTTP API, so the smoke serves a
 *     fake of that API on 127.0.0.1 (an OS-chosen port) and points the server
 *     at it with placeholder credentials. Nothing leaves the machine, and the
 *     fake refuses a request without the placeholder bearer token, so the
 *     credential path is exercised too.
 *   - Stdio only: the server has no HTTP transport.
 *   - Every child runs in its own process group and the whole group is killed
 *     when its run ends or times out, so a server the Inspector spawned cannot
 *     outlive it.
 *
 * The environment is an ALLOWLIST: npx, the Inspector and the server see only
 * the variables `baseEnv` names, each with its reason beside it, plus the ones
 * this script sets. Nothing else inherited reaches them: no token, no
 * NODE_OPTIONS, no proxy, no npm_config_ override, no real MYCELIA_ variable.
 * HOME is a scratch directory, so `~/.npmrc` and other dotfiles are not read
 * either.
 *
 * Accepted limitation: the smoke trusts the tools on the machine. `node`,
 * `npm`, `npx` and `bun` are found through the inherited PATH, as is npm's
 * global config, so whoever controls PATH or the Node installation can
 * replace what runs and forge every verdict, the integrity check included.
 *
 * Every target is local: `bun src/index.ts` over stdio, talking to the fake
 * on 127.0.0.1. Nothing here runs against a deployed Mycelia API.
 */

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./lib/main-module.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The pinned Inspector. 2.15.0 is the only release outside the vulnerable
 * range of every advisory the Inspector repository had published when this
 * was written (read 2026-11-15 with `gh api
 * repos/modelcontextprotocol/inspector/security-advisories`): 2.0.0-2.11.0
 * are in GHSA-q978-78c7-phqw, GHSA-vcc9-3xgm-p9v4 and GHSA-m5pj-3536-3xcp
 * (fixed 2.12.0); 2.12.0-2.13.0 in GHSA-h9j8-vj8g-v3gg,
 * GHSA-rwv7-mh2c-ff2p and GHSA-2fw8-7jmw-r937 (fixed 2.14.0); 2.14.0 in
 * GHSA-fvg8-f358-w2c8, GHSA-5572-x678-xmv8, GHSA-9w48-x22j-rrm7 and
 * GHSA-pp85-586h-2m95 (fixed 2.15.0). It is also the version of the source
 * clone this form was copied from (d330df96).
 */
export const INSPECTOR_VERSION = "2.15.0";
export const INSPECTOR_PACKAGE = `@modelcontextprotocol/inspector@${INSPECTOR_VERSION}`;
/** `npm view @modelcontextprotocol/inspector@2.15.0 dist.integrity`, 2026-11-15. */
export const INSPECTOR_INTEGRITY =
  "sha512-TWdX2oJNVTan3B0/0YLpVJWbeuuii3cgDnc7uIwAiCQ9q7QMvZuQrapkQXOC2MKsmyNWj0tplWjza3IolBU+wA==";

/**
 * The 2026-07-28 era does not gate yet. It is the newest era the pinned
 * Inspector speaks, and this server's SDK (@modelcontextprotocol/sdk 1.32.2)
 * does not implement `server/discover`, so that era fails at negotiation
 * (measured 2026-11-16: "the server did not offer pinned protocol version
 * 2026-07-28 via server/discover"). Every run still measures and reports it. Turn this on once the reported era passes, and both eras
 * gate, as they do in the source.
 */
export const MODERN_ERA_GATES = false;
export const ERAS = [
  { name: "legacy", protocol: "2025-11-25", gates: true },
  { name: "modern", protocol: "2026-07-28", gates: MODERN_ERA_GATES },
];

/**
 * Budgets, inner strictly smaller than outer. The Inspector's own connect
 * bound sits inside the per-invocation kill timer, so a hung connect is
 * reported by the CLI (exit 4, "unreachable") before this script kills it;
 * the CI job's `timeout-minutes` encloses both.
 */
export const CONNECT_TIMEOUT_MS = 20_000;
export const INVOCATION_TIMEOUT_MS = 60_000;
/** npm's public registry, set explicitly so no config can redirect the fetch. */
export const NPM_REGISTRY = "https://registry.npmjs.org/";

/** Placeholder identity the server is started with; never a real credential. */
export const SMOKE_AGENT = {
  name: "SMOKE",
  id: "smoke-agent",
  key: "smoke-placeholder-not-a-credential",
};
/** The request id the fake's feed reports as created by the smoke agent. */
const REQ = "smoke-req-1";

/**
 * Every request the smoke makes. `args` are the Inspector options after the
 * server target; `exit` is the expected exit code; `error` is the expected
 * error-envelope code on the last stderr line (refusals only); `expect` is a
 * substring the stdout result must contain (refusals only); `result` maps
 * each top-level field of a successful call's parsed result to the value it
 * must hold (read at its location, not found anywhere in the serialized
 * response); `calls` names the tool a case calls, which is what the
 * completeness check counts.
 */
export const CASES = [
  {
    name: "initialize",
    args: ["--method", "initialize"],
    exit: 0,
    expectProtocol: true,
  },
  { name: "tools/list", args: ["--method", "tools/list"], exit: 0, list: true },
  {
    name: "tools/list --strict",
    args: ["--method", "tools/list", "--strict"],
    exit: 0,
  },
  call(
    "mycelia_browse_requests",
    { status: "open", limit: 5 },
    { result: { ok: true, fake: "GET /v1/requests" } },
  ),
  call(
    "mycelia_get_request",
    { request_id: REQ },
    { result: { ok: true, fake: "GET /v1/requests/:id" } },
  ),
  call(
    "mycelia_claim_request",
    { request_id: REQ, estimated_minutes: 5 },
    { result: { ok: true, fake: "POST /v1/requests/:id/claims" } },
  ),
  call(
    "mycelia_respond",
    { request_id: REQ, body: "inspector smoke" },
    { result: { ok: true, fake: "POST /v1/requests/:id/responses" } },
  ),
  call(
    "mycelia_rate_response",
    { response_id: "smoke-resp-1", direction: "up" },
    { result: { ok: true, fake: "POST /v1/responses/:id/ratings" } },
  ),
  call(
    "mycelia_feed",
    { limit: 5 },
    { result: { ok: true, fake: "GET /v1/feed" } },
  ),
  // myOutgoing reads the feed, then fetches each request the agent created:
  // the result is built by the client, so it is checked by its shape.
  call("mycelia_my_outgoing", { limit: 5 }, { result: { ok: true } }),
  call(
    "mycelia_post_request",
    { title: "smoke", body: "inspector smoke" },
    { result: { ok: true, fake: "POST /v1/requests" } },
  ),
  {
    name: "tools/call mycelia_get_request: an upstream non-JSON reply",
    args: callArgs("mycelia_get_request", { request_id: "smoke-nonjson" }),
    exit: 0,
    result: { ok: false },
  },
  // Refusals.
  refusal("mycelia_get_request: a path-traversal id", "mycelia_get_request", {
    request_id: "../../etc/passwd",
  }),
  refusal(
    "write_file: a generic write is not a tool",
    "write_file",
    { path: "/tmp/mycelia-mcp-smoke", content: "x" },
    { error: "tool_not_found", counted: false },
  ),
];

function call(tool, toolArgs, extra = {}) {
  return {
    name: `tools/call ${tool}`,
    calls: tool,
    args: callArgs(tool, toolArgs),
    exit: 0,
    ...extra,
  };
}

function refusal(name, tool, toolArgs, extra = {}) {
  const { counted = true, ...rest } = extra;
  return {
    name,
    calls: counted ? tool : undefined,
    args: callArgs(tool, toolArgs),
    exit: 5,
    error: "tool_is_error",
    ...rest,
  };
}

/** `--tool-args-json`, not `--tool-arg`: passed verbatim, no number coercion. */
function callArgs(tool, toolArgs) {
  return [
    "--method",
    "tools/call",
    "--tool-name",
    tool,
    "--tool-args-json",
    JSON.stringify(toolArgs),
  ];
}

/** The tools the case table calls (refusal-only and fake tools excluded). */
export function calledTools(cases = CASES) {
  return [...new Set(cases.map((c) => c.calls).filter(Boolean))].sort();
}

/**
 * Compare the server's `tools/list` with the case table, both ways: a tool the
 * server lists with no call case is untested, and a case for a tool the
 * server does not list tests nothing. A name listed twice is a problem too:
 * the list must be exactly the called names, each once, not merely
 * contain them.
 *
 * @param {string[]} listed
 * @param {string[]} [called]
 * @returns {string[]} the problems; empty when they agree
 */
export function checkToolCoverage(listed, called = calledTools()) {
  const problems = [];
  const seen = new Set();
  for (const t of listed) {
    if (seen.has(t)) problems.push(`tools/list names \`${t}\` more than once`);
    seen.add(t);
  }
  for (const t of [...listed].sort())
    if (!called.includes(t))
      problems.push(`tools/list names \`${t}\`, which no case calls`);
  for (const t of called)
    if (!listed.includes(t))
      problems.push(`a case calls \`${t}\`, which tools/list does not name`);
  return problems;
}

/**
 * The tool's own result inside a `tools/call` response: the one text content
 * item, parsed as JSON. Text elsewhere in the response (a diagnostic, a
 * second content item) is never read as the result.
 *
 * @param {unknown} response the parsed Inspector stdout
 * @returns {{ value: unknown } | { error: string }}
 */
export function toolResult(response) {
  const result = response?.result;
  if (result?.isError === true)
    return { error: "the call returned isError: true" };
  const content = result?.content;
  if (!Array.isArray(content))
    return { error: "the result has no content array" };
  const texts = content.filter((item) => item?.type === "text");
  if (texts.length !== 1 || typeof texts[0].text !== "string")
    return {
      error: `the result has ${texts.length} text content items, expected 1`,
    };
  try {
    return { value: JSON.parse(texts[0].text) };
  } catch {
    return { error: "the result's text content is not JSON" };
  }
}

/** Last non-empty line of a stream: where the CLI's error envelope lives. */
export function lastLine(text) {
  const lines = text.trim().split("\n");
  return lines[lines.length - 1] ?? "";
}

/**
 * Judge one Inspector run against its case. The exit code is the verdict;
 * the rest only sharpens it.
 *
 * @param {{ exit: number, error?: string, expect?: string, result?: Record<string, unknown>, list?: boolean, expectProtocol?: boolean }} c
 * @param {{ status: number | null, signal?: string | null, stdout: string, stderr: string }} run
 * @param {{ protocol: string }} era
 * @returns {{ ok: boolean, reason: string, listed?: string[] }}
 */
export function judge(c, run, era) {
  if (run.status !== c.exit) {
    const envelope = lastLine(run.stderr);
    const got =
      run.status === null
        ? `killed (${run.signal ?? "no exit code"})`
        : `exit ${run.status}`;
    return {
      ok: false,
      reason: `${got}, expected exit ${c.exit}: ${envelope.slice(0, 300)}`,
    };
  }
  if (c.error !== undefined) {
    let code;
    try {
      code = JSON.parse(lastLine(run.stderr))?.error?.code;
    } catch {
      return {
        ok: false,
        reason: `exit ${run.status}, but the last stderr line is not an error envelope`,
      };
    }
    if (code !== c.error)
      return {
        ok: false,
        reason: `exit ${run.status} with envelope code ${code}, expected ${c.error}`,
      };
  }
  if (c.exit !== 0 && c.expect === undefined)
    return { ok: true, reason: `exit ${run.status}` };
  let parsed;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    return {
      ok: false,
      reason: `exit ${run.status}, but stdout is not one JSON object`,
    };
  }
  if (
    c.expect !== undefined &&
    !run.stdout.includes(JSON.stringify(c.expect).slice(1, -1))
  )
    return { ok: false, reason: `the result does not contain ${c.expect}` };
  if (c.result !== undefined) {
    const got = toolResult(parsed);
    if ("error" in got) return { ok: false, reason: got.error };
    for (const [field, want] of Object.entries(c.result)) {
      const value =
        got.value !== null && typeof got.value === "object"
          ? got.value[field]
          : undefined;
      if (value !== want)
        return {
          ok: false,
          reason: `result.${field} is ${JSON.stringify(value)}, expected ${JSON.stringify(want)}`,
        };
    }
  }
  if (c.expectProtocol && parsed?.result?.protocolVersion !== era.protocol)
    return {
      ok: false,
      reason: `negotiated ${parsed?.result?.protocolVersion}, expected ${era.protocol}`,
    };
  if (c.list) {
    const tools = parsed?.result?.tools;
    if (!Array.isArray(tools))
      return { ok: false, reason: "tools/list has no tools array" };
    const listed = tools.map((t) => t.name);
    const problems = checkToolCoverage(listed);
    if (problems.length > 0)
      return { ok: false, reason: problems.join("; "), listed };
    return { ok: true, reason: `exit 0, ${listed.length} tools`, listed };
  }
  return { ok: true, reason: `exit ${run.status}` };
}

/**
 * The server's own variables: the placeholder identity and the fake API's
 * base URL. They are added to `baseEnv`, so no inherited MYCELIA_ variable
 * (a real key) reaches the server under test.
 */
export function serverEnv(apiBase, agent = SMOKE_AGENT) {
  return {
    MYCELIA_MCP_AGENT_NAME: agent.name,
    [`MYCELIA_PERSONAL_AGENT_ID_${agent.name}`]: agent.id,
    [`MYCELIA_PERSONAL_KEY_${agent.name}`]: agent.key,
    MYCELIA_PERSONAL_API_BASE: apiBase,
  };
}

/**
 * The only inherited environment any child sees, by name. Each entry is here
 * because something in the run needs it; anything not listed is dropped.
 *
 *   PATH                 to find node, npm, npx and bun (trusted: see the
 *                        accepted limitation in the header)
 *   TMPDIR               where Node, npm and Bun put temporary files (on
 *                        macOS a per-user directory; absent on Linux runners)
 *
 * and set, not inherited:
 *
 *   HOME                 a scratch directory: npm and Bun need a writable
 *                        home, and a scratch one means `~/.npmrc` (a registry
 *                        override or a token) and other dotfiles are not read
 *   npm_config_cache     the user's npm cache, npm's default `~/.npm`, so the
 *                        pinned package is fetched once rather than every run;
 *                        the cache is content-addressed and npm checks the
 *                        integrity of what it reads from it
 *   npm_config_registry  the public registry, so no other config redirects it
 *   npm_config_update_notifier  false: no extra registry call, no banner
 *
 * Left out on purpose: LANG and LC_* (nothing judged here depends on locale:
 * JSON and exit codes), USER, SHELL and TERM (nothing needs them).
 *
 * @param {string} home the scratch HOME
 * @param {NodeJS.ProcessEnv} [base]
 * @param {string} [npmCache]
 */
export function baseEnv(
  home,
  base = process.env,
  npmCache = path.join(homedir(), ".npm"),
) {
  const env = {};
  for (const k of ["PATH", "TMPDIR"])
    if (typeof base[k] === "string") env[k] = base[k];
  return {
    ...env,
    HOME: home,
    npm_config_cache: npmCache,
    npm_config_registry: NPM_REGISTRY,
    npm_config_update_notifier: "false",
  };
}

/** The Inspector's own environment: isolated OAuth state, memory secret store. */
export function inspectorEnv(storage, home, base = process.env, npmCache) {
  return {
    ...baseEnv(home, base, npmCache),
    MCP_STORAGE_DIR: storage,
    MCP_INSPECTOR_OAUTH_STATE_PATH: path.join(storage, "oauth.json"),
    MCP_INSPECTOR_SECRET_STORE: "memory",
    MCP_OAUTH_CALLBACK_URL: "",
    MCP_AUTO_OPEN_ENABLED: "false",
  };
}

/**
 * The full Inspector command line for one case: the server command first,
 * `-e` for its environment, then the Inspector's options (client-smoke: an
 * option before the command loses the command).
 */
export function inspectorArgs(c, era, env) {
  const common = [
    ...c.args,
    "--format",
    "json",
    "--protocol-era",
    era.name,
    "--connect-timeout",
    String(CONNECT_TIMEOUT_MS),
  ];
  const head = ["--yes", INSPECTOR_PACKAGE, "--cli"];
  const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  return [...head, "bun", "src/index.ts", ...envArgs, ...common];
}

/** Kill a child's whole process group; a group already gone is fine. */
function killGroup(child, signal) {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // ESRCH: nothing left in the group.
  }
}

/**
 * Run one command in its own process group and collect its output; never
 * rejects. The group is killed with SIGKILL on timeout and again once the
 * command has closed, so nothing it started (the Inspector's stdio server)
 * outlives it.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ env: NodeJS.ProcessEnv, timeoutMs?: number, cwd?: string }} opts
 * @returns {Promise<{ status: number | null, signal: string | null, stdout: string, stderr: string }>}
 */
export function runGroup(command, args, opts) {
  const { env, timeoutMs = INVOCATION_TIMEOUT_MS, cwd = REPO } = opts;
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const killer = setTimeout(() => killGroup(child, "SIGKILL"), timeoutMs);
    child.once("error", (err) => {
      clearTimeout(killer);
      resolve({
        status: null,
        signal: null,
        stdout,
        stderr: `${stderr}\n${err.message}`,
      });
    });
    child.once("close", (status, signal) => {
      clearTimeout(killer);
      killGroup(child, "SIGKILL");
      resolve({ status, signal, stdout, stderr });
    });
  });
}

/**
 * The fake Mycelia API's answer to one request: a status and a JSON body (or
 * a string, sent as is). Every successful reply carries `fake`, the route it
 * matched, which the case table checks. A request without the placeholder
 * bearer token is refused, so the server's credential path is exercised.
 *
 * @param {{ method: string, url: string, authorization?: string }} req
 * @param {typeof SMOKE_AGENT} [agent]
 * @returns {{ status: number, body: unknown }}
 */
export function fakeReply(req, agent = SMOKE_AGENT) {
  if (req.authorization !== `Bearer ${agent.key}`)
    return {
      status: 401,
      body: {
        ok: false,
        error: { code: "UNAUTHORIZED", message: "bad token" },
      },
    };
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  const ok = (fake, data = {}) => ({
    status: 200,
    body: { ok: true, fake, data },
  });
  const route = `${req.method} ${pathname}`;
  if (route === "GET /v1/requests")
    return ok("GET /v1/requests", { requests: [] });
  if (route === "POST /v1/requests") return ok(route, { id: REQ });
  if (route === "GET /v1/feed")
    return ok(route, {
      events: [
        {
          event_type: "request.created",
          actor_id: agent.id,
          target_id: REQ,
        },
      ],
    });
  let m = pathname.match(/^\/v1\/requests\/([^/]+)$/);
  if (req.method === "GET" && m) {
    if (m[1] === "smoke-nonjson")
      return { status: 502, body: "<html>bad gateway</html>" };
    return ok("GET /v1/requests/:id", { id: m[1] });
  }
  m = pathname.match(/^\/v1\/requests\/[^/]+\/(claims|responses)$/);
  if (req.method === "POST" && m) return ok(`POST /v1/requests/:id/${m[1]}`);
  if (
    req.method === "POST" &&
    /^\/v1\/responses\/[^/]+\/ratings$/.test(pathname)
  )
    return ok("POST /v1/responses/:id/ratings");
  return {
    status: 404,
    body: { ok: false, error: { code: "NOT_FOUND", message: route } },
  };
}

/**
 * Serve `fakeReply` on 127.0.0.1, on a port the OS picks. Resolves with the
 * base URL and a `close()` that stops the listener.
 *
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export function startFakeMycelia(agent = SMOKE_AGENT) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      // Drain the body; the fake answers by route, not by content.
      req.resume();
      req.on("end", () => {
        const { status, body } = fakeReply(
          {
            method: req.method ?? "",
            url: req.url ?? "/",
            authorization: req.headers.authorization,
          },
          agent,
        );
        res.writeHead(status, {
          "content-type":
            typeof body === "string" ? "text/html" : "application/json",
        });
        res.end(typeof body === "string" ? body : JSON.stringify(body));
      });
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

/** Fail before running anything unless the registry still serves the pinned bytes. */
export function checkIntegrity(view) {
  const got = view();
  if (got !== INSPECTOR_INTEGRITY)
    return `the registry's integrity for ${INSPECTOR_PACKAGE} is ${got || "(none)"}, recorded ${INSPECTOR_INTEGRITY}`;
  return null;
}

function npmViewIntegrity(env) {
  const r = spawnSync("npm", ["view", INSPECTOR_PACKAGE, "dist.integrity"], {
    cwd: REPO,
    env,
    encoding: "utf8",
  });
  return r.status === 0 ? r.stdout.trim() : "";
}

/**
 * Summarise every result: the gating failures, and the reported ones.
 *
 * @param {{ era: { name: string, gates: boolean }, ok: boolean }[]} results
 * @returns {{ gatingFailures: number, reported: Record<string, { ok: number, total: number }> }}
 */
export function summarise(results) {
  const reported = {};
  let gatingFailures = 0;
  for (const r of results) {
    const e = (reported[r.era.name] ??= {
      ok: 0,
      total: 0,
      gates: r.era.gates,
    });
    e.total += 1;
    if (r.ok) e.ok += 1;
    else if (r.era.gates) gatingFailures += 1;
  }
  return { gatingFailures, reported };
}

/** @returns {Promise<number>} the exit code */
export async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "mycelia-mcp-smoke-"));
  const home = path.join(dir, "home");
  mkdirSync(home);
  const storage = path.join(dir, "inspector-storage");
  const ienv = inspectorEnv(storage, home);
  const results = [];
  let fake;
  try {
    const integrity = checkIntegrity(() => npmViewIntegrity(baseEnv(home)));
    if (integrity) {
      console.error(`smoke — FAIL  ${integrity}`);
      return 1;
    }
    console.log(
      `smoke — Inspector ${INSPECTOR_PACKAGE} (integrity matches the recorded value)`,
    );
    fake = await startFakeMycelia();
    const senv = serverEnv(fake.url);
    for (const era of ERAS) {
      for (const c of CASES) {
        const started = Date.now();
        const run = await runGroup("npx", inspectorArgs(c, era, senv), {
          env: ienv,
        });
        const verdict = judge(c, run, era);
        results.push({ era, ok: verdict.ok });
        const label = `stdio ${era.name} (${era.protocol}) ${c.name}`;
        const ms = Date.now() - started;
        if (verdict.ok)
          console.log(`smoke — ok    ${label}: ${verdict.reason} (${ms}ms)`);
        else if (era.gates)
          console.error(`smoke — FAIL  ${label}: ${verdict.reason}`);
        else
          console.log(
            `smoke — report ${label}: ${verdict.reason} (not gating, MODERN_ERA_GATES)`,
          );
      }
    }
  } finally {
    if (fake) await fake.close();
    rmSync(dir, { recursive: true, force: true });
  }
  const { gatingFailures, reported } = summarise(results);
  for (const [name, r] of Object.entries(reported))
    console.log(
      `smoke — era ${name}: ${r.ok} of ${r.total} as expected${r.gates ? "" : " (reported, not gating)"}`,
    );
  if (gatingFailures > 0) {
    console.error(`smoke — ${gatingFailures} gating check(s) failed`);
    return 1;
  }
  console.log("smoke — OK");
  return 0;
}

if (isMainModule(import.meta.url)) process.exitCode = await main();
