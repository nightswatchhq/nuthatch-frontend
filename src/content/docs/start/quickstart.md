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

Or build it with cargo:

```sh
cargo install --git https://github.com/nuthatch-indexer/nuthatch nuthatch
```

## 2. Scaffold a nest from an address

`init` detects the chain, resolves the ABI (Sourcify first, then an Etherscan-class API), vendors it
locally, and generates the schema, views, and AI surface - no API key required.

```sh
nuthatch init 0xA0b86991c6218b36c1D19D4a2e9Eb0cE3606eB48 --chain mainnet
```

You now have a nest directory: `nuthatch.toml`, `abis/`, `schema.json`, `views/`, `llms.txt`.

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
nuthatch sql "SELECT to, value FROM usdc__transfer ORDER BY block_number DESC LIMIT 5"
```

…or over HTTP:

```sh
curl 'http://127.0.0.1:8288/sql?q=SELECT+count(*)+FROM+usdc__transfer'
curl http://127.0.0.1:8288/balance/0xYourAddress
```

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
> page is about going deeper: authored logic, factories, roosts, upgrades, and operating it in
> production.

## Next

- [What is a nest?](/docs/concepts/nests/) - the mental model
- [Build a nest](/docs/build/config/) - `nuthatch.toml`, views, factories, recipes
- [Run a roost](/docs/operate/roosts/) - many nests, one runtime, one or more chains
