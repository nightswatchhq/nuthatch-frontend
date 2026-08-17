---
title: "3. The cursor"
description: "How Nuthatch backfills, follows the tip and handles a chain that can briefly disagree with itself."
order: 4
---

An indexer has two jobs which look similar from a distance and behave very differently in practice.
It must collect old history, often millions of blocks, and it must then follow a live chain whose
latest blocks are not yet final. Nuthatch calls the durable position that coordinates this work a
cursor.

There is one cursor per chain in a runtime. Not per HTTP route, not per tenant and not per nest.
That is a useful constraint, not a missing feature. One chain has one ordered tip, one finality
boundary and one reorganisation story. Giving every nest an independent opinion about those things
would multiply RPC work and make recovery needlessly inconsistent.

## Backfill is a controlled walk through history

For a newly mounted nest, Nuthatch begins at each contract's declared deployment block and asks the
RPC for logs in bounded windows. Providers impose limits on ranges, result counts and concurrency,
so the process does not assume that a heroic `getLogs` call will be welcome. It splits work into
windows, retries within its policy and records progress only after the rows have been accepted by
the hot store.

The details matter because RPCs are prone to giving an answer that is technically valid and
operationally useless. A provider may time out, cap a response, or make a 10,000-block request feel
like a personal insult. Nuthatch's window and concurrency controls let an operator fit the walk to
the provider. Faster is useful, but only if every accepted block remains attributable and repeatable.

Backfill catches a nest up to the present. It does not establish that the present is permanent.

## The tip is provisional

At the chain tip, a block can be replaced by a competing block. This is a reorganisation. A reader
who saw an event in the first branch must not be left with that event after the chain selects the
other branch. Nuthatch therefore keeps unfinalised data in its hot store, with enough block-hash
checkpoints to notice when the chain no longer agrees with the path it had followed.

When a mismatch is detected, the cursor finds the fork point and each affected hot store rolls back
to that point. It then indexes forward along the winning branch. The invariant is not “we never
briefly served a provisional result”. No honest near-tip system can promise that. The invariant is
“provisional rows are marked by their place in a reversible part of the pipeline, and the store
converges to the canonical chain.”

Finality is what ends that reversible period. Once a block sits sufficiently behind the head under
the configured chain policy, Nuthatch can seal it. Sealed history is no longer subject to ordinary
tip rollback and becomes the cold, durable half of the query surface.

## One chain, one source of ordering

In a multi-nest runtime the cursor obtains the union of needed logs and routes them to the nests
that own their address and event signature. A log may be relevant to more than one nest, in which
case each gets its own decoded rows. Fetching is shared; the nests' datasets are not silently
merged. This distinction keeps ownership and rollback manageable while avoiding N copies of the
same RPC polling.

Different chains need different cursors. They have different heads, different finality rules and
different failure domains. A runtime can host them, but it does not pretend that Arbitrum and
Ethereum form one sequence merely because they have both inconvenienced the same operator.

The cursor is the reason an index can say where it is. The next chapter is about where the data sits
once it has passed through that cursor, and why it lives in two forms.
