---
title: Runtimes & cursors
description: One runtime, many nests, across one or more chains, with one isolated cursor per chain.
order: 2
---

A **runtime** is one process hosting one nest or many. A **cursor** is a single chain's follow
position - the thing that reads the tip, tracks finality, and handles reorgs. The relationship between
them is the whole story.

In 2.0 the runtime also owns **tenancy**: a mount is `(tenant, nest identity)`, two tenants mounting
the same nest share one dataset, and a single-tenant runtime is simply `N=1` with a default tenant
nobody has to type. There used to be a separate *runtime* concept wrapping all this; it was retired, and
the runtime absorbed it.

## The single-cursor law

A **cursor is single-chain, single-writer, one observable failure boundary.** One cursor tracks exactly
one chain's canonical history - never two. Chains reorg, finalize, and advance on independent clocks, so
sharing a cursor between two of them is incoherent, not merely inadvisable. This law is
non-negotiable: nuthatch never multiplexes two chains behind one cursor.

## One chain, many nests

Nests on the **same chain** co-located in one runtime share **one cursor**: a single `getLogs` per window,
fanned out to the owning nests. So N nests cost roughly one nest's worth of RPC chatter - the density
win. Per-nest tables stay byte-identical to running each nest solo, because the same per-window code
runs either way.

Isolation is by construction: each nest keeps its own directory (`nests/<name>/` - its own hot store,
segments, and views), so one nest's bad view or runaway factory can't touch another's data.

## Many chains, one runtime

A runtime can also span **multiple chains** - one Base nest and one Arbitrum nest in a single process - by
running **one isolated cursor per distinct chain**. Each cursor has its own RPC source, tip-follow loop,
finality view, reorg boundary, and hot-store partition. A reorg on one chain touches only that chain's
cursor; another chain's data is left byte-identical.

```toml
# mounts.toml - multichain form: declare each chain's RPC, nests carry their own chain.
[runtime]
name = "my-runtime"
nests = ["base-pool", "arb-pool"]

[[chains]]
chain = "base"
chain_id = 8453
rpc_urls = ["https://base-rpc"]

[[chains]]
chain = "arbitrum-one"
chain_id = 42161
rpc_urls = ["https://arb-rpc"]
```

> **A capability, not a mandate.** One-chain-per-runtime stays fully valid and is the simplest default.
> Multichain is there for operators who want the density; the runtime enables the option, it never forces
> co-location.

## The footprint budget

The footprint budget is **per active-chain cursor: ≤2 GB RAM**. A single-chain runtime is one cursor
(≤2 GB); a multichain runtime's total is the sum of its cursors. Each chain's cursor is held to the budget
independently - a cursor whose *projected* footprint would exceed it is refused before it starts. Density
is RAM-bounded, not free.

## Failure boundaries

Each cursor is one observable failure boundary. One chain stalling or reorging cannot harm another
chain's nests; the runtime fate-shares its serving with *every* cursor, so a dead cursor fails the whole
runtime loudly rather than serving stale data as if healthy.

## Next

- [Run a runtime](/docs/operate/many-nests/) - the operational guide
- [Reorgs &amp; finality](/docs/concepts/reorgs/) - how a cursor handles a reorg
- [Storage &amp; sealing](/docs/concepts/storage/) - what a cursor writes
