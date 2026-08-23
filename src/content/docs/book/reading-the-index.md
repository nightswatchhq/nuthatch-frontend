---
title: "5. Reading the index"
description: "Raw tables, authored views, HTTP and SQL, with no invented claim of universal subgraph parity."
order: 6
---

An index is useful only when somebody can ask it a question. Nuthatch exposes decoded event data as
tables and makes that data available through read-only HTTP and SQL surfaces. The system is
intentionally more ordinary than a bespoke query language. SQL is well understood, inspectable and
capable of expressing both a simple point lookup and a careful event-derived calculation.

## Start from the raw event

Every selected event has a table, including an event which the contract has not emitted yet. In
that case the table is present and empty, rather than appearing only on the day the first log
arrives. The table contains decoded event fields and chain coordinates: block number, transaction
hash, log index, emitting address and related identity information. These columns let a consumer
order simultaneous events, trace a result back to a transaction and decide how to display the
distance from finality.

Raw tables are the audit trail. They may not be the API a product wants to hand to a browser, and
that is quite all right. They are the stable base upon which a product-specific interface can be
built. When a view looks suspicious, the raw log-derived rows provide the way to check it.

## Views give event data a useful shape

An authored SQL view is part of the nest package. It can rename columns, select a narrow consumer
surface, join related event tables and derive incremental-looking answers from the event history.
For example, an ERC-20 total supply can be calculated from mints and burns, and a latest Uniswap V2
reserve can be selected from the latest `Sync` event per pair. These are not opaque mapping code.
They are reviewable SQL over a known, pinned input.

This is a strong capability, but it has limits. A view is only as sound as the event model beneath
it. A historical event stream cannot reproduce a state variable that was changed without an event,
or content that a subgraph fetched from IPFS. An `eth_call` at a particular block may be necessary
for some questions.

Where such a read is necessary, it is **declared** rather than performed quietly: a `[[calls]]` or
`[[ipfs]]` block in the nest's configuration, pinned to a block or checked against a content address,
and stored in a table of its own that a reader can see and interrogate like any other. The
distinction this section is drawing survives intact. Nuthatch makes the event-derived part
dependable, and it does not perform other forms of data acquisition behind the reader's back - it
performs them in front of the reader, or not at all.

## Serving safely

The SQL endpoint is read-only and bounded. It has a concurrency semaphore, a request timeout, a
row cap and an upper limit on the unsealed rows a scan may include. A public deployment should use
named queries or an allowlist when it does not intend to offer general SQL. The runtime enforces
these local resource bounds, while a gateway in front supplies authentication, rate limits and
tenant policy.

The HTTP API offers conventional endpoints for discovery and tables as well as `/sql`. Admin routes
are a distinct surface and may mutate runtime state, such as mounting or unmounting a dataset. It
is important not to describe the whole server as “read-only” merely because its data API is. The
administrator can make changes, so the administrative listener needs the corresponding protection.

MCP and semantic descriptions provide more guided access for agents and tools. They are not a
second data model. They describe and query the same underlying tables and views.

## A good consumer contract

For a dashboard or service, define a small query contract: the rows, ordering, finality behaviour
and error policy it actually needs. Put the contract in an authored view or named query. Test it at
a fixed watermark. Then an application can switch from a degraded primary endpoint to the nest
without improvising SQL during the incident, which is a period when even ordinary punctuation can
become a tactical challenge.

The [SQL reference](/docs/reference/sql/), [HTTP API](/docs/reference/http-api/) and
[authored views guide](/docs/build/views/) provide the exact surfaces. The next chapter explains
how this data can be retained and reused even as its surrounding nest package evolves.
