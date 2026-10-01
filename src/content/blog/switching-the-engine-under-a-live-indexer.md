---
title: "Switching the SQL engine under a live indexer"
date: "2026-10-01"
description: "Five days ago we said Burrmill would replace DuckDB only after a release cycle of shadow traffic with no unexplained difference. We are not waiting for that. Burrmill will serve first and DuckDB will check behind it for a month. This is the operator's log of the switch, written as it happens, with the regressions listed before anyone finds them."
author: "cargopete"
tags: ["nuthatch", "burrmill", "duckdb", "datafusion", "operations", "sql", "rust"]
---

On 26 September we published [Replacing DuckDB, after all](/blog/replacing-duckdb-after-all), which
set out a five-step plan and a gate: Burrmill would answer beside DuckDB on live nests for a release
cycle, and cutover would wait for zero unexplained differences. **We are changing the order. Burrmill
will serve the queries now, and DuckDB will run behind it as the checker for about a month before it
leaves the binary.** That post gets a banner pointing here, and its body stays as written.

This post is the log of the switch. It is dated, it will grow an entry at each roll, and it lists
what gets worse before it lists what gets better.

## The shadow log was empty, and that told us nothing

The DIPS nest has run a shadow build since 28 September at 12:11 UTC: DuckDB serves, Burrmill
answers the same statement afterwards, and every difference is appended to a file. On 1 October we
read the file. It held one line, and the line was ours: a `printf` we had sent on the day of the roll
to prove the pipe worked.

Three days and no differences reads like a pass. It is not one. The shadow wrote differences and
nothing else, so a nest that agreed on every statement and a nest that was never sent a statement
produce the same file. We then tried the journal, and counted 1,654 lines mentioning the shadow,
which is almost certainly every line the nest has logged, because the binary is called
`nuthatch-3.12.1-shadow.1` and the journal prints the process name on each one.

So the gate we published could not have been judged on the evidence we were collecting. The shadow
now counts every statement it runs, agreed or not, and writes the running totals into the same file
at 1, 2, 4, 8 statements and every thousandth after. An empty log and a quiet nest are now different
things. The shadow binary on DIPS was also five days stale: it was built against a
Burrmill 36 engine commits older than today's.

## Why Burrmill serves first

The honest reason is that there is nobody to break. The nests in production today are read by one
consumer, the [Lodestar dashboard](https://www.lodestar-dashboard.com), which we also run. A month
of waiting per nest protects users we do not yet have, and the cheapest moment to change the engine
under an indexer is before anyone else depends on it.

The less comfortable half is that "run it and watch" only catches the loud failures. A crash, a
refusal and a slow query announce themselves. A wrong balance looks exactly like a right one. So the
switch has a fourth position. `NUTHATCH_ENGINE` already took `duckdb`, `shadow` and `burrmill`; it
now takes `checked`, which is the shadow turned round: **Burrmill's answer is served, DuckDB runs
the same statement afterwards, and any difference is recorded in the same format as before**, DuckDB
first in every record, so nothing that reads the log has to know which engine was serving.

Rolling a nest back is an edit to its unit file and a restart. No new binary, and no change to the
store.

## The plan, in order

These are intentions with dates attached, not results. The log at the bottom says what has actually
happened.

1. **Land the code.** The Burrmill branch (nuthatch#1613) and `checked` mode go onto main. This
   week.
2. **Roll the nests to `checked`, one at a time, quietest first.** DIPS, then GNS, then the QoS
   nest, then allocations, and the hosted platform's image last because it is many nests at once. A
   stopped-store archive is taken before each, as the runbook has always required. The aim is that
   DuckDB serves nothing by about 9 October. Allocations waits on two things: its memory limit
   raised, and the dashboard change described below.
3. **Watch for a month.** DuckDB runs only as the checker. We read the counts and the differences,
   and fix what they show.
4. **Remove DuckDB.** `duckdb` leaves `Cargo.toml`, the Dockerfile and the C++ toolchain with it.
   Early November at the soonest.

## What will be different for someone reading a nest

Answer parity on the authored views was the bar, and on the bench it holds: 22 of 22 views on the
allocations nest byte-identical (27 September), and a dialect corpus of 260 statements that either
agree or are refused by both (30 September). These are the places where the answer changes on
purpose, or the query stops being accepted.

| change | before | after |
|---|---|---|
| `SUM`, `MAX` or `MIN` over a `_dec` column holding a value that did not fit | answered from the rows that fit | **refused**, naming the sum |
| a transfer between 10^38 and 2^127 | counted in balances, exposure and velocity | dropped, and counted in `dropped_over_i128` |
| a named query DuckDB could not bound (nine views on the allocations nest) | refused as unboundable | admitted, with a bound from Burrmill's plan |
| functions DuckDB refuses without ICU (`developer_activity_weekly` on GNS) | refused | answered |
| eight DuckDB spellings in entity SQL: `1_000`, `E'x'`, `ISNULL`, `**`, `GROUP BY #1`, `GLOB`, `TABLE t`, `ASOF JOIN` | accepted | refused at load |
| `nuthatch emit dune` | supported | removed with DuckDB |

The first row is the one to read twice. DuckDB quietly sums what fits and says nothing about what
did not; Burrmill declines to produce a total it knows is short. We think that is the right way
round for token amounts, and it means a dashboard statement that sums such a column breaks on the
day. Two of Lodestar's do. The change that casts the source column instead is written, and the
allocations nest does not move until it has merged.

Real GRT amounts sit ten orders of magnitude below the 38-digit line. The three test fixtures that
crossed it were computing with 2^256 - 1, which is a number people write in tests.

## Where Burrmill is worse today

**Memory.** On 1 October we replayed the allocations nest in shadow mode at nuthatch's default
512 MB analytics limit: its 22 views and the dashboard's 81 statements. Of 27 recorded differences,
23 were Burrmill refusing with out-of-memory where DuckDB answered. DataFusion's hash join and final
aggregate cannot spill, and the ledger views join a great deal. The remedy is not clever: that nest's
limit goes to about 2 GB. DuckDB did the same work in a quarter of that, and we are not going to
pretend otherwise.

**Planning time on the network endpoint.** Its queries compose about thirty views into plans of
5,000 to 6,000 logical nodes. The contract suite takes 116 seconds on Burrmill against 32 on DuckDB,
roughly one second a query against 0.3. Part of it was ours and is fixed; the rest is a quadratic
walk in DataFusion's `EnsureRequirements`, fixed upstream in apache/datafusion#25098 and first
released in 56, which is due around the end of October. Until then that endpoint is slower.

**The binary.** 112 MB against 41 MB, unchanged from the last post, and accepted.

**What nobody has asked yet.** The corpus is what we have written and what the fuzzer could think
of. The planted `printf` was the first statement the DIPS shadow ever saw, and Burrmill did not have
`printf`. It does now. There will be others, and that is what the month is for.

## What landing it took

The work lived on a branch 34 commits ahead of nuthatch's main and 167 behind it. Merging the two on
1 October produced six conflicts in four files, and three problems that were not conflicts at all:

- Main had grown a new use of DuckDB's parser in the week since we counted them: a `check` helper
  that round-tripped SQL through `json_serialize_sql`. It is on sqlparser now. An inventory of a
  dependency you are removing goes stale at the speed of the rest of the team.
- Main had given the spill directory a 2 GB default. Burrmill's was still 100 GB.
- Both branches had independently fixed the same bug, a dead entity circuit that went unnoticed at
  the chain tip.

One test failed on every run on our 32-core machine, on main as well as on the branch. It asserted
that four readers would get 120 answers in while 120 seals ran, which is a statement about the
scheduler. It now paces each seal on a reader's answer.

Review found one more thing, and it predates Burrmill entirely. After a restart, the exposure and
velocity views are rebuilt from sealed data by SQL, and that SQL counted a transfer past 38 digits
that the live path drops. The amounts agreed; the counts could differ by the number of such
transfers. Nothing in production has one. The fix goes in with the same change, because a migration
is the one time everybody reads that code.

## The log

**1 October.** The branch is merged with main and up for review as nuthatch#1613. On default
features and with Burrmill and the `graph` feature on: integration tests 394 and 397 passed with
none failing, the network contract 21 of 21. The shadow counts what it compares. `checked` mode is
written and its tests pass. No nest is served by Burrmill yet.

*Entries follow as each nest rolls: DIPS first, then GNS, the QoS nest, allocations, and the hosted
platform's image last because it is many nests at once.*

## What would make us go back

Nothing above has happened on a live nest yet. Every figure is from a test suite or a replay over a
copy of a real store, and the last post explains at some length how a harness flatters.

If `checked` mode records a difference we cannot explain, that nest goes back to DuckDB the same
hour and stays there until we can. If it records one we cannot fix, DuckDB stays in the binary and
this post gets a banner of its own. Removing `duckdb` from `Cargo.toml` is the only step a restart
cannot undo, and it is the one step we are not hurrying: early November at the soonest, and only
after a month in which the checker had something to check and found nothing.
