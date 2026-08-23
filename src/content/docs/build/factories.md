---
title: Factories
description: Index children a contract spawns at runtime - Uniswap pools, Safe proxies, any factory.
order: 5
---

Many protocols deploy contracts at runtime: Uniswap's factory spins up a pool per pair, a Safe factory
deploys a proxy per wallet. You can't list those addresses at `init` - they don't exist yet. A
**factory** tells nuthatch to discover them as they're created and index each child automatically.

## The shape

A factory is a **template** (the child's ABI + events) plus a **factory** rule (which event on the
parent announces a new child, and which field holds its address):

```toml
[[templates]]
name = "pool"
abi = "abis/uniswap-v3-pool.json"
# filter = "topic0"        # optional backfill-strategy override for templates with very many children
# events = ["Swap"]        # optional: which of the ABI's events to decode (default: all of them)

[[factories]]
# When `factory` emits PoolCreated, the child in the `pool` param is indexed as a `pool`.
watch = "factory"          # the ALIAS of a [[contracts]] entry (or another template, for nesting)
event = "PoolCreated"
child_param = "pool"       # the event param holding the new child's address
template = "pool"          # which [[templates]] to apply to the child
# start = 12369621         # optional: only honour discoveries at or after this block
```

When the parent emits `PoolCreated`, nuthatch registers the address in that event's `pool` param as a new
`pool` child and decodes its events - every event the template's ABI defines - from discovery onward.

## One table, many children

All children of a template share one set of tables - `pool__swap`, `pool__mint`, `pool__burn` - no matter
how many pools exist. The [implicit `address` column](/docs/build/tables/) tells you which child each row
came from:

```sql
SELECT address AS pool, COUNT(*) AS swaps
FROM pool__swap
GROUP BY 1 ORDER BY swaps DESC;
```

## Discovery is deterministic

Child discovery is part of the deterministic decode path: the same blocks always discover the same
children in the same order, keyed off the parent's events. A reorg that un-emits a `PoolCreated` retracts
that child and its rows along with everything else - factories inherit the same reorg safety as any table
(see [Reorgs](/docs/concepts/reorgs/)).

During a direct backfill, the fetch which reads logs from children discovered in the current chunk
uses the same adaptive narrowing as the ordinary contract fetch. A provider response cap therefore
shrinks the window and retries; it does not abort the factory backfill. This was made consistent in
2.7.0 after a mainnet Uniswap V2 run found the one uncaught path in the field.

## Runaway factories are bounded

A factory that discovers a vast number of children is exactly the kind of thing that could blow the
[≤2 GB per-cursor budget](/docs/concepts/runtimes/). Discovery is bounded and observable per nest, and in a
[runtime](/docs/operate/many-nests/) its tables and failure state remain isolated. Same-chain nests do
share a cursor, however, so a runaway factory is still a capacity concern for that cursor. The bound
is there to turn that into an observable admission or quarantine decision rather than allowing one
nest to consume the machine by optimism.

## Next

- [ABIs, events &amp; tables](/docs/build/tables/) - the `address` column that distinguishes children
- [Reorgs](/docs/concepts/reorgs/) - how discovered children roll back
- [Recipes](/docs/build/recipes/) - e.g. `reserves` across all discovered pools
