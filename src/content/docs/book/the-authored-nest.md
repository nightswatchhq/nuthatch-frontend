---
title: "2. The authored nest"
description: "Contracts, ABIs, event choices and views become a portable, reproducible unit."
order: 3
---

Before Nuthatch indexes a single block, somebody must make several decisions: which chain matters,
which contracts matter, which ABI is authoritative, which event signatures should be decoded, and
which derived reads readers may need. These choices are the nest. The database files, generated
schema and decoded rows are consequences of that description, not the nest's essence.

That distinction is easy to wave away until an ABI changes, a directory is copied, or a deployment
must be reproduced on another machine. Then the authoring inputs are precisely the thing you need
to preserve.

## The authored inputs

A normal nest directory contains `nuthatch.toml`, vendored files under `abis/`, and optionally SQL
views, semantic descriptions and checks. The TOML names contracts and their start blocks. The ABI
pins the event layout used to decode their logs. A view may turn raw rows into a consumer-shaped
read without modifying the underlying historical facts.

The ABI is deliberately vendored. An explorer API is useful when scaffolding a nest, but it is not
an adequate long-term dependency for its definition. An explorer can change, a proxy can mislead,
and a fetched ABI may not be the ABI that was intended at the time. Keeping the source artefact in
the nest makes review and reproduction possible.

From those files Nuthatch generates a decode registry and a schema. The registry maps the address
and event signature it receives from a log to the columns it will write. The generated artefacts
are checked rather than treated as private magic. If the same authored inputs do not recreate the
expected registry, the machine should stop and say so. A stale decoder producing plausible rows is
not a success condition.

## Events first, then views

The raw event table is the durable base layer. It records chain coordinates such as block number,
transaction hash and log index alongside decoded event fields. Those coordinates are not clutter.
They establish order, support audit, and give a reader a route back to the originating chain fact.

Views sit above this base layer. They are ordinary SQL declarations authored with the nest. A view
can make transfers friendly to query, calculate a balance from the ordered transfer stream, or
present a protocol-specific activity table. Because it is a view rather than rewritten history, a
consumer can inspect the derivation and the raw events remain available when the definition needs
to change.

This is an important division of labour. A decoder answers “what did this log say according to this
pinned ABI?” A view answers “what result do we want from those rows?” Conflating the two makes
schema upgrades unnecessarily dangerous.

## Content identity

Nuthatch packages authored inputs into a canonical manifest and hashes that manifest with SHA-256.
The resulting nest identity, or NID, identifies what was authored, not which directory happens to
contain it and not who mounted it. Two copies of the same inputs have the same identity. A one-byte
change in an ABI, configuration or view creates a new identity.

That is deliberately strict. The hash is not a version label chosen at a meeting. It is a statement
that this exact package is what the runtime verified. Human names and versions remain useful for
navigation, but the NID is the thing a machine can use to decide whether two claimed nests are
identical.

Identity does not mean every NID requires a fresh backfill. Sometimes the package has changed in a
way that leaves its event data byte-identical. How Nuthatch recognises and safely adopts that data
is a later chapter. For now the point is simpler: the system begins by making the definition of a
nest small, explicit and reproducible.

For the exact file layout and configuration, see [authoring modes](/docs/concepts/authoring/) and
[the configuration reference](/docs/reference/config/). Next, the nest meets the chain.
