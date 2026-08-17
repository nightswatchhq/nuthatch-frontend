---
title: "4. Storage and sealing"
description: "Why recent data is mutable, historical data is sealed, and readers see one SQL surface."
order: 5
---

Chain data has an awkward temporal property. The newest blocks must remain reversible because a
reorganisation may replace them. Old blocks ought to be cheap to retain and scan for years. Trying
to satisfy both needs with one storage shape usually produces a database that is rather busy doing
neither particularly well.

Nuthatch separates the two deliberately. The hot store holds the near-tip, reversible working set.
Finalised history is sealed into immutable Parquet segments. The query layer joins the two so a
reader asks one question without having to know whether the answer happened ten minutes or ten
months ago.

## Hot data is for change

The hot store receives decoded rows while the cursor backfills and follows the tip. It supports the
operations a live index needs: inserting new event rows, recording checkpoints, rolling back a
reorganisation and deleting a range that belonged to the discarded branch. It is per dataset,
which gives a nest a clear write boundary and prevents an error in one package from rewriting
another package's working set.

The hot store is not a second-class cache. Before a block has crossed the finality boundary, it is
the authoritative record of what the cursor currently believes the chain says. Its mutability is a
feature. Treating tip data as immutable merely moves the eventual correction into an application
bug, where it is more expensive and less visible.

## Sealing is a commitment

When rows are final enough, Nuthatch writes them to Parquet segments and records them in a seal
manifest. A segment is immutable content with a bounded block range, table identity and hash. The
manifest describes the set of segments that make up the sealed historical view and is itself part of
the evidence an operator can inspect.

The operation is not “move some old rows to a different folder and hope for the best”. The system
writes staged output, verifies it and only then makes the new sealed state visible. If a process
dies at an inconvenient moment, the previous committed manifest remains coherent. Recovery may be
boring, which is the highest compliment available to storage machinery.

Because segments are immutable, they can be shared safely where their data identity matches. This
does not mean every nest shares every table. It means the runtime can avoid retaining identical
sealed history twice while preserving each dataset's package and query surface. The distinction
becomes important during upgrades.

## One query surface

DuckDB reads sealed Parquet efficiently and can also query the current hot rows. Nuthatch builds a
read-only SQL surface over the union. A query for a block range that straddles the finality boundary
does not require the caller to issue two requests or reconcile duplicate rows. The storage boundary
is an implementation detail, albeit one worth understanding when diagnosing performance.

There are guards around this freedom. Queries have concurrency, time, row and unsealed-row bounds.
Those guards protect the node from an enthusiastic analytical query becoming a denial-of-service
tool. They do not provide customer identity, quotas or billing. Those belong at the gateway, where
there is actually an authenticated caller to reason about.

## The full life of an event

Take one `Transfer` log. The cursor sees it in a block, selects the ABI decoder and writes a row
with its chain coordinates into the hot store. A reader can now query it, knowing it remains inside
the reorg window. After finality, the sealer writes the row into a Parquet segment, commits the
updated manifest and removes the corresponding hot copy. The SQL view continues to return it,
because it reads hot plus sealed history as one logical table.

The row changes physical home exactly once under normal operation. Its meaning does not change at
all. That is the point of keeping decoding separate from storage and of treating finality as a
first-class boundary.

For operational details, see [storage and sealing](/docs/concepts/storage/) and
[reorgs and finality](/docs/concepts/reorgs/). We can now turn to the thing readers actually use:
the index's query surface.
