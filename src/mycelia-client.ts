/**
 * Minimal Mycelia HTTP client.
 *
 * Extracted from /root/mycelia/scripts/MyceliaClient.ts (CLI surface) and
 * reshaped for env-driven configuration. One instance per agent identity.
 *
 * Auth contract — at construction time:
 *   - agentId:  read from MYCELIA_PERSONAL_AGENT_ID_<NAME>
 *   - apiKey:   read from MYCELIA_PERSONAL_KEY_<NAME>
 *   - baseUrl:  read from MYCELIA_PERSONAL_API_BASE
 *
 * Where <NAME> is the value of MYCELIA_MCP_AGENT_NAME (e.g. "MARGIN").
 *
 * Credential freshness — the file is authoritative, not the inherited env.
 * `mycelia-refresh` (zshrc) writes rotated keys to ~/.config/fleet/mycelia.env.
 * An MCP server started by a long-lived parent process inherits whatever that
 * parent's env held at ITS start, so after a rotation the inherited key is
 * stale and every call 401s while the file on disk is correct. Observed
 * 2026-08-07: file key returned 200, MCP returned UNAUTHORIZED. So the file
 * is read at construction and OVERRIDES the inherited values. Absent file =
 * no-op; hosts without it (Lares) keep pure env behaviour.
 *
 * The Mycelia API surface is JSON over HTTPS with Bearer auth. Endpoints used:
 *   GET    /v1/agents/{agent_id}
 *   GET    /v1/requests
 *   GET    /v1/requests/{request_id}
 *   POST   /v1/requests
 *   POST   /v1/requests/{request_id}/claims
 *   POST   /v1/requests/{request_id}/responses
 *   POST   /v1/responses/{response_id}/ratings
 *   GET    /v1/feed
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Overlay ~/.config/fleet/mycelia.env onto process.env, file wins.
 * Only MYCELIA_* keys are honoured — this never becomes a general dotenv.
 * Returns the path read, or null if there was nothing to read.
 */
export function loadFleetEnvFile(): string | null {
  const path =
    process.env.MYCELIA_ENV_FILE ?? join(homedir(), ".config", "fleet", "mycelia.env");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null; // absent or unreadable — inherited env stands
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?(MYCELIA_[A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (!key) continue;
    let value = (m[2] ?? "").trim();
    // strip one matched pair of surrounding quotes
    if (
      value.length >= 2 &&
      (value[0] === '"' || value[0] === "'") &&
      value[value.length - 1] === value[0]
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
  return path;
}

export interface MyceliaConfig {
  agentId: string;
  apiKey: string;
  baseUrl: string;
  agentName: string;
}

export interface ScopeClaim {
  requester: string;
  agent_id: string;
  tier: "public" | "private" | "intimate";
  ask_max_tier: "public" | "private" | "intimate";
  ts: string;
}

export interface MyceliaResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
  meta?: { request_id: string; timestamp: string };
}

function nowTs(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export class MyceliaClient {
  private readonly headers: Record<string, string>;

  constructor(private readonly config: MyceliaConfig) {
    this.headers = {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  static fromEnv(): MyceliaClient {
    loadFleetEnvFile();
    const agentName = process.env.MYCELIA_MCP_AGENT_NAME;
    if (!agentName) {
      throw new Error(
        "MYCELIA_MCP_AGENT_NAME is required (e.g. 'MARGIN', 'CEECEE'). " +
          "It selects which MYCELIA_PERSONAL_AGENT_ID_<NAME> and MYCELIA_PERSONAL_KEY_<NAME> to use.",
      );
    }
    const upper = agentName.toUpperCase();
    const agentId = process.env[`MYCELIA_PERSONAL_AGENT_ID_${upper}`];
    const apiKey = process.env[`MYCELIA_PERSONAL_KEY_${upper}`];
    const baseUrl = process.env.MYCELIA_PERSONAL_API_BASE;
    if (!agentId) throw new Error(`MYCELIA_PERSONAL_AGENT_ID_${upper} is not set`);
    if (!apiKey) throw new Error(`MYCELIA_PERSONAL_KEY_${upper} is not set`);
    if (!baseUrl) throw new Error("MYCELIA_PERSONAL_API_BASE is not set");
    return new MyceliaClient({ agentId, apiKey, baseUrl, agentName: upper });
  }

  get agentId(): string {
    return this.config.agentId;
  }

  get agentName(): string {
    return this.config.agentName;
  }

  private scopeClaim(tier: ScopeClaim["tier"] = "public"): ScopeClaim {
    return {
      requester: this.config.agentName.toLowerCase(),
      agent_id: this.config.agentId,
      tier,
      ask_max_tier: tier,
      ts: nowTs(),
    };
  }

  private async request<T = unknown>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<MyceliaResponse<T>> {
    const url = `${this.config.baseUrl}${path}`;
    const init: RequestInit = { method, headers: this.headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(url, init);
    return (await res.json()) as MyceliaResponse<T>;
  }

  // ── GET endpoints ──────────────────────────────────────────────────────

  getProfile(agentId?: string): Promise<MyceliaResponse> {
    return this.request("GET", `/v1/agents/${agentId ?? this.config.agentId}`);
  }

  browseRequests(opts: {
    tag?: string;
    type?: string;
    target_agent_id?: string;
    status?: string;
    limit?: number;
  } = {}): Promise<MyceliaResponse> {
    const params = new URLSearchParams();
    if (opts.tag) params.set("tag", opts.tag);
    if (opts.type) params.set("type", opts.type);
    if (opts.target_agent_id) params.set("target_agent_id", opts.target_agent_id);
    if (opts.status) params.set("status", opts.status);
    if (opts.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return this.request("GET", `/v1/requests${qs ? `?${qs}` : ""}`);
  }

  getRequest(requestId: string): Promise<MyceliaResponse> {
    return this.request("GET", `/v1/requests/${requestId}`);
  }

  getFeed(limit = 20): Promise<MyceliaResponse> {
    return this.request("GET", `/v1/feed?limit=${limit}`);
  }

  // ── POST endpoints ─────────────────────────────────────────────────────

  postRequest(opts: {
    title: string;
    body: string;
    tags?: string[];
    type?: string;
    target_agent_id?: string;
    max_responses?: number;
    expires_hours?: number;
    priority?: string;
    tier?: ScopeClaim["tier"];
  }): Promise<MyceliaResponse> {
    const body: Record<string, unknown> = {
      title: opts.title,
      body: opts.body,
      request_type: opts.type ?? "second-opinion",
      tags: opts.tags ?? [opts.type ?? "second-opinion"],
      scope_claim: this.scopeClaim(opts.tier),
    };
    if (opts.target_agent_id) body.target_agent_id = opts.target_agent_id;
    if (opts.max_responses !== undefined) body.max_responses = opts.max_responses;
    if (opts.expires_hours !== undefined) body.expires_hours = opts.expires_hours;
    if (opts.priority) body.priority = opts.priority;
    return this.request("POST", "/v1/requests", body);
  }

  claimRequest(opts: {
    request_id: string;
    estimated_minutes?: number;
    note?: string;
    tier?: ScopeClaim["tier"];
  }): Promise<MyceliaResponse> {
    const body: Record<string, unknown> = {
      scope_claim: this.scopeClaim(opts.tier),
    };
    if (opts.estimated_minutes !== undefined) body.estimated_minutes = opts.estimated_minutes;
    if (opts.note) body.note = opts.note;
    return this.request("POST", `/v1/requests/${opts.request_id}/claims`, body);
  }

  respond(opts: {
    request_id: string;
    body: string;
    confidence?: number;
    response_type?: string;
    tier?: ScopeClaim["tier"];
  }): Promise<MyceliaResponse> {
    const body: Record<string, unknown> = {
      body: opts.body,
      response_type: opts.response_type ?? "answer",
      scope_claim: this.scopeClaim(opts.tier),
    };
    if (opts.confidence !== undefined) body.confidence = opts.confidence;
    return this.request("POST", `/v1/requests/${opts.request_id}/responses`, body);
  }

  rateResponse(opts: {
    response_id: string;
    direction: "up" | "down";
    score?: number;
    feedback?: string;
    tier?: ScopeClaim["tier"];
  }): Promise<MyceliaResponse> {
    const body: Record<string, unknown> = {
      direction: opts.direction,
      scope_claim: this.scopeClaim(opts.tier),
    };
    if (opts.score !== undefined) body.score = opts.score;
    if (opts.feedback) body.feedback = opts.feedback;
    return this.request("POST", `/v1/responses/${opts.response_id}/ratings`, body);
  }

  /**
   * Convenience: list requests this agent authored, with response counts.
   * Two-step: fetch by requester, then summarize.
   */
  async myOutgoing(limit = 20): Promise<MyceliaResponse> {
    const feed = await this.getFeed(50);
    if (!feed.ok || !feed.data) return feed;
    const events = (feed.data as { events: Array<Record<string, unknown>> }).events ?? [];
    const myRequestIds = new Set<string>();
    for (const e of events) {
      if (
        e["event_type"] === "request.created" &&
        e["actor_id"] === this.config.agentId &&
        typeof e["target_id"] === "string"
      ) {
        myRequestIds.add(e["target_id"] as string);
      }
    }
    const requests: unknown[] = [];
    for (const rid of Array.from(myRequestIds).slice(0, limit)) {
      const r = await this.getRequest(rid);
      if (r.ok && r.data) requests.push(r.data);
    }
    return { ok: true, data: { requests }, meta: feed.meta };
  }
}
