---
title: "HTTP API"
description: "Every endpoint the served nest exposes."
order: 3
---

Everything a running nest serves, on `--listen` (default `127.0.0.1:8288`). All endpoints are
read-only GETs; the ingest thread is the only writer. In a [runtime](/docs/operate/many-nests/), each
nest's full surface appears under its `/<name>/…` prefix, byte-identical to a solo nest.

## Status & introspection

- `GET /` - the index summary: contract(s), chain, rows indexed, last and sealed block.
- `GET /health` - liveness; returns `ok`.
- `GET /ready` - readiness (caught up enough to serve).
- `GET /metrics` - Prometheus text. See [Metrics & footprint](/docs/operate/metrics/).
- `GET /nest` - the nest's identity: name, chain, content-addressed registry hash.
- `GET /shape` - which capabilities this nest can actually answer for (balances, flags, exposure,
  …). The MCP bridge reads it to advertise only live tools; it fails open if the probe fails.
- `GET /tables` - every decoded table with its columns, Solidity types, and topic0.
- `GET /schema` - the human/agent-readable data model, composed from the decode registry and
  [`semantic.toml`](/docs/build/semantic/).

## Data

- `GET /table/{name}?limit=N` - recent rows of one table, merged across the hot tip and sealed
  segments, newest first.
- `GET /entities` / `GET /entity/{id}` - entity point-reads from the hot store. Ids are formatted
  `{block:012}-{logindex:06}`.
- `GET /sql?q=…&max_rows=N` - read-only SQL over the live tip ∪ sealed history (SELECT/WITH only).
  Guarded: 30 s timeout, row cap (50,000 max; `max_rows` asks for less), 64 MiB result-byte cap, 2 concurrent. Results
  carry a **provenance stamp** - the block range and content-addressed segments the answer came
  from - so a figure can be cited against immutable data. See
  [The SQL surface](/docs/reference/sql/).
- `GET /explain?q=…` - validate a query **without executing it**: binds every table, column, and
  type and returns `{valid: true}` or an error with a fix hint. Cheaper than `/sql`; agents use it
  to check shape before spending a query.

## Derived & compliance

- `GET /balances?limit=N` - top holder balances from the incrementally-maintained view (i128 base
  units as decimal strings).
- `GET /balance/{address}` - one address's derived balance.
- `GET /exposure/{address}` - direct counterparty exposure to the labeled set: inbound/outbound
  count and summed amount per label (RFC-0008).
- `GET /flags?kind=threshold|velocity` - compliance flags: single transfers over the configured
  amount, or addresses over the windowed-volume threshold.

## Admin & runtime

- `GET /_admin/` - the built-in read-only dashboard; `GET /_admin/events` streams live activity
  (SSE). Off-localhost both require the admin token; `--no-admin` removes them. See
  [Serving & the admin UI](/docs/operate/serving/).
- `GET /nests` *(runtime only)* - the roster of mounted nests: name, chain, registry hash, table
  count, footprint, plus each nest's **live health** (`indexing` or `quarantined`, with the reason
  and the next re-admission attempt). The health half is merged per request, not cached at boot, so
  a quarantined nest reports what is true now.
- `GET /ready` *(runtime root)* - runtime-wide readiness, for a supervisor to poll. Each nest also
  answers its own `GET /<name>/ready`, so one sick nest is diagnosable without guessing.

During a breaking [upgrade](/docs/operate/upgrades/), the old version's responses additionally
carry `Deprecation: true` and a `Link: …; rel="successor-version"` header (RFC 8594) pointing at
its replacement.
