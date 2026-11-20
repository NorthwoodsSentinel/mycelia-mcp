/**
 * The guard that keeps the LOCAL pre-push gate out of GitHub CI.
 *
 * In this repo: the MCP Inspector's `scripts/lib/workflow-gate.mjs`
 * (`modelcontextprotocol/inspector` `main` eb54b44, its #2146), adapted. It
 * was not copied from the Inspector directly: it comes through a reviewed port
 * of the same guard in a private sibling repository, and the code below this
 * header is that port's. Where a comment below cites a review round
 * ("Codex audit r7", "Codex design r2"), it is a round of that port's review,
 * not of this repo's. Record: `PROVENANCE.md`.
 *
 * Why it exists. Two tiers run the same checks and are deliberately not the
 * same set. GitHub CI (`.github/workflows/main.yml`) runs every stage of
 * `npm run local:gate` except `local:dco`. `local:dco` reads `origin/main`,
 * which CI's shallow checkout does not have, so it stays local; a pull
 * request's commits are checked by `.github/workflows/dco.yml` instead. The
 * split is described in `docs/quality-gate.md`.
 *
 * The `local:` name removes the *invitation* to add such a stage to a workflow
 * (the Inspector renamed its gate off `ci` for that reason). This removes the
 * *possibility*.
 *
 * WHAT IT FORBIDS, and nothing more:
 *
 *   1. Invoking a `local:*` script. That namespace means local-only by
 *      construction, so the rule covers `local:dco`, `local:gate` and any
 *      later `local:*` script without being edited.
 *   2. Naming one through a workflow **expression** or a shell variable, as in
 *      `npm run local:${{ matrix.task }}` or `npm run local:$TASK`. A name the
 *      guard cannot read may well be `local:gate`, so it is treated as one.
 *      The limit: a fully opaque `npm run ${{ matrix.script }}` names no family
 *      at all and is not detectable here.
 *
 * NOT BROUGHT IN: the Inspector's rules 2 to 4 (non-Chromium engine passes,
 * `smoke:web:engine`, `SMOKE_BROWSER`). This repo has no browser smoke, no
 * engine matrix and no `SMOKE_BROWSER`, so they would guard nothing.
 *
 * ONLY EXECUTABLE POSITIONS ARE SCANNED, found by parsing the file rather than
 * by matching lines: `run:` scalars (inline and block), a custom `shell:`
 * command template (step-level, and `defaults.run.shell` at workflow and job
 * level), and the values of an `env:`, `container.env:` or `with:` mapping.
 * Everything else in a workflow is metadata that runs nothing. This repo's
 * `main.yml` names `local:gate` in its comments and in a step `name:`, on
 * purpose, to document the split, and that must not fail the guard.
 *
 * That is a real limit, stated rather than hidden (the Inspector's own): an
 * execution vector outside those positions, such as a third-party action that
 * reads a script name from somewhere else, is not seen. Two more, both
 * name-based by design: the guard does not follow an npm script into the
 * commands it runs, and it does not recognize a local-only command run
 * directly, without its `local:*` name.
 *
 * THREAT MODEL: this catches an ordinary or accidental workflow edit that runs
 * a local-only stage, spelled any of the usual ways (quoted, escaped, through
 * an expression or a variable, an alias, a shell template, a local action). It
 * is not a defence against a contributor deliberately obfuscating a command to
 * evade it: anyone who can write a workflow can edit or delete this file in
 * the same pull request, which review of that PR has to catch. A text guard
 * cannot close that, and pretending to would be a coverage claim that is not
 * there.
 *
 * NOT THE INSPECTOR'S, kept from the port: a `uses:` that names a
 * REPOSITORY-LOCAL action or reusable workflow (`./…`) is itself a finding.
 * Its steps live in another file this walk does not enter, so
 * `uses: ./.github/actions/gate` with a composite `run: npm run local:dco`
 * inside would otherwise pass. This repo has none, and
 * `scripts/verify-action-pins.mjs` reports a local ref too, so two guards
 * report one. It is kept so the logic stays the reviewed one. A future local
 * action must either teach this guard to follow it or be reviewed against it.
 *
 * Enforced by `scripts/lib/workflow-gate.test.mjs`, which runs this over every
 * file in `.github/workflows/` inside `npm run test:scripts`.
 */

import {
  LineCounter,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseAllDocuments,
} from "yaml";

/** Scripts whose `local:` prefix declares them local-only. */
export const LOCAL_SCRIPT_PREFIX = "local:";

/** Reasons a finding can carry, kept as constants so tests pin them. */
export const VIOLATION = {
  LOCAL_SCRIPT: "local-only-script",
  LOCAL_USES: "repository-local-uses",
};

// A name the guard cannot read: a GitHub expression (`${{ … }}`) or a shell
// variable the script expands itself (`$TASK`, `${TASK}`, `$env:TASK`, cmd's
// `%TASK%`). It keys off the leading `$`/`%` and runs to the end of the line,
// because an expression body can itself contain braces, so a brace-balanced
// match stops at the first `}` and misses exactly the case worth catching (the
// source's Copilot review).
const UNREADABLE = String.raw`[$%][^\n]*`;
// The name counts only after a package manager's `run` on the same line
// (Codex audit r7): `curl https://local:8080/health` or
// `SERVICE=local:dev` invoke no script and must not fail the guard. The `run`
// spellings are every one npm accepts (`run-script`, `run`, `rum`, `urn`; the
// same list `lib/npm-scripts.mjs` follows; Codex audit r10), plus yarn's
// implicit form (`yarn local:gate`).
const LOCAL_SCRIPT_RE = new RegExp(
  String.raw`\b(?:(?:npm|pnpm|bun)\s+(?:[^\n]*?\s)?(?:run-script|run|rum|urn)|yarn(?:\s+run)?)\s+(?:[^\n]*?\s)?(local:(?:[a-z0-9][a-z0-9:-]*|${UNREADABLE}))`,
  "gi",
);

/**
 * The executable scalars of a workflow, with the line each came from.
 *
 * Parsed with the `yaml` package rather than by hand: the source's first two
 * hand-rolled rounds were both wrong in the direction that reports coverage
 * that is not there (a `run: | # comment` opener, a flow mapping). The walk is
 * STRUCTURAL: it descends the schema's executable paths (workflow `env` and
 * `defaults.run.shell`; job `env`, `container.env`, `with` and
 * `defaults.run.shell`; step `run`, `shell`, `env` and `with`) rather than
 * matching keys by name anywhere, so a workflow input named `env` is not read
 * as one.
 *
 * ALIASES ARE RESOLVED, and reported at the line where the alias is used: an
 * alias node carries no `.value`, so `run: *cmd` with the anchor in a metadata
 * scalar would otherwise invoke anything while the guard saw nothing.
 *
 * A parse error THROWS rather than yielding no regions: a workflow the guard
 * cannot read must not pass as a workflow with nothing in it.
 *
 * @param {string} text
 * @param {string} [file] only for the parse-error message
 * @returns {Array<{line: number, kind: string, text: string}>}
 */
export function extractExecutableRegions(text, file = "<workflow>") {
  const lineCounter = new LineCounter();
  const docs = parseAllDocuments(text, { lineCounter });
  const regions = [];

  for (const doc of docs) {
    if (doc.errors.length > 0) {
      throw new Error(
        `workflow-gate: could not parse ${file}: ${doc.errors[0].message}`,
      );
    }

    const lineOf = (node) => lineCounter.linePos(node.range[0]).line;
    const deref = (node) => (isAlias(node) ? node.resolve(doc) : node);

    /** A `run:` command: one scalar, reported where it is written or aliased. */
    const addCommand = (node) => {
      if (node == null) return;
      const resolved = deref(node);
      if (!isScalar(resolved)) return;
      regions.push({
        line: lineOf(node),
        kind: "run",
        text: String(resolved.value ?? ""),
      });
    };

    /** An `env:` or `with:` mapping, each entry rebuilt as `NAME: value`. */
    const addMapping = (kind, node) => {
      if (node == null) return;
      const map = deref(node);
      if (!isMap(map)) return;
      for (const entry of map.items) {
        if (!isScalar(entry.key)) continue;
        const value = deref(entry.value);
        const valueText = isScalar(value) ? String(value.value ?? "") : "";
        regions.push({
          line: lineOf(entry.key),
          kind,
          text: `${String(entry.key.value)}: ${valueText}`,
        });
      }
    };

    const at = (node, key) => (isMap(node) ? node.get(key, true) : undefined);

    /** A `uses:` reference (step, or a job calling a reusable workflow). */
    const addUses = (node) => {
      if (node == null) return;
      const resolved = deref(node);
      if (!isScalar(resolved)) return;
      regions.push({
        line: lineOf(node),
        kind: "uses",
        text: String(resolved.value ?? ""),
      });
    };

    /**
     * `defaults.run.shell`: a custom `shell:` is a COMMAND TEMPLATE Actions
     * runs around every script, so `shell: npm run local:gate && bash {0}`
     * invokes the gate while the `run:` beside it looks harmless.
     */
    const addDefaultShell = (node) =>
      addCommand(at(deref(at(deref(node), "run")), "shell"));

    const root = deref(doc.contents);
    if (!isMap(root)) continue;
    addMapping("env", at(root, "env"));
    addDefaultShell(at(root, "defaults"));

    const jobs = deref(at(root, "jobs"));
    if (!isMap(jobs)) continue;
    for (const jobEntry of jobs.items) {
      const job = deref(jobEntry.value);
      if (!isMap(job)) continue;
      addMapping("env", at(job, "env"));
      // A job-level `with:` is the input block of a reusable-workflow call.
      addMapping("with", at(job, "with"));
      addUses(at(job, "uses"));
      addMapping("env", at(deref(at(job, "container")), "env"));
      addDefaultShell(at(job, "defaults"));

      const steps = deref(at(job, "steps"));
      if (!isSeq(steps)) continue;
      for (const stepNode of steps.items) {
        const step = deref(stepNode);
        if (!isMap(step)) continue;
        addCommand(at(step, "run"));
        addCommand(at(step, "shell"));
        addUses(at(step, "uses"));
        addMapping("env", at(step, "env"));
        addMapping("with", at(step, "with"));
      }
    }
  }

  return regions;
}

/**
 * Scan one workflow file's text for invocations that must stay local-only.
 *
 * Pure: takes text, returns findings. `file` is carried through only so a
 * caller can report where a finding came from.
 *
 * @param {string} text
 * @param {string} [file]
 * @returns {Array<{file: string, line: number, rule: string, match: string, message: string}>}
 */
export function findWorkflowViolations(text, file = "<workflow>") {
  const findings = [];

  for (const region of extractExecutableRegions(text, file)) {
    if (region.kind === "uses") {
      if (region.text.trim().startsWith("./")) {
        findings.push({
          file,
          line: region.line,
          rule: VIOLATION.LOCAL_USES,
          match: region.text.trim(),
          message:
            `\`uses: ${region.text.trim()}\` runs steps from a repository-local file this guard ` +
            `does not enter, so a local-only script there would pass unseen.`,
        });
      }
      // A `uses:` is a reference, not a command: nothing else applies to it.
      continue;
    }
    // Inside a `run:` block the parser hands back shell comments too, and a
    // comment-only line invokes nothing (the source's rule). An INLINE comment
    // is not removed (Codex audits r11 and r13): telling a comment
    // from text that runs needs each shell's own quoting and comment grammar.
    // Under `shell: cmd` a `#` is ordinary text, so `echo ok # & npm run
    // local:dco` runs the script. So `npm run validate # npm run local:dco` is
    // reported: a false fail, accepted, never a false pass. Then shell quote
    // and escape characters are removed before matching (Codex audit r4):
    // `npm run 'local':dco`, `local\:dco` and `lo"cal:d"co` all reach npm as
    // `local:dco`. Removing them can only add findings, never hide one.
    const body = region.text
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n")
      .replace(/["'\\]/g, "");
    for (const match of body.matchAll(LOCAL_SCRIPT_RE)) {
      findings.push({
        file,
        line: region.line,
        rule: VIOLATION.LOCAL_SCRIPT,
        match: match[1],
        message:
          `\`${match[1]}\` is a local-only script: the \`${LOCAL_SCRIPT_PREFIX}\` prefix means ` +
          `it runs in the pre-push gate, never in GitHub CI (docs/quality-gate.md).`,
      });
    }
  }

  return findings;
}

/**
 * Render findings as a single message, for an assertion failure.
 *
 * @param {ReturnType<typeof findWorkflowViolations>} findings
 * @returns {string}
 */
export function formatWorkflowViolations(findings) {
  return findings
    .map((f) => `  ${f.file}:${f.line}  [${f.rule}]  ${f.message}`)
    .join("\n");
}
