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
  Guarded: 30 s timeout, row cap (50,000 max; `max_rows` asks for less), 64 MiB result-byte cap, 2 concurrent.
  A query cut off by the timeout is answered with 504, one that spills more than the analytics spill
  cap to temporary storage (`analytics.max_temp_size`, 2 GB by default) with 507, and a malformed one
  with 400. Results
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

- `GET /derived` - the nest's declared incremental entities, and how current each one is.
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

- `GET /ipfs/gave-up` - the `[[ipfs]]` documents resolution gave up on, in block order. Each is
  absent from sealed history.

The GraphQL routes (`POST /graphql`, `/subgraphs/id/{id}`, `/subgraphs/name/…`) and `GET /graph/status`
are registered only in a binary built with `--features graph`. The published binaries and images are
not, and answer them with 404.

## Admin & runtime

- `GET /_admin/` - the built-in dashboard; `GET /_admin/events` streams live activity (SSE).
  Off-localhost both require the admin token; `--no-admin` removes them. See
  [Serving & the admin UI](/docs/operate/serving/).
- The **runtime lifecycle routes** below mutate runtime state: they require the admin token when
  bound off-localhost and disappear with `--no-admin`.
- `GET /nests` *(runtime only)* - the roster of mounted nests: name, chain, registry hash, table
  count, footprint, plus each nest's **live health** (`indexing` or `quarantined`, with the reason
  and the next re-admission attempt). The health half is merged per request, not cached at boot, so
  a quarantined nest reports what is true now.
- `GET /ready` *(runtime root)* - runtime-wide readiness, for a supervisor to poll. Each nest also
  answers its own `GET /<name>/ready`, so one sick nest is diagnosable without guessing.

## Runtime lifecycle (admin)

A runtime (`nuthatch dev --dir` over a `mounts.toml`) is driven by these routes. `<name>` is a mount's
route key: `usdc` for the default tenant, `acme/usdc` for any other, fixed for the life of the mount. The walkthrough is
[Host nests for others](/docs/operate/hosting-nests/).

| Route | Does | Answers |
|---|---|---|
| `POST /_admin/nests` `{"name", "nid"}` | Mount a NID under a name, as a job; fetched from `--registry` if not held | `202` and the job; `200` if already live with that NID; `409` for another NID |
| `POST /_admin/nests?wait=true` | The same, answering when finished | `200`, or `400` / `404` / `409` / `507` |
| `POST /_admin/nests?dry_run=true` | Price and check a mount, mounting nothing | `200` and a report with `refusal_status` |
| `GET /_admin/mounts` | Every mount the runtime knows, with its phase | `200` `{"mounts": [...]}` |
| `GET /metrics` | The runtime's Prometheus exposition, per-nest series labelled `{nest}` | `200`, even with nothing mounted |
| `GET /_admin/mounts/<name>` | One mount's job | `200`, or `404` |
| `POST /_admin/suspend/<name>` | Take a mount off its cursor, keep its data, answer `503` in its place | `200`; `404` if not mounted |
| `POST /_admin/resume/<name>` | Resume a suspended mount, as a job (`?wait=true` accepted) | `202`; `404` if not suspended |
| `POST /_admin/move/<name>` `{"nid"}` | Switch a live name to a new NID in one step, as a job (`?wait=true` accepted) | `202`; `400` for a malformed NID; `409` while a job for the name is running |
| `DELETE /_admin/nests/<name>` | Unmount (drain, then remove routes); `?reclaim=true` also frees the dataset | `200` `{"unmounted", "reclaim"?}` |
| `DELETE /_admin/datasets/<nid>` | Free a dataset unmounted earlier | `200` reclaimed, `409` kept, `404` absent |

A job is `{"name", "nid", "phase", "reason"?, "since_unixtime"}`, with `phase` one of `accepted`,
`fetching`, `joining`, `live`, `failed`, or `suspended` while paused. Reading a job never waits on a mount in progress; unfinished
jobs resume after a restart. Mount refusals: `400` malformed NID or a name boot would refuse, `404` NID not held and no
`--registry`, `409` name taken, chain not declared or its cursor dead, `507` over the cursor's RAM
ceiling. On the job route each ends the job `failed` with the same reason.

The normal operator upgrade path is [staging a successor and running `nuthatch migrate`](/docs/operate/upgrades/).
It classifies schema compatibility before changing a mount; it does not silently put a second public
version behind an undocumented route.
