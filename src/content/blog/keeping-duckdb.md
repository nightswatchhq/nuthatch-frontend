---
title: "Keeping DuckDB"
date: "2026-08-31"
description: "We spent August asking whether Nuthatch could drop DuckDB, and every C++ dependency with it, without sacrificing anything. The answer is no - and two of our own published benchmarks turned out to be wrong in DuckDB's disfavour."
author: "cargopete"
tags: ["nuthatch", "duckdb", "datafusion", "benchmarks", "rfc", "sql", "rust"]
---

For most of August, Nuthatch carried an open question with a carve-out from our feature freeze:
**can we remove DuckDB, and with it every C++ dependency in the shipped binary, without sacrificing
anything?**

This week we answered it. The answer is no, and this post is the story of how we got there,
including the part where our own published benchmarks turned out to be wrong in DuckDB's disfavour.

## Why we asked

Nuthatch is a single-binary Rust indexer. Blocks come in over RPC, get decoded deterministically,
live briefly in a hot store, and past finality are sealed into immutable, content-addressed Parquet
segments. DuckDB sits at the end of that pipeline: it attaches the sealed segments read-only and
serves SQL over hot ∪ cold - one engine, no daemon, no Postgres.

It earns its place. But it also dominates the build in one specific way: **93% of our native
artefact bytes are DuckDB**, and it is the sole reason the Linux release binary dynamically links
`libstdc++.so.6`, which puts an ABI floor (`GLIBCXX_3.4.29`) under every machine that runs it. For a
project that pitches "one Rust binary, runs anywhere reasonable," a C++ runtime in the linkage is at
minimum an aesthetic itch, and the Rust ecosystem - DataFusion, Arrow, the pure-Rust Parquet
reader - has matured to the point where scratching it looked plausible.

So RFC-0042 asked the question properly, with a rule we set on day one: **no preferred answer**. The
RFC's acceptance gate listed everything a replacement had to preserve - exact refuse-on-overflow
arithmetic, authored views, the hot/cold seam, limits and cancellation, one binary - and its
decision section banned the arguments we didn't trust ourselves with: no appeals to Rust purity, no
roadmap, no "probably."

## How we ran it

We did the boring groundwork first. A bill of materials established what DuckDB actually costs (93%
of artefact bytes, but only 10.6% of clean build time - wasmtime costs twice that). An inventory
found DuckDB plays not one role but **six**: analytical SQL, the SQL parser we canonicalise through,
the reference oracle for our incremental entities, the restart seed, entity serving, and the
function vocabulary that decides what users may write in `entities.toml`. Measurements piled up: a
specialised Rust operator for our heaviest fold beat DuckDB at every size (0.55-0.85x); general SQL
through DataFusion on a realistic segment layout lost badly (2.5-2.8x slower); real authored views
ran at exact parity, 0.81-1.64x.

Then, for the final push, we tried something new: we wrote the closing experiments as a
**pre-registered brief** - outcome rules fixed before running, inadmissibility conditions stated, a
report format ending in a single decision line with a confidence percentage - and gave it to two
independent AI agents on the same machine, same commit, same nest, forbidden from reading each
other's work. The idea was to make disagreement localisable and agreement meaningful.

They agreed. **KEEP, at 78% and 88%.**

## What the experiments found

Three findings did most of the work, and two of them are corrections to things we'd published.

**1. Our concurrency benchmark was measuring its own mutex.** The scariest anti-DuckDB number in the
whole RFC was a flat ~40 qps from 1 to 32 clients with p99 blowing out to seven seconds, attributed
to our `analytics.rs` holding one connection under a mutex. Both agents, independently, found that
`analytics.rs` does no such thing - the lock is held for a map operation and dropped before the
query runs. The serialisation lived in the benchmark harness. Measured on the product's real path,
DuckDB scales roughly 5x from 1 to 32 clients with sub-second p99s, and a bounded connection pool
takes it to ~80 qps. The one row where DuckDB looked architecturally beaten was a bug in our
measurement, published as a property of the engine. It came from trusting a doc comment ("queries
take the mutex") over the body of the function it documented.

**2. The portability win costs 567 KB, not an engine migration.** The concrete payoff of going
C++-free was supposed to be dropping the `GLIBCXX` floor. One agent found why the obvious
`-static-libstdc++` flag doesn't work - our DuckDB bindings emit an explicit `-lstdc++`, which that
flag doesn't govern - and then fixed it by putting the static archive ahead on the linker search
path. Result: `libstdc++.so.6` gone from `ldd`, zero `GLIBCXX`/`CXXABI` symbols in the binary,
+0.55% size, and the binary boots on a system where libstdc++ has been deleted outright. The
headline benefit of removing DuckDB is now a release-build tweak that keeps DuckDB.

**3. Nobody is blocked.** Three independent searches of every issue, discussion, grant deliverable
and the platform support list found **zero** named users impeded by anything the C++ tail causes.
The only portability incident in our history was a glibc floor from an unpinned CI runner, which
removing DuckDB wouldn't have touched. We are a young project and this partly measures our user
count rather than our users' happiness. But the specific claim the removal case rested on - that
this complexity is costing an identifiable someone something identifiable - found nothing to stand
on, three times.

Meanwhile the costs of removal stayed exactly where they were: five of DuckDB's six roles have no
replacement built; DataFusion still silently wraps integer overflow where DuckDB errors, which for
an indexer summing token amounts is the single worst place to be silently wrong; real views need a
`HUGEINT` compatibility layer that doesn't exist; and the first specialised Rust operator we ever
built for this effort shipped an i128 overflow bug that a "24/24 exact parity" corpus couldn't see,
because the corpus never reached the boundary. It was caught in review. That one stung, and it
recalibrated how much weight "parity exact" can carry when the corpus is friendly.

There was one genuinely encouraging result for a future Rust path, and it deserves stating fairly:
the entire admitted query surface of a real production nest reduces to **twelve stock relational
operators**. Both agents converged on the same list from different query sets, and eighteen
deliberately adversarial ad-hoc queries added exactly one more. Whatever eventually serves this
workload does not need to be a general SQL engine. But "the surface is small" is an argument that a
replacement is *feasible*, not that it is *motivated*, and feasibility was never the thing in doubt.

## The decision

**DuckDB stays**, in all six roles, and the RFC is closed with the reasoning on record rather than
left ajar. The short version of the ledger: every measured reason to remove it either dissolved
under measurement (concurrency), became a two-line fix (portability), or found no one who needed it
(users), while the regressions a removal would accept remained itemised, real, and unpaid.

The decision comes with reopen conditions, because "closed" should mean "closed until something
changes," not "closed until someone's enthusiasm recovers." We'll reopen if a named user or funder
deliverable is genuinely blocked by the C++ tail (and the static-link fix doesn't cover it), if all
five unbuilt roles ever pass their parity corpora inside tight time-boxes, if DataFusion ships
refuse-on-overflow arithmetic by default, or on a schedule tied to a grafting change that would make
an engine swap expensive to do late. And not before September 2027 otherwise.

## What we're shipping anyway

The best part of an investigation that ends in "no change" is the pile of unconditional improvements
it leaves behind:

- **Statically absorbing `libstdc++`** in the release build, pending verification on the release
  runner. Removes a documented ABI floor for half a megabyte.
- **A bounded analytical connection pool.** The unbounded path reaches ~1.9 GB at 32 concurrent
  queries, 93% of a cursor's entire RAM budget, while a pool of 8 gives *more* throughput at
  two-thirds the memory. Better on both axes is not a trade-off, it's a bug fix.
- **Corrected benchmarks.** The false serialisation claim is being struck from the concurrency
  writeup and the misleading comment that seeded it is being fixed. Two of our published numbers
  were wrong; they're wrong in public, so they get corrected in public.
- **A corpus loading fix**, after an agent discovered that a segments-only nest copy silently reads
  as *empty* rather than erroring - absent data presenting as healthy, which is the exact failure
  shape an indexer must never exhibit.

## What we'd tell you to steal

Pre-registration was the whole game. Writing "here is what each result will mean" *before* running
anything is what let two independent runs be comparable, kept us from rationalising after the fact,
and made the final percentages mean something. The corrections table, where every revised number
appears next to the number it replaced, is the reason we trust this conclusion more than the
intuitions we started with, on both sides.

And the meta-lesson, which cost us the most to learn: **the strongest argument in the whole
investigation was an artefact of its own harness.** If your benchmark's conclusion matches a
sentence in a comment, check the function under the comment. Ours didn't match, for two published
documents in a row, and nobody looked until the question got expensive enough to look properly.

DuckDB, for its part, spent the month being measured by people actively trying to replace it and
came out ahead on nearly every row that mattered. That's about the highest compliment an embedded
engine can be paid. It stays.
