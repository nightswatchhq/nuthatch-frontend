---
title: "Nuthatch 3.0: make the answer arrive with the block"
date: "2026-08-29"
description: "Nuthatch 3.0 makes authored incremental entities stable: a nest can maintain a bounded keyed relation as blocks arrive, instead of re-running one expensive aggregate for every reader."
author: "cargopete"
tags: ["nuthatch", "release", "indexing", "sql", "dbsp", "the-graph", "rust"]
---

Nuthatch 3.0 is out. The major feature is small enough to describe in one sentence and substantial
enough to justify the number: a nest can declare a keyed relation in `entities.toml`, and Nuthatch
maintains it as blocks arrive rather than recomputing it whenever somebody queries it.

That is an authored incremental entity. It shipped in `3.0.0-alpha.1`, where it was exercised on live
Arbitrum and Ethereum nests, restarted under both SIGTERM and SIGKILL, and checked hourly against a
full recomputation. `3.0.0` is the stable cut, with the faults that soaking found fixed rather than
described as character-building.

## The gap between a view and an answer

Nuthatch has long let a nest carry `views/*.sql`. They are useful: a view gives raw decoded events a
meaningful shape, travels with the nest, binds against its schema, and is ordinary readable SQL. But a
view runs when it is queried. A panel which groups a growing history is still doing that grouping for
every reader.

An entity makes that opt-in and explicit:

```toml
[[entities]]
name = "indexer_rewards"
sql = "entities/indexer_rewards.sql"
key = ["indexer"]
max_rows = 100000
```

The SQL file contains one admitted `SELECT`. Nuthatch compiles it to an incremental circuit, feeds it
the decoded facts for each block, and exposes the maintained result through `/sql` and `/derived`.
When the chain reorganises, the removed facts go back through the same circuit as retractions. There is
no author-written rollback path waiting patiently to become different from the forward path.

The restriction is intentional. Views remain the place for broad SQL. Entities support deterministic
projection, filtering, exact arithmetic, grouping, supported aggregates and inner equijoins. They do
not pretend that `ORDER BY`, window functions, `DISTINCT` or percentile calculations have trivial
incremental semantics. If a query does not fit, it is still a perfectly respectable view.

## What it enables

The important outcome is that a nest author can decide, in the package, which answer is part of the
index and which is merely an analysis over it. That decision carries a key, a maximum row count, an
observable watermark, and a failure mode. It is visible to the person reviewing the nest and to the
operator running it.

On the Lodestar Horizon nest, the `indexer_rewards` panel had been an authored view over 733 sealed
segments. The same query, measured 25 times, was 2.15 seconds p50 as a query-time view and 87.7 ms p50
as a maintained entity. Both returned the same 82 rows. Updating a relation with 309,548 groups took
285 microseconds for one block. The query did not become cleverer. It simply ceased to repeat work it
had already done.

An entity is not an opaque cache. It is a relation with an applied-through block, a declared key, and
six Prometheus signals: current, applied-through, rows, faulted, unavailable, and seconds since
progress. A caller can see whether an answer is current, while an operator can see whether it has
stopped becoming current.

## What the alpha found

The alpha found five defects which the test suite had not found because the test suite did not own a
real long-running nest. One restart kept only `groups mod 10,000` of a maintained relation. One block
update copied the whole published relation and took 72 ms, growing with history. `/explain` answered
differently on a cold and a warm pooled connection. A provider-wide 429 could be diagnosed as a
result-cap problem and take a nest down. And `/sql` could attach a newer watermark to older rows.

They are fixed in the stable release. The current behaviour narrows a throttled request all the way to
one block before admitting it cannot make progress, fails a backfill after 64 no-progress attempts,
and captures entity rows and their watermark together. The test suite has cases now. More importantly,
the release notes say what was observed and what has not yet had enough calendar time to earn a stronger
claim.

## A quiet upgrade, with one deliberate cost

For an existing nest that declares no entities, 3.0 is a binary replacement and restart. No config
migration, data migration or re-index. On production Lodestar data, all 73 tables were counted at the
same watermark before and after the swap: 2,376,135 rows in each case.

Adding an entity later does cost a seed on the next restart. Nuthatch rebuilds it from the sealed corpus
and hot tail already held locally, not from RPC. On two Horizon corpora that work was 1.9 seconds for
249,979 rows across 733 segments and 2.4 seconds for 346,288 rows across 2,985. That is modest, but it
is not zero, and treating it as zero is how maintenance windows acquire folklore.

There is also one hard refusal: `--seal-direct` cannot run for a nest declaring an entity in this
release. Direct sealing bypasses the incremental path. Completing successfully with an empty relation
would be worse than an error, so Nuthatch declines the combination.

## Verify the binary, not merely its journey

Every release artifact now has a build-provenance attestation. The checksum beside a tarball still
matters, but it proves that the bytes survived transit. It cannot establish who built them, because an
attacker able to replace the tarball can replace its sidecar with it.

```sh
gh attestation verify nuthatch-x86_64-unknown-linux-gnu.tar.gz --repo nightswatchhq/nuthatch
```

The `--repo` is not decoration. Without it, an attestation from any repository can satisfy the command.
With it, GitHub's recorded workflow identity ties the artifact to this repository, its producing commit
and workflow. The release workflow performs the same verification before publication.

The [release](https://github.com/nightswatchhq/nuthatch/releases/tag/v3.0.0) has the complete changelog.
The [entities guide](/docs/build/entities/) has the authoring and operating contract. The work now is
less about saying that Nuthatch can compute a question and more about deciding, honestly and visibly,
which questions are important enough to compute as the chain moves.
