---
title: "8. Operating a truthful index"
description: "Verification, health, security and the habits that keep an index honest in production."
order: 9
---

An indexer can be available and wrong. It can answer HTTP requests while following the wrong chain,
serve a stale cursor, decode against an unsuitable ABI, or retain a view whose meaning nobody has
checked since the first enthusiastic afternoon. Availability matters. It is not the whole
definition of health.

Nuthatch is designed to make its claims checkable. The remaining work is operational discipline:
choose what to verify, give failures a route to a human, and avoid calling a system healthy merely
because it remains capable of returning JSON.

## Verify the inputs and the result

Start with the nest package. Inspect the contract addresses, deployment ranges, vendored ABIs and
event selections. Rebuild the generated schema and decode registry from those inputs. Confirm the
NID when loading or deploying a bundle. This establishes that the machine is indexing the package
you intended, rather than an equally well-formatted stranger.

Then verify a result against the chain at a fixed watermark. A useful check has a known block range,
a concrete expected answer and a way to replay the SQL. For an event-derived view, compare its rows
with the events and, where appropriate, with an independent chain query. For an application
fallback, exercise the exact named query and response shape the application will use. A test that
only proves that an endpoint returned 200 has the emotional comfort of a fire alarm with its
batteries removed.

### Verify the endpoint, and then verify it again later

The package is not the only input. The RPC endpoint is one too, and it is the one that changes
without telling you.

`nuthatch doctor --rpc <url>` asks an endpoint three questions before a backfill trusts it: the
widest `eth_getLogs` range it will serve, the largest JSON-RPC batch it accepts, and whether it has
archive depth. Each of those limits otherwise surfaces mid-backfill as a retry loop that looks
exactly like slowness, which is the worst way to learn it. Point it at the nest with `--dir` and it
probes with the contract filter the nest will actually issue, rather than an empty one.

Read its window figure as a **floor**, not a ceiling. A probe with no address filter measures the
provider's raw block-range capacity; every measurement on record has address-filtered limits coming
in *under* that, so the number is a conservative lower bound on what a real nest sustains.

The part worth building a habit around is the second probe. Nuthatch ships measured endpoints for
its built-in chains, and one of them was measured on a Tuesday and had silently lost archive depth by
the Wednesday - a from-deployment backfill could no longer use it at all, while the recorded figure
in the source still said otherwise. **A recorded measurement is a snapshot presented as a property.**
Nothing about an endpoint's past behaviour is a promise, including ours, so probe before a long
backfill rather than trusting a number somebody wrote down once.

## Observe the pipeline, not just the server

Metrics make the stages visible. `nuthatch_tip_lag_blocks` tells you whether the cursor keeps up.
`nuthatch_last_poll_unixtime` reveals a poller that has frozen. Per-nest health tells you whether a
part of a shared runtime has been quarantined. `nuthatch_cursor_live` identifies the chain cursor
that has died even if another chain in the same process remains busy. RSS and query rejection
counters show whether the node is protecting itself as intended.

Alert on sustained lag, a stalled poller, quarantined nests and approaching memory limits. Treat
the first three as a service issue and the last as an opportunity to reduce query concurrency or
reconsider the mounting budget before the machine makes the decision rather more abruptly. The
[metrics guide](/docs/operate/metrics/) contains runnable Prometheus examples.

## Secure the separate surfaces

The data API is read-only, but a runtime may also expose administrative routes that mount or remove
nests. Do not put an unauthenticated administrative listener on the public internet and then feel
surprised when somebody experiments with it. Restrict the listener, use a gateway where public
access is needed, and keep database credentials and RPC URLs in deployment configuration rather
than the nest package.

SQL needs its own care. General SQL is powerful enough to consume resources even when it cannot
write. Use named queries or an allowlist for public services. Keep the node's built-in timeout,
concurrency and result bounds on. Per-caller rates and quotas require authenticated identity, so
place them at the gateway. Calling a local concurrency semaphore a rate limiter would be a category
error with a pleasingly dangerous outcome.

## Recover without inventing history

When something fails, first establish which layer is unhealthy: RPC reachability, cursor progress,
one dataset's decoder, storage, query load or the gateway in front. The runtime is built so a
quarantined nest, a lease handover and a failed query are observable conditions rather than silent
reasons to return old data forever.

Do not repair a suspected data error by editing sealed rows or retroactively decoding history under
a new ABI. Preserve the evidence, identify the package and range involved, build the corrected
dataset under its own identity and migrate consumers deliberately. The cost of this restraint is
small compared with explaining an untraceable historical rewrite later.

That is Nuthatch's central ethic. It is not merely a fast way of turning logs into tables. It is a
way of retaining a clear chain of custody from authored definition to chain event to query result.
Once that chain of custody exists, a team can operate its own critical data path without asking a
remote endpoint to be both available and believed.

Use [production operation](/docs/operate/production/), [security](/docs/operate/security/) and
[verification](/docs/operate/verifying/) as the practical checklist alongside this chapter.
