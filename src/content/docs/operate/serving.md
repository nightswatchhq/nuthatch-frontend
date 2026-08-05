---
title: "Serving & the admin UI"
description: "The HTTP API, entity point-reads, /sql, and the built-in admin UI."
order: 1
---

`nuthatch dev` *is* the serve command: it backfills, follows the tip, and serves the HTTP API on
`127.0.0.1:8288` (change with `--listen`). There is no separate server to deploy - a nest that's
indexing is a nest that's serving.

## The surface

Three kinds of read, one process:

- **Point-reads** - `/entity/{id}`, `/balance/{address}`: sub-millisecond lookups against the redb
  hot store.
- **Analytical SQL** - `/sql?q=…`: read-only DuckDB queries over the live tip ∪ sealed history.
  Every event is a view named `{alias}__{event}`. See [The SQL surface](/docs/reference/sql/).
- **Introspection** - `/`, `/tables`, `/schema`, `/nest`, `/metrics`: what this nest is, what it
  holds, and how it's doing.

The full route list is in the [HTTP API reference](/docs/reference/http-api/).

## The guards

`/sql` is guarded so a bad query can't take the node down - these are self-protection, not knobs to
raise:

- **30-second timeout** per query. A runaway is interrupted, not left to spin.
- **50,000-row cap** per result (requests can ask for less via `max_rows`; the MCP bridge asks for
  much less so an agent's context isn't flooded).
- **64 MiB result-byte cap** per query. A row cap bounds count, not width - a wide-cell `SELECT` would
  otherwise materialise unbounded Rust-side (outside DuckDB's memory limit); this keeps a query inside
  the footprint budget. Hitting it flags the result truncated, same as the row cap.
- **2 concurrent analytical queries.** A third gets a `503` - retry, don't remove the gate.
- **2,000,000 unsealed rows** scanned per query. Every `/sql` call parses the whole unsealed tip into
  memory, so on a deep-finality chain with a busy contract this is the largest RAM risk the process
  carries - and in a runtime it is a co-tenant's problem too, because the budget is per cursor. Past the
  ceiling the query is refused with a `503` naming the reason, rather than the box falling over. It is
  generous on purpose: a nest at tip on a normal chain is nowhere near it, so you should only ever meet
  this guard when something is genuinely wrong. Note it is a **refusal, not a downgrade** - an
  over-budget tip is never silently answered from sealed data alone, which would return a different
  number without saying so.
- **SELECT/WITH only.** The query surface is read-only by construction; the ingest thread is the
  only writer.

DuckDB itself runs with a per-query memory cap and a bounded thread count, so the analytical path
stays inside the [footprint budget](/docs/operate/metrics/).

## Exposure

**The API has no authentication.** Bound to localhost (the default) that's the point. Bound off
localhost, `dev` logs a loud warning: the guards bound *how much* a query can cost, but *who* may
query is your gateway's job. Put a reverse proxy with auth in front before exposing a nest publicly.

Shutdown is graceful: on SIGTERM/SIGINT axum drains in-flight requests, the ingest task checkpoints
its progress, and a restart resumes cleanly.

## The admin UI

Every nest serves a built-in, read-only dashboard at `/_admin/` - a single self-contained page
embedded in the binary. It talks only to the same-origin API and loads **no external resources**:
no CDN, no fonts, no analytics. Live activity streams over server-sent events from
`/_admin/events`.

Access follows the exposure rule:

- **On localhost** the page is open.
- **Off localhost** it requires `NUTHATCH_ADMIN_TOKEN` to be set *and* each request to present it
  as `?token=…` - otherwise the routes self-disable with a log line. The comparison is
  constant-time, so the token can't be recovered through a timing side-channel.
- `--no-admin` removes the routes entirely, for hosted deployments fronting their own dashboard.

With [many nests in one runtime](/docs/operate/many-nests/), each mount's UI lives under its prefix: `/<alias>/_admin/`.
