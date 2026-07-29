---
title: "We put a live dashboard on our own indexer. Here's the box."
date: "2026-07-18"
description: "Nuthatch stopped being a demo today. A real public dashboard - Lodestar - now serves two of its panels from a single nuthatch binary running on one small VPS of ours. This is the operator's log: the nests, the backfill, the box, the 86 MB, and the runtime deadlock we had to root-cause to get there."
author: "cargopete"
tags: ["nuthatch", "operations", "self-hosting", "the-graph", "arbitrum", "deployment", "duckdb", "rust"]
---

*Nuthatch stopped being a demo today. A real public dashboard - [Lodestar](https://www.lodestar-dashboard.com) - now serves two of its panels from a single nuthatch binary running on one small VPS of ours, over authenticated HTTPS, with no third-party data API in the path. This is the operator's log: what it actually took to go from "it indexes on my laptop" to "a product with users depends on this box."*

---

## The gap between "it works" and "it's load-bearing"

"Be your own indexer" is an easy slogan and a harder commitment. It's one thing to run `nuthatch init` on your machine, watch a backfill stream by, and query it. It's another to point a live product's traffic at the result and go to sleep. The distance between those two is where all the interesting failures live, and the only way to find them is to actually make the crossing.

So we did. The [Lodestar side of this story](https://www.lodestar-dashboard.com/blog/lodestar-runs-on-nuthatch) - which panels, the parity checks, the response shapes - is on Lodestar's blog. This post is the other half: what it's like to *operate* nuthatch for a real consumer.

## Two nests, four contracts' worth of events

A nest is config plus vendored ABIs - nothing to provision. We stood up two.

The delegation feed comes from HorizonStaking:

```sh
nuthatch init 0x00669A4CF01450B64E8A2A20E9b1FCB71E61eF03 \
  --chain arbitrum-one --alias staking
```

That resolves the ABI, generates deterministic decoders, and turns every event into a queryable table. HorizonStaking has twenty-eight of them; we wanted four. So the config carries an event allowlist:

```toml
[[contracts]]
alias = "staking"
address = "0x00669a4cf01450b64e8a2a20e9b1fcb71e61ef03"
events = ["TokensDelegated", "TokensUndelegated", "DelegatedTokensWithdrawn", "StakeDelegatedWithdrawn"]
```

That filters both the decode *and* the `eth_getLogs` topic set - you don't pay to fetch and store rows you'll never query. The developer-activity chart is a second nest indexing exactly one L2GNS event, `SubgraphPublished`.

## The backfill, and a sparse-contract trick

Delegation only needed a recent window. Developer activity needed a full year of GNS history - about 125 million Arbitrum blocks. At the default 2,000-block `getLogs` window that's ~62,000 requests, which is a fine way to spend an afternoon watching a progress log.

GNS is *sparse*, though - few events across enormous stretches of blocks - so the fix is a bigger window:

```sh
nuthatch dev --backfill 125000000 --window 50000 --seal-direct --concurrency 8
```

`--window 50000` turns 62,000 requests into ~2,500, and the year backfilled in about four minutes. Everything past finality is sealed into content-addressed Parquet segments - immutable, named by the hash of their contents. DuckDB attaches them read-only and serves the analytical SQL. That `/sql` endpoint is the entire integration surface Lodestar talks to.

## The box

Here's the part that still feels slightly unreasonable. The whole thing is one static binary. On the VPS it's:

- Two `systemd` services (one per nest), each `nuthatch dev` bound to localhost.
- One Caddy vhost with automatic TLS and basic-auth, path-routing the two nests so the consumer sees a single URL.
- A dedicated unprivileged user, hardened unit (`ProtectSystem=strict`, private tmp), data in one directory.

No Postgres. No Docker. No message bus. No IPFS. The resident memory for **both** nests, backfilled and serving live: **86 MB.** The footprint budget is 2 GB, and it is not remotely threatened. Tip lag sits at zero to a couple of blocks.

Deploying a new build is `curl` the release tarball, `install`, `systemctl restart` - the services resume from their persisted cursor, no re-backfill. That's the whole operational story. It is genuinely boring, which is the highest compliment you can pay infrastructure.

## And then it hung

It would be a dishonest field note without the bad night. Partway through, a backfill simply stopped. Process alive, zero CPU, zero progress, indefinitely - and the per-request 20-second timeout never fired, which is its own kind of alarming.

The wrong instinct is to guess. We reproduced it deterministically instead (it turned out to need a constrained worker pool), then sampled the stalled process. Every thread parked, one idle on the I/O driver, **zero in-flight network connections**, not a single application frame. That's not slow I/O - that's a lost wakeup. The runtime had gone fully to sleep with a task pending that nobody would ever poll.

Two tidy theories died against the evidence. HTTP/2 multiplexing? Forced HTTP/1.1; still hung. The incremental-view runtimes? Present in the passing runs too, so not the cause. The real variable was embarrassingly simple in hindsight: **every failing run pointed at a single RPC endpoint; every passing one had several.** High concurrency to one host was stalling the entire runtime - a lost wakeup total enough to freeze the timers.

The fix ships in `v0.2.2`: a single configured endpoint caps the backfill to sequential (loudly, with a note to add endpoints for parallelism); two or more keep full concurrency. Single-endpoint backfills got slower and stopped hanging, which is the right trade.

## We went looking for its relatives

A hang that silently freezes your indexer is exactly the failure that shouldn't be a one-off, so we audited the core paths for the same shape - failures that don't announce themselves - and fixed a family of them in `v0.3.0`:

- The backfill is now **resumable** (it persists a watermark and continues instead of restarting, which on one code path could otherwise re-seal overlapping ranges and double-count), and the process **dies loudly** if ingestion dies instead of quietly serving stale data.
- A transient timestamp fetch failure no longer bakes `block_timestamp = 0` into permanent segments.
- A single over-cap block fails with a clear message instead of retrying forever.
- Reorgs below finality halt rather than silently diverging; the segment manifest is written atomically so a `kill -9` can't orphan it; unused incremental-view circuits don't get spun up.

That's the binary the box runs today. Verified by checksum, both nests healthy.

## What it feels like to depend on your own indexer

The honest answer: uneventful, which is the point. A public dashboard's two panels now resolve against a machine we own, from data we derived ourselves from public inputs, with an automatic fallback to the old gateway if the box ever sneezes. Nobody has to trust a claim about the numbers - the code is [open and re-runnable](https://github.com/nuthatch-indexer/nuthatch), and the panels carry a small badge that only lights up when the data genuinely came from nuthatch.

We're not pretending it's the whole road. Some of Lodestar's data needs calldata and IPFS ingestion nuthatch doesn't have yet. The developer-activity numbers sit a single subgraph off the network subgraph's - documented, not hidden. And "a whole dashboard" is a long parade of panels, each with its own quirks to reproduce faithfully.

But two of them are ours now, running on 86 MB and one small box. That's what the slogan was always supposed to mean.

*Nuthatch is [github.com/nuthatch-indexer/nuthatch](https://github.com/nuthatch-indexer/nuthatch) - one Rust binary, MIT OR Apache-2.0. Point it at a contract; be your own indexer.*
