// NOR-125: fleet key file selection must fail CLOSED. Only an absent file (or MYCELIA_ENV_FILE=none) may fall back
// to the inherited env key. Cases from Codex's final audit of 155d682 are marked [Codex H1/H2/M3].
import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MyceliaClient, readFleetKeyFromFile } from "./mycelia-client";

const GOOD = "AAAAAAAAAAAAAAAA1234";
const NEWER = "BBBBBBBBBBBBBBBB5678";
let dir: string;
const saved = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fleetkey-"));
  process.env.MYCELIA_MCP_AGENT_NAME = "MARGIN";
  process.env.MYCELIA_PERSONAL_AGENT_ID_MARGIN = "agent-margin";
  process.env.MYCELIA_PERSONAL_KEY_MARGIN = "INHERITEDENVKEY0000";
  process.env.MYCELIA_PERSONAL_API_BASE = "https://example.invalid";
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});
const file = (body: string) => {
  const p = join(dir, "mycelia.env");
  writeFileSync(p, body);
  process.env.MYCELIA_ENV_FILE = p;
  return p;
};
const keyOf = (c: MyceliaClient) => (c as any).config.apiKey as string;

test("absent file -> absent, env key used", () => {
  process.env.MYCELIA_ENV_FILE = join(dir, "nope.env");
  expect(readFleetKeyFromFile("MARGIN")).toEqual({ kind: "absent" });
  expect(keyOf(MyceliaClient.fromEnv())).toBe("INHERITEDENVKEY0000");
});

test("MYCELIA_ENV_FILE=none -> absent, env key used", () => {
  process.env.MYCELIA_ENV_FILE = "none";
  expect(readFleetKeyFromFile("MARGIN").kind).toBe("absent");
  expect(keyOf(MyceliaClient.fromEnv())).toBe("INHERITEDENVKEY0000");
});

test("own valid key -> file key wins over env", () => {
  file(`MYCELIA_PERSONAL_KEY_MARGIN=${GOOD}\n`);
  expect(keyOf(MyceliaClient.fromEnv())).toBe(GOOD);
});

test("[Codex H1] readable file without this agent's key -> refuse, never the env key", () => {
  file(`MYCELIA_PERSONAL_KEY_CEECEE=${GOOD}\n`);
  expect(readFleetKeyFromFile("MARGIN").kind).toBe("error");
  expect(() => MyceliaClient.fromEnv()).toThrow(/refusing to start/);
});

test("[Codex H1] empty file -> refuse", () => {
  file("");
  expect(() => MyceliaClient.fromEnv()).toThrow(/no MYCELIA_PERSONAL_KEY_MARGIN/);
});

test("[Codex H2] only malformed assignments -> refuse", () => {
  file("MYCELIA_PERSONAL_KEY_MARGIN=short\n");
  expect(() => MyceliaClient.fromEnv()).toThrow(/none valid/);
});

// Codex audit 3873573 (MEDIUM): an early `return` under root counted as a PASS. Skip explicitly instead; the EISDIR
// test below is the root-proof non-ENOENT case.
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
test.skipIf(isRoot)("[Codex H2] unreadable file (non-ENOENT) -> refuse", () => {
  const p = file(`MYCELIA_PERSONAL_KEY_MARGIN=${GOOD}\n`);
  chmodSync(p, 0o000);
  try {
    expect(readFleetKeyFromFile("MARGIN").kind).toBe("error");
    expect(() => MyceliaClient.fromEnv()).toThrow(/could not read/);
  } finally {
    chmodSync(p, 0o600);
  }
});

test("[Codex H2] path is a directory (EISDIR) -> refuse", () => {
  process.env.MYCELIA_ENV_FILE = dir;
  expect(() => MyceliaClient.fromEnv()).toThrow(/could not read/);
});

test("[Codex M3] earlier malformed line does not defeat a later valid one", () => {
  file(`MYCELIA_PERSONAL_KEY_MARGIN=short\nMYCELIA_PERSONAL_KEY_MARGIN=${GOOD}\n`);
  expect(keyOf(MyceliaClient.fromEnv())).toBe(GOOD);
});

test("last valid assignment wins; a later malformed line is skipped", () => {
  file(`MYCELIA_PERSONAL_KEY_MARGIN=${GOOD}\nexport MYCELIA_PERSONAL_KEY_MARGIN="${NEWER}"\nMYCELIA_PERSONAL_KEY_MARGIN=bad\n`);
  expect(keyOf(MyceliaClient.fromEnv())).toBe(NEWER);
});

test("file never changes base URL or agent id, and never writes process.env", () => {
  file(`MYCELIA_PERSONAL_KEY_MARGIN=${GOOD}\nMYCELIA_PERSONAL_API_BASE=http://evil.invalid\nMYCELIA_PERSONAL_AGENT_ID_MARGIN=other\n`);
  const c = MyceliaClient.fromEnv() as any;
  expect(c.config.baseUrl).toBe("https://example.invalid");
  expect(c.config.agentId).toBe("agent-margin");
  expect(process.env.MYCELIA_PERSONAL_KEY_MARGIN).toBe("INHERITEDENVKEY0000");
});
