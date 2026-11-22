/**
 * Tests for the guard that keeps the local pre-push gate out of GitHub CI
 * (`workflow-gate.mjs`), in two halves.
 *
 * In this repo: the MCP Inspector's `scripts/lib/workflow-gate.test.mjs`
 * (`modelcontextprotocol/inspector` `main` eb54b44), adapted, with its engine
 * and SMOKE_BROWSER rows dropped (no browser smoke here). Like the guard, it
 * comes through a reviewed port in a private sibling repository, and the cases
 * below are that port's, all kept. A comment that cites a review round
 * ("Codex audit r4") means a round of that port's review. Record:
 * `PROVENANCE.md`.
 *
 * The table-driven half pins one case per rule the parser encodes, including
 * the negative cases. A guard that also rejected `npm run validate` or this
 * repo's own commented `main.yml` would be "fixed" by deleting it, taking the
 * real protection with it.
 *
 * The second half runs the parser over the repository's ACTUAL workflow files
 * (`main.yml`, `dco.yml`, `codeql.yml`, `dependency-refresh.yml` and
 * `dependabot-alerts.yml` today). It fails the moment a workflow invokes a
 * `local:*` script, and it fails if it finds no workflow file to read.
 *
 * Run by `npm run test:scripts`, which names this file by path: `node --test`
 * exits 0 on a glob that matches nothing.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  VIOLATION,
  extractExecutableRegions,
  findWorkflowViolations,
  formatWorkflowViolations,
} from "./workflow-gate.mjs";

const repoRoot = join(import.meta.dirname, "..", "..");
const workflowDir = join(repoRoot, ".github", "workflows");

/**
 * A minimal but schema-valid workflow around some step YAML. The walk is
 * structural, so a bare `- run: …` fragment would sit in no job and no step
 * and be correctly invisible; a table of fragments would assert nothing.
 */
const workflow = (steps) =>
  [
    "on: push",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    steps,
  ].join("\n");

describe("findWorkflowViolations", () => {
  const cases = [
    {
      name: "flags the pre-push gate itself",
      text: workflow("      - run: npm run local:gate"),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      name: "flags the local-only sign-off stage",
      text: workflow("      - run: npm run local:dco"),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      name: "flags any other local: script, without being edited for it",
      text: workflow("      - run: npm run local:anything-new"),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      name: "flags it under another runner",
      text: workflow("      - run: bun run local:gate"),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      name: "flags a local: script whose name is built from an expression",
      text: workflow("      - run: npm run local:${{ matrix.task }}"),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      name: "flags an expression whose own body contains braces",
      text: workflow(
        "      - run: npm run local:${{ format('{0}', matrix.task) }}",
      ),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      name: "flags a local: script named through a shell variable",
      text: workflow("      - run: npm run local:$TASK"),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      // Codex audit r4: the shell joins these into `local:dco` before npm sees it.
      name: "flags a local: name split by shell quoting or escaping",
      text: workflow(
        [
          "      - run: npm run 'local':dco",
          "      - run: npm run local\\:dco",
          '      - run: npm run lo"cal:d"co',
        ].join("\n"),
      ),
      rules: [
        VIOLATION.LOCAL_SCRIPT,
        VIOLATION.LOCAL_SCRIPT,
        VIOLATION.LOCAL_SCRIPT,
      ],
    },
    {
      name: "flags a command inside a block scalar",
      text: workflow(
        "      - run: |\n          npm run validate\n          npm run local:gate",
      ),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      name: "flags a block scalar opened with a trailing comment",
      text: workflow(
        "      - run: | # why this step exists\n          npm run local:gate",
      ),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      // Codex audit r7: `local:` with no package-manager run invokes nothing.
      name: "leaves a local: URL or value that runs no script alone",
      text: workflow(
        [
          "      - run: curl https://local:8080/health",
          "        env:",
          "          SERVICE: local:dev",
        ].join("\n"),
      ),
      rules: [],
    },
    {
      name: "flags pnpm and yarn spellings too",
      text: workflow(
        [
          "      - run: pnpm run local:gate",
          "      - run: yarn local:gate",
          "      - run: npm run-script local:dco",
          // Codex audit r10: npm's other two aliases for run-script.
          "      - run: npm rum local:dco",
          "      - run: npm urn local:gate",
        ].join("\n"),
      ),
      rules: [
        VIOLATION.LOCAL_SCRIPT,
        VIOLATION.LOCAL_SCRIPT,
        VIOLATION.LOCAL_SCRIPT,
        VIOLATION.LOCAL_SCRIPT,
        VIOLATION.LOCAL_SCRIPT,
      ],
    },
    {
      name: "flags a command reached through a YAML alias",
      text: workflow(
        [
          "      - name: &cmd npm run local:gate",
          "        run: echo documenting the gate",
          "      - run: *cmd",
        ].join("\n"),
      ),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      name: "flags a command passed as an action input",
      text: workflow("      - with:\n          args: npm run local:gate"),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      name: "flags one in a step env value",
      text: workflow(
        "      - env:\n          TASK: npm run local:gate\n        run: $TASK",
      ),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      name: "flags a command in a step's shell template",
      text: [
        "on: push",
        "jobs:",
        "  build:",
        "    steps:",
        "      - shell: npm run local:gate && bash {0}",
        "        run: echo hello",
      ].join("\n"),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      name: "flags one in the workflow-level defaults.run.shell",
      text: [
        "on: push",
        "defaults:",
        "  run:",
        "    shell: npm run local:gate && bash {0}",
        "jobs:",
        "  build:",
        "    steps:",
        "      - run: echo hello",
      ].join("\n"),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      name: "flags one in a job's container env",
      text: [
        "on: push",
        "jobs:",
        "  build:",
        "    container:",
        "      image: node:22",
        "      env:",
        "        STAGE: npm run local:dco",
        "    steps:",
        "      - run: echo hello",
      ].join("\n"),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      name: "flags a step that uses a repository-local action",
      text: workflow("      - uses: ./.github/actions/gate"),
      rules: [VIOLATION.LOCAL_USES],
    },
    {
      name: "flags a job that calls a repository-local reusable workflow",
      text: [
        "on: push",
        "jobs:",
        "  gate:",
        "    uses: ./.github/workflows/local-gate.yml",
      ].join("\n"),
      rules: [VIOLATION.LOCAL_USES],
    },
    {
      name: "leaves a pinned third-party action alone",
      text: workflow(
        "      - uses: actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955 # v4.3.0",
      ),
      rules: [],
    },
    {
      name: "leaves the CI stages alone",
      text: workflow(
        "      - run: npm run validate && npm run verify:skills:cli && npm run smoke",
      ),
      rules: [],
    },
    {
      name: "leaves an ordinary shell name alone",
      text: workflow("      - shell: bash\n        run: npm run validate"),
      rules: [],
    },
    {
      // Codex audit r1 asked for this to pass. It does not, by the
      // source's own choice: a script name inside quoted shell text is
      // indistinguishable from an invocation without parsing the shell, and
      // inside a `run:` block erring toward the finding is the safe direction.
      // Pinned so the behavior is a decision, not an accident.
      name: "flags a local: name even in echoed prose inside run (the safe direction)",
      text: workflow('      - run: echo "npm run local:gate is local-only"'),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      name: "does not read a step name as an invocation",
      text: workflow(
        "      - name: Run the gate (every stage of local:gate but local:dco)\n        run: npm run validate",
      ),
      rules: [],
    },
    {
      name: "does not scan a workflow input that happens to be named env",
      text: [
        "on:",
        "  workflow_dispatch:",
        "    inputs:",
        "      env:",
        "        description: why local:gate stays local",
        "        default: npm run local:gate",
        "jobs:",
        "  build:",
        "    steps:",
        "      - run: npm run validate",
      ].join("\n"),
      rules: [],
    },
    {
      name: "does not read a YAML comment as an invocation",
      text: workflow(
        "      # local:dco runs in npm run local:gate, never here\n      - run: npm run validate",
      ),
      rules: [],
    },
    {
      name: "does not read a shell comment inside a run block as one either",
      text: workflow(
        "      - run: |\n          # local:gate is the pre-push gate\n          npm run validate",
      ),
      rules: [],
    },
    // Only a comment-only line is dropped. An inline comment is reported, on
    // purpose (Codex audits r11, r13): whether the text after a `#` runs
    // depends on the shell.
    {
      name: "reports a local script named in an inline comment (accepted false fail)",
      text: workflow(
        "      - run: |\n          npm run validate # npm run local:dco",
      ),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      name: "reads past a # under shell: cmd, where it is not a comment",
      text: workflow(
        "      - shell: cmd\n        run: |\n          echo ok # & npm run local:dco",
      ),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
  ];

  for (const { name, text, rules } of cases) {
    it(name, () => {
      const found = findWorkflowViolations(text, "case.yml");
      assert.deepEqual(
        found.map((f) => f.rule),
        rules,
        formatWorkflowViolations(found),
      );
    });
  }

  it("reports the line a finding came from", () => {
    const [finding] = findWorkflowViolations(
      workflow("      - run: npm run local:gate"),
      "main.yml",
    );
    assert.equal(finding.line, 6);
    assert.equal(finding.file, "main.yml");
    assert.equal(finding.match, "local:gate");
  });

  it("names the file in a parse error, rather than a placeholder", () => {
    assert.throws(
      () => findWorkflowViolations("jobs:\n  - a\n  b: c\n", "main.yml"),
      /could not parse main\.yml/,
    );
  });
});

describe("extractExecutableRegions", () => {
  it("descends the executable paths and skips the metadata beside them", () => {
    const regions = extractExecutableRegions(
      [
        "on: push",
        "jobs:",
        "  build:",
        "    steps:",
        "      - name: local:gate is local-only",
        "        env:",
        "          FOO: bar",
        "        run: npm run validate",
      ].join("\n"),
    );
    // The step `name:` is absent; the two executable values are not. Order
    // follows the walk (a step's `run` before its `env`), not the file.
    assert.deepEqual(
      regions.map((r) => [r.kind, r.text.trim()]),
      [
        ["run", "npm run validate"],
        ["env", "FOO: bar"],
      ],
    );
  });

  it("throws on a workflow it cannot parse, rather than finding nothing", () => {
    assert.throws(
      () => extractExecutableRegions("jobs:\n  - a\n  b: c\n", "broken.yml"),
      /could not parse broken\.yml/,
    );
  });
});

describe(".github/workflows", () => {
  const files = readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f));

  it("has workflow files to check", () => {
    // Deny-by-default: an empty listing would make the check below pass
    // vacuously after a rename or a move of the workflow directory.
    assert.ok(
      files.length > 0,
      `no workflow files found in ${workflowDir}; the guard below would pass vacuously`,
    );
  });

  it("never invokes a local-only script", () => {
    const findings = files.flatMap((file) =>
      findWorkflowViolations(
        readFileSync(join(workflowDir, file), "utf8"),
        file,
      ),
    );
    assert.deepEqual(
      findings,
      [],
      "GitHub CI must not run a local-only script (docs/quality-gate.md):\n" +
        formatWorkflowViolations(findings),
    );
  });
});
