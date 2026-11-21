# DESIGN: NOR-648: this agent's rotated key from the fleet key file

Status: design, for review by the review model before the carried code is adapted.
Ticket: NOR-648, a named item of NOR-125.
Carried from: pull request 2 of this repository, branch `fix/fleet-env-file-overlay`, six commits `2a78d7a..303ea0e` (2026-11-08 to 2026-11-11). They applied to `main` at `7c53bba` without conflict. The first commit of this branch holds them **as carried, not yet adapted**: `src/mycelia-client.ts` (the reader and its use in `fromEnv`) and `src/fleet-key.test.ts` (written for another test runner; it does not run under this repository's gate yet).

Words used below. **Measured**: run or counted for this design on 2026-11-21 (UTC), macOS arm64. **Read**: read in the named file. **UNKNOWN**: not established.

## 1. Goal and the evidence that it is done

After a key rotation, a server started by a long-lived host process keeps receiving the old key in its inherited environment. The server may read **only this agent's key** from one file at start, and that value wins over the inherited one.

Done when:

- The three behaviours of section 2 hold, each with a test that fails when the behaviour is removed.
- The suite is hermetic: no test, on any machine, reads a key file from the home folder (section 3).
- `npm run local:gate` exits 0 with every file in `src/` at 90 on all four coverage measures; CI is green on the pull request.
- The pull request carries client evidence, because this is server behaviour: `npm run smoke`, and each refusal case run by hand with what the server printed, against the pull request's commit.
- The review model's audit is clean on the exact commit.

## 2. The behaviours carried, unchanged

These were settled by the review rounds on pull request 2 and are not reopened here.

1. **One value, and nothing else.** `readFleetKeyFromFile(<NAME>)` looks for `MYCELIA_PERSONAL_KEY_<NAME>` only. It returns the value; it never writes to the process environment. The base URL and the agent id are read from the environment only, so the file cannot redirect the destination or switch the identity.
2. **The last valid assignment wins; a malformed one is skipped and said aloud.** A value must be 16 to 512 characters from a fixed set. A malformed assignment prints one line naming the variable and the file, never the value, and does not defeat a later valid one.
3. **Fail closed.** The reader answers one of three things: **absent** (no file, or the file switched off by `MYCELIA_ENV_FILE=none`), **key**, or **error** (the file is there and cannot be read, or holds no valid key for this agent). `fromEnv()` uses the inherited key only on **absent**, and refuses to start on **error**.

The file is `~/.config/fleet/mycelia.env` unless `MYCELIA_ENV_FILE` names another path.

## 3. What is new in this change

### 3.1 The suite must not read a real key file

Measured: the machine this was written on has a real `~/.config/fleet/mycelia.env`. Read: `src/mycelia-client.test.ts` on `main` calls `fromEnv()` in 6 places with the agent name `TESTER` and sets no `MYCELIA_ENV_FILE`. With the carried code, each of those would open the real file, find no key for `TESTER`, and refuse to start. So `main`'s own tests would fail on any machine that has the file and pass in CI, and a test process would be opening a file of real credentials.

Change: the Vitest configuration sets `MYCELIA_ENV_FILE=none` for every test (`test.env`), with its reason beside it. A test of the reader sets the variable itself, to a file it creates in a temporary folder. One test asserts the default is in force: with nothing set by the test, `process.env.MYCELIA_ENV_FILE` is `none`.

The smoke run already starts the server with a scratch home folder (Read, `scripts/smoke-inspector.mjs`), so its file is absent. It additionally passes `MYCELIA_ENV_FILE=none`, so that does not depend on the home folder.

### 3.2 The carried test file joins this repository's runner

`src/fleet-key.test.ts` is rewritten for Vitest with the same cases (the three review findings it reproduces keep their labels), imports with the `.ts` extension as the other tests do, and is named in `test.include`. The case that needs a file the process cannot read is skipped by name when run as root, as carried.

### 3.3 Documentation

`MYCELIA_ENV_FILE` and the file's default path are added where the other variables are described: the header of `src/index.ts`, `README.md`, the `local-dev` skill's environment table, and the bug report form's list of variable names. Each says the three outcomes in one line and that the file holds a secret.

⚠️ **One sentence of the rules file changes with this.** `AGENTS.md` opens by saying the server "acts with one agent identity's bearer token, read from the environment, and nothing else". After this change the token may also come from the key file. The sentence is edited to say so, and the pull request names that edit first in its hand-off, because the rules file is the owner's contract and his merge is what approves it.

## 4. Threat model, accepted limitations, settled decisions

- **Threat model:** the server starting with the wrong key without saying so (a stale inherited key after a rotation); the file being able to change anything other than this agent's key; a credential reaching a log, an error message or a test process.
- **Accepted limitations:**
  - **A present file with no key for this agent refuses to start.** A machine whose file holds another agent's key only must set `MYCELIA_ENV_FILE=none` for this server. Settled on pull request 2 as the price of failing closed.
  - **The default path is read on every host that has the file**, including one whose operator did not know of it. The start-up refusal names the file and the switch.
  - The file's permissions and ownership are not checked. Whoever can write that file can already replace the key this agent uses; the base URL and identity are out of the file's reach by behaviour 1.
  - The value's character set is this API's key format as observed, not a published grammar. A future key outside it is refused loudly, not truncated.
  - The key is read once, at start. A rotation while the server runs needs a restart, as before.
  - `test.env` protects Vitest runs. A script that starts the real server on a developer's machine without the scratch home folder would read the real file; none in this repository does (Read: the smoke script is the only one that starts the server).
- **Settled decisions:** the three behaviours of section 2, as reviewed on pull request 2. No new dependency. The reader stays in `src/mycelia-client.ts` beside `fromEnv`, its only caller.

## 5. Order of work

1. This note and the carried commit, for design review.
2. `vitest.config.ts`: `test.env` and the new test file in `test.include`; the test file rewritten for Vitest.
3. The smoke script's explicit switch.
4. The four documentation places.
5. `npm run format`, commit, the gate, the pull request with its evidence, the audit on the exact commit. A comment on pull request 2 names this one; closing pull request 2 is the owner's.

## 6. Outside this scope (one mention each)

- Moving the one machine that runs the old branch onto `main` after the merge.
- Checking the key file's permissions.
- Re-reading the key while the server runs.

## 7. Review log

- **Design review r1 (`b95fa6c`): 5 findings, all accepted; its coverage of the three settled behaviours found them done as written.**
  1. HIGH, a path given in `MYCELIA_ENV_FILE` was echoed in the refusal and in the malformed-line message, so a key put where the path belongs would be printed: **accepted**. No message carries a configured path; it is called "the file named by MYCELIA_ENV_FILE". Only the fixed default spelling is named. The raw error text, which also carries the path, is no longer used; the error code is.
  2. MEDIUM, no test asserted that messages carry no credential: **accepted**. The test file captures everything printed and thrown and asserts the absence of the valid, malformed, inherited and path-carried values.
  3. MEDIUM, expected error output was not suppressed: **accepted**. `console.error` is captured in every test and its exact text asserted where a message is expected.
  4. MEDIUM, the default path had no behavioural test: **accepted, done in the same process.** The review wrote it as a subprocess. Here the home folder is pointed at a scratch directory, and the test stops before reading anything if that did not take effect.
  5. MEDIUM, the rules-file sentence changes without a provenance entry: **accepted** (`PROVENANCE.md`, Rules file).
  - Its six attack cases are in the test file with their labels. One is kept with its expected result corrected: case 1 expects a refusal for a configured path that does not exist, and by the settled behaviour a missing file is absent and does not refuse. The case is kept as written with the corrected result, and a second form of it (the path exists and is a directory) reaches the refusal the case was written to inspect.
  - Checked by removing each behaviour in turn: echoing the configured path failed 8 of the file's 23 tests; falling back on an unusable file failed 9; removing the test-wide switch failed 6 of the whole suite's 85 on a machine that has a key file.
  - No second design round: every finding is accepted, and the audit is on the exact commit.
- Audit, on the exact commit: (not yet run)
