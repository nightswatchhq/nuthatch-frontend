---
title: "Appendix C. A lease handover, walked through"
description: "How scaled mode keeps a second worker from becoming a second writer."
order: 12
---

Running a cursor on one machine is simple because there is one process that can write its hot
state. Running it across machines introduces a more awkward possibility: the first worker is slow
or partitioned, the control plane gives the work to a second worker, and then the first worker
comes back convinced it still owns the chain. Without a fencing rule, both can write. This is how a
failover exercise becomes a data-corruption exercise with better branding.

Scaled mode assigns cursor work through a Postgres-backed control plane. Workers register and claim
a lease for a chain. The lease has an owner and an `owner_fence`, a monotonically increasing number
that identifies one particular period of ownership.

## The normal sequence

Worker A starts, registers and claims the lease for Arbitrum. The control plane records A as owner
with fence 41. A runs the Nuthatch cursor, advances through blocks and renews its lease. Its writes
and progress reports carry the ownership context expected by the control plane.

At this point there is one writer. The control plane does not infer that from a worker's optimism.
It has a current lease record which says so.

## A fails, B takes over

Suppose Worker A is killed, loses network access, or otherwise stops renewing. Once its lease
expires, Worker B can claim the same chain. The control plane updates the owner to B and increments
the fence to 42. B now starts the cursor under fence 42.

The increment is not an ornament for logs. It distinguishes this ownership epoch from A's old one.
Any action that still arrives from A carrying fence 41 can be rejected as stale. Worker A cannot
resume and extend its former claim merely because its process remained alive long enough to regain
connectivity. The control plane has moved on.

A correctly written worker must also stop its local ingestion task when it learns that it has lost
the lease. This reduces unnecessary work and narrows the time during which it could attempt stale
operations. The fence remains necessary because process shutdown and network delivery are not
atomic events. It is the backstop that makes delayed messages and slow death harmless.

## Control plane outage is not automatic eviction

There is a separate failure worth naming. If the control plane is unavailable but the worker still
holds a valid lease and its data store is available, the cursor may continue indexing according to
the system's lease and outage policy. A control-plane outage is not evidence that a second worker
has taken ownership. In the two-machine test, workers continued processing during a deliberate
control-plane outage while Postgres remained available, then reconciled when the service returned.

The boundary is always ownership, not mere connectivity. If the worker can no longer establish that
its lease is current, it must not keep acting as the sole authority by force of habit. Conversely,
if the control-plane service is briefly unavailable but the durable lease record still protects the
writer, stopping the cursor needlessly can turn a control-plane incident into a data availability
incident.

## What this buys the operator

With leases and fences, failover is observable and testable. The worker roster shows registrations.
The lease record shows the owner and fence. A deliberate handover should move ownership and
increment `owner_fence`. A healthy test is not “two workers exist”. It is “the old holder stopped
being allowed to write, the new holder took over, and indexing continued without two authorities
claiming the same cursor.”

Scaled mode does not alter the event model, decode registry or sealing rules described elsewhere in
this book. It gives those same rules a single writer across machines. The real achievement is not
that a worker can restart. It is that the system can tell the difference between a restart and two
writers, which is where the difficult bits live.
