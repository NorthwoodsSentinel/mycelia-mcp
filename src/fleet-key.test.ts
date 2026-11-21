// Tests for the key file reader in src/mycelia-client.ts (NOR-648): which key
// the server starts with when a key file is present, absent, switched off or
// unusable.
//
// The rule under test is "fail closed": only an ABSENT file (or the switch
// `MYCELIA_ENV_FILE=none`) may fall back to the inherited environment key.
// Cases marked [H1], [H2], [M3] reproduce findings of the reviews of the
// change this was carried from; cases marked [r1-N] are the attack cases of
// design review r1 for NOR-648, kept as written except where noted.
//
// ⚠️ Every test here names its own file in a temporary folder. The Vitest
// configuration sets `MYCELIA_ENV_FILE=none` for every test, so no test opens
// a key file in the home folder of the machine it runs on; the last test
// asserts that default is in force. The one test of the default path points
// the home folder at a scratch directory first, and stops before reading if
// that did not take effect.
//
// The reader reports a malformed assignment on `console.error`. That output is
// captured here, both to keep the run quiet and to assert that no message
// carries a key or a configured path.

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  DEFAULT_FLEET_KEY_FILE,
  FLEET_KEY_FILE_OFF,
  MyceliaClient,
  readFleetKeyFromFile,
} from "./mycelia-client.ts";

const INHERITED = "INHERITEDENVKEY0000";
const GOOD = "AAAAAAAAAAAAAAAA1234";
const NEWER = "BBBBBBBBBBBBBBBB5678";
const BASE = "https://example.invalid";

let dir: string;
let errors: MockInstance<typeof console.error>;

/** Everything the reader printed, as one string. */
function printed(): string {
  return errors.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
}

/** Write `body` to a key file in the temporary folder and name it. */
function file(body: string): string {
  const path = join(dir, "mycelia.env");
  writeFileSync(path, body);
  vi.stubEnv("MYCELIA_ENV_FILE", path);
  return path;
}

/**
 * The bearer key and the URL a client actually sends, read from one request
 * against a recording `fetch`. Nothing leaves the machine.
 */
async function sentBy(
  client: MyceliaClient,
): Promise<{ key: string; url: string }> {
  const seen: { key: string; url: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({
        key: (headers.get("Authorization") ?? "").replace(/^Bearer /, ""),
        url: String(url),
      });
      return new Response(JSON.stringify({ ok: true, data: {} }));
    }),
  );
  await client.getRequest("r1");
  return seen[0] ?? { key: "", url: "" };
}

/** The message `fromEnv()` refuses with, or "" when it does not throw. */
function refusal(): string {
  try {
    MyceliaClient.fromEnv();
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fleetkey-"));
  vi.stubEnv("MYCELIA_MCP_AGENT_NAME", "MARGIN");
  vi.stubEnv("MYCELIA_PERSONAL_AGENT_ID_MARGIN", "agent-margin");
  vi.stubEnv("MYCELIA_PERSONAL_KEY_MARGIN", INHERITED);
  vi.stubEnv("MYCELIA_PERSONAL_API_BASE", BASE);
  errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("an absent or switched-off file: the inherited key stands", () => {
  it("a file that does not exist is absent", async () => {
    vi.stubEnv("MYCELIA_ENV_FILE", join(dir, "nope.env"));
    expect(readFleetKeyFromFile("MARGIN")).toEqual({ kind: "absent" });
    expect((await sentBy(MyceliaClient.fromEnv())).key).toBe(INHERITED);
    expect(printed()).toBe("");
  });

  it("MYCELIA_ENV_FILE=none is absent, even when a file would be found", async () => {
    file(`MYCELIA_PERSONAL_KEY_MARGIN=${GOOD}\n`);
    vi.stubEnv("MYCELIA_ENV_FILE", FLEET_KEY_FILE_OFF);
    expect(readFleetKeyFromFile("MARGIN")).toEqual({ kind: "absent" });
    expect((await sentBy(MyceliaClient.fromEnv())).key).toBe(INHERITED);
  });
});

describe("a usable file: this agent's key, and nothing else", () => {
  it("the file's key wins over the inherited one", async () => {
    file(`MYCELIA_PERSONAL_KEY_MARGIN=${GOOD}\n`);
    expect(readFleetKeyFromFile("MARGIN")).toEqual({
      kind: "key",
      value: GOOD,
    });
    expect((await sentBy(MyceliaClient.fromEnv())).key).toBe(GOOD);
  });

  it("reads `export`, quotes and surrounding space", () => {
    for (const line of [
      `export MYCELIA_PERSONAL_KEY_MARGIN=${GOOD}`,
      `MYCELIA_PERSONAL_KEY_MARGIN="${GOOD}"`,
      `MYCELIA_PERSONAL_KEY_MARGIN='${GOOD}'`,
      `  MYCELIA_PERSONAL_KEY_MARGIN=  ${GOOD}  `,
    ]) {
      file(`${line}\n`);
      expect(readFleetKeyFromFile("MARGIN"), line).toEqual({
        kind: "key",
        value: GOOD,
      });
    }
  });

  it("never changes the base URL or the agent id, and never writes the environment", async () => {
    file(
      `MYCELIA_PERSONAL_KEY_MARGIN=${GOOD}\n` +
        "MYCELIA_PERSONAL_API_BASE=http://evil.invalid\n" +
        "MYCELIA_PERSONAL_AGENT_ID_MARGIN=other\n",
    );
    const client = MyceliaClient.fromEnv();
    expect(client.agentId).toBe("agent-margin");
    const sent = await sentBy(client);
    expect(sent.key).toBe(GOOD);
    expect(sent.url.startsWith(`${BASE}/`)).toBe(true);
    expect(process.env.MYCELIA_PERSONAL_KEY_MARGIN).toBe(INHERITED);
    expect(process.env.MYCELIA_PERSONAL_API_BASE).toBe(BASE);
  });
});

describe("the last valid assignment wins; a malformed one is skipped aloud", () => {
  it("[M3] an earlier malformed line does not defeat a later valid one", async () => {
    file(
      `MYCELIA_PERSONAL_KEY_MARGIN=short\nMYCELIA_PERSONAL_KEY_MARGIN=${GOOD}\n`,
    );
    expect((await sentBy(MyceliaClient.fromEnv())).key).toBe(GOOD);
  });

  it("a later malformed line is skipped, and the last valid one stands", async () => {
    file(
      `MYCELIA_PERSONAL_KEY_MARGIN=${GOOD}\n` +
        `export MYCELIA_PERSONAL_KEY_MARGIN="${NEWER}"\n` +
        "MYCELIA_PERSONAL_KEY_MARGIN=bad\n",
    );
    expect((await sentBy(MyceliaClient.fromEnv())).key).toBe(NEWER);
  });

  it("[r1-2] malformed then valid: one diagnostic, naming the variable and no value", () => {
    file(
      "MYCELIA_PERSONAL_KEY_MARGIN=LEAKME\n" +
        `MYCELIA_PERSONAL_KEY_MARGIN=${GOOD}\n`,
    );
    expect(readFleetKeyFromFile("MARGIN")).toEqual({
      kind: "key",
      value: GOOD,
    });
    expect(errors).toHaveBeenCalledTimes(1);
    expect(printed()).toBe(
      "mycelia-mcp: MYCELIA_PERSONAL_KEY_MARGIN in the file named by MYCELIA_ENV_FILE has a malformed assignment (ignored)",
    );
    expect(printed()).not.toContain("LEAKME");
    expect(printed()).not.toContain(GOOD);
  });

  it("[r1-3] valid, malformed, then valid: the last valid one, one diagnostic", () => {
    file(
      `MYCELIA_PERSONAL_KEY_MARGIN=${GOOD}\n` +
        "MYCELIA_PERSONAL_KEY_MARGIN=bad\n" +
        `export MYCELIA_PERSONAL_KEY_MARGIN='${NEWER}'\n`,
    );
    expect(readFleetKeyFromFile("MARGIN")).toEqual({
      kind: "key",
      value: NEWER,
    });
    expect(errors).toHaveBeenCalledTimes(1);
    expect(printed()).not.toContain(GOOD);
    expect(printed()).not.toContain(NEWER);
  });

  it("a value outside the key format is malformed: too short, too long, a space, an open quote", () => {
    for (const value of [
      "short",
      "A".repeat(513),
      "AAAAAAAAAAAAAAAA 1234",
      `"${GOOD}`,
      "",
    ]) {
      file(`MYCELIA_PERSONAL_KEY_MARGIN=${value}\n`);
      const result = readFleetKeyFromFile("MARGIN");
      expect(result.kind, JSON.stringify(value)).toBe("error");
    }
    // A 16-character and a 512-character value are inside it.
    for (const value of ["A".repeat(16), "A".repeat(512)]) {
      file(`MYCELIA_PERSONAL_KEY_MARGIN=${value}\n`);
      expect(readFleetKeyFromFile("MARGIN")).toEqual({ kind: "key", value });
    }
  });
});

describe("fail closed: a file that is there and unusable refuses to start", () => {
  it("[H1] a readable file without this agent's key", () => {
    file(`MYCELIA_PERSONAL_KEY_OTHER=${GOOD}\n`);
    expect(readFleetKeyFromFile("MARGIN")).toEqual({
      kind: "error",
      why: "the file named by MYCELIA_ENV_FILE exists but has no MYCELIA_PERSONAL_KEY_MARGIN",
    });
    expect(refusal()).toBe(
      "mycelia-mcp: refusing to start: the file named by MYCELIA_ENV_FILE exists but has no MYCELIA_PERSONAL_KEY_MARGIN. " +
        "Fix the file, or set MYCELIA_ENV_FILE=none to use the environment key.",
    );
  });

  it("[H1] an empty file", () => {
    file("");
    expect(refusal()).toContain(
      "exists but has no MYCELIA_PERSONAL_KEY_MARGIN",
    );
  });

  it("[H2] only malformed assignments", () => {
    file(
      "MYCELIA_PERSONAL_KEY_MARGIN=short\nMYCELIA_PERSONAL_KEY_MARGIN=also bad\n",
    );
    expect(refusal()).toContain(
      "the file named by MYCELIA_ENV_FILE has 2 assignment(s) of MYCELIA_PERSONAL_KEY_MARGIN, none valid",
    );
    expect(errors).toHaveBeenCalledTimes(2);
  });

  // Run as root, a file with no permissions is still readable, so the case
  // cannot fail there and is skipped by name instead of passing by accident.
  // The directory case below needs no permission bits and runs everywhere.
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  it.skipIf(isRoot)("[H2] a file the process cannot read", () => {
    const path = file(`MYCELIA_PERSONAL_KEY_MARGIN=${GOOD}\n`);
    chmodSync(path, 0o000);
    try {
      expect(readFleetKeyFromFile("MARGIN")).toEqual({
        kind: "error",
        why: "could not read the file named by MYCELIA_ENV_FILE (EACCES)",
      });
      expect(refusal()).toContain("refusing to start: could not read");
    } finally {
      chmodSync(path, 0o600);
    }
  });

  it("[H2] a path that is a directory", () => {
    vi.stubEnv("MYCELIA_ENV_FILE", dir);
    expect(readFleetKeyFromFile("MARGIN")).toEqual({
      kind: "error",
      why: "could not read the file named by MYCELIA_ENV_FILE (EISDIR)",
    });
    expect(refusal()).toContain("refusing to start: could not read");
  });

  it("[r1-4] only unrelated configuration: refused, and the environment is unchanged", () => {
    file(
      `MYCELIA_PERSONAL_KEY_OTHER=${GOOD}\n` +
        "MYCELIA_PERSONAL_API_BASE=http://evil.invalid\n" +
        "MYCELIA_PERSONAL_AGENT_ID_MARGIN=evil-agent\n",
    );
    const result = readFleetKeyFromFile("MARGIN");
    expect(result).toEqual({
      kind: "error",
      why: "the file named by MYCELIA_ENV_FILE exists but has no MYCELIA_PERSONAL_KEY_MARGIN",
    });
    expect(refusal()).toContain("refusing to start");
    expect(refusal()).not.toContain(GOOD);
    expect(process.env.MYCELIA_PERSONAL_API_BASE).toBe(BASE);
    expect(process.env.MYCELIA_PERSONAL_AGENT_ID_MARGIN).toBe("agent-margin");
  });
});

describe("no message carries a key or a configured path", () => {
  const SECRET = "SECRETKEY1234567890";

  it("[r1-1] a configured path that contains the key, file missing", async () => {
    // As written by the review, with its expected verdict corrected: a path
    // that does not exist is ABSENT by the settled behaviour, so this does not
    // refuse. What the case protects still holds: nothing printed or thrown
    // contains the key.
    vi.stubEnv("MYCELIA_ENV_FILE", join(dir, SECRET, "missing.env"));
    vi.stubEnv("MYCELIA_PERSONAL_KEY_MARGIN", SECRET);
    expect(readFleetKeyFromFile("MARGIN")).toEqual({ kind: "absent" });
    expect(refusal()).toBe("");
    expect((await sentBy(MyceliaClient.fromEnv())).key).toBe(SECRET);
    expect(printed()).not.toContain(SECRET);
  });

  it("[r1-1] a configured path that contains the key, and is refused", () => {
    // The same attack on the path that does refuse: the named path exists and
    // is a directory.
    const path = join(dir, SECRET);
    mkdirSync(path);
    vi.stubEnv("MYCELIA_ENV_FILE", path);
    vi.stubEnv("MYCELIA_PERSONAL_KEY_MARGIN", SECRET);
    const message = refusal();
    expect(message).toContain("refusing to start: could not read");
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain(dir);
    expect(printed()).not.toContain(SECRET);
  });

  it("a key put where the path belongs is not echoed back", () => {
    vi.stubEnv("MYCELIA_ENV_FILE", dir);
    // A directory whose name is not the point: the configured VALUE must not
    // appear, whatever it is.
    expect(refusal()).not.toContain(dir);
    vi.stubEnv(
      "MYCELIA_ENV_FILE",
      file(`MYCELIA_PERSONAL_KEY_MARGIN=${SECRET} x\n`),
    );
    const message = refusal();
    expect(message).toContain("none valid");
    expect(message).not.toContain(SECRET);
    expect(printed()).not.toContain(SECRET);
    expect(printed()).not.toContain(dir);
  });

  it("an inherited key never appears in a refusal", () => {
    file("MYCELIA_PERSONAL_KEY_OTHER=irrelevant\n");
    expect(refusal()).not.toContain(INHERITED);
    expect(printed()).not.toContain(INHERITED);
  });
});

describe("the default path", () => {
  it("[r1-5] with nothing configured, the file in the home folder is read", async () => {
    // In this process, not a subprocess as the review wrote it: the home
    // folder is pointed at the scratch directory, and the test stops here if
    // that did not take effect, before anything is read.
    vi.stubEnv("HOME", dir);
    vi.stubEnv("USERPROFILE", dir);
    vi.stubEnv("MYCELIA_ENV_FILE", undefined);
    expect(homedir()).toBe(dir);
    expect(process.env.MYCELIA_ENV_FILE).toBeUndefined();

    // No file there yet: absent, and the inherited key stands.
    expect(readFleetKeyFromFile("MARGIN")).toEqual({ kind: "absent" });

    mkdirSync(join(dir, ".config", "fleet"), { recursive: true });
    writeFileSync(
      join(dir, ".config", "fleet", "mycelia.env"),
      `MYCELIA_PERSONAL_KEY_MARGIN=${GOOD}\n`,
    );
    expect(readFleetKeyFromFile("MARGIN")).toEqual({
      kind: "key",
      value: GOOD,
    });
    expect((await sentBy(MyceliaClient.fromEnv())).key).toBe(GOOD);
  });

  it("a refusal about the default file names it by its fixed spelling, not the home folder", () => {
    vi.stubEnv("HOME", dir);
    vi.stubEnv("USERPROFILE", dir);
    vi.stubEnv("MYCELIA_ENV_FILE", undefined);
    expect(homedir()).toBe(dir);
    mkdirSync(join(dir, ".config", "fleet"), { recursive: true });
    writeFileSync(join(dir, ".config", "fleet", "mycelia.env"), "# empty\n");
    const message = refusal();
    expect(message).toContain(
      `${DEFAULT_FLEET_KEY_FILE} exists but has no MYCELIA_PERSONAL_KEY_MARGIN`,
    );
    expect(message).not.toContain(dir);
  });
});

describe("a broken link is a key file that cannot be read, not an absent one", () => {
  // Audit r1: opening a link whose target is missing answers "no such file",
  // the same answer as no file at all. Read as absent, the server would start
  // on the inherited key without a word, in the middle of a rotation.
  const BROKEN =
    "the file named by MYCELIA_ENV_FILE is a link whose target is missing, or lies under one";

  it("[a1] the key file is a link to a target that does not exist", async () => {
    const link = join(dir, "mycelia.env");
    symlinkSync(join(dir, "missing-rotated-key"), link);
    vi.stubEnv("MYCELIA_ENV_FILE", link);
    expect(readFleetKeyFromFile("MARGIN")).toEqual({
      kind: "error",
      why: BROKEN,
    });
    const message = refusal();
    expect(message).toContain(`refusing to start: ${BROKEN}`);
    expect(message).not.toContain(dir);
    expect(message).not.toContain(INHERITED);
  });

  it("a folder above the key file is a link to a target that does not exist", () => {
    symlinkSync(join(dir, "missing-folder"), join(dir, "fleet"));
    vi.stubEnv("MYCELIA_ENV_FILE", join(dir, "fleet", "deeper", "mycelia.env"));
    expect(readFleetKeyFromFile("MARGIN")).toEqual({
      kind: "error",
      why: BROKEN,
    });
    expect(refusal()).toContain("refusing to start");
  });

  it("the default path is a broken link", () => {
    vi.stubEnv("HOME", dir);
    vi.stubEnv("USERPROFILE", dir);
    vi.stubEnv("MYCELIA_ENV_FILE", undefined);
    expect(homedir()).toBe(dir);
    mkdirSync(join(dir, ".config", "fleet"), { recursive: true });
    symlinkSync(
      join(dir, "missing-rotated-key"),
      join(dir, ".config", "fleet", "mycelia.env"),
    );
    const message = refusal();
    expect(message).toContain(
      `refusing to start: ${DEFAULT_FLEET_KEY_FILE} is a link whose target is missing, or lies under one`,
    );
    expect(message).not.toContain(dir);
  });

  it("a link that resolves is read like any file", async () => {
    const target = join(dir, "real.env");
    writeFileSync(target, `MYCELIA_PERSONAL_KEY_MARGIN=${GOOD}\n`);
    const link = join(dir, "mycelia.env");
    symlinkSync(target, link);
    vi.stubEnv("MYCELIA_ENV_FILE", link);
    expect(readFleetKeyFromFile("MARGIN")).toEqual({
      kind: "key",
      value: GOOD,
    });
    expect((await sentBy(MyceliaClient.fromEnv())).key).toBe(GOOD);
  });

  it("no file under a folder link that resolves is still absent", async () => {
    mkdirSync(join(dir, "real-folder"));
    symlinkSync(join(dir, "real-folder"), join(dir, "fleet"));
    vi.stubEnv("MYCELIA_ENV_FILE", join(dir, "fleet", "mycelia.env"));
    expect(readFleetKeyFromFile("MARGIN")).toEqual({ kind: "absent" });
    expect((await sentBy(MyceliaClient.fromEnv())).key).toBe(INHERITED);
  });

  it("no file under folders that do not exist is still absent", () => {
    vi.stubEnv("MYCELIA_ENV_FILE", join(dir, "a", "b", "c", "mycelia.env"));
    expect(readFleetKeyFromFile("MARGIN")).toEqual({ kind: "absent" });
  });

  it("two links that point at each other cannot be read", () => {
    symlinkSync(join(dir, "b"), join(dir, "a"));
    symlinkSync(join(dir, "a"), join(dir, "b"));
    vi.stubEnv("MYCELIA_ENV_FILE", join(dir, "a"));
    expect(readFleetKeyFromFile("MARGIN")).toEqual({
      kind: "error",
      why: "could not read the file named by MYCELIA_ENV_FILE (ELOOP)",
    });
  });
});

describe("every test starts with the key file switched off", () => {
  it("[r1-6] MYCELIA_ENV_FILE is `none` unless a test sets it", () => {
    // Nothing above this line in this test set or stubbed the variable, and
    // `afterEach` restores it between tests.
    expect(process.env.MYCELIA_ENV_FILE).toBe(FLEET_KEY_FILE_OFF);
    expect(readFleetKeyFromFile("MARGIN")).toEqual({ kind: "absent" });
  });
});
