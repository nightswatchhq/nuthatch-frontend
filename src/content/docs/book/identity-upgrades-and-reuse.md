---
title: "6. Identity, upgrades and reuse"
description: "How immutable nest versions coexist with data that need not be indexed twice."
order: 7
---

Software versioning is often an agreement among humans: this release is called 2.5.0, and these
are the changes we say it contains. That remains valuable, but it is not sufficient for deciding
whether two indexer packages decode the same data. Nuthatch uses content identity for that question.

The nest identity, or NID, is the SHA-256 hash of the canonical authored manifest. Change a
contract selection, pinned ABI, event configuration or authored view, and the NID changes. The
runtime stores data by that identity under `data/<nid>/`; a mount maps an operator-facing alias and
tenant to it. An alias may change without changing data. Two tenants may mount the same NID without
starting two indexers. The name is for people. The NID is for evidence.

## Package identity is not data identity

The useful subtlety is that two different nest packages can produce exactly the same decoded data.
Perhaps the only change is a view, a semantic description, a comment-like metadata field or some
other authored input that does not affect event selection or decoding. The package has honestly
changed, so it must have a new NID. But forcing a complete backfill merely because a view changed
would be an expensive ceremony with no new information in it.

Nuthatch calculates a data identity from the inputs that actually determine decoded event rows. On
migration or staged upgrade, it can compare this identity with existing datasets. If the data
identity matches, it adopts the existing data into the new identity instead of indexing the chain
again. The adoption is a staged, verified filesystem operation. The existing source remains; the
new dataset gains the necessary package material and references the reusable sealed history.

This is not a claim that every update is free. If an ABI, event selection, contract range or decode
rule changes, the decoded dataset may differ. That is a real data change. The runtime classifies
the difference and requires an operator to acknowledge breaking changes rather than presenting an
old table with a new label and hoping no one notices.

### The guarantee has to hold on the ordinary path too

That last sentence describes an intention, and for a while it was only true where somebody had gone
looking for it. A **packaged** nest records its expected registry hash, and mounting one regenerates
the registry and verifies it. A nest run the ordinary way, from a directory on your own machine, did
not compare anything.

So adding an event to a running nest's configuration and restarting produced this: the process
started, observed it was already at the chain tip, indexed nothing, and served - stamping the **new**
registry hash onto rows the **old** configuration had produced. Every query then reported provenance
under a decode registry that had never run. The only visible symptom was an unrelated view failing to
load, and only because that view happened to reference one of the new tables; a change touching
tables no view mentioned said nothing at all.

It is worth being precise about why that is worse than missing rows. A content address is a claim
about *what produced this data*. A wrong one is not an inconvenience, it is a lie in the one field
whose entire job is to be checkable. And it was a lie the system told about itself, in the direction
that looks healthy.

A nest now compares the registry recorded in its store against the registry its configuration
produces, and refuses to start when they differ, naming both hashes and the remedy. A store written
before the check existed has no recorded hash; refusing those would break every running deployment
for a fault it may not have, so it adopts the hash and logs that it was **recorded rather than
verified** - which is a different claim, and says so.

## Reuse at two levels

There are two distinct wins:

1. Exact package equality: two mounts with the same NID share one dataset immediately. This is what
   happens when two tenants mount the same nest.
2. Data equality across package versions: distinct NIDs can adopt data that has the same data
   identity. The packages remain distinct, but the indexer avoids useless re-ingestion.

Sealed segments are immutable content, so they are the natural part of history to share. The hot
store remains dataset-local because it must participate in live writes and reversible reorg
handling. This keeps a new package from accidentally inheriting a mutable working store it does not
fully understand.

## Grafting, honestly

“Grafting” is sometimes used loosely to mean any form of reuse. In the current runtime, adoption is
whole-dataset reuse where data identity proves compatibility. Views are query-time definitions,
not independently materialised histories that can each be grafted in a different way. There is no
promise today that a changed view receives a special partial backfill or that arbitrary schemas can
be spliced together. Those might be useful future capabilities, but a book should say what the
machine does now.

The `nuthatch migrate` command plans the move, can dry-run it, and refuses named breaking changes
unless the operator explicitly permits them. It is designed to be idempotent. A migration that
discovers it needs to re-index data has failed its central job.

The detailed, operational companion is [nest identity and reuse](/docs/concepts/nest-identity/)
and [upgrading a nest](/docs/operate/upgrades/). Once packages and datasets have these clean
boundaries, a single process can host many of them without becoming a muddle of names.
