---
title: "Performance"
description: What it measures at, on someone else's benchmark - and the three things that actually decide your backfill's wall clock.
order: 9
---

## The number

We ran **someone else's** benchmark rather than writing one that flattered us: Sentio's
[OBIB](https://github.com/sentioxyz/open-blockchain-indexer-benchmark). Case 1 indexes `Transfer` from
LBTC across 22.2M Ethereum blocks, write-only, no serving.

| | |
|---|---|
| wall clock | **74.8 s** |
| events | **294,278** - matches Sentio's own README exactly |
| RPC requests | **321** |
| peak RSS | **320 MB** |

Against a real provider (Alchemy), on an 11-core laptop, `--no-timestamps`, adaptive window, 8-way
concurrency. Re-runnable with `nuthatch bench backfill`; the artifact is checked into the repo.

**The record count matching Sentio's is the part worth trusting.** A fast indexer that quietly drops
events is not fast, it is wrong, and an event count agreeing with an independent implementation is a
much stronger signal than a stopwatch.

## It did not finish at all before v0.9.0

Worth stating plainly, because it is the reason we now run outside benchmarks.

Alchemy returns its oversized-range refusal as HTTP **400**. Our status classifier did not enumerate
400, so it fell through to `Transient` - which meant the window was retried **unchanged**, forever.
Case 1 never completed. Our own test suite was green throughout, because every fixture returned the
error shape we had thought to write down.

That is the whole argument for benchmarking against a real provider instead of a mock: mocks return
the failures you imagined.

## What actually decides your wall clock

Not CPU. Nuthatch is round-trip bound on ordinary workloads, and three things dominate:

### 1. `block_timestamp` - about 85% of it, if you let it

Timestamps cost a block-header round trip per block, and the fan-out is *serial inside each window*,
which is why throwing concurrency at it barely helps (16-way bought 1.2×).

They are now **demand-driven**: a nest that never asks a time-series question does not pay. Drop the
column at scaffold time with `init --no-timestamps`.

This is an **init-time** decision, deliberately not a flag you can flip: changing it later is a
breaking schema change and a full re-index. Blocks give you ordering; only timestamps give you time.
If you are unsure, keep them - the default is on for a reason.

### 2. The log window, and whether it fits your provider

Every provider caps `eth_getLogs` differently, most document it wrongly, and several change it by
tier. So nuthatch **adapts**: it widens while an endpoint keeps up and narrows the moment it does not,
discovering the real limit rather than trusting a config value.

Check an endpoint before you trust a backfill to it:

```sh
nuthatch doctor --rpc https://your-endpoint.example --address 0xADDR
```

It reports the largest window the endpoint will actually serve, its batch limit, and whether it has
archive history - measured against that endpoint, not read from its documentation.

### 3. Your endpoint

The shipped free public endpoints exist so `init` → `dev` works with zero setup. They are rate-limited,
shared, and frequently lack archive history. A deep backfill on one will crawl or stop. `--rpc` is
repeatable and nuthatch round-robins with per-endpoint health tracking, so two or three endpoints buy
failover as well as throughput.

## Footprint

**≤2 GB RAM per active-chain cursor**, enforced in CI rather than aspired to. A roost's total is the
sum of its cursors, and a nest whose projected footprint would exceed the budget is **refused** at
mount with a `507` rather than admitted with a warning.

Measured peaks: ≈37 MB for a single contract, ≈58 MB across a three-contract, 23-table nest - under 3%
of the budget. The 320 MB in the OBIB run above is a full-throttle backfill, which is the expensive
case, not the steady state.

## Query speed, and the engine we did not switch to

Analytical queries run on DuckDB, attaching sealed Parquet segments read-only alongside the hot tip.

DataFusion - one Arrow-native, pure-Rust engine across both modes - has been the recorded *direction*
since RFC-0013, gated on a benchmark. We ran the gate rather than arguing about it, on the fold that
matters (a signed 128-bit aggregate over a string-typed `uint256` column):

| rows | DuckDB | DataFusion | ratio |
|---|---|---|---|
| 2 M | 41 ms | 76 ms | 1.85× |
| 8 M | 95 ms | 244 ms | 2.57× |
| 20 M | 229 ms | 606 ms | 2.65× |

Each size was run twice with the engine order reversed, because whichever goes first warms the page
cache. Results were **identical** at every size, in both orders - correctness was never the question.

What failed the gate is that the gap **widens with segment size**, and segments only grow. So DuckDB
stays in both modes. The destination is unmet, not repudiated: measure-then-switch worked, and the
measurement said don't.

## Measuring your own

```sh
nuthatch bench backfill --from <block> --to <block> --runs 3
```

Benchmarks are CI artifacts here, not blog posts: backfill events/sec, tip lag, entity point-read
p50/p99 and RSS are tracked per commit, and a regression fails the build.
