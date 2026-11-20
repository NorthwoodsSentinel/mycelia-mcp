/**
 * Reading `bun.lock`, the text lockfile, for the install guards.
 *
 * In this repo: not an MCP Inspector file. The Inspector's
 * `verify-install-fresh` and `verify-install-scripts`
 * (`modelcontextprotocol/inspector` `main` eb54b44) read npm's
 * `package-lock.json`. This repo installs with Bun, whose lockfile has a
 * different shape, so the reading is its own module, shared by the install
 * guards here (`scripts/verify-install-fresh.mjs` today). It comes, with
 * only this header changed, from a reviewed port of those guards in a private
 * sibling repository; a comment below that cites a review round ("Codex design
 * r1") means a round of that port's review. Record: `PROVENANCE.md`.
 *
 * The shape this reads (`lockfileVersion` 1):
 *
 *   - `workspaces[""]` is the root project: its `dependencies`,
 *     `devDependencies` and `optionalDependencies`.
 *   - `packages` maps an INSTALL PATH to `[ident, registry, meta, integrity]`
 *     (a registry package). `ident` is `name@version`; `meta` may carry
 *     `dependencies`, `optionalDependencies`, `os` and `cpu`.
 *
 * An install path is a chain of package names, one per `node_modules` level.
 * A name segment starting with `@` takes the next segment with it, so
 * `@babel/parser` is ONE name at the top level, not `@babel` with `parser`
 * nested under it (Codex design r1, finding 1). So:
 *
 *   eslint            → node_modules/eslint
 *   @babel/parser     → node_modules/@babel/parser
 *   qified/hookified  → node_modules/qified/node_modules/hookified
 *   a/@s/n            → node_modules/a/node_modules/@s/n
 *
 * Every failure to read is a THROW, never an empty result: a lockfile the
 * guards cannot read must not pass as a lockfile with nothing in it.
 */

/**
 * Removes trailing commas before `}` or `]`, outside string literals. Bun
 * writes them; `JSON.parse` rejects them. A comma inside a string (an
 * integrity hash never has one, but a path might) is left alone.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripTrailingCommas(text) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") {
        out += text[++i] ?? "";
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === "}" || text[j] === "]") continue;
    }
    out += c;
  }
  return out;
}

/**
 * Splits an install-path key into package names (see the header).
 *
 * @param {string} key
 * @returns {string[]}
 */
export function splitInstallPath(key) {
  const segments = key.split("/");
  const names = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === "") {
      throw new Error(`bun.lock: install path "${key}" has an empty segment`);
    }
    if (seg.startsWith("@")) {
      const next = segments[i + 1];
      if (next === undefined || next === "" || seg === "@") {
        throw new Error(
          `bun.lock: install path "${key}" has a scope with no package name`,
        );
      }
      names.push(`${seg}/${next}`);
      i++;
    } else {
      names.push(seg);
    }
  }
  return names;
}

/**
 * The directory, relative to the install root, where an install path lives.
 *
 * @param {string} key
 * @returns {string} e.g. `node_modules/a/node_modules/@s/n`
 */
export function installDir(key) {
  return splitInstallPath(key)
    .map((name) => `node_modules/${name}`)
    .join("/");
}

/**
 * Splits `name@version` at the LAST `@`, so a scoped name keeps its scope.
 *
 * @param {string} ident
 * @returns {{ name: string, version: string }}
 */
export function splitIdent(ident) {
  const at = ident.lastIndexOf("@");
  if (at <= 0 || at === ident.length - 1) {
    throw new Error(`bun.lock: "${ident}" is not name@version`);
  }
  return { name: ident.slice(0, at), version: ident.slice(at + 1) };
}

/**
 * @typedef {object} LockEntry
 * @property {string} key       the install path, as written
 * @property {string} dir       where it lives, relative to the install root
 * @property {string} name      the package name
 * @property {string} version   the locked version
 * @property {Record<string, unknown>} meta  the entry's metadata object
 */

/**
 * Parses `bun.lock` text into its root project and its package entries.
 *
 * Each entry's ident must name the package its key ends in; a mismatch throws
 * (an entry whose key and ident disagree cannot be checked at either).
 *
 * @param {string} text
 * @returns {{ root: Record<string, Record<string, string>>, entries: LockEntry[], trustedDependencies: unknown }}
 */
export function parseBunLock(text) {
  let doc;
  try {
    doc = JSON.parse(stripTrailingCommas(text));
  } catch (err) {
    throw new Error(`bun.lock: could not parse: ${err.message}`);
  }
  if (doc === null || typeof doc !== "object") {
    throw new Error("bun.lock: not an object");
  }
  if (doc.lockfileVersion !== 1) {
    throw new Error(
      `bun.lock: lockfileVersion ${JSON.stringify(doc.lockfileVersion)} is not the 1 this reader knows`,
    );
  }
  const root = doc.workspaces?.[""];
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    throw new Error('bun.lock: no root workspace (workspaces[""])');
  }
  const packages = doc.packages;
  if (
    packages === null ||
    typeof packages !== "object" ||
    Array.isArray(packages)
  ) {
    throw new Error("bun.lock: no packages map");
  }

  const entries = Object.entries(packages).map(([key, value]) => {
    if (!Array.isArray(value) || typeof value[0] !== "string") {
      throw new Error(`bun.lock: entry "${key}" is not [ident, …]`);
    }
    const { name, version } = splitIdent(value[0]);
    const names = splitInstallPath(key);
    if (names[names.length - 1] !== name) {
      throw new Error(
        `bun.lock: entry "${key}" names "${name}", not the package its path ends in`,
      );
    }
    const meta =
      value.find(
        (v, i) =>
          i > 0 && v !== null && typeof v === "object" && !Array.isArray(v),
      ) ?? {};
    return { key, dir: installDir(key), name, version, meta };
  });

  return { root, entries, trustedDependencies: doc.trustedDependencies };
}
