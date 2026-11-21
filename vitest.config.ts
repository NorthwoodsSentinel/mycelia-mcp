// Vitest configuration: which tests run, and the per-file coverage bar.
//
// Vitest and its V8 coverage provider are the MCP Inspector's test tools at
// its exact pins (4.1.12). The thresholds block is the Inspector's own
// (modelcontextprotocol/inspector, clients/launcher/vitest.config.ts at commit
// d330df96): 90 on all four dimensions, per file. Record: PROVENANCE.md.
//
// `test.include` names each test file by path, not by a glob: a renamed test
// file then fails the run instead of being skipped (AGENTS.md: keep a test
// file's exact filename).
//
// `coverage.include` is the whole source folder, so a new file there is
// measured without anyone remembering to add it. A file no test loads is
// reported at 0 and fails. Every exclusion below is a named line with its
// reason.
//
// `test.env` switches the server's key file off for every test; the reason is
// beside it.
//
// `testTimeout` is stated once, here. `retry` stays unset: a retry would turn
// a real red into a quiet green.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: [
      "src/mycelia-client.test.ts",
      "src/fleet-key.test.ts",
      "src/index.test.ts",
    ],
    // The key file is switched off for every test. Without this, any test that
    // builds a client from the environment would open the key file in the home
    // folder of the machine it runs on: a file of real credentials on a
    // developer's machine, and a start-up refusal for a test agent it does not
    // name. A test of the reader names its own file in a temporary folder
    // (`src/fleet-key.test.ts`, which also asserts this default is in force).
    env: { MYCELIA_ENV_FILE: "none" },
    testTimeout: 10_000,
    hookTimeout: 10_000,
    coverage: {
      provider: "v8",
      // `skipFull: false`: list every measured file, including one at 100%.
      reporter: [["text", { skipFull: false }], "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        // Test files are not code under test.
        "src/**/*.test.ts",
      ],
      thresholds: {
        perFile: true,
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 90,
      },
    },
  },
});
