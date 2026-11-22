// One second between consecutive GitHub writes, for the scheduled sweeps.
//
// Written in this repo (not the source's): docs/DESIGN-nor-673-sweeps.md,
// addition A3. The rule it carries out is AGENTS.md, Issue-driven Work Style:
// "Pace bulk GitHub writes: 1 s between requests, never in parallel". The
// source's rules have the same line and its sweeps do not pace.
//
// A sweep wraps every issue write (a create, an edit, a comment) in the
// function `pacedWrites()` returns. The first write goes straight through;
// each later one waits `WRITE_PAUSE_MS` first. The sweeps are synchronous, so
// their writes are never parallel, and the wait is synchronous too.
//
// The monthly sweep makes ONE write a run today (it creates its issue or edits
// it), so its pause does not fire. The wrapper is on its write path all the
// same, so that a second write cannot be added to a run without the pause.
//
// The pause is a parameter, so a test passes a recorder and does not wait.
//
// Not here, and why: the rule's other half, "a refused create can still go
// through, so look before retrying". The sweeps retry nothing inside a run: a
// failed write throws, and the next run reads the listing of its own issues
// before it creates anything.

/** The gap the rule asks for between two GitHub writes, in milliseconds. */
export const WRITE_PAUSE_MS = 1000;

/**
 * Block this thread for `ms` milliseconds, without a child process and
 * without spinning: a wait on a private buffer that nothing ever notifies.
 *
 * @param {number} ms
 */
export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * A wrapper for one run's GitHub writes: it calls each write in turn and
 * pauses before every write after the first.
 *
 * A write that throws still counts as a write: the request may have reached
 * GitHub, so whatever follows it waits as well.
 *
 * @param {(ms: number) => void} [pause] defaults to a real synchronous sleep
 * @returns {<T>(write: () => T) => T}
 */
export function pacedWrites(pause = sleepSync) {
  let wrote = false;
  return (write) => {
    if (wrote) pause(WRITE_PAUSE_MS);
    wrote = true;
    return write();
  };
}
