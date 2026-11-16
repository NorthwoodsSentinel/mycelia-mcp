// Tests for src/mycelia-client.ts. `fetch` is replaced with a recorder, so
// nothing here leaves the machine: each case asserts the request the client
// builds (method, URL, headers, body) and how it reads the reply.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MyceliaClient, type MyceliaConfig } from "./mycelia-client.ts";

const CONFIG: MyceliaConfig = {
  agentId: "agent-1",
  apiKey: "test-key",
  baseUrl: "https://mycelia.example.test",
  agentName: "TESTER",
};

interface Call {
  url: string;
  init: RequestInit;
}

let calls: Call[];

function reply(body: unknown, status = 200): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status });
}

/** Replace fetch with one that records each call and answers from `answer`. */
function stubFetch(answer: (url: string) => Response | Promise<Response>) {
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return answer(String(url));
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function bodyOf(i = 0): Record<string, unknown> {
  return JSON.parse(String(calls[i]?.init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("MyceliaClient.fromEnv", () => {
  function clearEnv() {
    vi.stubEnv("MYCELIA_MCP_AGENT_NAME", "");
    vi.stubEnv("MYCELIA_PERSONAL_AGENT_ID_TESTER", "");
    vi.stubEnv("MYCELIA_PERSONAL_KEY_TESTER", "");
    vi.stubEnv("MYCELIA_PERSONAL_API_BASE", "");
  }

  it("requires MYCELIA_MCP_AGENT_NAME", () => {
    clearEnv();
    expect(() => MyceliaClient.fromEnv()).toThrow(
      /MYCELIA_MCP_AGENT_NAME is required/,
    );
  });

  it("requires the agent id for the named agent (name upper-cased)", () => {
    clearEnv();
    vi.stubEnv("MYCELIA_MCP_AGENT_NAME", "tester");
    expect(() => MyceliaClient.fromEnv()).toThrow(
      "MYCELIA_PERSONAL_AGENT_ID_TESTER is not set",
    );
  });

  it("requires the key", () => {
    clearEnv();
    vi.stubEnv("MYCELIA_MCP_AGENT_NAME", "tester");
    vi.stubEnv("MYCELIA_PERSONAL_AGENT_ID_TESTER", "agent-1");
    expect(() => MyceliaClient.fromEnv()).toThrow(
      "MYCELIA_PERSONAL_KEY_TESTER is not set",
    );
  });

  it("requires the base URL", () => {
    clearEnv();
    vi.stubEnv("MYCELIA_MCP_AGENT_NAME", "tester");
    vi.stubEnv("MYCELIA_PERSONAL_AGENT_ID_TESTER", "agent-1");
    vi.stubEnv("MYCELIA_PERSONAL_KEY_TESTER", "test-key");
    expect(() => MyceliaClient.fromEnv()).toThrow(
      "MYCELIA_PERSONAL_API_BASE is not set",
    );
  });

  it("builds a client from the four variables", () => {
    clearEnv();
    vi.stubEnv("MYCELIA_MCP_AGENT_NAME", "tester");
    vi.stubEnv("MYCELIA_PERSONAL_AGENT_ID_TESTER", "agent-1");
    vi.stubEnv("MYCELIA_PERSONAL_KEY_TESTER", "test-key");
    vi.stubEnv("MYCELIA_PERSONAL_API_BASE", "https://mycelia.example.test");
    const c = MyceliaClient.fromEnv();
    expect(c.agentId).toBe("agent-1");
    expect(c.agentName).toBe("TESTER");
  });
});

describe("request transport", () => {
  it("sends the bearer token and JSON content type, and returns the parsed body", async () => {
    stubFetch(() => reply({ ok: true, data: { id: "r1" } }));
    const res = await new MyceliaClient(CONFIG).getRequest("r1");
    expect(res).toEqual({ ok: true, data: { id: "r1" } });
    expect(calls[0]?.url).toBe("https://mycelia.example.test/v1/requests/r1");
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.init.headers).toEqual({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });
    expect(calls[0]?.init.body).toBeUndefined();
  });

  it("turns a non-JSON reply into a typed error with a capped excerpt", async () => {
    stubFetch(() => reply(`<html>${"x".repeat(500)}</html>`, 502));
    const res = await new MyceliaClient(CONFIG).getFeed();
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("HTTP_502_NON_JSON");
    expect(res.error?.message).toMatch(
      /^Upstream returned non-JSON \(status 502\): <html>x+$/,
    );
    expect(res.error?.message.length).toBeLessThan(260);
  });

  it("reports a network error by its class only, never its message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("connect failed https://user:test-key@host");
      }),
    );
    const res = await new MyceliaClient(CONFIG).getFeed();
    expect(res).toEqual({
      ok: false,
      error: {
        code: "FETCH_TYPEERROR",
        message: "Network error contacting Mycelia API (TypeError)",
      },
    });
  });

  it("names a thrown non-Error UnknownError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw "boom";
      }),
    );
    const res = await new MyceliaClient(CONFIG).getFeed();
    expect(res.error?.code).toBe("FETCH_UNKNOWNERROR");
  });

  it("aborts a request after 30 s and reports a timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      ),
    );
    const pending = new MyceliaClient(CONFIG).getFeed();
    await vi.advanceTimersByTimeAsync(30_000);
    const res = await pending;
    expect(res).toEqual({
      ok: false,
      error: {
        code: "FETCH_TIMEOUT",
        message: "Mycelia API did not respond within 30000ms",
      },
    });
  });
});

describe("id and limit guards", () => {
  it("rejects a non-string id", () => {
    const c = new MyceliaClient(CONFIG);
    expect(() => c.getRequest(42 as unknown as string)).toThrow(
      "request_id must be a string (got number)",
    );
  });

  it.each(["", "../etc", "a/b", "a?b", "a#b", "x".repeat(129)])(
    "rejects the id %j",
    (id) => {
      const c = new MyceliaClient(CONFIG);
      expect(() => c.getRequest(id)).toThrow(/disallowed characters/);
    },
  );

  it.each([
    [undefined, "20"],
    [Number.NaN, "20"],
    ["7", "20"],
    [0, "1"],
    [-5, "1"],
    [7.9, "7"],
    [500, "100"],
  ])("bounds the feed limit %j to %s", async (limit, want) => {
    stubFetch(() => reply({ ok: true }));
    await new MyceliaClient(CONFIG).getFeed(limit as number);
    expect(calls[0]?.url).toBe(
      `https://mycelia.example.test/v1/feed?limit=${want}`,
    );
  });
});

describe("GET endpoints", () => {
  it("getProfile defaults to this agent", async () => {
    stubFetch(() => reply({ ok: true }));
    await new MyceliaClient(CONFIG).getProfile();
    expect(calls[0]?.url).toBe(
      "https://mycelia.example.test/v1/agents/agent-1",
    );
  });

  it("getProfile checks a given id", async () => {
    stubFetch(() => reply({ ok: true }));
    const c = new MyceliaClient(CONFIG);
    await c.getProfile("other.agent");
    expect(calls[0]?.url).toBe(
      "https://mycelia.example.test/v1/agents/other.agent",
    );
    expect(() => c.getProfile("../x")).toThrow(/agentId contains/);
  });

  it("browseRequests with no filters asks for /v1/requests", async () => {
    stubFetch(() => reply({ ok: true }));
    await new MyceliaClient(CONFIG).browseRequests();
    expect(calls[0]?.url).toBe("https://mycelia.example.test/v1/requests");
  });

  it("browseRequests passes every filter, capped and checked", async () => {
    stubFetch(() => reply({ ok: true }));
    await new MyceliaClient(CONFIG).browseRequests({
      tag: "t".repeat(80),
      type: "y".repeat(80),
      target_agent_id: "agent-2",
      status: "s".repeat(40),
      limit: 999,
    });
    const url = new URL(String(calls[0]?.url));
    expect(url.pathname).toBe("/v1/requests");
    expect(url.searchParams.get("tag")).toBe("t".repeat(64));
    expect(url.searchParams.get("type")).toBe("y".repeat(64));
    expect(url.searchParams.get("target_agent_id")).toBe("agent-2");
    expect(url.searchParams.get("status")).toBe("s".repeat(32));
    expect(url.searchParams.get("limit")).toBe("100");
  });

  it("browseRequests refuses an unsafe target_agent_id", () => {
    expect(() =>
      new MyceliaClient(CONFIG).browseRequests({ target_agent_id: "a/b" }),
    ).toThrow(/target_agent_id contains/);
  });
});

describe("POST endpoints", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-02T03:04:05.678Z"));
  });

  const SCOPE = {
    requester: "tester",
    agent_id: "agent-1",
    tier: "public",
    ask_max_tier: "public",
    ts: "2026-01-02T03:04:05Z",
  };

  it("postRequest with only the required fields uses the defaults", async () => {
    stubFetch(() => reply({ ok: true }));
    await new MyceliaClient(CONFIG).postRequest({ title: "T", body: "B" });
    expect(calls[0]?.url).toBe("https://mycelia.example.test/v1/requests");
    expect(calls[0]?.init.method).toBe("POST");
    expect(bodyOf()).toEqual({
      title: "T",
      body: "B",
      request_type: "second-opinion",
      tags: ["second-opinion"],
      scope_claim: SCOPE,
    });
  });

  it("postRequest tags by its type when no tags are given", async () => {
    stubFetch(() => reply({ ok: true }));
    await new MyceliaClient(CONFIG).postRequest({
      title: "T",
      body: "B",
      type: "code-review",
    });
    expect(bodyOf().tags).toEqual(["code-review"]);
    expect(bodyOf().request_type).toBe("code-review");
  });

  it("postRequest passes every optional field", async () => {
    stubFetch(() => reply({ ok: true }));
    await new MyceliaClient(CONFIG).postRequest({
      title: "T",
      body: "B",
      tags: ["a", "b"],
      type: "q",
      target_agent_id: "agent-2",
      max_responses: 0,
      expires_hours: 0,
      priority: "high",
      tier: "private",
    });
    expect(bodyOf()).toEqual({
      title: "T",
      body: "B",
      request_type: "q",
      tags: ["a", "b"],
      target_agent_id: "agent-2",
      max_responses: 0,
      expires_hours: 0,
      priority: "high",
      scope_claim: { ...SCOPE, tier: "private", ask_max_tier: "private" },
    });
  });

  it("claimRequest with only an id", async () => {
    stubFetch(() => reply({ ok: true }));
    await new MyceliaClient(CONFIG).claimRequest({ request_id: "r1" });
    expect(calls[0]?.url).toBe(
      "https://mycelia.example.test/v1/requests/r1/claims",
    );
    expect(bodyOf()).toEqual({ scope_claim: SCOPE });
  });

  it("claimRequest with minutes, note and tier", async () => {
    stubFetch(() => reply({ ok: true }));
    await new MyceliaClient(CONFIG).claimRequest({
      request_id: "r1",
      estimated_minutes: 0,
      note: "n",
      tier: "intimate",
    });
    expect(bodyOf()).toEqual({
      scope_claim: { ...SCOPE, tier: "intimate", ask_max_tier: "intimate" },
      estimated_minutes: 0,
      note: "n",
    });
  });

  it("claimRequest refuses an unsafe id before sending", () => {
    const fn = stubFetch(() => reply({ ok: true }));
    expect(() =>
      new MyceliaClient(CONFIG).claimRequest({ request_id: "../x" }),
    ).toThrow(/request_id contains/);
    expect(fn).not.toHaveBeenCalled();
  });

  it("respond defaults the response type", async () => {
    stubFetch(() => reply({ ok: true }));
    await new MyceliaClient(CONFIG).respond({ request_id: "r1", body: "B" });
    expect(calls[0]?.url).toBe(
      "https://mycelia.example.test/v1/requests/r1/responses",
    );
    expect(bodyOf()).toEqual({
      body: "B",
      response_type: "answer",
      scope_claim: SCOPE,
    });
  });

  it("respond passes confidence, type and tier", async () => {
    stubFetch(() => reply({ ok: true }));
    await new MyceliaClient(CONFIG).respond({
      request_id: "r1",
      body: "B",
      confidence: 0,
      response_type: "partial",
      tier: "private",
    });
    expect(bodyOf()).toEqual({
      body: "B",
      response_type: "partial",
      confidence: 0,
      scope_claim: { ...SCOPE, tier: "private", ask_max_tier: "private" },
    });
  });

  it("rateResponse with only a direction", async () => {
    stubFetch(() => reply({ ok: true }));
    await new MyceliaClient(CONFIG).rateResponse({
      response_id: "s1",
      direction: "up",
    });
    expect(calls[0]?.url).toBe(
      "https://mycelia.example.test/v1/responses/s1/ratings",
    );
    expect(bodyOf()).toEqual({ direction: "up", scope_claim: SCOPE });
  });

  it("rateResponse with score, feedback and tier", async () => {
    stubFetch(() => reply({ ok: true }));
    await new MyceliaClient(CONFIG).rateResponse({
      response_id: "s1",
      direction: "down",
      score: 0,
      feedback: "f",
      tier: "private",
    });
    expect(bodyOf()).toEqual({
      direction: "down",
      score: 0,
      feedback: "f",
      scope_claim: { ...SCOPE, tier: "private", ask_max_tier: "private" },
    });
  });
});

describe("myOutgoing", () => {
  it("returns the feed reply unchanged when it failed", async () => {
    stubFetch(() => reply({ ok: false, error: { code: "E", message: "m" } }));
    const res = await new MyceliaClient(CONFIG).myOutgoing();
    expect(res).toEqual({ ok: false, error: { code: "E", message: "m" } });
  });

  it("returns the feed reply unchanged when it has no data", async () => {
    stubFetch(() => reply({ ok: true }));
    const res = await new MyceliaClient(CONFIG).myOutgoing();
    expect(res).toEqual({ ok: true });
  });

  it("treats a feed with no events list as empty", async () => {
    stubFetch(() => reply({ ok: true, data: {}, meta: { request_id: "m" } }));
    const res = await new MyceliaClient(CONFIG).myOutgoing();
    expect(res).toEqual({
      ok: true,
      data: { requests: [] },
      meta: { request_id: "m" },
    });
  });

  it("fetches only requests this agent created, up to the limit, keeping those that load", async () => {
    const events = [
      { event_type: "request.created", actor_id: "agent-1", target_id: "r1" },
      { event_type: "request.created", actor_id: "agent-1", target_id: "r1" },
      { event_type: "request.created", actor_id: "agent-1", target_id: "r2" },
      { event_type: "request.created", actor_id: "agent-1", target_id: "r3" },
      { event_type: "request.created", actor_id: "agent-1", target_id: "r4" },
      { event_type: "request.created", actor_id: "someone", target_id: "x1" },
      { event_type: "request.claimed", actor_id: "agent-1", target_id: "x2" },
      { event_type: "request.created", actor_id: "agent-1", target_id: 9 },
    ];
    stubFetch((url) => {
      if (url.includes("/v1/feed"))
        return reply({ ok: true, data: { events } });
      if (url.endsWith("/r1")) return reply({ ok: true, data: { id: "r1" } });
      if (url.endsWith("/r2")) return reply({ ok: false });
      return reply({ ok: true, data: { id: "r3" } });
    });
    const res = await new MyceliaClient(CONFIG).myOutgoing(3);
    expect(calls[0]?.url).toBe("https://mycelia.example.test/v1/feed?limit=50");
    expect(calls.slice(1).map((c) => c.url)).toEqual([
      "https://mycelia.example.test/v1/requests/r1",
      "https://mycelia.example.test/v1/requests/r2",
      "https://mycelia.example.test/v1/requests/r3",
    ]);
    expect(res).toEqual({
      ok: true,
      data: { requests: [{ id: "r1" }, { id: "r3" }] },
      meta: undefined,
    });
  });

  it("defaults to 20 outgoing requests", async () => {
    const events = Array.from({ length: 25 }, (_, i) => ({
      event_type: "request.created",
      actor_id: "agent-1",
      target_id: `r${i}`,
    }));
    stubFetch((url) =>
      url.includes("/v1/feed")
        ? reply({ ok: true, data: { events } })
        : reply({ ok: true, data: {} }),
    );
    const res = await new MyceliaClient(CONFIG).myOutgoing();
    expect(calls.length).toBe(21);
    expect((res.data as { requests: unknown[] }).requests.length).toBe(20);
  });
});
