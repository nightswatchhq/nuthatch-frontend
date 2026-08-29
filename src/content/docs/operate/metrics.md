---
title: "Metrics & footprint"
description: "Prometheus /metrics and the ≤2 GB-per-cursor footprint budget."
order: 5
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

With [many nests in one runtime](/docs/operate/many-nests/), the process-level series blend every mounted nest into one
number, so each nest also gets labelled per-nest counterparts: `nuthatch_nest_last_block`,
`nuthatch_nest_sealed_through`, `nuthatch_nest_rows_decoded_total`,
`nuthatch_nest_rows_sealed_total`, and `nuthatch_nest_reorgs_total`.

Health series (RFC-0026), which is where you look when *part* of a runtime is unwell:

| Series | Meaning |
|---|---|
| `nuthatch_nest_health{nest,chain}` | `1` while the nest is indexing, `0` while it is quarantined. |
| `nuthatch_nest_quarantine_total{nest}` | Times this nest has been quarantined since start - a flapping nest shows up here before anyone notices. |
| `nuthatch_cursor_live{chain}` | `1` while the chain's cursor is running, `0` once it has died. |

Each declared authored incremental entity adds six gauges, labelled by nest and entity:
`nuthatch_entity_applied_through`, `nuthatch_entity_current`, `nuthatch_entity_rows`,
`nuthatch_entity_faulted`, `nuthatch_entity_unavailable`, and
`nuthatch_entity_seconds_since_progress`. Page on `faulted`; investigate a `current` gauge that stays
zero or a progress age that keeps climbing. This is the difference between a maintained answer that is
fresh and one that merely happens to have a table-shaped name.

## The footprint budget

The budget is a non-negotiable, CI-enforced: **≤2 GB RAM per active-chain cursor** - one chain's
tip-following plus serving, whether that cursor hosts one nest or twelve. A single-chain runtime is
one cursor (≤2 GB total, shared across its nests); a multichain runtime's total is the sum of its
cursors. Density is RAM-bounded, not free: a runtime refuses to mount a nest whose projected
footprint would blow the ceiling (`max_rss_mb`, default 2048).

Inside the budget, the analytical path is separately bounded - each DuckDB query runs under its own
memory cap and thread limit, and the concurrency gate bounds the aggregate. If you're tight, lower
concurrency rather than raising the per-query cap.

## A small, useful alert set

These are deliberately symptoms rather than a pager for every counter. Pick the lag threshold for
the chain and the service promise you make to readers. The examples assume Prometheus has a
`job="nuthatch"` label.

```yaml
groups:
  - name: nuthatch
    rules:
      - alert: NuthatchCursorStalled
        expr: time() - nuthatch_last_poll_unixtime{job="nuthatch"} > 180
        for: 5m
        labels: { severity: page }
        annotations:
          summary: "Nuthatch has not polled its chain for five minutes"

      - alert: NuthatchFallingBehind
        expr: nuthatch_tip_lag_blocks{job="nuthatch"} > 50
        for: 15m
        labels: { severity: ticket }
        annotations:
          summary: "Nuthatch remains more than 50 blocks behind the tip"

      - alert: NuthatchNestQuarantined
        expr: nuthatch_nest_health{job="nuthatch"} == 0
        for: 2m
        labels: { severity: page }
        annotations:
          summary: "A mounted nest is quarantined"

      - alert: NuthatchNearMemoryBudget
        expr: nuthatch_rss_bytes{job="nuthatch"} > 1800 * 1024 * 1024
        for: 10m
        labels: { severity: ticket }
        annotations:
          summary: "Nuthatch is within 248 MB of its default cursor budget"
```

The memory number is intentionally below the default 2 GB ceiling. It gives you time to reduce
query concurrency or investigate a mount before the runtime has to refuse more work. In a
multichain runtime, alert per `nuthatch_cursor_live{chain}` and per-nest health too; the aggregate
RSS cannot identify which chain has become expensive. See
[Troubleshooting](/docs/operate/troubleshooting/) for the corresponding diagnosis paths.
