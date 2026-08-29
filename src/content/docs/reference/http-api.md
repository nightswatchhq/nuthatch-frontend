---
title: "HTTP API"
description: "Every endpoint the served nest exposes."
order: 3
---

Everything a running nest serves, on `--listen` (default `127.0.0.1:8288`). The data API is read-only:
the ingest thread is the only data writer. A runtime additionally has two authenticated admin mutation
routes for mounting and unmounting nests. In a [runtime](/docs/operate/many-nests/), each nest's full
surface appears under its `/<name>/…` prefix, byte-identical to a solo nest.

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
- `GET /queries` - the mount's sanctioned query surface: `sql` (`open` | `deny` | `allowlist`),
  `free_form`, and each named query with its parameters and path. On an `open` mount this simply
  reports that free-form SQL is available.
- `GET /q/{name}?<params>` - run a **named, parameterised** query by name, passing its declared
  arguments as the query string. The caller never supplies SQL. Available on any mount that declares
  queries, and the *only* SQL route on an `sql = "allowlist"` mount - where `/sql` and `/explain` are
  refused with the list of names you may ask for instead. See
  [Bounding what a mount will answer](/docs/operate/security/#bounding-what-a-mount-will-answer).

## Derived & compliance

- `GET /derived/{entity}` - the first page of a declared incremental entity, including its
  applied-through provenance.
- `GET /derived/{entity}/{key}` - a keyed point read from that maintained relation. The key follows
  the order declared in `entities.toml`. An entity is also a relation on `/sql`, so it can be joined
  with decoded tables.

- `GET /balances?limit=N` - top holder balances from the incrementally-maintained view (i128 base
  units as decimal strings).
- `GET /balance/{address}` - one address's derived balance.
- `GET /exposure/{address}` - direct counterparty exposure to the labeled set: inbound/outbound
  count and summed amount per label (RFC-0008).
- `GET /flags?kind=threshold|velocity` - compliance flags: single transfers over the configured
  amount, or addresses over the windowed-volume threshold.

## Admin & runtime

- `GET /_admin/` - the built-in dashboard; `GET /_admin/events` streams live activity (SSE).
  Off-localhost both require the admin token; `--no-admin` removes them. See
  [Serving & the admin UI](/docs/operate/serving/).
- `POST /_admin/nests` *(runtime only)* - mount a nest into a running runtime. `DELETE
  /_admin/nests/{name}` unmounts it. These mutate runtime state, require the admin token when
  remote, and disappear with `--no-admin`.
- `GET /nests` *(runtime only)* - the roster of mounted nests: name, chain, registry hash, table
  count, footprint, plus each nest's **live health** (`indexing` or `quarantined`, with the reason
  and the next re-admission attempt). The health half is merged per request, not cached at boot, so
  a quarantined nest reports what is true now.
- `GET /ready` *(runtime root)* - runtime-wide readiness, for a supervisor to poll. Each nest also
  answers its own `GET /<name>/ready`, so one sick nest is diagnosable without guessing.

The normal operator upgrade path is [staging a successor and running `nuthatch migrate`](/docs/operate/upgrades/).
It classifies schema compatibility before changing a mount; it does not silently put a second public
version behind an undocumented route.
