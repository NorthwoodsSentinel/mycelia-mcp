# KINTSUGI

Repairs in this repo are marked, not hidden. Each fix carries the same gold line in three
places: a `kintsugi:` comment at the repair site, a `Kintsugi:` trailer on the commit, and a
row here. Where the repair has no comment syntax (a lockfile, package.json), the seam lives
in the trailer and this ledger only. The ledger is append-only.

A row never claims a review before one exists. Review status names the reviewer, the verdict
and the reviewed SHA. Security repairs describe the class of fix, never how to exploit the break.

| Date | What broke | How it was mended | Mended by / reviewed by | Gold line |
|---|---|---|---|---|
| 2026-10-31 | The lockfile pinned vulnerable packages beneath a current SDK. | Regenerated the lock within existing ranges (7235b76). | CeeCee / Codex audit of 7235b76: fail (HIGH was a mistake in my review brief, which said 'engines' applied here, not a defect; MEDIUM untested runtime paths, non-security, ticketed) | the surface was new; the roots beneath were old — / we turned the soil, and the same voice answers. |
