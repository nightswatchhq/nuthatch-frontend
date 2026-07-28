---
title: "Metrics & footprint"
description: "Prometheus /metrics and the ≤2 GB-per-cursor footprint budget."
order: 2
---

Every running nest exposes Prometheus text at `GET /metrics`. Gauges are set to the latest value;
counters only ever increase - standard scrape targets, no exporter sidecar needed.

## The series

Process-level gauges:

| Series | Meaning |
|---|---|
| `nuthatch_tip_height` | The chain head as last seen from RPC. |
| `nuthatch_last_block` | The last block fully indexed into the hot store. |
| `nuthatch_tip_lag_blocks` | The gap between the two - your "are we keeping up" number. |
| `nuthatch_sealed_through` | The highest block sealed to Parquet (trails finality, by design). |
| `nuthatch_rss_bytes` | The process's resident set - watch it against the budget. |
| `nuthatch_last_poll_unixtime` | When the tip was last polled (a frozen value means a stalled poller). |
| `nuthatch_alert_outbox_depth` | Undelivered webhook/alert rows in the durable outbox. |

Process-level counters:

| Series | Meaning |
|---|---|
| `nuthatch_rows_decoded_total` | Event rows decoded into the hot store. |
| `nuthatch_rows_sealed_total` | Rows sealed into Parquet segments. |
| `nuthatch_reorgs_total` | Reorg detections (the hot store rolled back and converged). |
| `nuthatch_http_requests_total` | Every served request - the operator's billing/usage signal. |
| `nuthatch_sql_queries_total` | Analytical queries served. |
| `nuthatch_sql_rejections_total` | Queries refused by the guards (timeout, interrupt, bad SQL). |
| `nuthatch_rpc_requests_total` | Upstream RPC calls made. |

In a [roost](/docs/operate/roosts/), the process-level series blend every mounted nest into one
number, so each nest also gets labelled per-nest counterparts: `nuthatch_nest_last_block`,
`nuthatch_nest_sealed_through`, `nuthatch_nest_rows_decoded_total`,
`nuthatch_nest_rows_sealed_total`, and `nuthatch_nest_reorgs_total`.

Health series (RFC-0026), which is where you look when *part* of a roost is unwell:

| Series | Meaning |
|---|---|
| `nuthatch_nest_health{nest,chain}` | `1` while the nest is indexing, `0` while it is quarantined. |
| `nuthatch_nest_quarantine_total{nest}` | Times this nest has been quarantined since start - a flapping nest shows up here before anyone notices. |
| `nuthatch_cursor_live{chain}` | `1` while the chain's cursor is running, `0` once it has died. |

## The footprint budget

The budget is a non-negotiable, CI-enforced: **≤2 GB RAM per active-chain cursor** - one chain's
tip-following plus serving, whether that cursor hosts one nest or twelve. A single-chain roost is
one cursor (≤2 GB total, shared across its nests); a multichain roost's total is the sum of its
cursors. Density is RAM-bounded, not free: a roost refuses to mount a nest whose projected
footprint would blow the ceiling (`max_rss_mb`, default 2048).

Inside the budget, the analytical path is separately bounded - each DuckDB query runs under its own
memory cap and thread limit, and the concurrency gate bounds the aggregate. If you're tight, lower
concurrency rather than raising the per-query cap.

Alert if you must on `nuthatch_tip_lag_blocks` (sustained growth = RPC throughput problem) and
`nuthatch_rss_bytes` (approaching the ceiling). Everything else is diagnosis material - see
[Troubleshooting](/docs/operate/troubleshooting/).
