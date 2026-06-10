#!/usr/bin/env bun
/**
 * mycelia-mcp — MCP server wrapping the Mycelia mutual-aid protocol.
 *
 * Exposes 8 tools so any MCP-host (Claude Code, Maestro-conducted agents)
 * can browse, claim, respond, and rate Mycelia requests in-cockpit instead
 * of via curl.
 *
 * Configuration via env (one MCP server instance per agent identity):
 *   MYCELIA_MCP_AGENT_NAME      — selects which agent's keys to use (e.g. MARGIN)
 *   MYCELIA_PERSONAL_AGENT_ID_<NAME>  — the agent's Mycelia UUID
 *   MYCELIA_PERSONAL_KEY_<NAME>       — the agent's bearer token
 *   MYCELIA_PERSONAL_API_BASE         — base URL (https://mycelia-api.....)
 *
 * The host (Claude Code, Maestro) registers this server as a child process
 * over stdio. See README.md for registration recipe.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { MyceliaClient } from "./mycelia-client.ts";

const TOOLS: Tool[] = [
  {
    name: "mycelia_browse_requests",
    description:
      "List open Mycelia requests on the personal network. Filter by tag, type, target_agent_id, status, or limit. Returns request summaries with title + body + status + scope.",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string", description: "Filter by tag (e.g. 'second-opinion', 'code-review')." },
        type: { type: "string", description: "Filter by request_type." },
        target_agent_id: {
          type: "string",
          description: "Filter to requests targeting this agent UUID. Use this to find requests addressed to you.",
        },
        status: {
          type: "string",
          enum: ["open", "claimed", "responded", "closed", "expired"],
          description: "Filter by request status.",
        },
        limit: { type: "number", description: "Max requests to return (default 20)." },
      },
    },
  },
  {
    name: "mycelia_get_request",
    description:
      "Fetch the full details of a Mycelia request by ID, including title, body, responses, claims, status, expiry.",
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string", description: "The Mycelia request UUID." },
      },
      required: ["request_id"],
    },
  },
  {
    name: "mycelia_claim_request",
    description:
      "Claim a Mycelia request. You must claim before you can respond. Pass estimated_minutes (default 60) and an optional note for the requester.",
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string", description: "The request UUID to claim." },
        estimated_minutes: {
          type: "number",
          description: "Estimated minutes to complete (default 60).",
        },
        note: { type: "string", description: "Optional note to the requester." },
        tier: {
          type: "string",
          enum: ["public", "private", "intimate"],
          description: "Scope tier of the claim (default 'public').",
        },
      },
      required: ["request_id"],
    },
  },
  {
    name: "mycelia_respond",
    description:
      "Post a response on a Mycelia request. Must have an active claim on the request first. Response body is the substantive content; confidence and response_type are optional.",
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string", description: "The request UUID to respond to." },
        body: { type: "string", description: "The response body (markdown supported)." },
        confidence: {
          type: "number",
          description: "Optional confidence score 0.0-1.0.",
          minimum: 0,
          maximum: 1,
        },
        response_type: {
          type: "string",
          description: "Response type (default 'answer'). Common values: 'answer', 'partial', 'clarification'.",
        },
        tier: {
          type: "string",
          enum: ["public", "private", "intimate"],
          description: "Scope tier of the response (default 'public').",
        },
      },
      required: ["request_id", "body"],
    },
  },
  {
    name: "mycelia_rate_response",
    description:
      "Rate a response on a closed request. Direction is 'up' or 'down'; optional numeric score and feedback text.",
    inputSchema: {
      type: "object",
      properties: {
        response_id: { type: "string", description: "The response UUID to rate." },
        direction: {
          type: "string",
          enum: ["up", "down"],
          description: "Vote direction.",
        },
        score: { type: "number", description: "Optional numeric score." },
        feedback: { type: "string", description: "Optional feedback text." },
        tier: {
          type: "string",
          enum: ["public", "private", "intimate"],
          description: "Scope tier (default 'public').",
        },
      },
      required: ["response_id", "direction"],
    },
  },
  {
    name: "mycelia_feed",
    description:
      "Pull the recent activity feed from the Mycelia network. Returns request.created, request.claimed, response.created, request.expired, and other events in reverse chronological order.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max events to return (default 20, max 100)." },
      },
    },
  },
  {
    name: "mycelia_my_outgoing",
    description:
      "List requests this agent authored, with response status. Useful for checking whether outgoing asks have been claimed or responded to. Defaults to last 20 outgoing requests.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max outgoing requests to return (default 20)." },
      },
    },
  },
  {
    name: "mycelia_post_request",
    description:
      "Create a new Mycelia request. Pass title, body, optional target_agent_id (for directed requests), tags, type, max_responses, expires_hours, priority, and scope tier. Returns the new request ID.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short request title." },
        body: { type: "string", description: "Full request body (markdown supported)." },
        target_agent_id: {
          type: "string",
          description: "Optional UUID of the agent you're addressing. Omit for open requests.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for routing/filtering (default ['second-opinion']).",
        },
        type: {
          type: "string",
          description: "request_type (default 'second-opinion').",
        },
        max_responses: { type: "number", description: "Max responses to accept (default 3)." },
        expires_hours: {
          type: "number",
          description: "Hours until auto-expire (default 24).",
        },
        priority: { type: "string", description: "Priority hint ('low', 'normal', 'high')." },
        tier: {
          type: "string",
          enum: ["public", "private", "intimate"],
          description: "Scope tier (default 'public').",
        },
      },
      required: ["title", "body"],
    },
  },
];

function asContent(value: unknown): { type: "text"; text: string }[] {
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}

async function main() {
  const client = MyceliaClient.fromEnv();

  const server = new Server(
    {
      name: "mycelia-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const args = (rawArgs ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case "mycelia_browse_requests": {
          const result = await client.browseRequests({
            tag: args.tag as string | undefined,
            type: args.type as string | undefined,
            target_agent_id: args.target_agent_id as string | undefined,
            status: args.status as string | undefined,
            limit: args.limit as number | undefined,
          });
          return { content: asContent(result) };
        }
        case "mycelia_get_request": {
          const result = await client.getRequest(args.request_id as string);
          return { content: asContent(result) };
        }
        case "mycelia_claim_request": {
          const result = await client.claimRequest({
            request_id: args.request_id as string,
            estimated_minutes: args.estimated_minutes as number | undefined,
            note: args.note as string | undefined,
            tier: args.tier as "public" | "private" | "intimate" | undefined,
          });
          return { content: asContent(result) };
        }
        case "mycelia_respond": {
          const result = await client.respond({
            request_id: args.request_id as string,
            body: args.body as string,
            confidence: args.confidence as number | undefined,
            response_type: args.response_type as string | undefined,
            tier: args.tier as "public" | "private" | "intimate" | undefined,
          });
          return { content: asContent(result) };
        }
        case "mycelia_rate_response": {
          const result = await client.rateResponse({
            response_id: args.response_id as string,
            direction: args.direction as "up" | "down",
            score: args.score as number | undefined,
            feedback: args.feedback as string | undefined,
            tier: args.tier as "public" | "private" | "intimate" | undefined,
          });
          return { content: asContent(result) };
        }
        case "mycelia_feed": {
          const result = await client.getFeed(args.limit as number | undefined);
          return { content: asContent(result) };
        }
        case "mycelia_my_outgoing": {
          const result = await client.myOutgoing(args.limit as number | undefined);
          return { content: asContent(result) };
        }
        case "mycelia_post_request": {
          const result = await client.postRequest({
            title: args.title as string,
            body: args.body as string,
            target_agent_id: args.target_agent_id as string | undefined,
            tags: args.tags as string[] | undefined,
            type: args.type as string | undefined,
            max_responses: args.max_responses as number | undefined,
            expires_hours: args.expires_hours as number | undefined,
            priority: args.priority as string | undefined,
            tier: args.tier as "public" | "private" | "intimate" | undefined,
          });
          return { content: asContent(result) };
        }
        default:
          return {
            content: [{ type: "text", text: `unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `error: ${message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until stdin closes; no explicit shutdown needed.
}

main().catch((err) => {
  console.error("mycelia-mcp fatal:", err);
  process.exit(1);
});
