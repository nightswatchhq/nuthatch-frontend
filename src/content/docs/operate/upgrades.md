---
title: "Upgrading a nest"
description: "The N-1 resync tax, solved by the runtime rather than by a command you have to remember."
order: 9
---

The N-1 problem is the subgraph resync tax: version N is live, version N+1 needs days of backfill, and
consumers eat downtime or stale data during the flip.

In 2.0 there is **no upgrade command**. The runtime does the classifying, and grafting does the rest.

:::note[What changed]
`nuthatch nest diff` and `nuthatch nest upgrade` were removed in 2.0. They carried real information,
but only if you remembered to run them. That information now arrives at the moment a nest's identity
actually changes, which is the moment it matters.
:::

## Stage the new version and migrate

```sh
nuthatch migrate --dir my-runtime --dry-run   # prints the plan, and names any breaking change
nuthatch migrate --dir my-runtime             # applies it
```

The runtime compares the staged version's schema against what the alias currently serves:

- **Compatible** - additive only: new tables, new columns, new views. Nothing a current consumer reads
  changes shape. Applied.
- **Breaking** - a consumer-observable change: a removed table or column, a changed type. **Named and
  refused**, with nothing moved:

```text
  usdc: nests/usdc -> data/8f21c4de0b1a
      BREAKING for consumers of `usdc`:
        - column `usdc__transfer.value` removed

Error: 1 mount(s) would break consumers (listed above). Nothing was changed.
```

Add `--allow-breaking` once the consumers are ready, or mount the new version under a different alias
and migrate them across on their own clock. **The data is safe either way** - this is about queries,
not bytes.

## Why an edit usually costs nothing

A nest's identity is a hash of its authored inputs, so *any* edit changes it. Without more, that would
mean every edit re-indexes the chain. Two things stop it:

**Early cutoff.** A **cosmetic** edit - a comment, a renamed view, a doc change, a tweak to the query
surface - changes what the nest *is* but not what it *stores*. The new identity **adopts the existing
dataset** instead of backfilling. On a real 428 MB nest this takes about a tenth of a second, because
it moves nothing.

**Shared segments.** Sealed segments are content-addressed, so two nests that decode the same contract
produce byte-identical files and hold **one copy** between them. A second nest indexing a contract you
already index costs no new bytes.

## What will never be reused, and why

Some derivations cannot be cached at all, and the runtime tells you at load rather than leaving you to
wonder why edits stay slow:

```text
! view stamped can never be reused across an edit: it calls the volatile function `now()`,
  whose value changes between runs
```

A view whose result depends on the clock, on randomness, or on row order the engine does not guarantee
is legal to author - it simply cannot be reused, because two runs may honestly disagree. Run
`nuthatch check` to see the list before you deploy.

A **cycle** among views is different: it is refused at load, with the cycle named.

## Coming from 1.x

**If you run a single nest - `nuthatch dev --dir <nest>` on a directory with a `nuthatch.toml` - there
is nothing to migrate.** Stop the service, swap the binary, start it. 2.0's layout change is to
*runtime* directories, and a solo nest does not have one. Verified on a production box: two solo nests
upgraded 1.0.2 → 2.0.0 by binary swap, row counts byte-identical before and after, back at tip in
seconds.

`nuthatch migrate` is for a directory that has a **`roost.toml`** in it. If you do not have that file,
skip the rest of this section.

Measured on a real two-nest runtime rather than a fixture:

```text
BEFORE   882 MB   504 parquet files
$ nuthatch migrate --dir /opt/my-runtime
Shared 504 segment(s) into segments/ (504 duplicate copies reclaimed).
real 0m0.259s
AFTER    880 MB   252 parquet files      per-dataset leftovers: 0
```

A quarter of a second, and **nothing re-indexed**. The disk total barely moves because the segments
were only ~4 MB of that 882 MB - the bulk is per-dataset hot stores, which are mutable and
reorg-affected and so cannot be shared. The **file count** is what shows the collapse; nests with more
sealed history save bytes too.

The order for a runtime directory: dry-run against a copy, stop the service, swap the binary, migrate,
start.

What changed, all of it reserved for a major:

- `roost.toml` → `mounts.toml`, `[roost]` → `[runtime]`
- `nuthatch roost dev` → **`nuthatch dev`**; the directory decides what runs
- `nuthatch nest diff` and `nest upgrade` removed - the runtime classifies at the moment identity changes
- on-disk `nests/<name>/` → `data/<nid>/`, plus a shared content-addressed `segments/`
- the `GET /nests` roster field `roost` → `runtime`

`provenance` also gained `nid`, naming *which dataset* answered rather than only how it decoded. That
one is additive - nothing to do.

## The upgrade you will eventually do at 2am

Rehearse it. `nuthatch migrate --dir <copy> --dry-run` against a non-production copy prints the whole
plan, including every breaking change by name, and changes nothing. A plan you have read once is worth
more than a command you have memorised.
