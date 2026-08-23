---
title: "Appendix A. One log, end to end"
description: "A close reading of the path from an RPC log to a row that survives sealing and can be queried."
order: 10
---

The architecture becomes less mysterious when reduced to one ordinary event. Suppose an ERC-20
contract emits a `Transfer` log in block 19,000,100. The transaction succeeded, the receipt holds
the log, and the chain's RPC can return it through `eth_getLogs`. What must happen before a reader
can safely ask Nuthatch for that transfer?

The short answer is fetch, route, decode, order, persist, then eventually seal. The longer answer
is worth knowing because each verb protects a different invariant.

## 1. Fetch only a defined universe

The cursor has a registry built from the authored package. It knows the contract addresses and the
event topic hashes that it is prepared to decode. For a solo nest it asks the source for logs inside
a bounded block window. In a runtime with several mounts on the same chain, the cursor asks once
for the union of those filters and routes a returned log to every live nest whose registry matches.

The RPC response is not yet application data. It is untrusted transport input. It may arrive out of
order, it may include logs useful to another mounted nest, and an endpoint may reject a window or
return a response too large for its local limits. The cursor's retry, window-sizing and concurrency
policy exist here. They deal with the ordinary weather of RPC infrastructure before a row reaches
durable storage.

An empty result still matters. The cursor must advance over a block range with no selected events,
otherwise it would return to the same quiet range forever. Progress is about blocks successfully
accounted for, not merely rows received.

## 2. Route and decode with a pinned registry

For the transfer log, the registry looks at the emitting address and topic zero, identifies the
`Transfer(address,address,uint256)` decoder from the vendored ABI, and decodes indexed and data
fields into a typed row. It also supplies the implicit chain columns: block number, transaction
hash, transaction index, log index, address and, where configured, the block timestamp.

No schema inference happens at this point. The table layout was generated from the nest's inputs.
An unknown event is not invited to become a new column because it happened to look interesting.
Likewise, a malformed log does not earn a creative interpretation. The point of a pinned registry
is that the mapping from byte sequence to row is reviewable and repeatable.

Factories add one wrinkle. A factory event can discover child contracts which should be indexed
thereafter. During backfill, Nuthatch performs discovery before the authoritative decode for the
window so a child discovered in the window is already known when its own logs are decoded. The
final row path remains the same. Discovery is not allowed to become a second, differently behaving
decoder.

## 3. Establish a canonical local order

Providers are not entitled to return equivalent log sets in the same order. Nuthatch therefore
sorts decoded rows by chain coordinates before writing or sealing. The salient ordering is block,
transaction and log index. This is not cosmetic. A view calculating a balance, a factory registry
or a content-addressed segment must behave the same when two RPC endpoints return the same chain
facts in different sequence.

This is also why concurrent backfill needs care. Fetches may happen in parallel, but their results
must enter the sealing path in deterministic block order. Otherwise speed has changed the bytes of
historical storage, and a supposedly content-addressed result has become dependent on timing. That
would be a rather expensive way of saving a few seconds.

## 4. Commit to the hot store

For an unfinalised block, the sorted row is written to the dataset's hot store alongside the cursor
checkpoint. The write establishes two things together: the transfer is visible to live reads, and
the cursor now has evidence of which chain block it believes it processed. A later reorg check
compares that evidence with the chain's current answer.

Derived views and incremental state receive the same event in this phase. Their update is part of
the reversible hot path. If the log later belongs to a discarded branch, the rollback replays its
effect with the opposite weight or rebuilds the affected hot state. A derived answer is therefore
not permitted to outlive the raw event it depends upon.

## 5. Seal after finality

Once block 19,000,100 crosses the finality watermark, Nuthatch serialises its rows into a
content-addressed Parquet segment. The segment is staged and verified; the seal manifest is updated
only when the output is ready to become the committed sealed history. The matching hot rows can then
be pruned. The event is no longer subject to ordinary reorg rollback.

`--seal-direct` uses the same sealed representation for old, already-final history, bypassing the
hot store during an initial bulk backfill. It still resolves every declared `[[calls]]` input at its
pinned block before it commits the segment. It is an optimisation with an important precondition:
the range must be past finality. It does not use a fast path to omit declared inputs or declare
recent, reversible blocks permanent.

## 6. Answer a query with provenance

When a reader asks for the transfer or runs SQL over its table, the serving layer reads sealed
segments and the hot tail as one logical surface. The response carries watermarks and source
information so a caller can tell how current the answer is and whether the hot contribution was
available. A hot-store failure must not quietly make a query look complete while returning only
sealed history.

That final detail is representative of the design. A Nuthatch answer is useful not only because it
contains a number, but because it can say which package decoded it, how far the cursor had reached
and what portion of history was sealed when the answer was formed.
