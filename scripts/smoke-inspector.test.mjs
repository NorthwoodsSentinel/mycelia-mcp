// Tests for the Inspector smoke: the pure parts of
// scripts/smoke-inspector.mjs, which decide what is run and how a run is
// judged. The live run itself is `npm run smoke`, a stage of `local:gate`
// and of CI; these tests make sure its verdicts cannot drift quietly (a
// refusal that passes on a crash, an era that starts or stops gating, an
// Inspector option placed before the server command).
// The form follows the reference servers' scripts/smoke-servers.test.mjs
// (modelcontextprotocol/servers e1d154ee): pure helpers driven with inline
// values, the case table checked for completeness. Run by
// `npm run test:scripts`, which names this file by path.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CASES,
  CONNECT_TIMEOUT_MS,
  ERAS,
  INSPECTOR_INTEGRITY,
  INSPECTOR_PACKAGE,
  INVOCATION_TIMEOUT_MS,
  MODERN_ERA_GATES,
  SMOKE_AGENT,
  calledTools,
  checkIntegrity,
  checkToolCoverage,
  inspectorArgs,
  inspectorEnv,
  judge,
  lastLine,
  NPM_REGISTRY,
  baseEnv,
  fakeReply,
  runGroup,
  startFakeMycelia,
  serverEnv,
  summarise,
} from "./smoke-inspector.mjs";

const LEGACY = ERAS.find((e) => e.name === "legacy");
const MODERN = ERAS.find((e) => e.name === "modern");
const SIX = [
  "mycelia_browse_requests",
  "mycelia_claim_request",
  "mycelia_feed",
  "mycelia_get_request",
  "mycelia_my_outgoing",
  "mycelia_post_request",
  "mycelia_rate_response",
  "mycelia_respond",
];
const byName = (n) => CASES.find((c) => c.name === n);
const envelope = (code) =>
  `banner\n{"error":{"code":"${code}","message":"m"}}\n`;

test("the Inspector is pinned to one exact version, with its integrity recorded", () => {
  assert.equal(INSPECTOR_PACKAGE, "@modelcontextprotocol/inspector@2.15.0");
  assert.match(INSPECTOR_INTEGRITY, /^sha512-[A-Za-z0-9+/]+=*$/);
});

test("checkIntegrity passes only on the recorded value", () => {
  assert.equal(
    checkIntegrity(() => INSPECTOR_INTEGRITY),
    null,
  );
  assert.match(
    checkIntegrity(() => "sha512-other"),
    /recorded/,
  );
  assert.match(
    checkIntegrity(() => ""),
    /\(none\)/,
  );
});

test("the 2025-11-25 era gates and the 2026-07-28 era does not", () => {
  assert.deepEqual(
    ERAS.map((e) => [e.name, e.protocol, e.gates]),
    [
      ["legacy", "2025-11-25", true],
      ["modern", "2026-07-28", false],
    ],
  );
  assert.equal(MODERN_ERA_GATES, false);
  assert.ok(!ERAS.some((e) => e.name === "auto"));
});

test("the inner connect budget is strictly smaller than the kill timer", () => {
  assert.ok(CONNECT_TIMEOUT_MS < INVOCATION_TIMEOUT_MS);
});

test("the case table: initialize first, every tool called, refusals exit 5", () => {
  assert.equal(CASES[0].name, "initialize");
  assert.deepEqual(calledTools(), SIX);
  const refusals = CASES.filter((c) => c.exit !== 0);
  assert.ok(refusals.length >= 2);
  for (const r of refusals) {
    assert.equal(r.exit, 5, r.name);
    assert.ok(r.error, `${r.name} names its envelope code`);
  }
  // Every successful call names the field it reads from the result.
  for (const c of CASES.filter((c) => c.exit === 0 && c.calls))
    assert.ok(c.result && "ok" in c.result, c.name);
  assert.ok(CASES.some((c) => c.args.includes("--strict")));
  assert.equal(new Set(CASES.map((c) => c.name)).size, CASES.length);
});

test("checkToolCoverage fails both ways", () => {
  assert.deepEqual(checkToolCoverage(SIX), []);
  assert.match(
    checkToolCoverage([...SIX, "new_tool"]).join(),
    /new_tool.*no case calls/,
  );
  assert.match(
    checkToolCoverage(SIX.filter((t) => t !== "mycelia_feed")).join(),
    /mycelia_feed.*does not name/,
  );
});

test("checkToolCoverage requires each name exactly once", () => {
  // The expected names plus a duplicate: membership agrees, cardinality not.
  const problems = checkToolCoverage([...SIX, "mycelia_feed"]);
  assert.match(problems.join(), /mycelia_feed.*more than once/);
  const c = byName("tools/list");
  const v = judge(
    c,
    {
      status: 0,
      stdout: JSON.stringify({
        result: {
          tools: [...SIX, "mycelia_feed"].map((name) => ({ name })),
        },
      }),
      stderr: "",
    },
    LEGACY,
  );
  assert.equal(v.ok, false, v.reason);
});

test("lastLine is the envelope line", () => {
  assert.equal(lastLine(envelope("x")), '{"error":{"code":"x","message":"m"}}');
  assert.equal(lastLine(""), "");
});

test("judge: the exit code is the verdict", () => {
  const c = byName("tools/call mycelia_feed");
  const good = {
    status: 0,
    stdout: JSON.stringify({
      result: {
        content: [
          {
            type: "text",
            text: '{\n  "ok": true,\n  "fake": "GET /v1/feed"\n}',
          },
        ],
      },
    }),
    stderr: "",
  };
  assert.equal(judge(c, good, LEGACY).ok, true);
  assert.match(
    judge(c, { ...good, status: 5, stderr: envelope("tool_is_error") }, LEGACY)
      .reason,
    /exit 5, expected exit 0/,
  );
  assert.match(
    judge(c, { ...good, status: null, signal: "SIGKILL" }, LEGACY).reason,
    /killed \(SIGKILL\)/,
  );
  assert.match(
    judge(c, { ...good, status: null }, LEGACY).reason,
    /no exit code/,
  );
  assert.match(
    judge(c, { ...good, stdout: "not json" }, LEGACY).reason,
    /not one JSON object/,
  );
  assert.match(
    judge(
      c,
      { ...good, stdout: JSON.stringify({ result: { content: [] } }) },
      LEGACY,
    ).reason,
    /0 text content items/,
  );
});

test("judge: a call's expected field is read from its parsed result, not found anywhere", () => {
  const text = (obj) => ({ type: "text", text: JSON.stringify(obj, null, 2) });
  const run = (result) => ({
    status: 0,
    stdout: JSON.stringify({ result }),
    stderr: "",
  });
  for (const c of CASES.filter((c) => c.exit === 0 && c.result)) {
    const right = c.result;
    // A nested diagnostic carries the expected fields byte for byte; the
    // fields at their own location are wrong.
    const wrong = Object.fromEntries(
      Object.entries(right).map(([k, v]) => [
        k,
        typeof v === "boolean" ? !v : `${v}-elsewhere`,
      ]),
    );
    const bad = judge(
      c,
      run({ content: [text({ ...wrong, diagnostic: right })] }),
      LEGACY,
    );
    assert.equal(bad.ok, false, `${c.name}: ${bad.reason}`);
    assert.match(bad.reason, /result\.\w+ is/);
    const good = judge(c, run({ content: [text(right)] }), LEGACY);
    assert.equal(good.ok, true, `${c.name}: ${good.reason}`);
  }
  const feed = byName("tools/call mycelia_feed");
  const want = { ok: true, fake: "GET /v1/feed" };
  // The expected text outside the content (a diagnostic _meta) is not read.
  const outside = judge(
    feed,
    run({
      content: [text({ ok: true, fake: "GET /v1/requests" })],
      _meta: { note: '"fake": "GET /v1/feed"' },
    }),
    LEGACY,
  );
  assert.equal(outside.ok, false, outside.reason);
  // A second text item is ambiguous, not a pass.
  const two = judge(
    feed,
    run({ content: [text({ ok: false }), text(want)] }),
    LEGACY,
  );
  assert.equal(two.ok, false, two.reason);
  assert.match(two.reason, /2 text content items/);
  // Text that is not JSON, a result that is not an object, and a result
  // flagged isError, do not pass.
  assert.match(
    judge(feed, run({ content: [{ type: "text", text: "ok" }] }), LEGACY)
      .reason,
    /not JSON/,
  );
  assert.match(
    judge(feed, run({ content: [text(true)] }), LEGACY).reason,
    /result\.ok is undefined/,
  );
  assert.match(
    judge(feed, run({ content: [text(want)], isError: true }), LEGACY).reason,
    /isError/,
  );
  assert.match(judge(feed, run({}), LEGACY).reason, /no content array/);
});

test("judge: a refusal in the server's real shape still passes", () => {
  const c = byName("mycelia_get_request: a path-traversal id");
  const v = judge(
    c,
    {
      status: 5,
      stdout: JSON.stringify({
        result: {
          content: [
            {
              type: "text",
              text: "error: request_id contains disallowed characters",
            },
          ],
          isError: true,
        },
      }),
      stderr: envelope("tool_is_error"),
    },
    LEGACY,
  );
  assert.equal(v.ok, true, v.reason);
});

test("judge: a refusal must exit 5 with the right envelope code", () => {
  const c = byName("mycelia_get_request: a path-traversal id");
  assert.equal(
    judge(
      c,
      { status: 5, stdout: "{}", stderr: envelope("tool_is_error") },
      LEGACY,
    ).ok,
    true,
  );
  // a crash or an unreachable server is not a refusal
  assert.equal(
    judge(c, { status: 1, stdout: "", stderr: envelope("error") }, LEGACY).ok,
    false,
  );
  assert.equal(
    judge(c, { status: 4, stdout: "", stderr: envelope("unreachable") }, LEGACY)
      .ok,
    false,
  );
  // accepted where it should refuse
  assert.equal(
    judge(c, { status: 0, stdout: "{}", stderr: "" }, LEGACY).ok,
    false,
  );
  assert.match(
    judge(
      c,
      { status: 5, stdout: "", stderr: envelope("tool_not_found") },
      LEGACY,
    ).reason,
    /expected tool_is_error/,
  );
  assert.match(
    judge(c, { status: 5, stdout: "", stderr: "plain text" }, LEGACY).reason,
    /not an error envelope/,
  );
  // A case that names an expected substring checks stdout for it.
  const withExpect = { ...c, expect: "disallowed characters" };
  assert.equal(
    judge(
      withExpect,
      {
        status: 5,
        stdout: '{"t":"error: request_id contains disallowed characters"}',
        stderr: envelope("tool_is_error"),
      },
      LEGACY,
    ).ok,
    true,
  );
  assert.match(
    judge(
      withExpect,
      { status: 5, stdout: "{}", stderr: envelope("tool_is_error") },
      LEGACY,
    ).reason,
    /does not contain/,
  );
  assert.match(
    judge(
      withExpect,
      { status: 5, stdout: "not json", stderr: envelope("tool_is_error") },
      LEGACY,
    ).reason,
    /not one JSON object/,
  );
});

test("judge: initialize checks the negotiated protocol", () => {
  const c = byName("initialize");
  const run = (v) => ({
    status: 0,
    stdout: JSON.stringify({ result: { protocolVersion: v } }),
    stderr: "",
  });
  assert.equal(judge(c, run("2025-11-25"), LEGACY).ok, true);
  assert.match(
    judge(c, run("2025-06-18"), LEGACY).reason,
    /negotiated 2025-06-18/,
  );
  assert.equal(judge(c, run("2026-07-28"), MODERN).ok, true);
});

test("judge: tools/list must name exactly the tools the table calls", () => {
  const c = byName("tools/list");
  const run = (names) => ({
    status: 0,
    stdout: JSON.stringify({
      result: { tools: names.map((name) => ({ name })) },
    }),
    stderr: "",
  });
  assert.equal(judge(c, run(SIX), LEGACY).ok, true);
  assert.equal(judge(c, run([...SIX, "extra"]), LEGACY).ok, false);
  assert.equal(judge(c, run(SIX.slice(1)), LEGACY).ok, false);
  assert.match(
    judge(c, { status: 0, stdout: '{"result":{}}', stderr: "" }, LEGACY).reason,
    /no tools array/,
  );
});

test("inspectorArgs: npx --yes, exact pin, server command first, options after", () => {
  const c = byName("tools/call mycelia_feed");
  const args = inspectorArgs(c, LEGACY, { A: "1" });
  assert.deepEqual(args.slice(0, 6), [
    "--yes",
    INSPECTOR_PACKAGE,
    "--cli",
    "bun",
    "src/index.ts",
    "-e",
  ]);
  assert.equal(args[6], "A=1");
  assert.ok(args.indexOf("--method") > args.indexOf("src/index.ts"));
  assert.deepEqual(
    args.slice(
      args.indexOf("--protocol-era"),
      args.indexOf("--protocol-era") + 2,
    ),
    ["--protocol-era", "legacy"],
  );
  assert.ok(args.includes("--format") && args.includes("--connect-timeout"));
  const modern = inspectorArgs(c, MODERN, {});
  assert.ok(modern.includes("modern"));
  assert.ok(!modern.includes("auto"));
});

test("the server gets the placeholder identity and the fake's base URL only", () => {
  const env = serverEnv("http://127.0.0.1:1");
  assert.deepEqual(env, {
    MYCELIA_MCP_AGENT_NAME: "SMOKE",
    MYCELIA_PERSONAL_AGENT_ID_SMOKE: "smoke-agent",
    MYCELIA_PERSONAL_KEY_SMOKE: SMOKE_AGENT.key,
    MYCELIA_PERSONAL_API_BASE: "http://127.0.0.1:1",
  });
  assert.match(SMOKE_AGENT.key, /placeholder/);
});

test("fakeReply: every route the client uses, tagged; the token is required", () => {
  const auth = `Bearer ${SMOKE_AGENT.key}`;
  const r = (method, url, authorization = auth) =>
    fakeReply({ method, url, authorization });
  assert.equal(
    r("GET", "/v1/requests?status=open").body.fake,
    "GET /v1/requests",
  );
  assert.equal(r("POST", "/v1/requests").body.fake, "POST /v1/requests");
  assert.equal(r("GET", "/v1/feed?limit=5").body.fake, "GET /v1/feed");
  assert.deepEqual(r("GET", "/v1/feed").body.data.events[0], {
    event_type: "request.created",
    actor_id: "smoke-agent",
    target_id: "smoke-req-1",
  });
  assert.equal(r("GET", "/v1/requests/x1").body.fake, "GET /v1/requests/:id");
  assert.equal(
    r("POST", "/v1/requests/x1/claims").body.fake,
    "POST /v1/requests/:id/claims",
  );
  assert.equal(
    r("POST", "/v1/requests/x1/responses").body.fake,
    "POST /v1/requests/:id/responses",
  );
  assert.equal(
    r("POST", "/v1/responses/s1/ratings").body.fake,
    "POST /v1/responses/:id/ratings",
  );
  const nonJson = r("GET", "/v1/requests/smoke-nonjson");
  assert.equal(nonJson.status, 502);
  assert.equal(typeof nonJson.body, "string");
  assert.equal(r("DELETE", "/v1/requests/x1").status, 404);
  assert.equal(r("GET", "/v1/requests/x1", "Bearer wrong").status, 401);
  assert.equal(fakeReply({ method: "GET", url: "/v1/feed" }).status, 401);
});

test("startFakeMycelia serves on loopback and closes", async () => {
  const fake = await startFakeMycelia();
  try {
    assert.match(fake.url, /^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/);
    const ok = await fetch(`${fake.url}/v1/feed`, {
      headers: { authorization: `Bearer ${SMOKE_AGENT.key}` },
    });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).fake, "GET /v1/feed");
    const html = await fetch(`${fake.url}/v1/requests/smoke-nonjson`, {
      method: "POST",
      body: "x",
      headers: { authorization: `Bearer ${SMOKE_AGENT.key}` },
    });
    assert.equal(html.status, 404);
    await html.text();
    const bad = await fetch(`${fake.url}/v1/feed`);
    assert.equal(bad.status, 401);
    await bad.text();
  } finally {
    await fake.close();
  }
});

test("the environment is an allowlist: secrets and steering variables never pass", () => {
  const base = {
    PATH: "/bin",
    TMPDIR: "/tmp/x",
    HOME: "/Users/real",
    AWS_SECRET_ACCESS_KEY: "aws-secret",
    NPM_TOKEN: "npm-token",
    GITHUB_TOKEN: "gh-token",
    NODE_OPTIONS: "--require=/tmp/hook.cjs",
    HTTPS_PROXY: "http://proxy.invalid:8080",
    https_proxy: "http://proxy.invalid:8080",
    NPM_CONFIG_REGISTRY: "https://registry.invalid/",
    npm_config_registry: "https://registry.invalid/",
    npm_config_userconfig: "/Users/real/.npmrc",
    NODE_TLS_REJECT_UNAUTHORIZED: "0",
    MYCELIA_PERSONAL_KEY_REAL: "real-key",
    MCP_INSPECTOR_OAUTH_STATE_PATH: "/Users/real/oauth.json",
    UNDEF: undefined,
  };
  const env = baseEnv("/scratch/home", base, "/cache/.npm");
  assert.deepEqual(env, {
    PATH: "/bin",
    TMPDIR: "/tmp/x",
    HOME: "/scratch/home",
    npm_config_cache: "/cache/.npm",
    npm_config_registry: NPM_REGISTRY,
    npm_config_update_notifier: "false",
  });
  const ienv = inspectorEnv(
    "/scratch/store",
    "/scratch/home",
    base,
    "/cache/.npm",
  );
  for (const e of [env, ienv]) {
    const text = JSON.stringify(e);
    for (const value of [
      "aws-secret",
      "npm-token",
      "gh-token",
      "hook.cjs",
      "proxy.invalid",
      "registry.invalid",
      "/Users/real",
      "real-key",
    ])
      assert.ok(!text.includes(value), value);
    for (const name of [
      "AWS_SECRET_ACCESS_KEY",
      "NPM_TOKEN",
      "GITHUB_TOKEN",
      "NODE_OPTIONS",
      "HTTPS_PROXY",
      "https_proxy",
      "NPM_CONFIG_REGISTRY",
      "npm_config_userconfig",
      "NODE_TLS_REJECT_UNAUTHORIZED",
    ])
      assert.equal(e[name], undefined, name);
  }
  assert.equal(ienv.MCP_STORAGE_DIR, "/scratch/store");
  assert.equal(
    ienv.MCP_INSPECTOR_OAUTH_STATE_PATH,
    "/scratch/store/oauth.json",
  );
  assert.equal(ienv.MCP_INSPECTOR_SECRET_STORE, "memory");
  assert.equal(ienv.MCP_OAUTH_CALLBACK_URL, "");
  // Exactly the allowlist's names plus the Inspector's own.
  assert.deepEqual(
    Object.keys(ienv).sort(),
    [
      ...Object.keys(env),
      "MCP_AUTO_OPEN_ENABLED",
      "MCP_INSPECTOR_OAUTH_STATE_PATH",
      "MCP_INSPECTOR_SECRET_STORE",
      "MCP_OAUTH_CALLBACK_URL",
      "MCP_STORAGE_DIR",
    ].sort(),
  );
  assert.equal(NPM_REGISTRY, "https://registry.npmjs.org/");
});

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
// A condition wait with a bound, not a fixed sleep: it returns as soon as
// the process is gone.
async function goneWithin(pid, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !alive(pid);
}

test("runGroup: a timeout kills the descendants, not only the child", async () => {
  // sh starts a sleeping grandchild and waits on it, so the timeout fires.
  const run = await runGroup("sh", ["-c", "sleep 30 & echo $!; wait"], {
    env: { PATH: process.env.PATH },
    timeoutMs: 300,
  });
  assert.equal(run.signal, "SIGKILL");
  const pid = Number(run.stdout.trim());
  assert.ok(pid > 0);
  assert.equal(
    await goneWithin(pid, 3_000),
    true,
    `grandchild ${pid} survived`,
  );
});

test("runGroup: a descendant left behind by a command that exits is killed", async () => {
  const run = await runGroup(
    "sh",
    ["-c", "sleep 30 >/dev/null 2>&1 & echo $!"],
    { env: { PATH: process.env.PATH }, timeoutMs: 10_000 },
  );
  assert.equal(run.status, 0);
  const pid = Number(run.stdout.trim());
  assert.ok(pid > 0);
  assert.equal(await goneWithin(pid, 3_000), true, `orphan ${pid} survived`);
});

test("summarise counts only gating failures as failures", () => {
  const r = summarise([
    { era: LEGACY, ok: true },
    { era: LEGACY, ok: false },
    { era: MODERN, ok: false },
    { era: MODERN, ok: true },
  ]);
  assert.equal(r.gatingFailures, 1);
  assert.deepEqual(r.reported.legacy, { ok: 1, total: 2, gates: true });
  assert.deepEqual(r.reported.modern, { ok: 1, total: 2, gates: false });
});
