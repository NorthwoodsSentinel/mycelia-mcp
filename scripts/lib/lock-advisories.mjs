// The lock file check of the daily alert sweep: which versions locked in
// `bun.lock` are in range of an advisory GitHub has reviewed.
//
// Written in this repo (not the source's). The sweep it serves,
// `scripts/dependabot-alerts.mjs`, was adapted from the MCP Inspector's, and
// the source has no such step. It exists because GitHub's dependency graph for
// this repository holds the declared dependencies only: it does not read
// `bun.lock`, so a package that is merely locked raises no Dependabot alert,
// and a sweep of the alerts alone never reports it.
// Design: docs/DESIGN-nor-695-lockfile-advisories.md (sections 3, 4 and 11).
// Record: PROVENANCE.md, "Sweeps".
//
// What it does, in order:
//
//   1. `lockedVersions` checks every entry of the parsed lock file. A name
//      that is not an npm package name, or a version that is not a plain
//      semver version (a git or file source), stops the run: such a copy
//      cannot be asked about, and a run that skipped it would be green having
//      not checked it. Nothing from the lock file reaches `gh` before this.
//   2. `advisoryQueries` splits the name@version pairs into queries of
//      GitHub's advisory listing, `GET /advisories`. Each query is a path with
//      ONE `affects` parameter: the pairs joined by commas, percent-encoded as
//      a whole. ⚠️ Repeating the parameter is NOT the same request. Measured
//      2026-11-22 with two pairs that each have advisories:
//      `affects=a@1,b@2` returned both packages' advisories (8);
//      `affects=a@1&affects=b@2` returned only the last pair's (5), exit 0.
//      A query built that way would ask about one pair in a hundred and
//      report the rest clean. The path also says `type=reviewed` in so many
//      words. GitHub's page gives that as the default, and measured the same
//      day the default was wider: a query that left the parameter out got a
//      withdrawn advisory of type `unreviewed` back with the reviewed ones.
//   3. `readLockAdvisories` reads each query to its last page through the
//      shared list reader (`lib/gh.mjs`), which throws on a failed call, on an
//      answer that is not a list of pages and on no pages at all.
//   4. `checkAnswer` checks every entry of every answer, and every
//      vulnerability of every entry. A failed check THROWS; none skips an
//      entry. Empty, non-JSON or misshapen output is an error here, never
//      "nothing found". An advisory that two answers hold is read as two
//      independent copies: what they say of the advisory as a whole must
//      agree, and what each lists is united, so neither is taken for having
//      arrived first.
//   5. `controlStates` looks for the control advisories in each answer (see
//      `CONTROLS`). This is what tells an empty answer from "no advisories":
//      a name that does not exist is answered with one empty page and exit 0,
//      exactly as a clean lock file is.
//   6. `lockRecords` turns each advisory that applies into a record of the
//      shape the Dependabot alert listing gives, with `manifest_path`
//      `bun.lock`, so the sweep's own grouping, marker, issue text and
//      reconciliation handle it unchanged.
//
// What is and is not trusted from the advisory listing:
//
//   - Its matching is not trusted to INCLUDE. A record is made only when a
//     locked version satisfies the advisory's range, by `semver`, here; the
//     sweep's own narrowing checks again before an issue is filed.
//   - Its matching is not allowed to disagree silently either. An advisory
//     that is not withdrawn, returned for a query, must name a package that
//     query asked about and a range one of the asked versions satisfies. If
//     `semver` here says none does, the run stops: the two disagree (a
//     prerelease version is the known way), and "not exposed" would be this
//     file's guess.
//   - Its silence is trusted only as far as the controls show. They show the
//     query was answered for two pairs in it. They do not show the answer is
//     whole, and the endpoint gives no total to check against (the design
//     note, section 7, states that limit and its bound).
//   - No URL is taken from an answer. The link in an issue is built from the
//     checked advisory id.
//
// Untrusted text here: every package name and version in `bun.lock`, and
// every field of every answer. No shell is involved (`gh` is spawned with an
// argument array), the path starts with a constant so nothing can be read as
// an option, and the pairs travel percent-encoded inside the path of a GET.
// ⚠️ Never as a `-F` field: `gh api -F key=@value` reads a FILE when the value
// starts with `@`, and every scoped package name starts with `@`. Encoding
// also keeps a name from ending the value, adding a parameter, or standing as
// one of the `{owner}`-style placeholders `gh` fills in.
//
// What this file can do: read. It starts `gh api` for `advisories?…` and
// nothing else, and writes nothing anywhere.

import semver from "semver";
import { ghPaginatedList } from "./gh.mjs";

/** The `manifest_path` a record from the lock file carries. */
export const LOCK_MANIFEST = "bun.lock";

/** The one ecosystem asked about. */
const ECOSYSTEM = "npm";

/**
 * The control pairs: two name@version pairs that are known to be in range of
 * a long-standing advisory, on two unrelated packages. Every query carries
 * both, and `controlStates` reads each answer for their advisories.
 *
 * Read from the endpoint on 2026-11-22, both reviewed and not withdrawn:
 * `GHSA-xvch-5gv4-984h` (published 2022-03-18) lists `minimist` `< 0.2.4`,
 * and `GHSA-35jh-r3h4-6jhm` (published 2021-05-06) lists `lodash`
 * `< 4.17.21`.
 *
 * Two, so that one advisory being withdrawn upstream does not blind the
 * sweep; see `readLockAdvisories` for what each outcome does. A control is an
 * ordinary pair to everything else: its advisory becomes a record only if the
 * lock file itself holds that package at a version in range.
 */
export const CONTROLS = Object.freeze([
  Object.freeze({
    name: "minimist",
    version: "0.0.8",
    ghsa: "GHSA-xvch-5gv4-984h",
  }),
  Object.freeze({
    name: "lodash",
    version: "4.17.20",
    ghsa: "GHSA-35jh-r3h4-6jhm",
  }),
]);

/** At most this many pairs from the lock file in one query. */
export const MAX_PAIRS_PER_QUERY = 100;

/**
 * At most this many characters of percent-encoded `affects` value in one
 * query, the controls included. A budget, not a known limit: measured
 * 2026-11-22, a value of 7,501 encoded characters was accepted and a URL of
 * 10,901 was refused with HTTP 414. (The endpoint's own stated limit is 1,000
 * packages.) A single pair is always sent, whatever its length: `NAME_MAX`
 * and `VERSION_MAX` keep one pair far below the budget.
 */
export const MAX_AFFECTS_CHARS = 4000;

/**
 * An npm package name: lower-case letters, digits, `.`, `_` and `-`, with an
 * optional `@scope/`. Narrower than everything the registry has ever held (an
 * old name can hold a capital letter); a name outside it stops the run, which
 * is the safe side for a value on its way into a command argument.
 */
const NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/** npm's own bound on a package name's length. */
const NAME_MAX = 214;

/** A plain semver version: no `v`, no `=`, no white space, no range. */
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** semver's own bound on a version's length. */
const VERSION_MAX = 256;

/** A GitHub advisory id, as it goes into a marker and a link. */
const GHSA_RE = /^GHSA(?:-[0-9a-z]{4}){3}$/;

/** Is this value a plain object: an entry of a listing, or a map? */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * GitHub's `vulnerable_version_range` as a range `semver` reads: its conjuncts
 * are separated by a comma, which `semver` reads as nothing at all.
 *
 * The same normalisation as `toSemverRange` in `scripts/dependabot-alerts.mjs`
 * (the source's function, with its reason there). It is repeated here because
 * that script imports this file; a test in the sweep's suite holds the two to
 * the same answers.
 *
 * @param {string} range
 * @returns {string}
 */
export function semverRange(range) {
  return range
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Every version each package is locked at, after checking every entry.
 *
 * @param {Array<{name: string, version: string}>} entries the lock file's
 *   entries, as `parseBunLock` returns them
 * @returns {Map<string, string[]>} name → its distinct versions, sorted
 * @throws on the first entry that cannot be asked about
 */
export function lockedVersions(entries) {
  const versionsOf = new Map();
  for (const entry of entries) {
    const { name, version } = entry;
    if (
      typeof name !== "string" ||
      name.length > NAME_MAX ||
      !NAME_RE.test(name)
    ) {
      throw new Error(
        `bun.lock holds a package whose name is not an npm package name this check can ask about: ${JSON.stringify(name)}`,
      );
    }
    if (
      typeof version !== "string" ||
      version.length > VERSION_MAX ||
      !VERSION_RE.test(version) ||
      semver.valid(version) === null
    ) {
      throw new Error(
        `bun.lock holds ${name} at ${JSON.stringify(version)}, which is not a registry version this check can ask about`,
      );
    }
    if (!versionsOf.has(name)) versionsOf.set(name, new Set());
    versionsOf.get(name).add(version);
  }
  return new Map(
    [...versionsOf]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, versions]) => [name, [...versions].sort(semver.compare)]),
  );
}

/** A control as the pair it is asked about with. */
const controlPair = (control) => ({
  name: control.name,
  version: control.version,
});

/**
 * The path of one query: a constant, then ONE `affects` parameter holding
 * every pair, comma-separated and percent-encoded as a whole (the header,
 * step 2, says why it must be one).
 *
 * @param {Array<{name: string, version: string}>} pairs
 * @returns {string}
 */
export function advisoryPath(pairs) {
  const value = pairs.map((p) => `${p.name}@${p.version}`).join(",");
  return `advisories?ecosystem=${ECOSYSTEM}&type=reviewed&per_page=100&affects=${encodeURIComponent(value)}`;
}

/**
 * The queries that ask about every locked pair: each holds the control pairs
 * and at most `MAX_PAIRS_PER_QUERY` pairs from the lock file, within
 * `MAX_AFFECTS_CHARS`.
 *
 * There is always at least one query, so a lock file with no packages still
 * asks about the controls: "nothing to ask" must not look like "asked, and
 * nothing found".
 *
 * @param {Map<string, string[]>} versionsOf from `lockedVersions`
 * @returns {Array<{path: string, asked: Array<{name: string, version: string}>}>}
 *   `asked` is every pair in the query, the controls included
 */
export function advisoryQueries(versionsOf) {
  const controls = CONTROLS.map(controlPair);
  const pairs = [...versionsOf].flatMap(([name, versions]) =>
    versions.map((version) => ({ name, version })),
  );
  const affectsLength = (chunk) =>
    advisoryPath([...controls, ...chunk]).length - advisoryPath([]).length;

  const chunks = [];
  let current = [];
  for (const pair of pairs) {
    if (
      current.length > 0 &&
      (current.length === MAX_PAIRS_PER_QUERY ||
        affectsLength([...current, pair]) > MAX_AFFECTS_CHARS)
    ) {
      chunks.push(current);
      current = [];
    }
    current.push(pair);
  }
  chunks.push(current);

  return chunks.map((chunk) => {
    const asked = [...controls, ...chunk];
    return { path: advisoryPath(asked), asked };
  });
}

/**
 * The range and the patched version of one vulnerability, checked: the range
 * a string `semver` reads (and not empty), the `first_patched_version` a
 * semver version or `null` (a vulnerability that leaves the field out fails:
 * a missing value is neither). It is the check the sweep makes on
 * an npm alert, for its reason: `semver` answers "does not satisfy" for a
 * range it cannot read, which would read as "not exposed".
 *
 * @param {string} id the advisory's id, for the message
 * @param {{package: {name: string}}} vulnerability
 * @returns {{range: string, patched: string | null}} the range as `semver` reads it
 */
function rangeAndPatch(id, vulnerability) {
  const range =
    typeof vulnerability.vulnerable_version_range === "string"
      ? semverRange(vulnerability.vulnerable_version_range)
      : "";
  const patched = vulnerability.first_patched_version;
  if (
    range === "" ||
    semver.validRange(range) === null ||
    !(
      patched === null ||
      (typeof patched === "string" && semver.valid(patched) !== null)
    )
  ) {
    throw new Error(
      `the advisory listing held ${id} on ${vulnerability.package.name} with a vulnerable range or a patched version that is not semver`,
    );
  }
  return { range, patched };
}

/**
 * One answer of the advisory listing, checked. Every failed check throws.
 *
 * Each entry must be an object stating:
 *
 *   - `ghsa_id`, in the form `GHSA-xxxx-xxxx-xxxx`, and no id twice in one
 *     answer (the same advisory in two queries' answers is expected);
 *   - `type` `reviewed`, the only type the query asks for;
 *   - `withdrawn_at`, present, a string or `null`: a withdrawn advisory IS in
 *     the answer (measured), and an entry that leaves the field out cannot be
 *     told from one that was never withdrawn;
 *   - `severity` and `summary` as strings and `cve_id` as a string or `null`.
 *     None of the three decides anything, so none is held to a form: each is
 *     text in an issue, and a word or an id this file has not seen must not
 *     turn a good read into a failed one (the review model's cases 4 and 5);
 *   - `vulnerabilities`, a non-empty list of objects, EVERY one of which
 *     states its `package` as an object with a string `ecosystem` and a
 *     string `name`, its `vulnerable_version_range` as a string, and its
 *     `first_patched_version`, present, as a string or `null`. That holds for
 *     a vulnerability of another ecosystem or another package too: one that
 *     does not say what it is about cannot be shown to be about something
 *     else, and is not skipped (the review model's case 3). The endpoint's
 *     schema allows a null package, name and range; measured 2026-11-22 over
 *     all 8,184 reviewed npm advisories and their 11,750 vulnerabilities,
 *     none had one.
 *
 * A vulnerability counts as ASKED ABOUT when it is `npm` and names a package
 * of this query. Each of those must also state a range `semver` reads and a
 * patched version that is a semver version or `null`: the alert path's
 * check, for its reason (`semver` answers "does not satisfy" for a range it
 * cannot read, which would read as "not exposed"). Measured the same day: 16
 * of the database's 11,237 npm ranges and 21 of its patched versions are not
 * ones `semver` reads (a calendar version such as `2026.05.0`), so an
 * advisory like that on a locked package stops the run, by name.
 *
 * And the answer must be an answer to THIS query. Every advisory in it must
 * hold at least one vulnerability that was asked about; and one that is not
 * withdrawn must hold a range that an asked version of that package
 * satisfies. An advisory that fails the first is an answer to some other
 * question. One that fails the second is the listing and `semver`
 * disagreeing about a version, and silence there would be a guess.
 *
 * @param {unknown[]} list the flattened pages of one query
 * @param {Array<{name: string, version: string}>} asked the query's pairs
 * @returns {object[]} the same entries
 */
export function checkAnswer(list, asked) {
  const askedVersions = new Map();
  for (const { name, version } of asked) {
    if (!askedVersions.has(name)) askedVersions.set(name, []);
    askedVersions.get(name).push(version);
  }
  const fail = (what) => {
    throw new Error(`the advisory listing held ${what}`);
  };

  const seen = new Set();
  for (const entry of list) {
    if (!isRecord(entry)) fail("an entry that is not an object");
    const id = entry.ghsa_id;
    if (typeof id !== "string" || !GHSA_RE.test(id)) {
      fail("an entry with no usable advisory id");
    }
    if (seen.has(id)) fail(`${id} twice in one answer`);
    seen.add(id);
    if (entry.type !== "reviewed") {
      fail(`${id} with a type other than "reviewed"`);
    }
    if (
      !(entry.withdrawn_at === null || typeof entry.withdrawn_at === "string")
    ) {
      fail(`${id} without a withdrawn_at that is a date or null`);
    }
    if (
      typeof entry.severity !== "string" ||
      typeof entry.summary !== "string" ||
      !(entry.cve_id === null || typeof entry.cve_id === "string")
    ) {
      fail(`${id} without its severity, summary or CVE id in a usable form`);
    }
    if (
      !Array.isArray(entry.vulnerabilities) ||
      entry.vulnerabilities.length === 0
    ) {
      fail(`${id} with no list of vulnerabilities`);
    }

    let askedAbout = 0;
    let inRange = 0;
    for (const vulnerability of entry.vulnerabilities) {
      if (!isRecord(vulnerability)) {
        fail(`${id} with a vulnerability that is not an object`);
      }
      const pkg = vulnerability.package;
      const patch = vulnerability.first_patched_version;
      if (
        !isRecord(pkg) ||
        typeof pkg.ecosystem !== "string" ||
        typeof pkg.name !== "string" ||
        typeof vulnerability.vulnerable_version_range !== "string" ||
        !(patch === null || typeof patch === "string")
      ) {
        fail(
          `${id} with a vulnerability that does not state its package, its vulnerable range and its patched version`,
        );
      }
      if (pkg.ecosystem !== ECOSYSTEM || !askedVersions.has(pkg.name)) {
        continue;
      }
      askedAbout++;
      const { range } = rangeAndPatch(id, vulnerability);
      if (
        askedVersions
          .get(pkg.name)
          .some((version) => semver.satisfies(version, range))
      ) {
        inRange++;
      }
    }
    if (askedAbout === 0) {
      fail(`${id}, which names no package this query asked about`);
    }
    if (entry.withdrawn_at === null && inRange === 0) {
      fail(
        `${id}, which it returned for this query although no version asked about is in its range as semver reads it`,
      );
    }
  }
  return list;
}

/**
 * The state of each control in one checked answer:
 *
 *   - `good`: its advisory is there, is not withdrawn, and lists a range for
 *     the control's package that the control's version satisfies;
 *   - `stale`: its advisory is there, but is withdrawn or no longer lists
 *     such a range;
 *   - `absent`: its advisory is not in the answer at all.
 *
 * @param {object[]} answer from `checkAnswer`
 * @returns {Array<{control: (typeof CONTROLS)[number], state: "good" | "stale" | "absent"}>}
 */
export function controlStates(answer) {
  return CONTROLS.map((control) => {
    const advisory = answer.find((entry) => entry.ghsa_id === control.ghsa);
    if (advisory === undefined) return { control, state: "absent" };
    const applies =
      advisory.withdrawn_at === null &&
      advisory.vulnerabilities.some(
        (v) =>
          v.package?.ecosystem === ECOSYSTEM &&
          v.package.name === control.name &&
          semver.satisfies(
            control.version,
            semverRange(v.vulnerable_version_range),
          ),
      );
    return { control, state: applies ? "good" : "stale" };
  });
}

/**
 * The advisories that apply to the lock file, as records of the shape the
 * Dependabot alert listing gives.
 *
 * One record per (advisory, package, range) whose range some locked version
 * of that package satisfies. A withdrawn advisory makes none. `manifest_path`
 * is `bun.lock`, which the sweep already knows; the link is built from the
 * checked id; the scope says it was not determined, because whether a locked
 * package serves the running server or only the tooling is not computed.
 *
 * The same (advisory, package, range) twice with the same patched version is
 * taken once. With two patched versions it is a contradiction in the answers
 * and throws, as the same alert listed twice does in the sweep.
 *
 * @param {Iterable<object>} advisories checked entries, each id once
 * @param {Map<string, string[]>} versionsOf from `lockedVersions`
 * @returns {object[]}
 */
export function lockRecords(advisories, versionsOf) {
  const records = [];
  const seen = new Map();
  for (const advisory of advisories) {
    if (advisory.withdrawn_at !== null) continue;
    for (const vulnerability of advisory.vulnerabilities) {
      const pkg = vulnerability.package;
      if (pkg?.ecosystem !== ECOSYSTEM || !versionsOf.has(pkg.name)) continue;
      // Checked here as well as in `checkAnswer`: an advisory returned for
      // one query can also name a package another query asked about, whose
      // range that answer's check never read.
      const { range, patched } = rangeAndPatch(advisory.ghsa_id, vulnerability);
      if (
        !versionsOf
          .get(pkg.name)
          .some((version) => semver.satisfies(version, range))
      ) {
        continue;
      }
      const identity = JSON.stringify([
        advisory.ghsa_id,
        pkg.name,
        vulnerability.vulnerable_version_range,
      ]);
      if (seen.has(identity)) {
        // The same entry again is expected: an advisory two answers held
        // brings each of its vulnerabilities twice (`readLockAdvisories`).
        // The same range with ANOTHER patched version is a contradiction.
        if (seen.get(identity) === patched) continue;
        throw new Error(
          `the advisory listing held ${advisory.ghsa_id} with the same range for ${pkg.name} twice, with two patched versions`,
        );
      }
      seen.set(identity, patched);
      records.push({
        state: "open",
        html_url: `https://github.com/advisories/${advisory.ghsa_id}`,
        dependency: {
          package: { ecosystem: ECOSYSTEM, name: pkg.name },
          manifest_path: LOCK_MANIFEST,
          scope: "not determined",
        },
        security_advisory: {
          ghsa_id: advisory.ghsa_id,
          cve_id: advisory.cve_id,
          severity: advisory.severity,
          summary: advisory.summary,
        },
        security_vulnerability: {
          vulnerable_version_range: vulnerability.vulnerable_version_range,
          first_patched_version:
            patched === null ? null : { identifier: patched },
        },
      });
    }
  }
  return records;
}

/**
 * Ask the advisory listing about every pair locked in `bun.lock`.
 *
 * Every read is made, and every answer checked, before anything is returned;
 * the caller makes its first write only after this returns. So a failure
 * here leaves every issue as it was.
 *
 * What the controls decide, for each query's answer:
 *
 * | the two controls are | the read | this function |
 * | --- | --- | --- |
 * | both good | stands | carries on |
 * | either one absent | FAILED | throws |
 * | both stale | FAILED | throws: nothing is left to vouch for the answer |
 * | one good, one stale | stands, on the good one | carries on, and names the stale one in `staleControls` |
 *
 * Absent is a failed read even beside a good control: a withdrawn advisory
 * stays in the listing with its date (measured: advisories withdrawn in 2020
 * and 2021 are still returned), so one that is missing altogether was left
 * out by the answer, and an answer that left out one advisory known to apply
 * may have left out others. One stale control does not stop the work,
 * because the other still shows the query was answered. The caller ends the
 * run red on `staleControls` after its work, so that a control which needs
 * replacing is not a line in a log nobody reads.
 *
 * @param {Function} spawn every `gh` call goes through it
 * @param {Array<{name: string, version: string}>} entries the lock file's
 *   entries, as `parseBunLock` returns them
 * @returns {{records: object[], staleControls: string[]}} `staleControls`
 *   names each as `name@version (advisory id)`
 */
export function readLockAdvisories(spawn, entries) {
  const versionsOf = lockedVersions(entries);
  const queries = advisoryQueries(versionsOf);
  const advisories = new Map();
  const stale = new Set();
  queries.forEach((query, index) => {
    const which = `query ${index + 1} of ${queries.length}`;
    let answer;
    try {
      answer = checkAnswer(ghPaginatedList(spawn, query.path), query.asked);
    } catch (error) {
      throw new Error(`${which}: ${error.message}`);
    }
    const states = controlStates(answer);
    const name = ({ control }) =>
      `${control.name}@${control.version} (${control.ghsa})`;
    const absent = states.filter((s) => s.state === "absent");
    if (absent.length > 0) {
      throw new Error(
        `${which}: the answer does not hold the control ${absent.length === 1 ? "advisory" : "advisories"} for ${absent.map(name).join(" and ")}, so it cannot be read as "nothing found"`,
      );
    }
    const staleHere = states.filter((s) => s.state === "stale");
    if (staleHere.length === states.length) {
      throw new Error(
        `${which}: every control advisory is withdrawn or no longer covers its control version (${staleHere.map(name).join(" and ")}), so nothing vouches for the answer`,
      );
    }
    for (const s of staleHere) stale.add(name(s));
    for (const advisory of answer) {
      const held = advisories.get(advisory.ghsa_id);
      if (held === undefined) {
        advisories.set(advisory.ghsa_id, {
          ...advisory,
          vulnerabilities: [...advisory.vulnerabilities],
        });
        continue;
      }
      // The same advisory in a second answer. The endpoint returns the whole
      // advisory each time, so the two copies should be one advisory; they
      // are still two independent reads, and neither is taken on the
      // strength of having arrived first (the review model's cases 1 and
      // 2). What says whether the advisory applies at all must agree, or
      // the run stops. What each copy lists is united, so a package only
      // the later copy names is not lost; `lockRecords` takes an entry both
      // copies hold once, and stops on one range with two patched versions.
      for (const field of ["withdrawn_at", "severity", "summary", "cve_id"]) {
        if (held[field] !== advisory[field]) {
          throw new Error(
            `${which}: ${advisory.ghsa_id} does not agree with the copy an earlier answer held (its ${field})`,
          );
        }
      }
      held.vulnerabilities.push(...advisory.vulnerabilities);
    }
  });
  return {
    records: lockRecords(advisories.values(), versionsOf),
    staleControls: [...stale],
  };
}
