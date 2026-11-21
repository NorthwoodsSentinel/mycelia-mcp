#!/usr/bin/env node
// Read the verdict of one Codex audit round from its final message (NOR-610)
// — `npm run audit:verdict -- <final message file>`.
//
// `pr-flow` step 6a decides a round by "the verdict line" of the run's final
// message, and until this script that line was defined only in prose. The last
// audit of that skill reported that an odd message has no defined outcome:
// `AUDIT: unknown`, two verdict lines, or a quoted `AUDIT: pass` beside a real
// `AUDIT: fail` fit none of the four outcomes the skill names. This script is
// the definition, so the same message always reads the same way.
//
// The rule was fitted to three real final messages before it was written, not
// to the brief's wording. One ended with `**AUDIT: fail**`; one BEGAN with
// `AUDIT: fail` followed by a dash and a sentence, and ended in prose; one
// ended with a bare `AUDIT: pass`. A "last line, exact string" rule reads two
// of those three as no verdict.
//
// The rule:
//
//   - Fenced blocks are skipped. A fence opens on a line indented by at most
//     three spaces that then has three or more backticks, or three or more
//     tildes. It closes on a later line indented by at most three spaces that
//     has the same character, at least as many of them, and nothing after but
//     whitespace. A fence that never closes runs to the end of the file.
//   - A CANDIDATE is a line outside any fence, indented by at most three
//     spaces, that begins with `AUDIT:` after at most one emphasis opener
//     (`**`, `__`, `*` or `_`, with no space after it). A bullet, a block
//     quote, a backticked quotation, a line indented by four or more spaces
//     and a verdict mentioned mid-sentence are not candidates.
//   - A candidate is a VERDICT LINE only when what follows `AUDIT:` is exactly
//     one space, then `pass` or `fail`, then at most one emphasis closer, and
//     then one of: nothing but whitespace; a `.`, `,`, `;` or `:`; optional
//     whitespace and a `—` or `–`; whitespace and a `-` or `(`. Every other
//     candidate is MALFORMED: `AUDIT: unknown`, `AUDIT: passed`,
//     `AUDIT: pass|fail`, `AUDIT: pass or fail`, `AUDIT: pass-fail`.
//   - Any malformed candidate: no verdict, whatever else the file holds.
//     Otherwise, no verdict line: no verdict; one or more, all the same: that
//     verdict; both kinds present: no verdict.
//   - A file that is missing, unreadable, empty or only whitespace: no verdict.
//
// ⚠️ The grammar is closed on purpose (design review r1). A line that starts
// like a verdict and is not one makes the whole message unreadable to this
// script, instead of being read by its first word. So the script fails toward
// "no verdict": a real verdict written outside the grammar costs a re-read or
// another round, never a pass.
//
// It prints `audit verdict: pass`, `audit verdict: fail` or
// `audit verdict: no verdict`, and exits 0, 1 or 2 in that order. Exit 0 means
// pass and nothing else.
//
// What it does not know, and the skill keeps as prose: the wrapper's exit code,
// whether the run timed out, whether the file belongs to this round, and
// whether a pass lists findings (the skill treats that as a fail). The owner's
// `codex-review` wrapper computes a verdict field of its own, differently; it
// is not in this repository, and where the two disagree on an odd message this
// reading is the stricter one.

import { readFileSync } from "node:fs";
import { isMainModule } from "./lib/main-module.mjs";

export const PASS = "pass";
export const FAIL = "fail";
export const NO_VERDICT = "no verdict";

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const CANDIDATE = /^ {0,3}(?:\*\*|__|\*|_)?AUDIT:/;
const VERDICT =
  /^ {0,3}(?:\*\*|__|\*|_)?AUDIT: (pass|fail)(?:\*\*|__|\*|_)?(?:\s*$|[.,;:]|\s*[—–]|\s+[-(])/;

/**
 * The verdict of a final message's text: `PASS`, `FAIL` or `NO_VERDICT`. The
 * rule is the header's.
 */
export function readVerdict(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return NO_VERDICT;
  }
  const found = new Set();
  let fence = null;
  for (const line of text.split(/\r?\n/)) {
    if (fence) {
      const close = FENCE_CLOSE.exec(line);
      if (
        close &&
        close[1][0] === fence.char &&
        close[1].length >= fence.length
      ) {
        fence = null;
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      fence = { char: open[1][0], length: open[1].length };
      continue;
    }
    if (!CANDIDATE.test(line)) {
      continue;
    }
    const verdict = VERDICT.exec(line);
    if (!verdict) {
      return NO_VERDICT;
    }
    found.add(verdict[1]);
  }
  if (found.size !== 1) {
    return NO_VERDICT;
  }
  return found.has(PASS) ? PASS : FAIL;
}

const EXIT = { [PASS]: 0, [FAIL]: 1, [NO_VERDICT]: 2 };

/**
 * `argv` is the final message's path and nothing else. A missing argument, or
 * a file that cannot be read, is "no verdict": there is nothing to read a
 * pass from.
 */
export function main(
  argv,
  { log = console.log, error = console.error, read = readFileSync } = {},
) {
  let text = "";
  if (argv.length !== 1) {
    error("audit-verdict: usage: audit-verdict <final message file>");
  } else {
    try {
      text = read(argv[0], "utf8");
    } catch (cause) {
      error(`audit-verdict: cannot read ${argv[0]}: ${cause.message}`);
    }
  }
  const verdict = readVerdict(text);
  log(`audit verdict: ${verdict}`);
  return EXIT[verdict];
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
