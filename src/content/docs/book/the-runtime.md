---
title: "7. The runtime"
description: "Mounts, tenants, one cursor per chain, the nest lifecycle, and how the same model extends to scaled mode."
order: 8
---

A nest is a portable description plus its dataset. A runtime is the process that makes one or more
such datasets live. This is where Nuthatch separates the questions people often tie together by
habit: what a package is, what an operator calls it, who has mounted it, which chain is followed,
and what query surface is exposed.

The runtime reads `mounts.toml`. A mount records an alias, tenant, NID and SQL access policy. The
alias is the route a caller sees. The tenant is an opaque operator label. The NID selects the
identity-keyed dataset. Because those are separate, two tenants can mount one NID and share its
data while exposing different aliases or named-query allowlists.

This is multi-tenancy in the useful, modest sense: multiple independently named datasets in one
runtime. It is not an identity service, quota system or billing platform. Those require knowing
who the caller is, and the runtime does not. Put a gateway in front when the deployment needs that
policy. The node protects its own memory and query capacity regardless of who is asking.

## One cursor per chain

Within one chain, a runtime uses a shared cursor. The cursor sees the chain once, obtains the union
of relevant logs and routes each log to the mounted nests that need it. This reduces duplicate RPC
polling and means that finality and reorg detection have one coherent boundary. Each dataset still
has isolated hot storage, package files and query context.

The rule is per chain. A multichain runtime owns a separate cursor for each chain because chains do
not share a head, a finality rule or a failure mode. The runtime groups mounts by chain before
spawning the cursor work. It does not make a multi-chain deployment magically one ordered stream.

The effect is worth being precise about. A runaway factory or failed decoder should quarantine the
affected nest rather than corrupt its neighbour's data. A dead cursor must not hide behind healthy
HTTP routes. And an operator needs metrics that distinguish a process-level number from per-nest
and per-chain health.

## Capacity is a physical constraint

Nuthatch has a default 2 GB resident-set budget per active-chain cursor. It estimates the impact of
a mount before accepting it and exposes the actual footprint through metrics. The number is not a
marketing density claim. A runtime with two chains has two cursors and therefore two separately
bounded workloads. A high-rate nest can still be expensive even if it has very few neighbours.

The shared cursor pays for chain polling once. It does not make storage, decode work or analytical
queries free. The runtime keeps those costs visible so density does not become a pleasant-sounding
route to an out-of-memory kill.

## The runtime owns the lifecycle

A runtime that could only be changed by editing a file and restarting would make every change as wide
as a fault: restarting to add one nest stops all the others. So the set of mounts is changed while the
process runs, through an admin API, and since 3.13.0 the runtime does the whole of it. A caller hands it
a NID and a name. The runtime fetches the bundle from a registry if it does not hold it, checks that the
bundle's own manifest computes to that NID, installs it, lets it catch up and then serves it. Nothing
outside the process has to unpack, verify or arrange anything.

A mount that fetches and backfills can take far longer than a caller will hold an HTTP request open, so
it is a job rather than a call. The job moves through accepted, fetching, joining and then live or
failed (or reads suspended while an operator has paused it), and it is written to disk, so a restart in the middle picks it up again instead of forgetting
it. The record of a job lives beside the runtime's lock rather than behind it: asking how a mount is
going must never wait for the mount it is asking about.

Joining is the delicate step. A cursor advances from the slowest of its live nests, so a nest spliced in
far behind would drag every neighbour back through history. The newcomer therefore catches up on its own,
beside the cursor, and joins at a window boundary once it is level. The first nest on a chain has no
neighbours to spare, so it starts that chain's cursor exactly as boot would. The last nest to leave does
not stop the cursor; an empty cursor idles, because the next mount onto that chain should find it there.

Pausing is a different thing from leaving. A suspended mount comes off its cursor and gives up its store,
but keeps its data, its record and its name, and its routes answer that it is suspended rather than that
it has vanished. Resuming is an ordinary mount of the recorded identity, which catches up from where it
stopped.

Changing a name's version is where a naive design shows a gap. A new version of a nest is a new NID, so
the name has to be repointed, and a reader must see the old nest and then the new one with no error in
between. The runtime mounts the new identity under a staging name and lets it catch up. It then takes the
old nest off the cursor, tells the cursor to know the staged nest by the real name, and swaps the whole
composition of routes in one step. Until that swap a reader is served by the old nest's stored data;
after it, by the new. The swap is a single atomic replacement of the routing table, so there is no
moment at which the name is served by neither.

## When one process is not enough

Scaled mode moves cursor ownership into a control plane backed by Postgres. Workers register,
claim leases for chains and fence ownership with monotonically increasing values. A worker may only
write while it owns the current lease. If it dies, another worker can take the lease and continue.
The fence prevents a late former owner from writing as though nothing happened, which is the small
but crucial detail separating failover from two machines cheerfully scribbling over the same state.

The data model remains recognisable: mounts identify datasets, cursors follow chains, hot data is
reversible and sealed data is durable. Scaled mode changes who is allowed to perform the cursor
work, not what the chain data means.

For configuration and practical commands, see [run many nests](/docs/operate/many-nests/),
[host nests for others](/docs/operate/hosting-nests/) and [scaled mode](/docs/operate/scaled/). The final chapter is about operating the whole arrangement
without taking a green health endpoint as proof of truth.
