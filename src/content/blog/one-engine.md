---
title: "One engine"
date: "2026-10-02"
description: "Six days after we said Burrmill would replace DuckDB only after a release cycle of shadow traffic, every nuthatch nest we run is on Burrmill and 4.1.0 ships with no DuckDB in it. This is the retrospective: what the migration cost, what it found in our own code, where Burrmill is still worse, and what comes next."
author: "cargopete"
tags: ["nuthatch", "burrmill", "duckdb", "datafusion", "operations", "sql", "rust"]
---

On 31 August we published [Keeping DuckDB](/blog/keeping-duckdb). On 26 September we published
[Replacing DuckDB, after all](/blog/replacing-duckdb-after-all), with a plan that ran to early
November. On 2 October at 11:14 UTC the last of our six production nests restarted on nuthatch
4.1.0, a binary with no DuckDB in it, and Lodestar reported healthy. **The migration that was going
to take a careful month took six days, and most of what it found was in our own code rather than in
either engine.** This post is the account, with the losses first, because the running
[operator's log](/blog/switching-the-engine-under-a-live-indexer) already has the day-by-day.

## What was actually replaced

nuthatch's SQL surface is now [Burrmill](https://github.com/nightswatchhq/burrmill): a Rust engine
over DataFusion 55.0.0 with its own analyzer and physical rules. Since its first commit on
31 August it has grown to 235 commits and 24,225 lines in `crates/burrmill/src`, 37 of those files
being the DataFusion host and its rules, and a dialect corpus of 273 statements that DuckDB and
Burrmill either answer identically or both refuse, last run 273 of 273 on 1 October. In nuthatch,
4.0.0 to 4.1.0 is 82 commits across 96 files, 3,816 lines added and 21,020 removed. The removals
are DuckDB's engine file, the shadow and checked modes that compared the two engines, `nuthatch
emit dune`, a measurement harness that used DuckDB as its oracle, and about 45 tests whose purpose
was to agree with DuckDB.

| | 4.0.2 | 4.1.0 |
|---|---:|---:|
| Linux release binary | 108.5 MB | 195.0 MB |
| C++ runtime linked | `libstdc++` | none |
| glibc floor (`objdump -T`) | 2.34 | 2.35 |
| engines in the binary | DuckDB, Burrmill behind a feature | Burrmill |

Two of those rows went against us. The binary is 80% larger, because DataFusion's Rust is compiled
into it rather than DuckDB's C++ being linked from a bundled library, and we accepted that trade on
26 September. The glibc floor rose because 4.1.0 references `hypot` at `GLIBC_2.35`, where libm
re-versioned it, so RHEL 9 and Amazon Linux 2023 need the source build where they ran 4.0.x from
the artifact. We measured that on the published binary after the release, which is the wrong order,
and nuthatch#1649 corrects the README.

## The plan changed twice in one day, and the second change was the right one

The 26 September plan was a release cycle of shadow traffic per nest with zero unexplained
differences before cutover. On the morning of 1 October we replaced it with `checked` mode, Burrmill
serving and DuckDB checking behind it for a month. By the afternoon that was gone too. The reason
is the one the [earlier post](/blog/replacing-duckdb-after-all) had already given: DuckDB was being
replaced partly because of its own wrong answers, the `HUGEINT` that wraps, the timestamp
comparison that goes NULL, the ICU it does not ship. **An engine you are leaving because it is
sometimes wrong is not the standard to measure its replacement against.** What a nest has to agree
with is the subgraph its readers already trust, and nuthatch has carried a script for that since
the allocations nest was built: it asks the network subgraph and the nest the same questions at one
pinned block. From then on a nest rolled on that comparison, before and after, and a DuckDB
difference became a lead rather than a verdict.

The allocations nest was compared at block 510,658,602 three times: DuckDB on its old views, DuckDB
on the rewritten views, Burrmill on the rewritten views. All three print the same thing. That thing
is not clean: rewards agree for 203 of 203 epochs, and seven epochs have their query fees booked to
the neighbouring epoch, each group summing to the subgraph's figure to the wei. That fault predates
Burrmill, lives in the views, and had not been written down until an engine change made someone
compare against the right thing.

The `checked` mode lived for twenty-four hours. It caught one thing in that time, on GNS: five rows
where DuckDB and Burrmill picked a different "newest subgraph" for a deployment. Two subgraphs had
the same `created_at`, the query said newest first and take one, and each engine took a different
one. Neither was wrong; the query was ambiguous on both. It now breaks the tie on the subgraph id
(kittiwake#193).

## Most of what broke was ours

Here is the list of things the migration found, with whose they were.

**Ours, in nuthatch.** Views on the allocations nest that only DuckDB could define: `ASOF JOIN`,
`LATERAL`, list lambdas. A restart path that counted a transfer past 38 digits that the live path
drops. An entity relation that lost its declared column types when loaded into the new engine. An
empty answer that lost its column names. A test that required the README to say the binary needs
libstdc++ "because it embeds DuckDB", and kept passing after DuckDB left, because the README still
said so. A test built to push data across the engine's internal batch boundary, sized at DuckDB's
2,048-row vector with 5,000 rows at most, so that on DataFusion's 8,192-row batches it crossed no
boundary and had tested nothing since the engine changed. Two measurement tools that had never
been run against production's actual views, so sixteen clean replays had tested a nest that did not
exist.

**Ours, in Burrmill.** Seven faults found by the QoS nest alone, whose first replay answered 5 of
23 views: a missing `unhex`; `DATE + integer` past the year 2262 turning the days into nanoseconds;
`TRY` covering only its outermost cast; `unnest` marking every column as overflowed; a hash join
building its table on whichever input the query named first, which there was the one with 74
million rows (killed at 60 GB, then 30 seconds with a 4 MB build once it chose the smaller side); a
`QUALIFY k = min(k) OVER (...)` that sorted the whole input (600 seconds, then 40); and a
`count(DISTINCT (a, b, c))` kept as boxed structs (over 500 seconds for one day, then 4). Also
`typeof`, which did not exist.

**Ours, in operations.** A roll that edited the wrong systemd drop-in, because the last file read
wins and the runbook named an earlier one. A roll undone by its own script, because `journalctl |
grep -q` under `pipefail` reports failure when `grep` finds what it wanted and stops reading. A nest
that crash-looped for fourteen and a half minutes because a later drop-in put its SQL permits back
to four and the memory gate correctly refused four statements at 2 GB each. A release tagged twice
on the wrong commit, because the tag command moves the tag to wherever `main` is and `main` had not
been merged to yet.

**DuckDB's.** Two of its own bugs in the earlier post, and one of its parser's spellings, `ASOF
JOIN`, which our entity lowering had been quietly treating as an inner join.

**DataFusion's.** A quadratic walk in `EnsureRequirements`, fixed upstream for 56.

## Where Burrmill is worse, measured

**Each statement.** On the allocations nest, about 2.5 times DuckDB's time, through `/sql`, with
eight times the memory allowed to each session. On a copy at four clients DuckDB answered 112
statements a second; Burrmill with two permits answered 26 and turned 19 away as busy.

**Memory.** DuckDB ran that nest at four permits of 256 MB. Burrmill needs 2 GB and eight analytics
threads: at 1 GB it refuses 12 or 13 of the dashboard's 103 statements, at 768 MB 18. Its hash
joins and final aggregates do not spill to disk, so a statement that needs more memory than it has
is refused rather than slowed, which we think is the right behaviour and is also a regression.

**Date pruning.** Lodestar's eight statements over one day of QoS data take about 4.5 seconds on
Burrmill where DuckDB took 0.7. DuckDB reads the one day asked for; Burrmill reads every segment,
because the date range arrives through a join and is not pushed down to the scan.

**Planning on deep views.** The network endpoint's queries compose about thirty views into plans of
5,000 to 6,000 logical nodes; a contract suite that took 32 seconds on DuckDB takes 116 on Burrmill
in a release build. Unoptimised, as CI builds for tests, the same queries blow through a 30-second
budget, which is how CI caught what our release-build runs on a 32-core machine could not. The
job that runs them went from 13 minutes to between 37 and 45.

**Operational memory.** This one was not Burrmill's but it arrived with Burrmill. The QoS nest grew
from 1 GB to 7.3 GB resident with 4.3 GB more in swap in a day, against a 2 GB engine limit, was
throttled by its cgroup, and stopped answering; Lodestar's daily QoS ingest failed twenty times
overnight. The limit held: the memory was outside the engine's accounting, and it was glibc's
malloc keeping what a whole-day statement had freed. On a copy with the dashboard's own 279
statements, glibc ended at 5.6 GB and jemalloc under 2.1 GB; after the four whole-day statements
alone, glibc held 1.72 GB indefinitely and jemalloc 0.95 GB twenty seconds later. 4.1.0 uses
jemalloc on Linux. DuckDB never showed this because it manages its own buffers inside the limit it
is given, which is a point in DuckDB's favour that we did not have on the list.

## Where it is better, measured

Nine named queries on the allocations nest that DuckDB refused as unboundable, because its plans
rescanned through nested-loop and delim joins, are admitted on Burrmill with a bound from its plan,
because DataFusion decorrelates them into hash joins. Functions DuckDB refused without ICU answer.
A sum over a column holding a value that did not fit 38 digits is refused with the aggregate named,
where DuckDB returned a total that silently left those values out. A transfer between 10^38 and
2^127 is counted in `dropped_over_i128` rather than disappearing. The binary links no C++ runtime.
And the thing we wanted on 26 September and could not measure then: when the QoS nest answered 5
of 23 views, we fixed seven faults in the engine in a day and a half, in Rust, with tests, and rolled
it. We would not have done that to DuckDB.

## The numbers of the switch itself

| | |
|---|---|
| first nest served by Burrmill | DIPS, 1 October, 11:09 UTC |
| last nest | the QoS nest on 4.1.0, 2 October, 11:14 UTC |
| nests | 6 (DIPS, GNS, allocations, QoS, data-services, the legacy staking archive) |
| rolls that failed before succeeding | 3 (DIPS once, allocations twice) |
| longest a nest was down | 14.5 minutes (allocations, the crash loop) |
| time GNS spent back on DuckDB | 3.5 hours |
| Lodestar statements compared before and after the last two rolls | 24, 21 identical, 3 equal to 1.8e-12 |
| `checked` mode's lifetime | 24 hours |
| tests passing on the DuckDB-free tree | 1,880 default, 1,989 with `graph` |
| users affected | none that we know of; Lodestar is the only consumer, and it reports healthy |

Every figure above was measured by us on our own nests and copies between 26 September and
2 October 2026; the two earlier posts carry the bench figures.

## What comes next

For Burrmill: pushing a date range through a one-row join side to the scan, which is the 4.5 against
0.7 seconds; DataFusion 56 for the planning cost, and whatever is left of it after that; spilling
hash joins, so a statement that needs more than its limit slows rather than refuses; and the
permits, since two permits at 2 GB turned away 19 of 360 requests where DuckDB turned away none.

For nuthatch: 4.1 is the line with one engine, and a release from here carries one language and
one planner. The seven fee epochs on the allocations nest are a views fault and get fixed as one.
The glibc floor goes into the release checklist as a thing measured before the tag rather than after.

For the two earlier posts: Keeping DuckDB gets a dated banner pointing at the reversal, and the
reversal gets one pointing here. Both bodies stay as written. A project that quietly edits its old
positions is harder to trust than one that dates them, and we have now reversed ourselves twice in
five weeks, which is the kind of record that only stays useful if it is kept.
