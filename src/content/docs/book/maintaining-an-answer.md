---
title: "6. Maintaining an answer"
description: "Why v3 adds authored incremental entities without pretending that every SQL view is one."
order: 7
---

An indexer has two chances to pay for a calculation. It can wait until somebody asks, scan the facts
then, and return the result as a view. Or it can do a little work for each arriving block, retain a
bounded answer, and make the later read cheap. Neither is universally better. The first is flexible;
the second is useful precisely because it is constrained.

Nuthatch 3.0 makes that choice available to a nest author through an **authored incremental entity**.
It is the first release in which the author, rather than only the built-in balance circuits, can say
that a relation should be maintained during indexing.

## Two kinds of authored SQL

An ordinary `views/*.sql` file contains `CREATE VIEW`. It runs on the hot and sealed query surface when
a reader asks for it. It can use the broad read-only SQL surface. It has no permanent state and does
not affect ingest. This is the sensible default.

An entity has one `SELECT` in `entities/` and a declaration in `entities.toml`. That declaration gives
the result a key and a maximum row count. Nuthatch compiles the admitted subset to an incremental
circuit and feeds it facts as they arrive. The relation can be queried through SQL or read by key.

The distinction stops a pleasing but false sales pitch. Naming a view does not make it incremental.
An entity does, but it gains that property by accepting resource limits and less SQL, not by attaching
an adjective to a DuckDB query.

## Why the restriction earns its keep

Incremental maintenance must be able to add a block and retract a block without rescanning all earlier
ones. Projection, filtering, exact arithmetic, grouping, supported aggregates and inner equijoins have
that shape. `ORDER BY`, `LIMIT`, window functions, outer joins, `DISTINCT`, percentiles and recursive
queries do not belong in the first safe subset. They remain valid questions for views.

The row bound is equally important. A maintained answer is state retained at the cursor, alongside
the chain's hot data. `max_rows` participates in admission rather than being a hopeful comment. If a
relation would grow past it, the entity faults and the nest is quarantined. An answer that has stopped
being maintained must not continue to be served as current.

## The lifecycle is still one circuit

During backfill, tip following and a reorganisation, the same relation receives facts. A reorg feeds
the removed facts with negative weight, so no bespoke author rollback can drift from the forward path.
After a restart, the relation is seeded from sealed segments and the hot tail already held locally. No
historical RPC replay is involved.

This is observable. Each entity has applied-through, current, row-count, faulted, unavailable and
seconds-since-progress metrics. The reader's provenance and the operator's metrics answer the same
question from opposite ends: is this result current, and if not, why are we still looking at it?

There is one deliberately blunt 3.0 limitation. `--seal-direct` bypasses the ingest route used to
maintain entities, so it is refused for a nest declaring one. It is better to reject an unsupported
fast path than to finish a backfill with an elegant, empty answer.

The practical authoring details are in the [entities guide](/docs/build/entities/). The next chapter
returns to identity, where changing an entity definition has different consequences from changing the
facts beneath it.
