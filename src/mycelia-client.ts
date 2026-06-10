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

/**
 * Path-segment guard. Mycelia request/response/agent IDs are UUIDs. Anything
 * containing '/', '?', '#', '..', or non-URL-safe chars is hostile or wrong —
 * reject upfront rather than encodeURIComponent and pass through. Belt and
 * suspenders: encodeURIComponent IS still applied at the URL build step.
 */
const UUID_LIKE = /^[A-Za-z0-9._-]{1,128}$/;
function assertSafeId(value: unknown, paramName: string): string {
  if (typeof value !== "string") {
    throw new Error(`${paramName} must be a string (got ${typeof value})`);
  }
  if (!UUID_LIKE.test(value)) {
    throw new Error(
      `${paramName} contains disallowed characters or is empty/oversized. ` +
        `Mycelia IDs are URL-safe tokens up to 128 chars: [A-Za-z0-9._-].`,
    );
  }
  return value;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_LIMIT = 100;
function boundLimit(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : 20;
  return Math.max(1, Math.min(MAX_LIMIT, v));
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
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
    const init: RequestInit = { method, headers: this.headers, signal: ctrl.signal };
    if (body !== undefined) init.body = JSON.stringify(body);
    try {
      const res = await fetch(url, init);
      // Try to parse JSON; if upstream returns non-JSON (HTML error page from a
      // proxy, plaintext from a load balancer), surface a typed error rather
      // than throw raw "Unexpected token < ..." up the stack.
      const text = await res.text();
      let parsed: MyceliaResponse<T> | null = null;
      try {
        parsed = JSON.parse(text) as MyceliaResponse<T>;
      } catch {
        return {
          ok: false,
          error: {
            code: `HTTP_${res.status}_NON_JSON`,
            // Cap body excerpt so a 500KB error page doesn't dominate transcript
            message: `Upstream returned non-JSON (status ${res.status}): ${text.slice(0, 200)}`,
          },
        };
      }
      return parsed;
    } catch (err: unknown) {
      // Never echo the err.message blind; some runtimes include URL +
      // sometimes auth header in transport-error messages. Surface only the
      // error class and HTTP-shape.
      const cls = err instanceof Error ? err.name : "UnknownError";
      const aborted = (err as { name?: string }).name === "AbortError";
      return {
        ok: false,
        error: {
          code: aborted ? "FETCH_TIMEOUT" : `FETCH_${cls.toUpperCase()}`,
          message: aborted
            ? `Mycelia API did not respond within ${DEFAULT_TIMEOUT_MS}ms`
            : `Network error contacting Mycelia API (${cls})`,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // ── GET endpoints ──────────────────────────────────────────────────────

  getProfile(agentId?: string): Promise<MyceliaResponse> {
    const id = agentId === undefined ? this.config.agentId : assertSafeId(agentId, "agentId");
    return this.request("GET", `/v1/agents/${encodeURIComponent(id)}`);
  }

  browseRequests(opts: {
    tag?: string;
    type?: string;
    target_agent_id?: string;
    status?: string;
    limit?: number;
  } = {}): Promise<MyceliaResponse> {
    const params = new URLSearchParams();
    if (opts.tag) params.set("tag", String(opts.tag).slice(0, 64));
    if (opts.type) params.set("type", String(opts.type).slice(0, 64));
    if (opts.target_agent_id) {
      params.set("target_agent_id", assertSafeId(opts.target_agent_id, "target_agent_id"));
    }
    if (opts.status) params.set("status", String(opts.status).slice(0, 32));
    if (opts.limit !== undefined) params.set("limit", String(boundLimit(opts.limit)));
    const qs = params.toString();
    return this.request("GET", `/v1/requests${qs ? `?${qs}` : ""}`);
  }

  getRequest(requestId: string): Promise<MyceliaResponse> {
    const id = assertSafeId(requestId, "request_id");
    return this.request("GET", `/v1/requests/${encodeURIComponent(id)}`);
  }

  getFeed(limit = 20): Promise<MyceliaResponse> {
    return this.request("GET", `/v1/feed?limit=${boundLimit(limit)}`);
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
    const id = assertSafeId(opts.request_id, "request_id");
    return this.request("POST", `/v1/requests/${encodeURIComponent(id)}/claims`, body);
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
    const id = assertSafeId(opts.request_id, "request_id");
    return this.request("POST", `/v1/requests/${encodeURIComponent(id)}/responses`, body);
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
    const id = assertSafeId(opts.response_id, "response_id");
    return this.request("POST", `/v1/responses/${encodeURIComponent(id)}/ratings`, body);
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
