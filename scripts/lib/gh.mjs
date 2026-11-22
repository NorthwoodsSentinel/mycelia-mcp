// In this repo: copied from modelcontextprotocol/inspector at commit d330df96,
// scripts/lib/gh.mjs, by copy then edit. Its `#N` references, and the script
// families its first paragraph names, are the source repo's. Here the callers
// are `scripts/handoff-check.mjs` and its tests (NOR-610), and the monthly
// dependency sweep, `scripts/dependency-refresh.mjs` (NOR-684). Edits: `OWNER`
// and `REPO` name this repository; `COPILOT_REVIEWER_LOGIN` and `ghGraphql`
// are removed, because nothing here uses them; and `ghPaginatedObject` is
// added, for the endpoints that answer with one object per page and a
// `total_count`. `ghPaginatedList` was removed with the other two while
// nothing used it and is back, as the source has it, now that the sweep lists
// its own open issues through it. Record: PROVENANCE.md.
//
// Shared `gh` invocation helpers for the maintainer-workflow scripts (#2558)
// — the pr:*, board:*, advisory:* and action:* helpers. Those scripts replace
// command blocks that the skills previously transcribed inline, so the
// failure modes the skills could only warn about in prose are handled here
// once, under test.
//
// Every function takes its spawn function as a parameter (callers default it
// to `spawnSync`), the same injectability pattern `dependabot-alerts.mjs` and
// `dependency-refresh.mjs` set, so orchestration is testable without starting
// a `gh` process. Auth is `gh`'s own — nothing here sees a token.

export const OWNER = "NorthwoodsSentinel";
export const REPO = "mycelia-mcp";
export const REPO_SLUG = `${OWNER}/${REPO}`;

/**
 * `spawnSync`'s default `maxBuffer` is 1 MiB, which a whole-board or
 * all-issue JSON listing can exceed — board #28 already passes 500 items and
 * each item carries its content — killing the call with ENOBUFS before
 * `itemListComplete` ever gets to validate the dump. 64 MiB keeps the bound
 * explicit while leaving complete dumps ample headroom.
 */
export const GH_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Run `gh` with the given args. Throws only on spawn failure (gh not
 * installed); a non-zero exit is the caller's to interpret via the result.
 */
export function gh(spawn, args) {
  const result = spawn("gh", args, {
    encoding: "utf8",
    maxBuffer: GH_MAX_BUFFER,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

/**
 * Run `gh` and parse its stdout as JSON, throwing on a non-zero exit with the
 * stderr in the message. An API/auth failure must throw rather than read as an
 * empty result — the pr-flow skill's wait loop documents why: an error
 * swallowed into a zero makes a background wait retry blind forever.
 */
export function ghJson(spawn, args) {
  const result = gh(spawn, args);
  if (result.status !== 0) {
    throw new Error(
      `gh ${args.join(" ")} failed (${result.status}): ${(result.stderr ?? "").trim()}`,
    );
  }
  return JSON.parse(result.stdout);
}

/**
 * Fetch a paginated REST list endpoint completely.
 *
 * ⚠️ `--slurp` is load-bearing (same note as `dependabot-alerts.mjs`): without
 * it `gh api --paginate` concatenates one JSON array per page into invalid
 * JSON. With it the output is an array of pages, flattened here.
 */
export function ghPaginatedList(spawn, path) {
  const pages = ghJson(spawn, ["api", "--paginate", "--slurp", path]);
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error(`unexpected non-list response from ${path}`);
  }
  return pages.flat();
}

/**
 * Fetch, completely, a paginated REST endpoint that answers with one OBJECT
 * per page: `{ total_count, <key>: [...] }` (workflow runs, a run's jobs, a
 * commit's combined status). Returns the items, and the pages for a caller
 * that needs another field of them. Added in this repo (NOR-610).
 *
 * ⚠️ `--slurp` is load-bearing (the source's note on its list reader): without
 * it `gh api --paginate` concatenates one JSON document per page into invalid
 * JSON. With it the output is an array of pages.
 *
 * A read counts as whole only when all of these hold, and anything else
 * throws — a short read must never look like a clean answer:
 *
 *   - every page is an object with an integer `total_count` and an array
 *     under `key`, and at least one page came back;
 *   - every page reports the SAME `total_count` (a listing that grew or
 *     shrank while it was paged is read again, not trusted);
 *   - the number of items collected equals it;
 *   - every item carries an integer `id`, and no `id` appears twice. Count
 *     alone is not enough: a listing that changes between pages can repeat
 *     one item and drop another with the count still right (design review
 *     r1 of NOR-610).
 */
export function ghPaginatedObject(spawn, path, key) {
  const pages = ghJson(spawn, ["api", "--paginate", "--slurp", path]);
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error(`unexpected response from ${path}: no pages`);
  }
  const items = [];
  for (const page of pages) {
    if (
      page === null ||
      typeof page !== "object" ||
      Array.isArray(page) ||
      !Number.isInteger(page.total_count) ||
      !Array.isArray(page[key])
    ) {
      throw new Error(
        `unexpected response from ${path}: a page without total_count and ${key}`,
      );
    }
    if (page.total_count !== pages[0].total_count) {
      throw new Error(
        `incomplete read of ${path}: total_count changed between pages`,
      );
    }
    items.push(...page[key]);
  }
  const total = pages[0].total_count;
  if (items.length !== total) {
    throw new Error(
      `incomplete read of ${path}: ${items.length} of ${total} ${key}`,
    );
  }
  const seen = new Set();
  for (const item of items) {
    const id = item === null || typeof item !== "object" ? undefined : item.id;
    if (!Number.isInteger(id)) {
      throw new Error(
        `unexpected response from ${path}: an item without an id`,
      );
    }
    if (seen.has(id)) {
      throw new Error(`incomplete read of ${path}: id ${id} appears twice`);
    }
    seen.add(id);
  }
  return { items, pages };
}

/**
 * Parse a `--flag`-style value as a positive integer, throwing a usage-shaped
 * error naming the flag — shared by every script's argv validation.
 */
export function requirePositiveInt(value, flag) {
  if (value === undefined || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(
      `${flag} must be a positive integer (got ${value ?? "nothing"})`,
    );
  }
  return Number(value);
}
