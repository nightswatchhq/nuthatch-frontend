---
title: "Why a Nuthatch nest has two identities"
date: "2026-08-17"
description: "A Nuthatch nest is an immutable package, but an edit should not automatically mean a full re-index. Here is how NIDs, data identity, adoption, and shared segments fit together."
author: "cargopete"
tags: ["nuthatch", "architecture", "content-addressing", "data-reuse", "indexing", "the-graph"]
---

*A content-addressed package should be immutable. That does not mean a documentation edit ought to fetch the whole chain again.*

Nuthatch nests are content-addressed. That is the right default for something that declares how
on-chain data is decoded and exposed: a deployment can name exactly the contracts, ABIs, event
selection, views, and schema it was built from. Change the authored package, and it is a different
package.

There is an obvious operational cost, though. If every changed byte made a nest forget its existing
history, editing a view comment would mean a complete re-index. Correctness has won, but rather
expensively.

The design is two identities, each answering a different question:

```text
authored nest package ──hashes to──> NID ──mount points to──> data/<nid>/
                                      │
                                      └── data identity decides whether an
                                          existing dataset may be adopted
```

The NID is deliberately strict. The data identity is deliberately narrower. Neither is an
approximation of the other.

## The NID: an immutable package identity

A nest's manifest records every authored input, with a SHA-256 for each file, in a canonical order.
Its NID is a domain-separated SHA-256 over that canonical manifest. The package includes the
configuration, pinned ABIs, SQL views, schema, semantic material, documentation, and the rest of
the authored surface. It does **not** include indexed data or generated build artefacts.

Consequently, every authored edit produces a new NID. A new ABI, a changed event selection, a new
view, or a README correction all make a distinct package. This is not a version label that can be
silently retargeted. An operator can always say which package a dataset belongs to.

One detail matters for upgrades. The NID neutralises the Nuthatch binary's own generator version.
Otherwise, a binary upgrade would give every nest a new identity and orphan every dataset even when
the generated decoder was identical. The decoder registry hash remains part of the manifest, and is
regenerated and verified on load. A binary which actually changes decoding therefore still changes
the NID, as it should.

## Mounts turn package identity into a running service

The runtime's `mounts.toml` maps a `(tenant, alias)` to an NID. The dataset is stored under
`data/<nid>/`; it does not know its friendly name or the tenant that mounted it.

That gives a useful property without introducing a hosted multi-tenant service. Two aliases, or two
tenants, mounting the same NID share one dataset, one backfill, and one contribution to the cursor.
Removing one mount does not remove the data while another still refers to it. The tenant is an opaque
ownership label. Authentication, quotas, billing, and rate limiting remain the gateway's job.

A runtime can host nests across several chains, but each chain has its own cursor, finality view,
reorg boundary, and writer. There is no cross-chain multiplexing concealed behind a cheerful config
file. That way lies weather.

## The data identity: can this package use existing history?

The NID answers, "is this exactly the same package?" It is intentionally too broad to answer,
"would this package store the same bytes?"

For that, Nuthatch computes a separate data identity. It includes the decode registry and every
authored input that can affect stored data. It excludes only inputs which the indexing path cannot
read: views, `queries.toml`, `semantic.toml`, documentation, and scaffolded agent material.

The safety rule is simple:

- A new NID never replaces an old one.
- An existing dataset is adoptable only when its data identity **and** its decoder registry hash both match the incoming nest.
- The source must contain readable indexed history.
- An ambiguous or failed match falls back to an ordinary backfill.

This errs on the useful side of conservative. A false negative costs time and RPC requests. A false
positive serves somebody else's history as though it were yours, which is not a feature.

When an incoming nest is adoptable, Nuthatch copies the old derived state into the new
`data/<nid>/` directory using a staging directory and an atomic rename. It then overlays the incoming
package's own authored files. The old dataset is never moved, since it may still be mounted by
another tenant or still be the version an operator is serving. If the copy fails, the destination is
left input-only and can safely try again next time.

This is what makes a view-only, query-allowlist, semantic, or documentation change cheap. The NID
moves because the package genuinely changed. The stored history is adopted because its inputs did
not.

## Reuse means two different things

There are two reuse mechanisms, and they are worth keeping separate.

### Whole-dataset adoption

At mount or migration time, the runtime looks across existing datasets for one whose data identity
and decoder registry match the incoming nest. This is not confined to a package's direct predecessor:
another nest in the runtime can supply the history if it meets the same exact test.

It is not semantic query matching. Nuthatch does not see two similar entity names and make an
optimistic guess. It reuses a whole dataset only when the authored data-producing inputs prove that
the stored data is the same.

### Shared sealed segments

Finalised history is stored as immutable, content-addressed Parquet segments. In a multi-nest
runtime, they live in a shared `segments/<content-hash>.parquet` store. A dataset manifest references
the segment hash; it does not need to own another copy of the bytes.

Two nests that independently produce byte-identical segments therefore use one file on disk. This
is more granular than dataset adoption and is also simpler: the segment hash is the proof. No SQL
equivalence engine, no entity-name comparison, and no hopeful interpretation of what a query might
mean.

The mutable hot store remains per dataset. It is affected by reorgs and has a writer, so sharing it
would be an impressive way to turn one nest's trouble into everyone else's. Sealed Parquet is
immutable, so it is the proper sharing boundary.

## Updating a nest

The normal runtime update is staged and inspected first:

```sh
nuthatch migrate --dir <runtime> --dry-run
nuthatch migrate --dir <runtime>
```

The plan tells the operator whether it will keep an existing identity, merge duplicate mounts, adopt
an existing dataset, or create a new one and index it. A new schema is also compared against the
currently served schema.

An additive table or column is compatible. Removing or renaming a table or column, or changing a
column's type, is breaking. The migration refuses a breaking change by default and names the affected
surface. The operator can explicitly accept it with `--allow-breaking`, or mount the successor under
another alias and move consumers on their own schedule.

That compatibility check is intentionally a schema-surface check. It cannot prove that an arbitrary
change to a view preserves the meaning of its results while retaining the same columns. We treat
that as an operator and review concern rather than pretending a schema diff has solved program
equivalence. There are already enough haunted shortcuts in this line of work.

## What grafting is today, and what it is not yet

The word "grafting" can suggest a sophisticated per-view cache. That is the long-term direction,
but it would be misleading to claim it is already the current cost centre.

Authored SQL views are presently defined at query time over the hot store and sealed segments. They
are not materialised. Editing one has never required recomputing stored view data, because no such
data exists. The historical problem was that the edit changed the package NID, and the old
identity-keyed layout would consequently re-fetch the raw chain data.

Whole-dataset adoption fixes that current problem. Per-derivation DAG reuse, where a changed stored
derivation causes only its dependent derivations to recompute, remains deferred until Nuthatch has
materialised derivations to reuse. It is better to state that boundary now than manufacture a cache
for data that does not yet exist.

## Immutable packages, practical operations

Content addressing is often presented as a purity exercise. The useful version is more mundane. It
lets an operator retain an exact, reproducible definition of every nest version, while the runtime
reuses history whenever it can prove that the bytes are unchanged.

The NID keeps versions honest. The data identity keeps harmless edits cheap. Shared immutable
segments remove duplicate cold storage. The remaining work is deliberately conservative, because a
re-index is inconvenient and a false reuse is silent.

That is the trade. It is not glamorous, but it gives an indexer a proper memory rather than a series
of increasingly confident guesses.
