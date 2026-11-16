// Tests for src/index.ts: the server is driven by a real MCP client over the
// SDK's in-memory transport, and each Mycelia client method is spied, so a
// case asserts which method a tool call reaches and with which arguments.
// Nothing here leaves the machine.

import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MyceliaClient } from "./mycelia-client.ts";
import { TOOLS, asContent, createServer, fatal, main } from "./index.ts";

const OK = { ok: true, data: { echo: true } };

function fakeClient() {
  const c = new MyceliaClient({
    agentId: "agent-1",
    apiKey: "test-key",
    baseUrl: "https://mycelia.example.test",
    agentName: "TESTER",
  });
  const spies = {
    browseRequests: vi.spyOn(c, "browseRequests").mockResolvedValue(OK),
    getRequest: vi.spyOn(c, "getRequest").mockResolvedValue(OK),
    claimRequest: vi.spyOn(c, "claimRequest").mockResolvedValue(OK),
    respond: vi.spyOn(c, "respond").mockResolvedValue(OK),
    rateResponse: vi.spyOn(c, "rateResponse").mockResolvedValue(OK),
    getFeed: vi.spyOn(c, "getFeed").mockResolvedValue(OK),
    myOutgoing: vi.spyOn(c, "myOutgoing").mockResolvedValue(OK),
    postRequest: vi.spyOn(c, "postRequest").mockResolvedValue(OK),
  };
  return { c, spies };
}

async function connect(client: MyceliaClient) {
  const server = createServer(client);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const mcp = new Client({ name: "test", version: "0" });
  await mcp.connect(b);
  return mcp;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("asContent", () => {
  it("wraps a value as one pretty-printed text item", () => {
    expect(asContent({ a: 1 })).toEqual([
      { type: "text", text: '{\n  "a": 1\n}' },
    ]);
  });
});

describe("tools/list", () => {
  it("lists the eight tools", async () => {
    const mcp = await connect(fakeClient().c);
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    expect(tools).toHaveLength(8);
  });
});

// The public tool contract, written out by hand: each tool's properties, its
// required fields and its enums. A change to `TOOLS` that drops a required
// field, renames a property or alters an enum fails here, not only in review.
const TIER = ["public", "private", "intimate"];
const CONTRACT: Record<
  string,
  { props: string[]; required: string[]; enums: Record<string, string[]> }
> = {
  mycelia_browse_requests: {
    props: ["tag", "type", "target_agent_id", "status", "limit"],
    required: [],
    enums: { status: ["open", "claimed", "responded", "closed", "expired"] },
  },
  mycelia_get_request: {
    props: ["request_id"],
    required: ["request_id"],
    enums: {},
  },
  mycelia_claim_request: {
    props: ["request_id", "estimated_minutes", "note", "tier"],
    required: ["request_id"],
    enums: { tier: TIER },
  },
  mycelia_respond: {
    props: ["request_id", "body", "confidence", "response_type", "tier"],
    required: ["request_id", "body"],
    enums: { tier: TIER },
  },
  mycelia_rate_response: {
    props: ["response_id", "direction", "score", "feedback", "tier"],
    required: ["response_id", "direction"],
    enums: { direction: ["up", "down"], tier: TIER },
  },
  mycelia_feed: { props: ["limit"], required: [], enums: {} },
  mycelia_my_outgoing: { props: ["limit"], required: [], enums: {} },
  mycelia_post_request: {
    props: [
      "title",
      "body",
      "target_agent_id",
      "tags",
      "type",
      "max_responses",
      "expires_hours",
      "priority",
      "tier",
    ],
    required: ["title", "body"],
    enums: { tier: TIER },
  },
};

describe("the tool contract", () => {
  it("tools/list serves exactly the contract", async () => {
    const mcp = await connect(fakeClient().c);
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      Object.keys(CONTRACT).sort(),
    );
    for (const t of tools) {
      const want = CONTRACT[t.name];
      expect(want, t.name).toBeDefined();
      if (!want) continue;
      const props = (t.inputSchema.properties ?? {}) as Record<
        string,
        { type?: string; enum?: string[] }
      >;
      expect(t.inputSchema.type, t.name).toBe("object");
      expect(Object.keys(props), t.name).toEqual(want.props);
      expect(t.inputSchema.required ?? [], t.name).toEqual(want.required);
      const enums = Object.fromEntries(
        Object.entries(props)
          .filter(([, v]) => v.enum !== undefined)
          .map(([k, v]) => [k, v.enum]),
      );
      expect(enums, t.name).toEqual(want.enums);
    }
  });
});

describe("tools/call", () => {
  it("mycelia_browse_requests passes its filters", async () => {
    const { c, spies } = fakeClient();
    const mcp = await connect(c);
    const res = await mcp.callTool({
      name: "mycelia_browse_requests",
      arguments: {
        tag: "t",
        type: "y",
        target_agent_id: "a2",
        status: "open",
        limit: 5,
      },
    });
    expect(spies.browseRequests).toHaveBeenCalledWith({
      tag: "t",
      type: "y",
      target_agent_id: "a2",
      status: "open",
      limit: 5,
    });
    expect(res.content).toEqual(asContent(OK));
    expect(res.isError).toBeUndefined();
  });

  it("a call with no arguments is read as an empty object", async () => {
    const { c, spies } = fakeClient();
    const mcp = await connect(c);
    await mcp.callTool({ name: "mycelia_browse_requests" });
    expect(spies.browseRequests).toHaveBeenCalledWith({
      tag: undefined,
      type: undefined,
      target_agent_id: undefined,
      status: undefined,
      limit: undefined,
    });
  });

  it("mycelia_get_request", async () => {
    const { c, spies } = fakeClient();
    const mcp = await connect(c);
    await mcp.callTool({
      name: "mycelia_get_request",
      arguments: { request_id: "r1" },
    });
    expect(spies.getRequest).toHaveBeenCalledWith("r1");
  });

  it("mycelia_claim_request", async () => {
    const { c, spies } = fakeClient();
    const mcp = await connect(c);
    await mcp.callTool({
      name: "mycelia_claim_request",
      arguments: {
        request_id: "r1",
        estimated_minutes: 5,
        note: "n",
        tier: "private",
      },
    });
    expect(spies.claimRequest).toHaveBeenCalledWith({
      request_id: "r1",
      estimated_minutes: 5,
      note: "n",
      tier: "private",
    });
  });

  it("mycelia_respond", async () => {
    const { c, spies } = fakeClient();
    const mcp = await connect(c);
    await mcp.callTool({
      name: "mycelia_respond",
      arguments: {
        request_id: "r1",
        body: "B",
        confidence: 0.5,
        response_type: "answer",
        tier: "public",
      },
    });
    expect(spies.respond).toHaveBeenCalledWith({
      request_id: "r1",
      body: "B",
      confidence: 0.5,
      response_type: "answer",
      tier: "public",
    });
  });

  it("mycelia_rate_response", async () => {
    const { c, spies } = fakeClient();
    const mcp = await connect(c);
    await mcp.callTool({
      name: "mycelia_rate_response",
      arguments: {
        response_id: "s1",
        direction: "up",
        score: 1,
        feedback: "f",
        tier: "public",
      },
    });
    expect(spies.rateResponse).toHaveBeenCalledWith({
      response_id: "s1",
      direction: "up",
      score: 1,
      feedback: "f",
      tier: "public",
    });
  });

  it("mycelia_feed", async () => {
    const { c, spies } = fakeClient();
    const mcp = await connect(c);
    await mcp.callTool({ name: "mycelia_feed", arguments: { limit: 3 } });
    expect(spies.getFeed).toHaveBeenCalledWith(3);
  });

  it("mycelia_my_outgoing", async () => {
    const { c, spies } = fakeClient();
    const mcp = await connect(c);
    await mcp.callTool({
      name: "mycelia_my_outgoing",
      arguments: { limit: 4 },
    });
    expect(spies.myOutgoing).toHaveBeenCalledWith(4);
  });

  it("mycelia_post_request", async () => {
    const { c, spies } = fakeClient();
    const mcp = await connect(c);
    const args = {
      title: "T",
      body: "B",
      target_agent_id: "a2",
      tags: ["x"],
      type: "q",
      max_responses: 2,
      expires_hours: 1,
      priority: "low",
      tier: "public",
    };
    await mcp.callTool({ name: "mycelia_post_request", arguments: args });
    expect(spies.postRequest).toHaveBeenCalledWith(args);
  });

  it("an unknown tool is an error result", async () => {
    const mcp = await connect(fakeClient().c);
    const res = await mcp.callTool({ name: "write_file", arguments: {} });
    expect(res).toEqual({
      content: [{ type: "text", text: "unknown tool: write_file" }],
      isError: true,
    });
  });

  it("a thrown Error becomes an error result with its message", async () => {
    const { c, spies } = fakeClient();
    spies.getRequest.mockImplementation(() => {
      throw new Error("request_id contains disallowed characters");
    });
    const mcp = await connect(c);
    const res = await mcp.callTool({
      name: "mycelia_get_request",
      arguments: { request_id: "../x" },
    });
    expect(res).toEqual({
      content: [
        {
          type: "text",
          text: "error: request_id contains disallowed characters",
        },
      ],
      isError: true,
    });
  });

  it("a thrown non-Error is stringified", async () => {
    const { c, spies } = fakeClient();
    spies.getFeed.mockRejectedValue("plain");
    const mcp = await connect(c);
    const res = await mcp.callTool({ name: "mycelia_feed", arguments: {} });
    expect(res).toEqual({
      content: [{ type: "text", text: "error: plain" }],
      isError: true,
    });
  });
});

describe("main", () => {
  it("builds the client from the environment and serves on the given transport", async () => {
    vi.stubEnv("MYCELIA_MCP_AGENT_NAME", "tester");
    vi.stubEnv("MYCELIA_PERSONAL_AGENT_ID_TESTER", "agent-1");
    vi.stubEnv("MYCELIA_PERSONAL_KEY_TESTER", "test-key");
    vi.stubEnv("MYCELIA_PERSONAL_API_BASE", "https://mycelia.example.test");
    const [a, b] = InMemoryTransport.createLinkedPair();
    await main(a);
    const mcp = new Client({ name: "test", version: "0" });
    await mcp.connect(b);
    const { tools } = await mcp.listTools();
    expect(tools).toHaveLength(8);
    expect(mcp.getServerVersion()).toEqual({
      name: "mycelia-mcp",
      version: "0.1.0",
    });
  });

  it("rejects when the environment is incomplete", async () => {
    vi.stubEnv("MYCELIA_MCP_AGENT_NAME", "");
    const [a] = InMemoryTransport.createLinkedPair();
    await expect(main(a)).rejects.toThrow(/MYCELIA_MCP_AGENT_NAME is required/);
  });
});

describe("fatal", () => {
  it("prints the error and exits 1", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit called");
    }) as never);
    expect(() => fatal(new Error("x"))).toThrow("exit called");
    expect(err).toHaveBeenCalledWith("mycelia-mcp fatal:", new Error("x"));
    expect(exit).toHaveBeenCalledWith(1);
  });
});
