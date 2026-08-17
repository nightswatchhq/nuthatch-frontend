---
title: "Nuthatch is now a Graph Horizon data service"
date: "2026-08-17"
description: "A reproducible Nuthatch nest now has a paid, TAP-gated route on Arbitrum One. Here is the NID, the gateway, the first real settlement, and the parts we have deliberately not pretended are finished."
author: "cargopete"
tags: ["nuthatch", "the-graph", "horizon", "tap", "arbitrum", "payments", "operations", "rust"]
---

*There is a pleasant moment in any infrastructure project where the diagram finally has to become a machine. Nuthatch has spent its life making reproducible indexes from contracts and RPC endpoints. It can now put one of those indexes behind a Graph Horizon data service, accept a TAP receipt for a query, and settle the payment on Arbitrum One. The first run is deliberately small and self-run, because that is how one discovers which bits of a system are actually attached to the floor.*

---

## The thing being sold is a nest

The useful unit here is not "SQL", which is a little like advertising a library by saying it has shelves. It is a **Nuthatch nest**, identified by its NID.

```text
NID: 36d3c71446a56cdb5b90536d3f5f77351b1d92efcca94bc2fd41b1c368e69410
mode: NAMED
endpoint: https://nuthatchds.89.167.109.4.sslip.io
```

That identifier binds the authored inputs which make the index what it is: contract addresses, ABIs, selected events, views, semantics, and the author-sanctioned query surface. A provider is therefore saying something precise:

> I serve this reproducible dataset, with this query mode, at this endpoint.

The first offering is [`horizon-nest`](https://github.com/nightswatchhq/horizon-nest), the Nuthatch index of Graph Horizon activity on Arbitrum One. It exposes five named queries: `top_indexers`, `indexer`, `active_allocations`, `delegations_for_indexer`, and `network_totals`.

## The route through the machine

The service is deliberately a proxy, not a new indexing pipeline:

```text
consumer
  | TAP receipt
  v
nuthatch-gateway
  | validates receipt, prices route, rejects replays
  v
private Nuthatch runtime
  | named query allowlist
  v
Horizon nest data
```

The public gateway is written in Rust on [`horizon-core`](https://github.com/nightswatchhq/nuthatch-ds). It exposes free discovery routes for `/schema` and `/queries`, then charges for the useful bit. Named queries cost one computation unit, table reads cost two, and arbitrary SQL is not available in the first offering.

That last point matters. Nuthatch's local `/sql` is excellent for the person operating a nest. It is not a security boundary for a public internet service. The named query allowlist is the boundary, and it is enforced twice: by the gateway's `NAMED` mode and by Nuthatch itself.

## The mainnet proof

The [`NuthatchDataService`](https://arbiscan.io/address/0x647D1Fd14AF2DE3947522B74F1de5B99d317c10A) proxy is live on Arbitrum One.

It originally carried a 555 GRT service-level provision floor, which was a very sturdy way of ensuring nobody used a new service. We migrated that floor to zero in [this UUPS upgrade](https://arbiscan.io/tx/0xdb512643b0eb2f73cbfa4d86d1307abc125739d8e6c007a512c0b89f5291d3b5). Horizon Staking still requires a provision itself to be non-zero, quite reasonably, so the provider proof used 0.0001 GRT.

Then we ran one bounded real payment:

1. The provider registered and started the NID offering in NAMED mode.
2. A client signed a 0.000004 GRT EIP-712 TAP receipt and queried `top_indexers` through the public TLS gateway.
3. The gateway returned the real Nuthatch response with HTTP 200, persisted the receipt, and rejected an identical replay with HTTP 402.
4. A signed RAV for that accepted receipt was passed to `NuthatchDataService.collect()` in [this on-chain transaction](https://arbiscan.io/tx/0x9138d9bd8f5937162f87261b8e6853f692e1a76f6bcd0f497defb50c5f680c05).
5. The payment escrow balance read zero afterwards, and GraphTally emitted its collection events.

The provider and payer were the same account for the smallest possible proof. That means the settlement is real, but it is not a claim that we have demonstrated a bustling two-sided marketplace over a Tuesday lunch. One does these things in the correct order.

## What we checked before publishing it

The service repository passed six Rust gateway tests and seventeen Solidity tests. The Solidity suite includes UUPS storage preservation while migrating the provision floor. Formatting, build checks, and Docker Compose validation all passed as well.

On the VPS, we tested the public route rather than merely admiring a green process:

- free discovery works over TLS;
- no receipt on a paid route returns `402`;
- a different NID returns `404`;
- SQL in NAMED mode returns `404`;
- a burst over the configured limit returns `429`;
- the paid query returns `200`, and its replay returns `402`.

The Nuthatch runtime is 2.5.0, which reproduces the NID advertised by the contract. It is isolated from the other Nuthatch services on the VPS. The gateway is loopback-only behind Caddy, Postgres is loopback-only, request bodies are limited to 16 KiB, and NID routes are limited to 10 requests a second with a burst of 20. At rest the gateway sat at 17 MiB RSS with a 512 MiB systemd limit. The box itself remains notably untroubled.

## The deliberately unfinished part

This is a self-run mainnet beta, not an unrestricted public billing system wearing a false moustache.

Paid requests are currently limited to an allowlisted, GraphTally-authorized signer. The RAV in the proof was generated by that test client. Automatic RAV aggregation and collection are disabled until we operate and test a separate aggregator and a proper consumer signer-onboarding path. The public discovery API is live today; arbitrary callers should not infer that presenting an arbitrary signature will buy them a query.

There is one other small operational wrinkle. The serving runtime is currently also the writer for this mounted nest host. We tried the obvious read-only `nuthatch serve` substitution and found that it expects a direct nest directory rather than the mount host. The writer remains in place because a gateway with no functioning upstream would be a rather expensive health check. Packaging the direct-reader topology is the next piece of work.

The code, deployment record, and the exact test evidence are in [the Nuthatch Data Service repository](https://github.com/nightswatchhq/nuthatch-ds). The service also appears in [Lodestar's Horizon data service catalogue](https://www.lodestar-dashboard.com/data-services).

*Nuthatch remains one Rust binary for deriving and serving your own chain data. The new thing is that a reproducible nest can now be a paid Horizon offering too. That is a useful property, and there is plenty left to make it boring.*
