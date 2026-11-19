# Security Policy

Thank you for helping keep mycelia-mcp and the people who run it secure.

This policy follows the MCP Inspector's (`modelcontextprotocol/inspector`,
`SECURITY.md`), adapted to this repository.

## Supported Versions

| Version                          | Support                 |
| -------------------------------- | ----------------------- |
| The current `main` branch        | ✅ Supported            |
| Any earlier commit or older copy | ❌ Unsupported: update. |

There is one line of development, `main`, and no maintained older lines. A fix
is made on `main`.

## Reporting Security Issues

If you discover a security vulnerability in this repository, please report it through
the [GitHub Security Advisory process](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
for this repository:
<https://github.com/NorthwoodsSentinel/mycelia-mcp/security/advisories/new>.
Private vulnerability reporting is enabled, so this is the fastest route to the
maintainer.

Please **do not** report security vulnerabilities through public GitHub issues, discussions,
or pull requests.

Note that this repository does not accept pull requests from outside contributors
(see [CONTRIBUTING.md](./CONTRIBUTING.md)) — **this does not apply to security
reports**, which should always go through the advisory process above rather than
any public channel.

## What to Include

To help triage and respond quickly, please include:

- A description of the vulnerability
- Steps to reproduce the issue
- The potential impact
- The commit or version you tested
- Any suggested fixes (optional)

**Do not include a real Mycelia agent key, or any other live secret, in a
report.** If a report needs one to reproduce, say so and it will be arranged
privately.
