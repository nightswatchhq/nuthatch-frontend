---
title: "1. The data problem"
description: "Why a Nuthatch nest exists, and the exact boundary of the data it can promise."
order: 2
---

An Ethereum node can tell you what happened in a block. It is rather less interested in helping you
answer a product question such as “which addresses delegated to this indexer last week?” That answer
requires turning a stream of logs into a durable model, keeping it current as new blocks arrive,
and making it cheap enough to ask repeatedly. This is the ordinary work of an indexer.

The usual answer is a hosted subgraph. That is often an entirely sensible answer. A schema and its
mappings turn chain activity into a GraphQL endpoint, somebody else runs the infrastructure, and
the application obtains a pleasant query surface. The awkward moment is when that endpoint is
unreachable, unserved, behind the chain, or contains a capability that cannot be reproduced from
the chain alone.

Nuthatch starts from a smaller promise. A nest describes a chosen set of contracts, pinned ABIs,
events and SQL views. It reads logs from the chain, decodes those logs deterministically, and serves
the resulting event data through SQL and HTTP. There is no allocation, indexing market or hosted
control plane between the RPC endpoint and the query. A nest is something a team can keep beside
the application that depends on it.

## The useful boundary

A transaction log is public chain history. Given the same block range, contract addresses and ABI,
two honest implementations should decode the same rows. This makes event indexing a good substrate
for a portable local index. It also makes it possible to verify the result independently rather
than taking an API's word for it.

Not all subgraph data has that property. A mapping may make `eth_call`s whose result depends on the
block, fetch IPFS content, call an external service, or maintain bespoke off-chain state. Those are
not mistakes. They are simply dependencies that lie outside the event stream. Pretending that a
log index automatically offers parity with every such mapping is the beginning of a fairly tedious
outage.

The first question in a port is therefore not “can Nuthatch replace this subgraph?” It is “which
reads are event-derived, and what does each remaining read depend on?” Many useful reads turn out
to be straightforward: transfers, swaps, delegation changes, registration records and cumulative
balances. Some current-looking values can be derived from ordered events, such as ERC-20 supply
from mints and burns. Others genuinely require a contract read or external input. Name the boundary
before promising a fallback.

## A modest but strong promise

This bounded scope gives Nuthatch several useful properties:

- The input is inspectable. A nest vendors its ABI and says which events it accepts.
- The output is repeatable. Decoding is a pure transformation of log plus authored decode rules.
- The operator owns availability. An application may query its own machine or an API it controls.
- Historical data can be sealed and retained without keeping a full node or a bespoke database
  cluster alive forever.

The machine does not know the business meaning of an event. It knows how to preserve and present it
without quietly changing its mind. The semantic layer belongs in views and application code, where
it can be reviewed as such.

## A running example

Imagine a protocol dashboard that normally asks a GraphQL subgraph for recent delegations. Its
critical screen needs the delegator, indexer, timestamp and amount. Those values originate in a
specific event. A nest can watch the protocol contracts, decode that event into a table and expose
a view with precisely those columns. The dashboard retains its normal endpoint, but gains a small
and independently operated fallback for the read it cannot afford to lose.

This is not an ideological replacement programme. It is a good operational shape: use the rich
surface you have, and keep the irreplaceable event data somewhere you control. The practical
[subgraph fallback guide](/docs/build/subgraph-fallback/) walks through that exercise.

The next question is how that small description remains trustworthy after it has left your laptop.
That is the work of the authored nest.
