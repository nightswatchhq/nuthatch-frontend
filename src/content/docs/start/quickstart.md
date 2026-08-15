---
title: Quickstart
description: From a contract address to a live, queryable indexer in under two minutes.
order: 1
---

This is the golden path: from a bare contract address to a decoded, tip-following, queryable API - on
your own machine, with no external data service.

## 1. Install the binary

```sh
curl -fsSL https://nuthatch-indexer.com/install.sh | sh
```

Or build it with cargo, which needs the pinned toolchain - `rust-toolchain.toml` does **not** apply
to `cargo install --git`, so without `+1.95.0` you hit a `dbsp` compiler ICE on rustc 1.97 and get
nothing:

```sh
rustup toolchain install 1.95.0
cargo +1.95.0 install --git https://github.com/nightswatchhq/nuthatch nuthatch
```

## 2. Scaffold a nest from an address

`init` detects the chain, resolves the ABI (Sourcify first, then an Etherscan-class API), vendors it
locally, and generates the schema, views, and AI surface - no API key required.

```sh
nuthatch init 0xA0b86991c6218b36c1D19D4a2e9Eb0cE3606eB48 --alias usdc --chain mainnet
```

You now have a nest directory: `nuthatch.toml`, `abis/`, `schema.json`, `views/`, `llms.txt`.

`--alias` is the table prefix, so this contract's events land in `usdc__transfer`, `usdc__approval`,
and so on. Leave it out and the contract is called `c0`, giving you `c0__transfer` - which works
identically, just reads worse in a query.

## 3. Run it

`dev` backfills from the deployment block, follows the tip, decodes every declared event, and serves an
HTTP API - all in one process.

```sh
nuthatch dev
# ✓ indexing USDC on mainnet - serving http://127.0.0.1:8288
```

> **Note - the default endpoints are free public RPCs.** nuthatch ships them so this page works with
> zero setup, and they are fine for trying it out or following a low-traffic contract. They are shared
> and rate-limited, and under load they often return *nothing* rather than an error - so a deep backfill
> will crawl or stall. For anything you care about, point at your own node or a paid provider with
> `--rpc`. See [free public RPCs](/docs/operate/troubleshooting/#free-public-rpcs-stalls-and-empty-results).

## 4. Query it

Point-read an entity, run analytical SQL over the hot tip ∪ sealed history, or read a derived view.

```sh
nuthatch sql 'SELECT "to", value FROM usdc__transfer ORDER BY block_number DESC LIMIT 5'
```

`to` and `from` are SQL reserved words, so double-quote them. nuthatch spots this one and tells you
so rather than just failing.

…or over HTTP:

```sh
curl 'http://127.0.0.1:8288/sql?q=SELECT+count(*)+FROM+usdc__transfer'
curl 'http://127.0.0.1:8288/balances?limit=5'    # top holders - derived, no eth_call
curl http://127.0.0.1:8288/balance/0xSomeHolder  # one address
```

Balances are derived from the Transfers you have indexed, so an address answers `no balance` until it
appears in that range - start from `/balances` if you want an address that definitely does.

## What you just got

- **A decoded database.** Every declared event becomes a table `{alias}__{event}`, with implicit
  columns (`block_number`, `tx_hash`, `log_index`, `address`, …) alongside the decoded fields.
- **Hot + cold storage.** A redb tip store for point-reads, sealed content-addressed Parquet past
  finality, unified behind DuckDB SQL. See [Storage &amp; sealing](/docs/concepts/storage/).
- **Derived state, no `eth_call`.** Add `nuthatch recipe add total_supply` for an ERC-20's supply
  derived from Transfers - no archive node. See [Recipes](/docs/build/recipes/).
- **An admin UI and metrics** at `/_admin/` and `/metrics`.
- **An MCP server** so an agent can drive it offline. See [MCP](/docs/ai/mcp/).

> **Under two minutes.** That's the whole demo - install, `init`, `dev`, query. Everything after this
> page is about going deeper: authored logic, factories, runtimes, upgrades, and operating it in
> production.

## A word on the free public RPCs

nuthatch ships free public endpoints per chain so that `init` → `dev` works with zero setup. That is
the two-minute demo above, and it is deliberate. They are fine for trying it out, following the tip of
a quiet contract, or a modest recent-history backfill.

They are **not** fine for real work, and it's better to hear that here than at 3am:

- **They are rate-limited and shared.** You queue behind everyone else on the same free tier from the
  same IP range; throughput varies by the hour.
- **They fail intermittently, and not always loudly.** A rate-limited endpoint may return an empty
  result rather than an error. nuthatch fails over across the pool and retries, but a window every
  endpoint refuses will stall - `/ready` reports `stalled` when that happens.
- **Deep backfills will crawl or stop.** Full history over a busy contract is millions of
  `eth_getLogs` calls. Expect a free endpoint to throttle you long before that finishes.
- **No archive guarantees.** Many free endpoints prune old state, so a backfill from a 2020 deploy
  block can fail partway.

Use your own endpoint for anything you care about - your own node, or a paid provider:

```sh
nuthatch init 0xADDR --chain arbitrum-one --rpc https://your-endpoint.example/arbitrum
nuthatch dev --rpc https://your-endpoint.example/arbitrum   # or set rpc_urls in nuthatch.toml
```

`--rpc` is repeatable and nuthatch round-robins across the pool with per-endpoint health tracking, so
listing two or three gets you failover as well as throughput. Every endpoint in a pool must be on the
**same chain** - nuthatch verifies this at startup and refuses a mixed pool, since indexing against
the wrong chain corrupts state silently.

## Next

- **[Run it in production](/docs/operate/production/)** - the whole path from a fresh box to a nest
  serving unattended, ending in a pre-flight checklist. Start here if this is going anywhere real.
- **[Deploy it](/docs/operate/deploy/)** - systemd, Docker, and putting a proxy in front.
- **[Performance](/docs/operate/performance/)** - what it measures at, and the three things that
  decide your backfill's wall clock.
- **[Security](/docs/operate/security/)** - read this before exposing `/sql` to anyone you do not trust.
- **[Verifying a deployment](/docs/operate/verifying/)** - prove it works on your own hardware.

- [What is a nest?](/docs/concepts/nests/) - the mental model
- [Build a nest](/docs/build/config/) - `nuthatch.toml`, views, factories, recipes
- [Run many nests](/docs/operate/many-nests/) - one runtime, one or more chains, tenancy included
