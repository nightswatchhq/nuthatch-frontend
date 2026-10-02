---
title: "Switching the SQL engine under a live indexer"
date: "2026-10-01"
description: "Five days ago we said Burrmill would replace DuckDB only after a release cycle of shadow traffic with no unexplained difference. We did not wait for that. Four nests were served by Burrmill by the evening of 1 October, judged against the live subgraphs and not against DuckDB. This is the operator's log of the switch, written as it happens, with the regressions listed before anyone finds them."
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

> **Changed again, 1 October, afternoon.** The month of checking described below is not happening
> either. The nests are judged against The Graph's live subgraphs, which is what their readers
> compare them with, and DuckDB is being removed as soon as every nest runs without it. The
> sections above the log are left as they were written that morning; the log says what was done.

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
pretend otherwise. *Added later on 1 October: 2 GB alone is not enough, and the limit was not the
variable that mattered. The measurement is in the log below.*

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

**1 October, 11:09 UTC. DIPS is served by Burrmill.** The branch merged as nuthatch#1613, and
`checked` mode as #1615. The nest runs `4.0.0-checked.1`, built from exactly the tree on main. The
log's first count reads one statement, one agreed, which is the roll script's own `SELECT 1`; the
figures that matter will be Lodestar's.

It took two attempts, and the first is worth recording. At 11:02 the roll script stopped the nest,
archived its store, pointed the unit at the new binary and started it. The nest came back on the old
one. systemd reads a unit's drop-in files in name order and the last to set `ExecStart` wins; our
runbook named `rpc-311.conf`, and a file added two days earlier, `rpc-graphops.conf`, sorts after
it. The edit was correct and irrelevant. DIPS was down for one second and went on being served by
DuckDB, which is the least dramatic way a roll can fail.

What caught it was a line we nearly did not write: the script refuses to report success unless the
journal says "Burrmill serves every statement" and the log holds a count. Without that check this
entry would have announced a migration that had not happened. The script now asks systemd which file
decides, and confirms the running binary after the start.

**1 October, 11:11 UTC. GNS is served by Burrmill.** First attempt, with the corrected script,
which found the same overriding drop-in there and edited the right one. GNS went from 3.11.0
straight to the checked build and had never run in shadow, so it is the first nest to meet Burrmill
with no rehearsal on its own traffic. Its views were compared on both engines on 28 September and
agreed. We expect one kind of record from it: a view DuckDB refuses for want of ICU and Burrmill
answers.

**1 October, 11:37 UTC. GNS went back to DuckDB, for a reason that turned out not to be Burrmill's.**
Twenty-six minutes in, the checker had logged five statements whose rows differed, out of 32. All
five were the same dashboard query with different ids: for each deployment, the subgraph that most
recently published it, by `created_at`. We put DuckDB back in front, which is one line and a
restart, and then read the records.

Each differing row had the same deployment and the same version under two different subgraph ids.
We asked the nest for one of them: two subgraphs, both created at 1715090775. The query says
"newest first, take one", the two are equally new, and each engine took a different one. Neither
answer is wrong, because the question does not say which to prefer. It does mean Lodestar's search
could show either subgraph for such a deployment from one run to the next, on either engine, and
always could. The query now breaks the tie on the subgraph id.

We did not teach the checker to excuse this shape. It cannot see `created_at` in the rows it
compares, so a rule that forgave "newest of several" would forgive a real ordering fault that looked
the same. The fix belongs in the query. GNS returns to Burrmill when that query is deployed.

The lesson is about us and not the engine. DIPS and the allocations nest were replayed on both
engines before anything moved. GNS was rolled on a comparison three days old. When we then replayed
the QoS nest before touching it, 5 of its 23 views answered, so it has not been rolled, and will not
be until that number is 23.

The scripts now put the unit back and start it by themselves if anything fails after the nest has
been stopped. DIPS stayed up through its failed attempt because of the order the steps happened to
be in, which is not a property to rely on twice.

**1 October. The allocations nest needs threads, not memory.** We said above that its limit would
go to about 2 GB. We then replayed its 22 views and 81 dashboard statements with Burrmill serving
and DuckDB checking, sixteen times. No replay produced a differing row. The memory refusals did not
behave as expected:

| limit | analytics threads | replays | replays with a refusal |
|---:|---:|---:|---:|
| 512 MB | 2 | 1 | 1 (22 statements) |
| 2 GB | 2 | 4 | 4 |
| 2.5 GB | 2 | 1 | 1 |
| 3 GB | 2 | 4 | 3 |
| 2 GB | 8 | 3 | **0** |
| 3 GB | 8 | 3 | **0** |

At nuthatch's default of two analytics threads, one or two statements are refused on most replays
whatever the limit, and not the same ones twice. One was refused with the process holding 1.1 GB of
a 2.5 GB allowance: a repartition buffer was sitting on 657 MB that it could have spilled and was
never asked to, beside a hash join that cannot spill at all. At eight threads it did not happen in
six replays. We have not established why, and six is not a proof. That nest will run with 2 GB and
eight threads, and the checker will say whether six was enough.

It cannot start that way today. nuthatch refuses any analytics split above 2 GiB, the figure is a
constant, and there is one limit for every engine, which leaves 1,024 MB for analytics in total.
The QoS nest has the same problem: the first record of its replay is a hash join refused at 446 MB
of a 448 MB pool. nuthatch#1619 gives Burrmill its own limit, so DuckDB can stay at 512 MB beside
it, and lets an operator raise the wall. Both nests wait for it.

**1 October, afternoon. The judge changes.** The plan above has DuckDB checking behind Burrmill for
a month. That makes DuckDB the standard, and DuckDB is the engine with the wrapping `HUGEINT`, the
timestamp comparison that goes NULL, and no ICU. What a nest has to agree with is the subgraph its
readers already trust. nuthatch has carried a script for that since the allocations nest was built:
it asks the network subgraph and the nest the same questions at one pinned block and prints what
differs. **From here a nest is rolled on that comparison, taken before and after, and DuckDB is not
consulted.** A difference between the two engines remains a lead worth reading. It is no longer a
verdict.

**1 October, 15:08 UTC. GNS is back on Burrmill, alone.** The tie-break went out to Lodestar at
14:55. GNS was off Burrmill for three and a half hours over a query that was ambiguous on both
engines.

**1 October, 15:44 UTC. The allocations nest is served by Burrmill, at the third attempt.** Three
things about this one, and only the last is a success.

Every replay we had run for this nest used a copy whose views were rewritten on 24 September, on a
branch that was never pushed. Production's views still used `ASOF JOIN`, `LATERAL` and list lambdas,
and six of them do not define on Burrmill at all. Sixteen clean replays had tested a nest that did
not exist. The seven commits were rebased onto the nest's main, each rewritten view was compared
whole against its original on DuckDB (23 of 23 equal, the largest 1,678,525 rows), and the views
went onto the nest before the engine changed, so that the two changes could be told apart.

The comparison against the subgraph, at block 510,658,602, was run three times: DuckDB with the
original views, DuckDB with the rewrites, Burrmill with the rewrites. **All three print the same
thing.** That thing is not a clean bill: rewards agree for 203 of 203 epochs, and there are seven
epochs whose query fees the nest books to the neighbouring epoch. Each group sums to the subgraph's
figure to the wei, and it was true before today. It is a fault in the views and it is now written
down, which is one use of comparing against the right thing.

The roll itself failed twice. On the first attempt a drop-in that sorts after ours put the SQL
permits back to four; nuthatch's memory gate correctly refused four statements at 2 GB each, and
the nest restarted every fifteen seconds for fourteen and a half minutes while the script waited
patiently for it to become ready. On the second the roll worked and the script undid it, because
`journalctl | grep -q` under `pipefail` reports failure when `grep` has found what it wanted and
stopped reading. The scripts now check what systemd will actually hand the process before stopping
anything, and give up after three restarts.

What it costs: the nest ran four permits at 256 MB on DuckDB and runs two at 2 GB on Burrmill, with
eight analytics threads. At 1 GB Burrmill refuses 12 or 13 of the dashboard's statements, and at
768 MB 18. On a copy, through `/sql`, DuckDB answered 112 statements a second at four clients and
Burrmill with two permits answered 26 and turned 19 away as busy. **About two and a half times
DuckDB's time for each statement, with eight times the memory allowed to each.**

**1 October, 18:46 UTC. The QoS nest is served by Burrmill.** This is the nest whose replay answered
5 of 23 views. Seven faults stood between that and a roll, all ours: a missing `unhex`; `DATE +
integer` turning the days into nanoseconds past the year 2262; `TRY` covering only its outermost
cast; `unnest` marking every column as overflowed for the refusal rule above; and three plans. A
hash join built its table on whichever input the query named first, which here was the one with
74 million rows: killed at 60 GB, and 30 seconds with a 4 MB build once it picks the smaller side.
A `QUALIFY k = min(k) OVER (...)` sorted the whole input: 600 seconds, then 40. A
`count(DISTINCT (a, b, c))` kept each row as a boxed struct: over 500 seconds for one day, then 4.

Lodestar's eight statements against that nest now agree with DuckDB to 3 parts in 10^15, which is
floating-point summation order. **They take about 4.5 seconds where DuckDB took 0.7.** DuckDB reads
the one day the statement asks for; Burrmill reads every segment, because the date range arrives
through a join and is not pushed down to the scan. That is the next piece of engine work. Reading a
whole view on that nest still fails at 512 MB.

**1 October, evening. What is left.** Two nests are still on DuckDB: the read-only archive of the
legacy staking contract and the data-services nest. Neither has been replayed. In the code, DuckDB
is now the engine you have to ask for: with Burrmill as the default, 2,112 of nuthatch's tests pass
and 8 fail. Three of the eight were real gaps (no `typeof`; a maintained relation losing its column
types; an empty answer losing its column names) and are closed. The rest test DuckDB's own
settings. The crate leaves `Cargo.toml` when both remaining nests have moved and that suite is
green without it.

**2 October. DuckDB is out of the tree, and not yet out of a release.** nuthatch#1626 takes
`duckdb` out of `Cargo.toml`: 80 files, 971 lines added and 22,639 removed. It is a pull request and not a release: the two nests above stay on
the binaries they have until they have been replayed, and DIPS, which still runs `checked`, needs
one line of its unit changed before it can take the build, because a binary with no DuckDB refuses
to start for a unit that asks for it.

The `checked` mode this post introduced on the morning of 1 October goes with it, having lasted a
day. So do the shadow mode, `nuthatch emit dune`, and a measurement harness that used DuckDB as its
reference.

A fourth gap turned up beside the three above. A statement that spills past its cap used to be
stopped by nuthatch's own watchdog and answered `507`. DataFusion's disk manager now stops it
first, in under a third of a second, with a message advising the caller to raise a DataFusion setting
they cannot reach. It is answered `507` again, in nuthatch's words.

**Two tests were passing that should not have been**, and they are the part of this entry worth
keeping. One required the README to say the Linux binary needs libstdc++ "because it embeds
DuckDB", and its own comment promised that it would fail on the day DuckDB left. It did not fail.
It checks that the README makes the claim, the README went on making it, and so the test passed
on a binary that links no C++ runtime at all. The other exists to push data across the engine's
internal batch boundary, and its largest case was 5,000 rows: comfortably past DuckDB's 2,048-row
vector, and comfortably inside DataFusion's 8,192-row batch. For as long as Burrmill had been the
engine under it, it had tested nothing it was written to test. It now runs at 8,191, 8,192, 8,193
and 20,000 rows, and passes.

On our 32-core test machine, 1,880 tests pass on default features and 1,989 with the `graph`
feature, none failing. The Postgres, object-store, Trino and memory-footprint jobs run only in CI,
and the footprint job has never measured a Burrmill binary before.

**CI then found what that machine could not.** The footprint, Postgres, object-store and Trino
jobs passed, the last of them comparing Trino against Burrmill's numbers for the first time. One
job failed: two tests of the network endpoint ran past their 30-second query budget. We had tested
an optimised build, and CI tests an unoptimised one. DuckDB never showed the difference, because
its C++ was compiled with optimisation whatever the Rust around it was doing.

The obvious remedy is to compile the engine optimised inside test builds, so we measured it
before adopting it. It costs 75 CPU-minutes of compilation against 14, and one of the two tests
still fails on four cores. The cost is not the compiler's to remove: each of those tests takes
42 to 47 seconds in a release build, because every query in them plans through about thirty
views, and that planning is where Burrmill is slowest. The tests now have ten times the budget,
on the reasoning that they check answers and not latency, and the job that runs them takes 45
minutes where it took 13. That is the "planning time" line in the section above, with a figure
on it that we would rather not have had.

## What would make us go back

Nothing above has happened on a live nest yet. Every figure is from a test suite or a replay over a
copy of a real store, and the last post explains at some length how a harness flatters.

If `checked` mode records a difference we cannot explain, that nest goes back to DuckDB the same
hour and stays there until we can. If it records one we cannot fix, DuckDB stays in the binary and
this post gets a banner of its own. Removing `duckdb` from `Cargo.toml` is the only step a restart
cannot undo, and it is the one step we are not hurrying: early November at the soonest, and only
after a month in which the checker had something to check and found nothing.

*Added 1 October, evening.* That paragraph was written in the morning and three of its four
sentences did not survive the day. Four nests have been served by Burrmill, DuckDB checks only
DIPS, and the removal is under way. What still holds is the first condition, with the judge
changed: a nest that disagrees with its subgraph where it agreed before goes back the same hour,
for as long as there is a binary with DuckDB in it to go back to. After that the way back is the
previous release, and the store archive taken at each roll.
