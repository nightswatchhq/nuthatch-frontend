---
title: "We said nuthatch would never call a contract. It does now."
date: "2026-08-20"
description: "Over 70% of subgraphs use eth_call, and the rest of them read IPFS. nuthatch 2.6.0 does both, without giving up the determinism that was the reason for refusing in the first place."
author: "cargopete"
tags: ["nuthatch", "release", "eth_call", "ipfs", "the-graph", "subgraphs", "determinism"]
---

*A month ago we published a post called "No eth_calls in nuthatch: what you derive instead". This is
the post that retires it, and an explanation of what changed our mind.*

The old argument was not wrong about the risk. Reaching out to an archive node in the middle of
indexing means your data path now depends on a third party answering correctly, at the moment you
asked, forever. Re-run the index a year later against a different provider and you may get a different
answer, with nothing in the output to tell you which run was right. That is a genuinely bad property
for something whose whole claim is deterministic re-execution.

What the old argument was wrong about is that refusing is the only way to avoid it.

## What actually changed

The problem with a subgraph's `eth_call` is not that it calls. It is that the call is unpinned and
unaddressed. It happens at whatever block the handler happens to be at, the result is stored as a bare
number, and nothing records what question produced it.

nuthatch 2.6.0 pins the block and content-addresses the question:

```toml
[[calls]]
name = "grt_total_supply"
contract = "0x9623063377AD1B27544C965cCd7342f7EA7e88C7"
calldata = "0x18160ddd"
every = 100000
```

The result is keyed by `(chain_id, block, contract, calldata)`. The block is fixed, so the answer is
fixed. Two operators running the same nest against different archive providers get the same bytes, or
one of them has a provider that is lying and the disagreement is visible rather than silent. That is
the property we actually wanted. Refusing to call was a way of getting it; pinning is a better way,
because it also gets you the values.

Calls can be parameterised from the row that triggered them, so the shape a subgraph writes as
`contract.balanceOf(event.params.user)` has a direct equivalent.

## IPFS, and why the host is thrown away

The other half of the gap is content. Subgraphs read metadata off IPFS constantly, and a nest could
not.

```toml
[[ipfs]]
name = "subgraph_metadata"
on = "gns__subgraph_metadata_updated"
cid_column = "subgraphMetadata"
```

Every fetched document is re-hashed and checked against the CID it claims to be. A gateway serving the
wrong bytes produces no row rather than a plausible one.

The detail worth dwelling on is that the CID is extracted from whatever shape the contract stored, and
then **the host is discarded**. Contracts store these as bare CIDs, as `ipfs://` URIs, as full gateway
URLs, as subdomain gateway URLs, and as raw 32 byte digests. All of those arrive as strings from a log,
which means honouring the host would let whoever emitted the event choose what your indexer connects
to. Only the content address survives, and it is fetched through the gateways *you* configured.

That last shape, the bare `bytes32`, is worth a note. The Graph's own GNS stores subgraph metadata that
way, because 32 bytes is what a sha2-256 digest actually is and the `Qm...` text is merely one encoding
of it. A CIDv0 is `base58btc(0x12 0x20 || digest)`, so the digest is reframed rather than rehashed.

Gateways are configured with `--ipfs` and never in `nuthatch.toml`. A gateway is an access path, not
part of what a nest *is*, and two operators resolving the same CID through different gateways must get
the same bytes. So it must not enter the nest's content address. Point it at your own node if you want
no third party in the path at all.

## What we checked, and what it cost

Field numbers rather than fixtures, because a feature that only works in tests is not a feature.

On a seven contract Arbitrum nest: **2,725 pinned reads** across blocks 42,500,000 to 314,900,000, zero
reverts. Seven of those were checked value for value against an archive node afterwards and matched
**exactly, to the wei**.

On IPFS: a nest over Arbitrum GNS resolved **5 of 5 documents, all verified**, against a live gateway.
Three of those CIDs had been computed by hand beforehand and matched, which makes it agreement with the
network rather than the code agreeing with itself.

There is a cost and you should know it before you turn it on. Pinned reads resolve inside the indexing
window, and `--seal-direct` is refused while calls are declared, because a seal direct run would sail
past every sampled block and seal the range with the table silently absent. Measured on a real nest,
adding one `[[calls]]` entry took the same 454 million block backfill from about **12 minutes to about
66**. The guard is right and stays. Teaching the seal direct path to resolve calls is the follow up.

## Two bugs this found, and one it did not

Testing the features against production data rather than fixtures turned up two silent faults, both
fixed before the tag.

A `bytes32` CID column resolved nothing at all, with no complaint, because the resolver only understood
strings and the call site discarded the value before the resolver ever saw it. And call and IPFS tables
were queryable while being invisible: a table holding 3,509 rows appeared in neither `/tables` nor
`/schema`, and `/table/<name>` answered 404. The same short list also drove a drift warning that fired
on a perfectly correct configuration, which is how you teach operators to ignore warnings.

One it did not find in time, which is in 2.6.0 as shipped: **a transient RPC failure during a pinned
call is fatal rather than retried**. Every other fetch on that path has had never give up retry with
backoff for months; the tier 3 batch shipped without it. A 454 million block backfill of ours died
eight hours in at 87.6% on a single dropped connection. If you are running a long backfill with
`[[calls]]` on 2.6.0 and it exits with `pinned eth_call batch at block N`, restart it: nests resume
from where they got to rather than starting over, and ours caught up in 17 minutes. The fix is merged
and will be in the next release.

## Also in 2.6.0

**Four new chains:** BSC, Polygon, Gnosis and Optimism, each with measured endpoints. BSC ships with a
single endpoint because no keyless archive was found for it, which is stated rather than papered over.

**A silent overwrite fixed.** Block rows, call results and IPFS documents have no log index of their
own, and enough of them shared a synthetic one that they collided in the hot store. There is now a
reserved band: calls at 500,000, IPFS documents at 625,000, transaction level calls at 750,000, block
rows at 999,999. Worth noting how it nearly escaped: the first attempt to reproduce it used the seal
direct path and passed, because Parquet is append only and an overwrite cannot happen there.

## What derive first still means

Nothing above retires the recipes. Deriving a value from events you already indexed is still the
default and still the cheapest thing, and `nuthatch recipe list` still works. The difference is that
"derive it" is now a recommendation rather than the only option, and the cases the old post called the
irreducible residue have an answer.

The claim we could not honestly make a month ago, and can now, is this: any subgraph should be
reproducible as a nuthatch nest. If you find one that is not, that is a bug and we would like to see it.

Upgrading is drop in. Swap the binary and restart. `[[calls]]` and `[[ipfs]]` are opt in, so a nest
declaring neither behaves exactly as it did on 2.5.0.

```sh
curl -fsSL https://nuthatch-indexer.com/install.sh | sh
```

Be your own indexer.
