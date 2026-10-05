---
title: "Appendix C. A lease handover, walked through"
description: "How scaled mode keeps a second worker from becoming a second writer."
order: 13
---

Running a cursor on one machine is simple because there is one process that can write its hot
state. Running it across machines introduces a more awkward possibility: the first worker is slow
or partitioned, the control plane gives the work to a second worker, and then the first worker
comes back convinced it still owns the chain. Without a fencing rule, both can write. This is how a
failover exercise becomes a data-corruption exercise with better branding.

Scaled mode assigns cursor work through a Postgres-backed control plane, which holds what the fleet
should run and which workers exist. It does not hold ownership. The lease for a chain lives in that
chain's own hot-store schema, as three rows of its `meta` table: `lease_owner`, `lease_expires_at`
and `owner_fence`, a monotonically increasing number that identifies one particular period of
ownership. Putting the lease next to the data it protects is what lets every write check it in the
same transaction.

This appendix is read against the 4.10.1 source and dated rather than re-run. Scaled mode is a
separate build, `--features postgres-store`, shipped as the `nuthatch-scaled` Linux tarball; the
default binary answers `nuthatch worker` with a refusal that says so. The two-machine run it
describes is the one that accompanied RFC-0022.

## The normal sequence

Worker A starts, registers with the control plane and claims the lease for Arbitrum. The claim
locks the fence row, reads 40, writes 41 and records A as the holder, all in one transaction. A
runs the Nuthatch cursor, advances through blocks and renews its lease every five-second tick, for
a thirty-second term. Every write it makes, a window commit, a rollback, a seal watermark, opens a
transaction that first re-reads the fence and refuses to continue unless it still reads 41.

At this point there is one writer. Nobody infers that from a worker's optimism. The chain's store
has a current lease record which says so.

## A fails, B takes over

Suppose Worker A is killed, loses network access, or otherwise stops renewing. Once its lease
expires, Worker B can claim the same chain. The claim records B as holder and increments the fence
to 42. B now starts the cursor under fence 42. (The fence counts acquisitions, not changes of
owner: a worker that lets its own lease lapse and claims it again also moves the number on, which
is correct, since its old transactions are just as stale.)

The increment is not an ornament for logs. It distinguishes this ownership epoch from A's old one.
Any write that still arrives from A carrying fence 41 is refused at the fence check with a
lost-ownership error, including A's attempt to renew. Worker A cannot resume and extend its former
claim merely because its process remained alive long enough to regain connectivity. The lease has
moved on.

A correctly written worker would also stop its local ingestion task when it learns that it has lost
the lease, to save the work and narrow the time during which it attempts stale operations. In
4.10.1 it does not. A tick whose renewal is refused is logged as a failed tick, with the note that
held cursors keep working, and the ingestion task runs on, polling the RPC and decoding windows
whose every commit the fence then refuses, until the worker is restarted. That is filed as nuthatch
#1934. The data is safe throughout, which is the point of the next sentence: the fence is necessary
because process shutdown and network delivery are not atomic events. It is the backstop that makes
delayed messages, slow death and, as it turns out, a worker that has not noticed, harmless.

## Control plane outage is not automatic eviction

There is a separate failure worth naming. If the control plane is unavailable but the worker's data
store is, the cursor keeps indexing. There is no named policy for this; it is what the code does. A
tick heartbeats the control plane before it renews any lease, so while the control plane is down no
lease is renewed and the term runs out after thirty seconds, but an expired lease is not a taken
one. Nobody else can claim it either, the fence is unchanged, and every write still passes its
check. A control-plane outage is not evidence that a second worker has taken ownership. In the
two-machine test, workers continued processing during a deliberate control-plane outage while
Postgres remained available, then reconciled when the service returned.

The boundary is always ownership, not mere connectivity. If the worker can no longer establish that
its lease is current, it must not keep acting as the sole authority by force of habit, and the fence
sees to it that it cannot. Conversely, if the control-plane service is briefly unavailable but the
lease record in the store still protects the writer, stopping the cursor needlessly would turn a
control-plane incident into a data availability incident.

## What this buys the operator

With leases and fences, failover is observable and testable. The control plane's worker roster
shows registrations. The chain store's `meta` rows show the holder and fence. A deliberate handover
should move the holder and increment `owner_fence`. A healthy test is not "two workers exist". It is
"the old holder stopped being allowed to write, the new holder took over, and indexing continued
without two authorities claiming the same cursor."

Scaled mode does not alter the event model, decode registry or sealing rules described elsewhere in
this book. It gives those same rules a single writer across machines. The real achievement is not
that a worker can restart. It is that the system can tell the difference between a restart and two
writers, which is where the difficult bits live.
