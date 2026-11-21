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
 * Credential freshness: for the API KEY only, a key file wins over the inherited
 * environment. A server started by a long-lived parent process inherits whatever
 * that parent's environment held at ITS start, so after a key rotation the
 * inherited key is stale and every call is refused while the rotated key sits
 * on disk. So this agent's key, and nothing else, is read from the key file at
 * construction (`readFleetKeyFromFile`). A host with no such file keeps pure
 * environment behaviour. The design and its review log are
 * docs/DESIGN-nor-648-fleet-key-file.md.
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

import { lstatSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Where the key file is when `MYCELIA_ENV_FILE` does not name one. */
export const DEFAULT_FLEET_KEY_FILE = "~/.config/fleet/mycelia.env";

/** The value of `MYCELIA_ENV_FILE` that switches the key file off. */
export const FLEET_KEY_FILE_OFF = "none";

/**
 * What reading the key file found.
 *
 *   absent -> no file, or the file switched off (`MYCELIA_ENV_FILE=none`): the
 *             inherited environment key stands, so a host without the file
 *             behaves as it always did. A link whose target is missing is NOT
 *             absent (`notAbsentBecause`).
 *   key    -> the LAST VALID assignment for this agent.
 *   error  -> the file is there and cannot be read, or holds no valid key for
 *             this agent: `fromEnv()` refuses to start. Falling back to the
 *             inherited key here would be the silent stale key this exists to
 *             prevent.
 */
export type FleetKeyResult =
  | { kind: "absent" }
  | { kind: "key"; value: string }
  | { kind: "error"; why: string };

/** The error code of a failed file call, or "unknown error". Never its text. */
function codeOf(e: unknown): string {
  return e instanceof Error && "code" in e && typeof e.code === "string"
    ? e.code
    : "unknown error";
}

/**
 * Whether a path that answered "no such file" is really absent.
 *
 * "No such file" does not prove there is no key file. It is also the answer
 * for a link whose target is missing, at the path itself or at any folder
 * above it: a key file that is THERE and broken, which is plausible in the
 * middle of a rotation. Calling that "absent" would start the server on the
 * inherited key without a word, the one thing this reader exists to prevent
 * (audit r1). So the path is walked upward from the file:
 *
 *   - the first name that exists and is a link whose target does not resolve:
 *     NOT absent. There is a key file, and it cannot be read;
 *   - the first name that exists and is anything else (a folder, or a link
 *     that resolves): absent. The names below it really are not there;
 *   - a name that cannot be examined at all: NOT absent. Absence could not be
 *     established, and that is not the same as absent.
 *
 * Returns `null` for absent, or the reason it is not.
 */
function notAbsentBecause(path: string): string | null {
  let current = path;
  for (;;) {
    let isLink: boolean;
    try {
      isLink = lstatSync(current).isSymbolicLink();
    } catch (e) {
      const code = codeOf(e);
      if (code !== "ENOENT") return `could not be examined (${code})`;
      const parent = dirname(current);
      /* v8 ignore next -- @preserve: the root always exists, so the walk ends above; this only stops a loop if dirname ever returned its argument */
      if (parent === current) return null;
      current = parent;
      continue;
    }
    if (!isLink) return null;
    try {
      statSync(current);
      return null;
    } catch {
      return "is a link whose target is missing, or lies under one";
    }
  }
}

/**
 * Read ONLY this agent's key (`MYCELIA_PERSONAL_KEY_<NAME>`) from the key file.
 *
 * One value, returned and never written to `process.env`. The base URL and the
 * agent id stay environment-only, so the file cannot redirect the destination
 * or switch the identity (an earlier version overlaid every `MYCELIA_*` name
 * and could do both).
 *
 * ⚠️ No message built here may carry a value. A malformed assignment is named
 * by its variable, never quoted. A path given in `MYCELIA_ENV_FILE` is never
 * echoed either: someone who puts a key where the path belongs must not get it
 * back in a log (design review r1). Only the fixed default path is named.
 */
export function readFleetKeyFromFile(agentNameUpper: string): FleetKeyResult {
  const configured = process.env.MYCELIA_ENV_FILE;
  if (configured === FLEET_KEY_FILE_OFF) return { kind: "absent" };
  const path = configured ?? join(homedir(), ".config", "fleet", "mycelia.env");
  const where =
    configured === undefined
      ? DEFAULT_FLEET_KEY_FILE
      : "the file named by MYCELIA_ENV_FILE";
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    const code = codeOf(e);
    if (code !== "ENOENT") {
      return { kind: "error", why: `could not read ${where} (${code})` };
    }
    const reason = notAbsentBecause(path);
    if (reason === null) return { kind: "absent" };
    return { kind: "error", why: `${where} ${reason}` };
  }
  const want = `MYCELIA_PERSONAL_KEY_${agentNameUpper}`;
  let found: string | null = null;
  let malformed = 0;
  for (const line of raw.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m?.[1] !== want) continue;
    let value = (m[2] ?? "").trim();
    const quote = value[0];
    if (
      value.length >= 2 &&
      (quote === '"' || quote === "'") &&
      value.endsWith(quote)
    ) {
      value = value.slice(1, -1);
    }
    if (!/^[A-Za-z0-9._~+/=-]{16,512}$/.test(value)) {
      malformed++;
      console.error(
        `mycelia-mcp: ${want} in ${where} has a malformed assignment (ignored)`,
      );
      continue; // a malformed line must not defeat a later valid one
    }
    found = value; // the last VALID assignment wins
  }
  if (found !== null) return { kind: "key", value: found };
  return {
    kind: "error",
    why:
      malformed > 0
        ? `${where} has ${malformed} assignment(s) of ${want}, none valid`
        : `${where} exists but has no ${want}`,
  };
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
    const fileKey = readFleetKeyFromFile(upper);
    if (fileKey.kind === "error") {
      // Fail closed: a key file that is there and unusable must not fall back
      // to an inherited key that may be stale.
      throw new Error(
        `mycelia-mcp: refusing to start: ${fileKey.why}. ` +
          "Fix the file, or set MYCELIA_ENV_FILE=none to use the environment key.",
      );
    }
    const apiKey =
      fileKey.kind === "key"
        ? fileKey.value
        : process.env[`MYCELIA_PERSONAL_KEY_${upper}`];
    const baseUrl = process.env.MYCELIA_PERSONAL_API_BASE;
    if (!agentId)
      throw new Error(`MYCELIA_PERSONAL_AGENT_ID_${upper} is not set`);
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
    const init: RequestInit = {
      method,
      headers: this.headers,
      signal: ctrl.signal,
    };
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
    const id =
      agentId === undefined
        ? this.config.agentId
        : assertSafeId(agentId, "agentId");
    return this.request("GET", `/v1/agents/${encodeURIComponent(id)}`);
  }

  browseRequests(
    opts: {
      tag?: string;
      type?: string;
      target_agent_id?: string;
      status?: string;
      limit?: number;
    } = {},
  ): Promise<MyceliaResponse> {
    const params = new URLSearchParams();
    if (opts.tag) params.set("tag", String(opts.tag).slice(0, 64));
    if (opts.type) params.set("type", String(opts.type).slice(0, 64));
    if (opts.target_agent_id) {
      params.set(
        "target_agent_id",
        assertSafeId(opts.target_agent_id, "target_agent_id"),
      );
    }
    if (opts.status) params.set("status", String(opts.status).slice(0, 32));
    if (opts.limit !== undefined)
      params.set("limit", String(boundLimit(opts.limit)));
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
    if (opts.max_responses !== undefined)
      body.max_responses = opts.max_responses;
    if (opts.expires_hours !== undefined)
      body.expires_hours = opts.expires_hours;
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
    if (opts.estimated_minutes !== undefined)
      body.estimated_minutes = opts.estimated_minutes;
    if (opts.note) body.note = opts.note;
    const id = assertSafeId(opts.request_id, "request_id");
    return this.request(
      "POST",
      `/v1/requests/${encodeURIComponent(id)}/claims`,
      body,
    );
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
    return this.request(
      "POST",
      `/v1/requests/${encodeURIComponent(id)}/responses`,
      body,
    );
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
    return this.request(
      "POST",
      `/v1/responses/${encodeURIComponent(id)}/ratings`,
      body,
    );
  }

  /**
   * Convenience: list requests this agent authored, with response counts.
   * Two-step: fetch by requester, then summarize.
   */
  async myOutgoing(limit = 20): Promise<MyceliaResponse> {
    const feed = await this.getFeed(50);
    if (!feed.ok || !feed.data) return feed;
    const events =
      (feed.data as { events: Array<Record<string, unknown>> }).events ?? [];
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
