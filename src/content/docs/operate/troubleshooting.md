---
title: "Troubleshooting"
description: "RPC failover, stalls, corrupt-segment recovery, and common errors."
order: 6
---

Symptom → what to look at (`/metrics`) → remedy. All series live on the running `dev`/`roost` at
`http://127.0.0.1:8288/metrics`; see [Metrics & footprint](/docs/operate/metrics/) for the full
list.

## Backfill seems stuck

The most common cause is high `--concurrency` against a **single** RPC endpoint - many concurrent
requests to one host can stall the whole run. Use `--concurrency 1` for one endpoint, or configure
several `rpc_urls` (then 8-16 is fine). Watch `nuthatch_rows_decoded_total` and
`nuthatch_last_block` climb; on a TTY, `dev` shows a live progress line with events/sec and an ETA,
and a frozen line is the concurrency stall above.

A *sparse* contract over millions of blocks isn't stuck, just inefficient - each window comes back
near-empty. Widen it: `--window 50000` turns tens of thousands of near-empty requests into a few.
Keep the window under your provider's `getLogs` block-range cap; the concurrent backfill fails a
too-big range loudly rather than silently shrinking it.

## Free public RPCs: stalls and empty results

nuthatch ships a small pool of free public endpoints per chain so `init` -> `dev` works with no setup.
That is deliberate, and it is the right default for a first run. It is the wrong default for production,
and the failure mode is worth knowing because **it does not always look like an error**:

- **Shared rate limits.** You are queueing behind everyone else on the same free tier from the same IP
  range, so throughput varies by the hour.
- **Silent empties.** A throttled endpoint often answers with an *empty result* instead of an error. To
  the indexer that is indistinguishable from "no logs in this range", so the window advances and you
  simply get less data than expected.
- **Deep backfills crawl or stop.** Full history over a busy contract is millions of `eth_getLogs`
  calls; expect throttling long before it finishes.
- **No archive guarantees.** Many free endpoints prune old state, so a backfill from a 2020 deploy block
  can fail partway.

**Symptoms:** `nuthatch_last_block` barely moves while `nuthatch_rpc_requests_total` climbs; `/ready`
reports `stalled` (no successful poll within the stall window); the log shows `all RPC endpoints
unreachable` every ~60 s.

**Remedy - use your own endpoint:**

```sh
nuthatch dev --rpc https://your-endpoint.example/arbitrum
```

`--rpc` is repeatable, and nuthatch round-robins across the pool with per-endpoint health tracking, so
two or three endpoints buy you failover as well as throughput. Persist them as `rpc_urls` in
`nuthatch.toml` rather than passing them every run.

Every endpoint in a pool must be on the **same chain**. nuthatch verifies this at startup and refuses to
run against a mixed pool - indexing against the wrong chain corrupts state silently, so this is a hard
error rather than a warning.

## "block N alone exceeds the provider's getLogs result cap"

One block's logs are too large for the provider to return, and a single block can't be split
further. Use a provider with a higher (or no) result cap. This fails loudly by design rather than
looping forever.

## Tip lag

`nuthatch_tip_lag_blocks` is the gap between the chain head and your last indexed block
(`nuthatch_sealed_through` trails further - past finality, by design). Persistent growth means RPC
throughput, not nuthatch: add endpoints or point at your own node. The adaptive `getLogs` window
self-tunes for density.

## Reorgs

Reorgs only ever touch the **hot store** - sealed segments are immutable, and you should never see
sealed data change. `nuthatch_reorgs_total` counts detections; the hot store rolls back and the IVM
views retract automatically, converging to canonical state. If a plan seems to require rewriting
sealed Parquet to "fix" a reorg, the plan is wrong - the hot store already handled it.

## `/sql` returns 503 or times out

- **503 "server busy"** - the analytical gate is saturated (2 concurrent). It's node
  self-protection: retry, don't raise the cap.
- **30 s timeout** - the query is too heavy. Add a `WHERE`/`LIMIT`, aggregate with `GROUP BY`, or
  validate cheaply with [`/explain`](/docs/reference/http-api/) first.
- **Binder and parse errors come back with a fix hint** derived from the real schema: an unknown
  table suggests the nearest real one, `from`/`to` suggests double-quoting, `sum(value)` suggests
  `value_dec`. Follow the hint.

## RAM near the 2 GB budget

The budget is per-cursor and CI-enforced; in a roost it's shared across that cursor's nests
(`max_rss_mb`, default 2048), and a mount projected to exceed it is refused. Check the per-nest
estimated footprint (and the roost-wide actual `nuthatch_rss_bytes`) in the `/nests` roster. DuckDB
queries carry their own per-query memory cap and thread limit;
if you're tight, lower query concurrency rather than the per-query cap.

## "semantic.toml drift" warnings at startup

`semantic.toml` describes a table or column the decode registry doesn't have - a stale edit, or the
ABI changed. Fix the file or run `nuthatch schema` to regenerate the derived artifacts; the
footguns are always recomputed, and only the authored descriptions are yours to maintain. Stale
semantics are worse than none, so `dev` warns loudly.

## ABI won't resolve at `init`

`init` tries Sourcify, then Etherscan-class APIs. If both miss (an unverified contract), drop the
ABI into `abis/` yourself and reference it from `nuthatch.toml`, or pass `--rpc <url>` so a proxy's
implementation can be looked up on-chain - EIP-1967 proxies resolve their implementation ABI
automatically.
