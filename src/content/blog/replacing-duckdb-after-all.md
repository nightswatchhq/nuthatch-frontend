---
title: "Replacing DuckDB, after all"
date: "2026-09-26"
description: "Four weeks ago we wrote that DuckDB stays. We are reversing that: nuthatch will move its SQL surface to Burrmill, a Rust engine we built on DataFusion, once it has run beside DuckDB on live nests for a release without a single unexplained difference. Here is what changed, the numbers, where Burrmill still loses, and how the swap will be done on the ten nests already in production."
author: "cargopete"
tags: ["nuthatch", "duckdb", "datafusion", "burrmill", "benchmarks", "sql", "rust"]
---

On 31 August we published [Keeping DuckDB](/blog/keeping-duckdb), which closed a month-long
investigation with the words "it stays" and a list of conditions under which we would reopen the
question, the last of them being "not before September 2027 otherwise". It is September 2026, and
**we are reopening it, and answering it the other way: nuthatch will replace DuckDB with Burrmill,
a Rust engine we have built on DataFusion.**

That post said a project which quietly edits its old positions is harder to trust than one which
dates them, so it now carries a banner pointing here and the body is left as written. This post is
the account of what changed, what the new engine does and does not do, and how a swap of the
component that answers every SQL query is going to happen on nests that people are reading right
now.

## What changed was the question

None of the reopen conditions we wrote in August has been met in the form we wrote it. No named
user is blocked by the C++ tail. DataFusion has not shipped refuse-on-overflow arithmetic. What
changed, on 16 September, was that we stopped asking "is removal motivated?" and started asking "can
it be done without a regression anyone feels?", and the reason for the change was operational
rather than philosophical.

Two production incidents have been traced to the bundled engine. A DuckDB
assertion in compressed materialisation fires on a shape every sealed segment has once a cursor sits
inside it, and a 3.4.0 nest serving Lodestar's curator lists died twice at the same instruction, a
`free` on the HTTP response path, which is what a native library corrupting the heap looks like from
outside. We turned the optimiser off. Separately, nuthatch's `/sql` panicked on a `DECIMAL(38, s)`
result because the Rust bindings materialise it through a 96-bit type, which we worked around by
reprojecting the column as text. Neither is DuckDB's fault in any moral sense; both are the cost of
a large C++ engine inside a Rust binary, paid by the operator at two in the morning. That cost was
listed in August as an aesthetic itch. It stopped being aesthetic.

So the goal moved. The August gate was "at most 1.0x DuckDB on every shape", a bar chosen so that a
replacement would have to win to be allowed in. The September gate is **no regression a user can
feel, and answer parity on every authored statement that does not relax by one wei.** Under the
first bar, DuckDB won and the question was closed. Under the second, the work is what it has always
been: build the thing and measure it until it is boring.

## What Burrmill is

Burrmill is a Rust query engine for nuthatch's sealed Parquet segments and hot tip. Underneath it is
DataFusion 55, which we said in August was the only credible host and still is. On top of it,
Burrmill owns the parts DataFusion gets wrong for an indexer:

- **Exact arithmetic.** DataFusion wraps integer overflow silently, which for a system summing token
  amounts is the single worst place to be silently wrong. Burrmill's `CheckedArithmetic` rule
  rewrites every sum, product and cast to refuse rather than wrap, and a differential test table of
  every overflow shape we could think of is either exact or refused, never wrong.
- **DuckDB's dialect.** Every authored view in every nest is written in DuckDB SQL. Burrmill parses
  it, fits integer literals the way DuckDB does (`UBIGINT - 1` stays `UBIGINT`), rounds casts the way
  DuckDB does, and models two DuckDB roundings in `DECIMAL` to `DOUBLE` conversion that arrow does
  correctly and DuckDB does not, so that `lodestar_delegator_stakes` agrees to the last of its 6.4e18
  wei rather than to the first sixteen digits.
- **Plan shapes DataFusion lacks.** A range join (DataFusion 55 runs `x >= start AND x <= until` as a
  nested loop), top-per-group, a distinct split, shared repeated subqueries, and a purpose-built
  partitioned fold for the `GROUP BY` over hundreds of thousands of parties that nuthatch's balance
  rebuilds do.
- **A lockdown.** An unconfigured DataFusion `SessionContext` will read `/etc/hosts` and write
  files. Burrmill's catalogue knows the nest's segments and nothing else.

It is 112 MB of release binary and not one line of C++. The repository is
[nightswatchhq/burrmill](https://github.com/nightswatchhq/burrmill); the measurements below are all
in its `docs/`.

## The numbers, on a real nest

Everything below was measured on 24 and 25 September on a 32-core ThinkPad, against a 1,925-segment
copy of the graph-allocations nest that Lodestar reads in production, with DuckDB set up exactly as
nuthatch sets it up. Each view's entire output was compared as a multiset of nuthatch-encoded JSON
rows before any timing was printed.

| | DuckDB | Burrmill |
|---|---:|---:|
| authored views with byte-identical output | | **22 of 22** |
| all 22 views read whole, total time (27 Sep) | 41.4 s | **26.2 s** |
| views within 1.5x of DuckDB's time | | **22 of 22** |
| peak RSS, 989,690 groups, 8 threads | 572 to 598 MB | **241 to 245 MB** |
| serving the 12 then-portable views, 1 client | 7.2 qps | 14.7 qps |
| the same, 32 clients | 15.1 qps | **32.9 qps** |
| worst client's p99 at 32 clients | 7,424 ms | 1,350 ms |
| process RSS at 32 clients | 15.4 GB | 3.9 GB |
| fairness at 32 clients, 1.0 when every client is served alike | 0.00 | 0.90 |

The parity row is the one that matters and it is the one we would have bet against in August, when
nine of the twenty-two views used syntax DataFusion has no notion of: `ASOF` joins, `LATERAL`,
`list_reduce`, list comprehensions over a 32-digit hex word. Two of those now run unchanged, because
Burrmill implements `list_reduce` as DataFusion's, and seven were rewritten in portable SQL on a
branch of the nest, each rewrite checked against the original on DuckDB before Burrmill was allowed
near it.

The serving rows are from 24 September, before the last seven views were rewritten, so they cover
the 12 that were portable then. A fairness of 0.00 means at least one of the 32 clients completed
nothing in the window while others completed ten; Burrmill sits behind the same admission gate
nuthatch already uses and serves everyone. DuckDB also fails outright at 32 clients under the
default `ulimit -n`, which is a fact about file handles rather than engines, and the row above was
taken with the limit raised.

Then there is the fuzzer, which is where the confidence actually comes from. `burrmill-bench fuzz`
generates SQL from nuthatch's admitted grammar and runs each statement on both engines. As of today
it has drawn tens of thousands of cases across the shapes the views use: derived grouping, windows
over aggregates, self-joined CTEs, `QUALIFY`, `DISTINCT ON`, anti-joins, JSON, `arg_max`, `TRY`,
regex, time functions, `substr` from the end, `string_split`, `xor`. The latest 8,000 cases on four
seeds gave no differing answer. It found nine faults in Burrmill on its first day, three of them
silent wrong answers, and a DataFusion wrong answer on subqueries used as predicates. It also found two in
DuckDB, of which more below.

## Where Burrmill loses

**The binary is bigger and the build is not faster.** This is the row we expected to win and did
not. Measured on the same machine with 32 jobs, on a nuthatch-shaped consumer built both ways:

| | DuckDB | Burrmill |
|---|---:|---:|
| release binary | 41 MB | 112 MB |
| querying test binary | 162 MB | 495 MB |
| `target/` after a clean test build | 3.27 GB | 4.76 GB |
| clean test build | 77 s | 84 s |
| incremental rebuild | 1.1 s | 1.8 s |

DuckDB is one C++ archive, compiled once and handed to the linker. DataFusion is dozens of crates
whose generic operators are instantiated for every primitive type and land, with their line tables,
in every one of nuthatch's 81 test binaries. Of the 10.2 MB Burrmill has grown since its first
footprint measurement, 4.7 MB is generic instantiations under `core` and `datafusion_expr` alone. We
have accepted the footprint as the price of the swap and opened an issue on the build time, with a
list of things to try; we are not claiming a win there and will not until the probe shows one.

**Small queries.** An eight-row view like `lodestar_disputes` runs eighteen operators on DataFusion,
four of them repartitions across eight threads, for eight rows. A rule that removes the repartition
where the scans beneath it read under 4 MiB took it from 19 ms to 7-11, which is 0.80x DuckDB and
still the worst ratio on the nest.

**`HUGEINT` stops at 38 digits.** Burrmill represents it as `DECIMAL(38,0)`, which reaches 10^38 - 1
where DuckDB's reaches 2^127 - 1. A value between the two refuses; it does not answer wrongly. No
real nest has produced one.

**An integer compared with a boolean.** `1 = false` casts in DuckDB and refuses in Burrmill. On the
list; nobody has written it.

**Four of DuckDB's roles are still DuckDB's.** August's inventory found six roles, and Burrmill so
far replaces one, the executor, with the parser role partway (its reachability check is identical to
DuckDB's on 38 of 46 security-corpus statements and stricter on the other 8, never looser). The
canonical plan for grafting identity, the lowering of authored SQL into incremental circuits, the
DuneSQL translation and the function vocabulary that decides what `entities.toml` may say all still
ask DuckDB's parser. They move in the phase that puts the engine into nuthatch, not before.

## The two things the fuzzer found in DuckDB

We are replacing DuckDB with something that is, today, more tested against DuckDB than DuckDB is
against itself on our workload, and that produced two findings worth stating because they bear on
what "keep the mature engine" was buying.

The first is a wrap. In DuckDB 1.5.5, a `SUM` over `HUGEINT` that overflows errors on one thread and
returns `i128::MIN` on two or four. It is duckdb#24081, fixed on `main` six days after 1.5.5 was
tagged, and in no release as of 1.5.5. It is exactly the silent overflow we cited in August
as the reason DataFusion could not be trusted.

The second we have not seen reported. Once a connection has consulted its time zone, by calling
`year()` or `date_trunc` on a `TIMESTAMPTZ`, or reading the setting, `CAST(ts AS VARCHAR) < 'x'`
drops every row when `'x'` does not parse as a timestamp, because an optimiser rule moves the cast
onto the constant, the constant becomes NULL, and the guard that would stop it skips NULL. The switch
is sticky for the connection, and nuthatch caches one per nest. The write-up is in
[Burrmill's repository](https://github.com/nightswatchhq/burrmill/blob/main/docs/upstream/duckdb-cast-comparison-null-constant.md)
with a reproduction; filing it is on our list. A mature engine is not a correct one, and
the only way to know which parts of either you are relying on is to run them side by side on your
own statements, which is now what we do.

## How the swap will happen

There are ten nests in production: three on one Hetzner box serving Lodestar, a QoS nest and the
hosted platform's containers on the ThinkPad, and four hackathon nests that retire on 30 September
and will never migrate. Every one is read by a dashboard, a cron or a person. The order is fixed and
each step has a gate.

1. **An engine trait in nuthatch, with DuckDB as its only implementation.** A refactor that changes
   no answer, proved by the existing suite passing unchanged. It ships as an ordinary release and
   rolls like one. This started today.
2. **Shadow mode, behind a feature flag that is off in release builds.** Burrmill answers beside
   DuckDB on the same statement; DuckDB's answer is served; every difference is logged with the
   statement and both answers. It runs first against the dashboard's real statements replayed on a
   copy of the allocations store, then on the two quietest live nests. A classifier separates the
   expected differences (a `DOUBLE` we already know is inexact, the two DuckDB bugs above, the
   functions DuckDB refuses without ICU that Burrmill computes) from the ones we cannot explain.
3. **Gate 2**, all of: a release cycle of real traffic with zero unexplained differences; p99 within
   the existing 30-second budget; memory inside the nest's existing envelope; the parser at least as
   strict as DuckDB's on the security corpus.
4. **Cutover**, one nest at a time, quietest first, with a stopped-store archive taken before each
   so that rollback is the previous binary and that archive, which is exactly today's runbook. The
   platform's image goes last, because it is many nests at once.
5. **Removal**, one clean release later. The generated corpus and the DuckDB reference oracle stay
   in the test suite, so DuckDB goes on judging Burrmill after it has stopped serving anyone.

If shadow mode finds something we cannot explain, the cutover waits. If it finds something we cannot
fix, DuckDB stays and this post gets its own banner. That is the deal, and it is the same deal the
August post made in the other direction.

## What this does not yet prove

Nothing in nuthatch runs on Burrmill today. Every figure above is from a bench harness driving both
engines over a copy of a real nest, and a bench harness can flatter: it lent Burrmill two DataFusion features the crate alone did not
enable, which we only found by building a consumer that depended on Burrmill alone and watching
`SUBSTRING` fail to plan. The 0.65x was measured on 25 September, before two further days of engine
work. *Updated 2026-09-27:* re-run with all of it in, 22 of 22 views identical and **0.63x**,
every view within 1.5x. The shadow period exists because a corpus, however wide,
is friendly in ways live traffic is not: August's "24 of 24 exact" corpus could not see an i128
overflow that a reviewer could, and we have not forgotten that.

What we can say is that the thing we said in August could not be done, exact parity on every
authored statement with no `HUGEINT` layer and no refuse-on-overflow, has been done on the bench,
at lower latency and a third of the memory, and that the remaining distance is the distance between
a bench and production. We know how long that distance is. We have walked it in the other direction.
