#!/usr/bin/env node
// Durable guard for `.claude/skills/**/SKILL.md`.
//
// In this repo: copied from the MCP reference servers'
// `scripts/verify-skills.mjs` (modelcontextprotocol/servers at commit e1d154ee), then edited. The
// edits, all for this repo's facts:
//   - The wiring vouch (`checkWiring`) asks this repo's questions: CI here is
//     `.github/workflows/main.yml`, which runs `npm run validate`, and this
//     guard runs inside `validate`. The links the source asks of
//     `verify:skills:cli` are asked of `verify:skills` too; the source's two
//     links for `verify:skills:cli` itself (local:gate and CI) are kept beside
//     them, now that this repo has the stage (`scripts/verify-skills-cli.mjs`).
//   - The bonus run of `claude plugin validate` stays removed: it runs as its
//     own guaranteed stage, `verify:skills:cli`, as the source also does.
//   - `skills:eval` (`scripts/skill-eval.mjs`, the Inspector's) spends model
//     calls, so it is run by hand; `checkEvalNotWired` (added here) fails if a
//     gate or CI could start it.
//   - The entry check uses `isMainModule` (lib/main-module.mjs).
// Record: PROVENANCE.md.
//
// Below this header the text is the servers' own. A `#N` or `inspector#N`
// reference in it is an issue or PR of modelcontextprotocol/servers or
// modelcontextprotocol/inspector, kept because it is where the reasoning was
// worked out.
//
// `AGENTS.md` is loaded in full on every turn, so its rules are unconditionally
// present. A skill is conditional — its body loads only when it is invoked — so
// if a skill stops being reachable we lose behavior SILENTLY, and nothing in the
// normal workflow surfaces that. This is the check that does.
//
// What it asserts, cheapest first:
//   1. Every SKILL.md's frontmatter parses the way Claude Code parses it. This
//      is the whole-class failure: malformed YAML (or a fence that is not the
//      first line) loads the body with EMPTY metadata, so `/name` still works —
//      a manual spot check passes — while the description the model matches
//      against is gone and the skill never auto-fires again.
//   2. Every skill declares its invocation mode explicitly, so the set that has
//      to fire on its own is knowable by reading the files rather than inferred.
//   3. Every model-invoked skill has committed eval cases, including negatives.
//      Running them needs the Claude CLI and spends model calls, so it is NOT
//      in the gate; the cases existing is what this checks.
//   4. The skill LISTING stays inside its recorded character budget. Claude Code
//      truncates the listing when it overflows, dropping the least-invoked
//      entries first — which are exactly the model-invoked skills.
//
// (The source additionally runs `claude plugin validate` at a pinned CLI
// version, and has a `verify:skills:cli` stage that guarantees it. Here the
// stage exists; the in-`validate` bonus run does not. See the header.)

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./lib/main-module.mjs";
import {
  reachableScripts,
  rootReachesScript,
  scriptChainRuns,
} from "./lib/npm-scripts.mjs";
import { parse as parseYaml } from "yaml";
import {
  parseSkill,
  validateEvalCases,
  listingCost,
  LISTING_BUDGET,
} from "./lib/skill-manifest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SKILLS_DIR = path.join(ROOT, ".claude", "skills");

/** Directory names under `.claude/skills` that contain a SKILL.md. */
export function skillDirs(
  dir,
  { readdir = readdirSync, stat = statSync } = {},
) {
  return readdir(dir)
    .filter((n) => !n.startsWith("."))
    .filter((n) => stat(path.join(dir, n)).isDirectory())
    .sort();
}

/**
 * Whether a shell script invokes exactly `command`.
 *
 * A substring test is not enough, and my own justification for one was wrong:
 * it accepts a LONGER script name (`npm run verify:skills:cli:disabled`) and a
 * script merely named by another command (`echo npm run verify:skills:cli`),
 * either of which would let the real validator be removed while this guard
 * stayed green (Copilot).
 *
 * So the script is split on the separators that start a new command, and a
 * segment must equal the invocation exactly. That is precise for the commands
 * this guard checks, which take no arguments; a command that did would need
 * prefix matching with an argument boundary instead.
 *
 * Splitting is on `\n`, `;` and `&&` only — deliberately NOT on `|` or a bare
 * `&`. `||` is the failure-masking form, and both of its shapes must be
 * rejected: `npm run X || true` swallows a rejection so CI stays green, and
 * `true || npm run X` never runs the validator at all (Copilot). Leaving `||`
 * inside the segment means the segment does not equal the invocation, so both
 * are refused without special-casing either.
 *
 * @param {string} script A step's `run:` block.
 * @param {string} command e.g. `npm run verify:skills:cli`.
 */
export function runsCommand(script, command) {
  return script
    .split(/\n|;|&&/)
    .map((segment) => segment.trim())
    .some((segment) => segment === command);
}

/**
 * Whether an Actions boolean-ish value means "yes".
 *
 * YAML gives `true`, but a workflow may equally write `"true"` — and an
 * expression (`${{ … }}`) is unevaluable here, so it is treated as masking on
 * the same conservative principle the `if:` checks use.
 *
 * @param {unknown} value
 */
function isTruthy(value) {
  if (value === undefined || value === false) return false;
  return value !== "false";
}

/**
 * Whether a workflow's `on:` includes an event that fires for ordinary changes.
 *
 * `on:` takes three shapes — a bare string, a list, or a map of event names.
 * Note the YAML 1.1 `on` → `true` pitfall does not apply here: the `yaml`
 * package parses to the 1.2 core schema, where the key stays the string `on`.
 *
 * @param {unknown} on
 */
function triggersOnPush(on) {
  const events =
    typeof on === "string"
      ? [on]
      : Array.isArray(on)
        ? on
        : on !== null && typeof on === "object"
          ? Object.keys(on)
          : [];
  return events.some((e) => e === "push" || e === "pull_request");
}

/**
 * Whether the workflow has a step that runs `command` on every push.
 *
 * Four things must hold, and the guard has needed each one added in turn:
 * the WORKFLOW must fire on a push or pull_request (one switched to `on:
 * release` still contains the step but never runs it on a PR), the JOB must be
 * unconditional, so must the STEP, and neither may carry `continue-on-error` —
 * a step whose failure cannot fail the job asserts nothing, so a rejected skill
 * would leave the workflow green (Copilot).
 *
 * Deliberately conservative: a job or step carrying **any** `if:` is skipped.
 * This guard cannot evaluate an Actions expression, and the property being
 * asserted is "CI validates the skills on a PR" — which a conditional step does
 * not establish. Over-strictness costs a false failure that is obvious to fix;
 * under-strictness costs a guard that reports green while nothing runs.
 *
 * @param {string} workflowText
 * @param {string} command
 * @returns {boolean}
 */
export function ciRunsUnconditionally(workflowText, command) {
  let doc;
  try {
    doc = parseYaml(workflowText);
  } catch {
    return false;
  }
  if (!triggersOnPush(doc?.on)) return false;

  const jobs = doc?.jobs;
  if (jobs === null || typeof jobs !== "object") return false;

  for (const job of Object.values(jobs)) {
    if (job === null || typeof job !== "object") continue;
    if ("if" in job || isTruthy(job["continue-on-error"])) continue;
    const steps = Array.isArray(job.steps) ? job.steps : [];
    for (const step of steps) {
      if (step === null || typeof step !== "object") continue;
      if ("if" in step || isTruthy(step["continue-on-error"])) continue;
      if (typeof step.run === "string" && runsCommand(step.run, command))
        return true;
    }
  }
  return false;
}

/**
 * The workflow whose one job runs the gate. In the source this is
 * `typescript.yml` (its root-guards job); here it is `main.yml`, which runs
 * `npm run validate` unconditionally on every pull request.
 */
export const GUARDS_WORKFLOW = path.join(".github", "workflows", "main.yml");

/**
 * Assert the skill gate is still WIRED, not merely present.
 *
 * A gate that stops being invoked fails silently and every fixture test stays
 * green (Copilot, in the source). The source checks three links; here each
 * one asks the matching question of this repo:
 *
 *   - A sibling guard must be reachable from `validate`. The source's sibling
 *     is `verify:format-coverage`; this repo's is `verify:action-pins`. (In the
 *     source the two vouch for each other; `verify:action-pins` here does not
 *     yet vouch back, a follow-up.)
 *   - `local:gate` must reach this guard. The source asks this of
 *     `verify:skills:cli`; here this guard runs inside `validate`, which
 *     `local:gate` runs, and `local:gate` must reach `verify:skills:cli` too.
 *   - CI must run it on a PR: `main.yml` must have an unconditional step that
 *     runs `npm run validate`, and `validate` must reach `verify:skills`; and
 *     an unconditional step must run `npm run verify:skills:cli`.
 *
 * Nothing a gate or CI runs may reach the model-spending eval
 * (`checkEvalNotWired`, below).
 *
 * The workflow half must find a step that **actually runs on a PR**, which takes
 * two narrowings beyond a text search:
 *
 *   - Executable position. A raw substring match is satisfied by a comment, a
 *     step `name:`, or a workflow input default that merely mentions the
 *     command — so deleting the real step while leaving this docblock's wording
 *     nearby would keep the guard green.
 *   - Unconditional execution. A `run:` inside a release-only job, or behind
 *     `if: false`, is still syntactically a `run:` — so a step moved there
 *     would report as wired while PR CI validated nothing (Copilot). Any `if:`
 *     on the job or the step disqualifies it: this guard cannot evaluate an
 *     expression, and "runs sometimes" is not the property being asserted.
 *
 * @param {Record<string, string>} rootScripts
 * @param {string} workflowText
 * @returns {string[]} problems
 */
export function checkWiring(rootScripts, workflowText) {
  const problems = [];
  if (!rootReachesScript(rootScripts, "verify:action-pins")) {
    problems.push(
      "the root `validate` no longer runs `verify:action-pins` (a sibling guard). Restore it.",
    );
  }
  if (!scriptChainRuns(rootScripts, "local:gate", "verify:skills")) {
    problems.push(
      "`npm run local:gate` no longer runs `verify:skills`, so the skills are not checked before a push. Restore it.",
    );
  }
  if (
    !ciRunsUnconditionally(workflowText, "npm run validate") ||
    !rootReachesScript(rootScripts, "verify:skills")
  ) {
    problems.push(
      `\`${GUARDS_WORKFLOW}\` has no unconditional step that runs \`npm run validate\` with \`verify:skills\` inside it, so the skills are not checked on a PR. Restore it (a step behind an \`if:\`, or in a release-only job, does not count).`,
    );
  }
  // Local edit: `ciRunsUnconditionally` accepts a workflow that fires on push
  // OR pull_request (the source's rule). Here the gate must run on pull
  // requests, so a push-only workflow is a finding too.
  if (!triggersOnPullRequest(workflowText)) {
    problems.push(
      `\`${GUARDS_WORKFLOW}\` does not run on \`pull_request\`, so a PR is merged with no gate run on it. Restore the trigger.`,
    );
  }
  // The source's two links for the authoritative validator.
  if (!scriptChainRuns(rootScripts, "local:gate", "verify:skills:cli")) {
    problems.push(
      "`npm run local:gate` no longer runs `verify:skills:cli`, so the authoritative validator does not run before a push. Restore it.",
    );
  }
  if (!ciRunsUnconditionally(workflowText, "npm run verify:skills:cli")) {
    problems.push(
      `\`${GUARDS_WORKFLOW}\` has no unconditional step that runs \`npm run verify:skills:cli\`, so the authoritative validator does not run on a PR. Restore it (a step behind an \`if:\`, or in a release-only job, does not count).`,
    );
  }
  problems.push(...checkEvalNotWired(rootScripts, workflowText));
  return problems;
}

/** Text that names the model-spending eval, as a script or as its file. */
// `skill-eval.mjs`, not `skill-eval`: the eval's own unit tests
// (`skill-eval.test.mjs`, stubbed, no model call) run in `test:scripts`, and a
// bare `skill-eval` would flag them.
const EVAL_NAMES = ["skills:eval", "skill-eval.mjs"];

/**
 * Local addition: the eval spends metered model calls, so nothing a gate or CI
 * runs may start it; it is run by hand. The claim this proves is deliberately
 * narrow: no npm script reachable from `validate`, `local:gate`, or any npm
 * script a workflow step names, and no workflow step's `run:` text, names
 * `skills:eval` or `skill-eval.mjs`. Reachability here is `reachableScripts`, which
 * follows every `npm run` substring, so it over-includes: a mention in an
 * `echo` counts. That is the safe direction for a "must not reach" check (a
 * false failure is obvious to fix). NOT covered: a script that starts the eval
 * through some other file (a shell script, a Node script that spawns it), or a
 * workflow in another file. A reviewer reads those diffs.
 *
 * @param {Record<string, string>} rootScripts
 * @param {string} workflowText
 * @returns {string[]} problems
 */
export function checkEvalNotWired(rootScripts, workflowText) {
  const problems = [];
  const names = (text) => EVAL_NAMES.filter((n) => text.includes(n));
  const entries = new Set(["validate", "local:gate"]);
  let doc;
  try {
    doc = parseYaml(workflowText);
  } catch {
    doc = null;
  }
  const runs = [];
  for (const job of Object.values(doc?.jobs ?? {})) {
    for (const step of Array.isArray(job?.steps) ? job.steps : []) {
      if (typeof step?.run === "string") runs.push(step.run);
    }
  }
  for (const run of runs) {
    for (const n of names(run)) {
      problems.push(
        `\`${GUARDS_WORKFLOW}\` names \`${n}\` in a step's \`run:\`. The skill eval spends model calls and is run by hand only; remove it from CI.`,
      );
    }
    for (const m of run.matchAll(/npm (?:run-script|run|rum|urn) ([\w:-]+)/g))
      entries.add(m[1]);
  }
  for (const entry of entries) {
    for (const script of reachableScripts(rootScripts, entry)) {
      const body = rootScripts?.[script];
      const hits = [
        ...(EVAL_NAMES.includes(script) ? [script] : []),
        ...(typeof body === "string" ? names(body) : []),
      ];
      for (const n of new Set(hits)) {
        problems.push(
          `\`npm run ${entry}\` reaches \`${n}\` (via \`${script}\`). The skill eval spends model calls and is run by hand only; take it out of the gate.`,
        );
      }
    }
  }
  return [...new Set(problems)];
}

/**
 * Whether a workflow's `on:` names `pull_request` (any of the three shapes).
 * Unparseable YAML is not a trigger.
 *
 * @param {string} workflowText
 */
export function triggersOnPullRequest(workflowText) {
  let on;
  try {
    on = parseYaml(workflowText)?.on;
  } catch {
    return false;
  }
  const events =
    typeof on === "string"
      ? [on]
      : Array.isArray(on)
        ? on
        : on !== null && typeof on === "object"
          ? Object.keys(on)
          : [];
  return events.includes("pull_request");
}

function main(argv = process.argv.slice(2)) {
  // An explicit directory is the seam the fixture tests drive; without it this
  // guard could only ever be exercised against the repo's own (green) skills,
  // so it could stop enforcing anything while every unit test stayed green.
  const override = argv[0];
  const SKILLS_DIR = override ? path.resolve(override) : DEFAULT_SKILLS_DIR;
  const failures = [];

  // Only meaningful against the real repo; a fixture run has no wiring.
  if (!override) {
    const rootScripts = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf8"),
    ).scripts;
    const workflow = readFileSync(path.join(ROOT, GUARDS_WORKFLOW), "utf8");
    for (const problem of checkWiring(rootScripts, workflow)) {
      failures.push(problem);
    }
  }

  if (!existsSync(SKILLS_DIR)) {
    console.error(
      `verify:skills — ${path.relative(ROOT, SKILLS_DIR)} does not exist.`,
    );
    process.exit(1);
  }

  const dirs = skillDirs(SKILLS_DIR);
  // An empty skills directory means the skill set was deleted, and that must
  // fail loudly. (#4863 excused it with a temporary bootstrap allowance until
  // the first skill landed; #4866 added the first skills and removed it.)
  if (dirs.length === 0) {
    console.error("verify:skills — no skills found; the skill set is gone.");
    process.exit(1);
  }

  const parsed = [];
  const evalFiles = [];
  const modelInvokedDirs = new Set();
  for (const dir of dirs) {
    const file = path.join(SKILLS_DIR, dir, "SKILL.md");
    if (!existsSync(file)) {
      failures.push(`${dir}: no SKILL.md`);
      continue;
    }
    const skill = parseSkill(dir, readFileSync(file, "utf8"));
    for (const e of skill.errors) failures.push(`${dir}/SKILL.md: ${e}`);
    if (skill.errors.length > 0) continue;
    parsed.push(skill);

    if (skill.modelInvoked) {
      modelInvokedDirs.add(dir);
      const evalsFile = path.join(SKILLS_DIR, dir, "evals", "evals.json");
      if (!existsSync(evalsFile)) {
        failures.push(
          `${dir}: model-invoked skills need committed eval cases at evals/evals.json`,
        );
        continue;
      }
      let cases;
      try {
        cases = JSON.parse(readFileSync(evalsFile, "utf8"));
      } catch (e) {
        failures.push(`${dir}/evals/evals.json: not valid JSON — ${e.message}`);
        continue;
      }
      evalFiles.push({ dir, cases });
    }
  }

  // Validated after the loop, not inside it: a hand-off case names other
  // skills, and checking those links needs the model-invoked set complete.
  // Inside the loop the check would depend on directory order — `test-servers`
  // sorts before `testing`, so a chain through `testing` would be rejected as
  // unknown purely because of where the alphabet put it.
  // Keyed on the DIRECTORY name, which is what a chain link names and what a
  // skill is addressed by; the frontmatter `name` can be absent or disagree,
  // and either would silently shrink the set a chain is checked against.
  for (const { dir, cases } of evalFiles) {
    for (const e of validateEvalCases(dir, cases, modelInvokedDirs)) {
      failures.push(`${dir}/evals/evals.json: ${e}`);
    }
  }

  const cost = listingCost(parsed);
  if (cost > LISTING_BUDGET) {
    failures.push(
      `this repo contributes ${cost} chars to the skill listing, over its recorded ` +
        `budget of ${LISTING_BUDGET}. Tighten a description, or raise the budget ` +
        "deliberately in scripts/lib/skill-manifest.mjs — but note the real listing " +
        "budget is SHARED with bundled skills and the contributor's own " +
        "~/.claude/skills, none of which is visible from here.",
    );
  }

  if (failures.length > 0) {
    console.error(`verify:skills — ${failures.length} problem(s):\n`);
    for (const f of failures) console.error("  " + f);
    console.error("\nSee AGENTS.md → Maintaining the skills.");
    process.exit(1);
  }

  const modelInvoked = parsed.filter((s) => s.modelInvoked).map((s) => s.name);
  console.log(
    `verify:skills — OK: ${parsed.length} skills, ${modelInvoked.length} model-invoked ` +
      `(${modelInvoked.join(", ")}); this repo's listing share ${cost}/${LISTING_BUDGET} chars.`,
  );
}

// The symlink-safe entry check (see lib/main-module.mjs); a bare
// comparison exits 0 having checked nothing when run through a symlinked path.
if (isMainModule(import.meta.url)) {
  main();
}
