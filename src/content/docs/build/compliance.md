---
title: Compliance pack
description: Optional screening, flags, and alerts - a derive-only stage over decoded transfers.
order: 7
checked: 4.12.0
---

Some nests need more than raw rows: screen addresses against a sanctions list, flag transfers that cross
a threshold, raise an alert when something fires. The **compliance pack** is an optional stage over your
decoded transfers - off by default, deterministic, and, like every optional integration, it costs
nothing when it isn't configured.

> Screening lists are **local, content-addressed snapshots** you fetch and pin - nuthatch never reaches
> for a gated screening service mid-decode. That would break the
> [no-phone-home rule](/docs/concepts/determinism/).

## The shape

```toml
[screening]
lists = ["<list-hash>"]              # content-addressed snapshots from `nuthatch lists fetch`

[flags]                              # singular table - two built-in rules
threshold = "1000000000000"          # flag any single transfer ≥ this (base units, decimal string)
velocity_amount = "5000000000000"    # flag an address whose windowed outbound volume ≥ this
velocity_window = 7200               # window in BLOCKS (≈24h at 12s blocks); default 7200

[[alerts]]
kinds = ["threshold_flag", "sanction_hit"]   # which annotation kinds to deliver
url = "https://your-service/alerts"
# format = "raw"                             # default; "discord" posts a Discord-shaped message
```

- **`[screening]`** - screen each transfer's `from`/`to` against pinned list snapshots. A match becomes
  an append-only **`sanction_hit`** annotation, stamped with the list-snapshot version it matched.
  Fetch a list first with `nuthatch lists fetch` (built-in `ofac-sdn`, `eu-consolidated`, or your own
  via `--url`/`--file`).
- **`[flags]`** - two built-in rules, not arbitrary SQL. `threshold` flags any single transfer at or
  above an amount; each match becomes a sealed, append-only **`threshold_flag`** annotation. `velocity`
  flags an address whose outbound volume over `velocity_window` **blocks** reaches `velocity_amount`;
  this one is a *live* windowed view (served at `/flags?kind=velocity`), not a sealed annotation - so it
  isn't deliverable via alerts. Amounts are base units as decimal strings; the window is a **block
  count**, not wall-clock - an honest approximation, since the chain has no clock.
- **`[[alerts]]`** - deliver annotations whose `kind` is in `kinds` to a `url`. The valid kinds are
  `threshold_flag` and `sanction_hit`, which match the emitted annotations exactly, and
  `entity_fault`, which fires when an [incremental entity](/docs/build/entities/) faults. `format` is
  `raw` (the default) or `discord`, for a Discord webhook URL.

## Determinism holds

Screening and flags are deterministic derivations over decoded transfers - a list-snapshot match and two
numeric rules, nothing that phones out mid-decode. They're re-executable: the same blocks and the same
list snapshot always produce the same annotations, which is what makes the signed audit pack
(`nuthatch audit replay`) able to re-prove them from scratch. Effectful notification (the alert POST)
happens **after** sealing, never in the decode path - the same rule as webhooks and enrichers (see
[Determinism](/docs/concepts/determinism/)).

## Delivery is durable

Alerts ride the same host-side [webhook](/docs/build/webhooks/) delivery engine: at-least-once, via a
durable outbox, with retries and backoff. A stalled sink never blocks indexing - it only backs up its own
queue (`nuthatch_alert_outbox_depth` in [/metrics](/docs/operate/metrics/)).

## Query the annotations

Flags and hits are ordinary rows. Query the live counts over the HTTP API - `GET /flags?kind=threshold`
or `?kind=velocity` - or the full sealed history in SQL:

```sql
SELECT * FROM sanction_hit ORDER BY block_number DESC LIMIT 20;
```

## Next

- [Webhooks](/docs/build/webhooks/) - the delivery engine alerts share
- [The semantic layer](/docs/build/semantic/) - describe what a flag means
- [nuthatch.toml](/docs/build/config/) - where the stage is configured
