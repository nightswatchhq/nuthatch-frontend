---
title: "Scaled mode: a fleet"
description: When one machine is no longer enough - a writer pool, an independently-scaled serving tier, and a control plane.
order: 7
---

Everything else in these docs is **embedded mode**: one binary, no external services, the thing
`curl | sh` gets you. That is still the primary way to run nuthatch and the one you should reach for
first.

Scaled mode is a different deployment for a different problem — **one operator running many nests
across many machines**. It is opt-in at build time (`--features postgres-store`), so the published
binary carries no database driver and embedded mode stays a single file with nothing beside it.

## When to reach for it

Two reasons, and neither of them is "it sounds more serious":

- **A single box can no longer hold your cursors** inside its RAM budget. A roost is bounded per
  cursor at 2 GB, and Σ cursors has to fit the machine.
- **Serving load and ingestion load want different dials.** A backfill that saturates a writer
  shouldn't slow queries, and a traffic spike shouldn't slow indexing.

If neither applies, a [roost](/docs/operate/roosts/) on one machine is simpler, and that simplicity is
the point of the embedded path. Scaled mode is not an upgrade; it is a trade.

## The three roles

The same crates, run three ways. A role flag, never a fork.

| Role | Command | Owns |
|---|---|---|
| **Control plane** | `nuthatch control --db <postgres>` | *desired state* — what should run |
| **Writer** | `nuthatch dev --dir <nest>` | cursors it holds a **lease** on; ingests, decodes, seals |
| **Query-FE** | `nuthatch serve --dir <nest> --hot-store <postgres>` | nothing — serves from shared state |

```sh
docker compose -f docker-compose.scaled.yml --profile fleet up \
  --scale writer=2 --scale fe=3
```

## Three things to understand before you run it

These are the ones that will otherwise puzzle you at an unsociable hour.

### The control plane states intent; it commands nothing

`POST /nests` records that a nest should run and returns `200`. That does **not** mean it is running —
it means the fleet has been told to run it. A writer picks it up on its next tick.

There is deliberately no "start this nest on worker w3" endpoint. It would be the one call able to put
a cursor somewhere the scheduler did not choose and the lease did not arbitrate.

### Ownership is a lease, and the store enforces it

A cursor is held by exactly one writer at a time. If a writer stalls — long GC, paused container, a
host that goes away for ninety seconds — its lease expires and another writer takes over.

When the original wakes up, **its writes are refused by the store**, not merely unlikely to collide.
Every write carries a fence, and a stale fence is rejected inside the same transaction as the write. A
worker that checked its own lease before writing would be checking a fact that can expire between the
check and the write; this cannot.

That is why `--scale writer=N` is safe.

### The control plane and the lease are independent, on purpose

A control-plane outage stops *rescheduling*, not *ingestion*. Writers keep their leases and keep
working.

It follows that the two can legitimately **disagree**: a writer whose heartbeat has lapsed but whose
lease is still live keeps its cursor, and the scheduler's wish to rehome it is refused. That is
correct, not a fault. A plan is not permission.

## "Why is my nest not running?"

`GET /plan` runs the same placement logic the writers run, and reports what could not be placed and
why:

```json
{"assign":[{"chain":"mainnet","worker":"writer-1"}],
 "unplaceable":[{"chain":"base","rss_mb":2400,"reason":"toolargeforanyworker",
   "detail":"this cursor alone exceeds the largest worker's budget - adding workers will not help"}]}
```

The two reasons need different responses:

- `noroomrightnow` — every worker is at its budget. **Add a worker.**
- `toolargeforanyworker` — the cursor alone exceeds the largest worker's entire budget. **Adding
  workers will not help.** Split the nests across chains, or raise the budget.

Collapsing those into one message would send you shopping for hardware that cannot fix it.

## Versions are pinned fleet-wide

Every FE node resolves an endpoint through the control plane, not through the registry's movable
`latest`:

```sh
curl -XPUT localhost:8290/nests/usdc/pin \
  -d '{"version":"1.3.0","bundle_hash":"0x…"}'
```

If each node read `latest` for itself, then during an upgrade one node would serve the new schema
while another served the old — **the same endpoint answering differently depending on where the load
balancer sent the request.** Nothing errors; the only symptom is a consumer watching a column appear
and disappear.

A declared-but-unpinned endpoint is explicitly **not servable**. An FE refuses rather than guesses,
because guessing is each node choosing a version for itself.

A *compatible* update re-pins the same endpoint. A *breaking* one is a second endpoint served
alongside the first, so existing consumers keep working — which is the whole point of the breaking
path.

## Secrets never enter a bundle

Private RPC URLs and API keys live in the control plane, keyed by nest:

```sh
curl -XPUT localhost:8290/nests/usdc/secrets \
  -d '{"key":"rpc_url","value":"https://private…"}'
```

A writer receives only the secrets of the nests it is actually assigned. The interface is
**write-only** — you can list which keys exist, never read a value back.

Baking a credential into a content-addressed bundle would leak it *and* break addressing, since two
nests differing only in credentials would hash differently. Because secrets sit outside, **rotating
one changes no bundle hash**, so it never invalidates segment reuse or forces a re-index.

## Exposure

The control plane **refuses to start** off-localhost without `NUTHATCH_CONTROL_TOKEN`. Not a warning —
a refusal. It decides what an entire fleet runs, so an unauthenticated one on a public interface is
not a configuration anyone chooses on purpose.

`/health` stays unauthenticated so a load balancer can probe it; it reveals nothing.

## What scaled mode is not

Per-tenant billing, metering, quotas, or authz between mutually-untrusting **paying** customers. Those
belong to a gateway in front of nuthatch and are deliberately out of scope.

The line: *multi-nest co-tenancy* and *distributed self-hosted* mode are both in scope — one operator's
cooperating nests. Charging strangers for isolated access is a different product.

## Honest limits

Two things are not yet proven, and are worth knowing before you commit:

- **The compose stack has not been brought up end to end.** Every service in it maps to something
  tested, but the test suites talk to Postgres directly.
- **Everything is verified on one host** — several processes and connections against one database,
  which is genuinely equivalent for every invariant tested (a lease race does not care whether the
  contenders share a kernel). It is *not* a substitute for real network partitions or clock skew.

The full design and its acceptance criteria are in
[RFC-0022](https://github.com/nuthatch-indexer/nuthatch/blob/main/docs/rfcs/0022-distributed-scaled-mode.md);
the operator guide covers it at
[docs/operators.md](https://github.com/nuthatch-indexer/nuthatch/blob/main/docs/operators.md#scaled-mode-a-fleet-across-machines-rfc-0022).
