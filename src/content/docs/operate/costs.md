---
title: "What it costs to run"
description: "RPC requests are the bill RAM doesn't show - what following tip costs per day, why block_timestamps is the reason, and the honest number for a nest nobody reads."
order: 6
---

[Metrics & footprint](/docs/operate/metrics/) covers RAM. This page covers a different bill: **RPC
requests**, which is what your provider actually charges for, and which does not stop after backfill
- a nest following tip keeps paying it for as long as it runs. Being your own indexer does not make
this cost disappear; it means you are the one who sees it.

## Per day, per block

Following tip costs at least one request per block produced, for every column that needs one. On a
chain producing 345,600 blocks a day (Arbitrum's rate), a nest serving `block_timestamp` pays roughly
that many extra requests a day, on top of its `eth_getLogs` polling, for as long as it runs.

## `block_timestamps` is the reason

A timestamp lives in the block header, not in the log `eth_getLogs` returns, so serving
[`block_timestamp`](/docs/reference/config/#block_timestamps) costs one extra `eth_getBlockByNumber`
per distinct block. That cost does not end when backfill does - a nest at tip pays it again on every
new block, indefinitely.

Turning it off is only an option if nothing that reads your nest ever asks a time-series question.
It's an init-time choice, not a flag you can flip later: dropping the column afterward is a breaking
schema change and a full re-index. If you're unsure, keep it on - most nests turn out to need it once
someone builds a "last N days" view against them.

## Measured, not modelled

On our own reference deployment
([#750](https://github.com/nightswatchhq/nuthatch/issues/750), audited 2026-08-22): four nests, one
week, **~11.8M RPC requests** against **~100 HTTP requests actually served** - roughly **118,000 RPC
requests per HTTP request answered**, and if anything an understatement, since that ~100 excludes
only one nest's own audit-probe traffic and not the others'.

One of those four was explicitly labelled *temporary* and was stopped once the audit surfaced it: 2.8M
RPC requests over five days to hold three entities nobody was reading. What remains running is **~9M
RPC requests a week** across the other three nests, and none of that remainder is waste - each of
those nests' own queries filter or select on `block_timestamp`, confirmed by reading the SQL rather
than assumed. The full per-nest table is in the
[operator docs](https://github.com/nightswatchhq/nuthatch/blob/main/docs/operators.md#what-a-nest-costs-at-tip).

The busiest of the three averaged **~549,000 requests a day** over the audit window, on a chain
producing about 345,600 blocks a day - the right order of magnitude for a header fetch per block plus
its log polling on top.

## What that costs against a priced endpoint

None of the volume above was billed - most of those nests run against a free public endpoint. Pricing
the header-fetch load alone against a metered one, the same way the [benchmarks](/docs/operate/performance/)
page prices a backfill:

```
cost/month ≈ blocks/day × CU(eth_getBlockByNumber) × days/month × $/CU
           ≈ 345,600     × 20                       × 30         × $0.00000045
           ≈ $93/month
```

`eth_getBlockByNumber` at 20 CU, and $0.45 per million CU for the first 300M CU/month, are Alchemy's
own published pay-as-you-go rates, checked 2026-08-22:
[compute unit costs](https://www.alchemy.com/docs/reference/compute-unit-costs),
[pricing](https://www.alchemy.com/pricing).

This is the header-fetch term only, for one chain at Arbitrum's block rate. It excludes `eth_getLogs`
polling and every other RPC method a nest calls, so it's a floor, not a full bill.

## The honest number

A nest sitting at tip, answering nobody, still costs on the order of **~$100/month** against a paid
provider. That figure is this computation, not a measurement - the reference deployment itself paid
nothing for it, because it runs against a free endpoint.

This isn't a recommendation to turn `block_timestamps` off. It's a real, inherent cost of following
tip with timestamps on, and whether to pay it is a decision made against your own consumers, not a
default this page is telling you to change.
