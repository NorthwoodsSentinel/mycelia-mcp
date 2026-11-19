# Contributing to mycelia-mcp

Thank you for your interest in improving mycelia-mcp. The goal of this document
is to channel your input into a form that can be acted on quickly and
consistently.

This policy, and most of this document's wording, is the MCP Inspector's
([`modelcontextprotocol/inspector`](https://github.com/modelcontextprotocol/inspector),
`CONTRIBUTING.md`), adapted to this repository. Where it came from is recorded
in [`PROVENANCE.md`](./PROVENANCE.md).

## TL;DR

**This repository accepts issues, not pull requests.** Design and
implementation are done by the maintainer. If you've already built a fix or
feature locally, share **the prompt you used** to produce it — not the source
code.

## Why this policy exists

mycelia-mcp is developed with an AI-assisted, prompt-driven workflow built
around one rules file and a strict gate (see [`AGENTS.md`](./AGENTS.md)). Every
change follows the same conventions: it is tied to a tracked issue, every
commit is signed off, and it passes one gate before it is pushed — formatting,
lint with no warning tier, the typecheck, tests with a uniform per-file
coverage bar of ≥ 90% on lines, statements, functions, and branches, and a
smoke run of the server under the pinned MCP Inspector.

Accepting raw source PRs creates friction: a diff written outside this pipeline
has to be reverse-engineered to fit those conventions, gates, and review
process — often it's faster to re-derive the change than to adapt the patch.
Capturing your **intent** (a well-formed issue) or the **prompt** that
generated your local change lets the work be reproduced inside the same
workflow and standards, with the quality bar already baked in.

This policy is about efficiency, not gatekeeping. Your ideas, bug reports, and
prompts directly shape what gets built.

## Who opens pull requests

Pull requests against this repository are opened through the **maintainer's
own workflow** only: by the maintainer, or by a coding agent working for the
maintainer under [`AGENTS.md`](./AGENTS.md). The maintainer merges every one.
The repository's settings limit pull-request creation to collaborators.

If you're not the maintainer, open a **detailed issue** instead and it will be
picked up from there. If you've already prototyped the change locally, say so
in the issue and include the prompt you used (see
[If you've already fixed it locally](#if-youve-already-fixed-it-locally)) —
that's the fastest path from your work to a merged change.

**Every pull request references a tracked item**, including the maintainer's
own. Work here is tracked in the maintainer's issue tracker, whose items are
written `NOR-<number>`; a pull request's first line is `Closes NOR-<number>`.
An issue you file on GitHub that is taken up gets a tracked item of its own,
and the two are linked — which is why a well-formed issue is the useful
contribution here, and why writing one is never wasted effort.

## How to contribute a bug report or feature request

Open a well-formed issue describing the bug or the feature you have in mind.
A great issue gives everything needed to act on it without a round-trip —
see [What makes a good issue or prompt submission](#what-makes-a-good-issue-or-prompt-submission)
below. That's the whole process: you describe the intent, the maintainer
handles the design and implementation.

[**New issue**](https://github.com/NorthwoodsSentinel/mycelia-mcp/issues/new/choose)
offers a **Bug report** and a **Feature request** form. Blank issues are
disabled, so pick one of the two. The bug form requires the facts triage needs
first — which tool, which version, which MCP host; the feature form asks for
the problem you are trying to solve. The same chooser links out to the private
security-advisory process, to this policy, and to the Model Context Protocol's
own documentation, specification and SDK for reports that aren't about this
server itself.

**Never report a security vulnerability in a public issue.** See
[`SECURITY.md`](./SECURITY.md).

## If you've already fixed it locally

Please don't send a diff or open a pull request. Instead, open an issue that
includes:

- **The prompt(s) you used** to generate the change — the exact text, so it can
  be reproduced through the workflow here.
- **A description of the behavior before and after** your change.
- **How you verified it** (steps you ran, tests you added, what you observed).

The change is then reproduced through the pipeline so it arrives with the right
conventions, tests, and coverage.

## What makes a good issue or prompt submission

A great submission gives everything needed to act without a round-trip:

- **Clear reproduction or use case** — exact steps to reproduce a bug, or a
  concrete description of the feature and the problem it solves.
- **Expected vs. actual behavior** — what you saw, and what you expected
  instead.
- **Affected tool** — which of the server's tools is involved
  (`mycelia_browse_requests`, `mycelia_get_request`, `mycelia_claim_request`,
  `mycelia_respond`, `mycelia_rate_response`, `mycelia_feed`,
  `mycelia_my_outgoing`, `mycelia_post_request`), or "all" / "startup" if it is
  not specific to one.
- **Environment details** when relevant — OS, Bun version, the MCP host you
  ran the server under, and any relevant configuration. **Redact your Mycelia
  agent key and any other secret before you paste anything.**
- **The exact prompt text**, if you generated a local change and want it
  reproduced.

## Questions

If you're unsure how to scope something, open the issue anyway and say so — it
can be shaped from there. Thanks for helping make mycelia-mcp better.
