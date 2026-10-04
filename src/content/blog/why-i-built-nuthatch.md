---
title: "Why I built Nuthatch"
date: "2026-10-04"
description: "Seven years of making blockchains answer the questions applications ask, and why the answer for a small team should be one binary on its own box rather than another account on someone else's meter."
author: "cargopete"
tags: ["nuthatch", "self-hosting", "indexing", "essay"]
draft: false
---

*I have spent my whole working life on one problem: getting a blockchain to answer the questions an application actually asks. This is why the tool I ended up building is a single binary you run yourself, and who I built it for.*

---

## The first indexer I wrote was a loop around eth_getLogs

My first job in this industry, in 2019, was at WeiChain, shipping a decentralised exchange to mainnet. We did not have an indexer. We had an RPC endpoint and a loop that asked it for logs, and everything the front end showed a trader was assembled from whatever that loop had managed to collect.

The loop was a Node.js backend, and the node it asked was a laptop in an office drawer. It went down often, it came back when somebody noticed, and the user experience in between was horrendous. Nobody on that team was careless. We simply had no better option that a small team could afford.

Every team that reads a chain writes that loop at some point, and most of them then spend a year learning the same lessons. A node will drop a request without telling you. A reorg will take back a block you have already shown a user. A public endpoint will cap a log query at a size you only discover by exceeding it. None of it is difficult. All of it is tedious, and it is the same tedium in every repository.

## Then I met the same problem at every scale

At The Graph I started on the tooling. In 2021, on a Foundation grant through LimeChain, I built Matchstick, the unit-testing framework subgraph developers still use. From 2022 to 2025 I was at GraphOps, one of the protocol's core developer teams, building Graphcast and the services around the indexer network. In between I spent time at Kraken, whose details stay under an NDA, and later, briefly, at Dune.

From the inside, the pattern was hard to miss. **The large teams were fine.** They had budgets, an account manager, and someone whose whole job was the data pipeline. The small ones were not. Subgraphs are powerful, and in my experience people never quite used them well. The mappings are written in AssemblyScript, a language I liked so little that I wrote another one, Redstart, purely so that nobody would have to write it by hand. And the distance between the developer who writes a subgraph and the indexer who runs it is enormous: the first ships a manifest and hopes, and the second inherits whatever it does at block twenty million.

The edges are sharper than they look from a pricing page. Subgraph Studio's development endpoint is capped at 3,000 queries a day, which is plenty for a smoke test and about forty times short of a front end that polls; we found that out in September with a builder at ETHOnline who ran out within the hour. And on 8 October 2026 Studio stops serving BNB Chain and Polygon subgraphs altogether, as The Graph Foundation announced on 24 September. A subgraph that nobody picks up on the network will simply stop answering.

## The industry has gone to work for institutions

This is not a complaint about any one company. The money in blockchain data has moved towards institutions, and the products have followed it: enterprise plans, pre-indexed networks you query through someone else's API, self-hosted editions that still want an API key, and pricing pages that end in a "contact sales" button. Each of those is a reasonable business. Taken together, they leave the indie developer, the hacker at a weekend event and the three-person protocol team with an unappealing set of choices. They can pay a meter. They can route every question about their own contract through a third party that sees what they ask. Or they can write the loop again.

I wanted another option, and I could not find one, so I built it.

## Nuthatch is that loop, done properly, once

You point it at a contract address. It fetches the ABI from Sourcify, falling back to Etherscan, generates a SQL table for every event, backfills from the chain over ordinary JSON-RPC, and then follows the tip. Recent blocks live in an embedded store that a reorg can roll back. Anything past finality is sealed into content-addressed Parquet that a reorg can never touch. You query the two as one SQL surface, over HTTP, from the command line, or through an MCP server compiled into the binary, so an AI agent reads the real schema instead of guessing at it.

**There is no handler code to write, no Postgres, no Docker and no account.** It is one static binary that stays under 2 GB of RAM per chain, a ceiling CI enforces rather than hopes for. It is MIT or Apache-2.0, sends no telemetry, and keeps the data on your disk. Nobody, us included, holds a key you do not.

It is also not a prototype any more:

- **Lodestar**, an analytics dashboard for The Graph on Arbitrum One, serves its live panels from nests on one box rather than from the gateway.
- At Arbitrum One block 510,395,917, a nest built only from on-chain events reported **14,415 active allocations** on The Graph's SubgraphService. The network subgraph reports the same 14,415 at that block, matched by allocation ID, with none missing on either side. The ID lists and the commands to rerun the check are public in `graph-allocations-nest`.
- On case 6 of Sentio's Open Blockchain Indexer Benchmark, the Uniswap V2 factory over 10,001 blocks, nuthatch 4.3.1 produced **35,271 events and 232 discovered pairs** in every one of five runs, matching the benchmark's expected swap count exactly. The median was 5.14 seconds against Tenderly's public gateway on an 18-core laptop, measured on 4 October 2026.

## What it does not do, and who it is not for

A tool that only lists its strengths is an advert, so here are the rest.

- **It needs an RPC endpoint.** The bundled public ones are there for trying it out. Running it in earnest means your own node or a provider, and a provider may charge.
- **It is not the fastest on every benchmark.** On that same case 6, one of OBIB's own published rounds has Envio at 30 seconds, ahead of the 49.5 seconds we recorded on an Alchemy endpoint. Envio serves it from its own pre-indexed network, while nuthatch reads plain JSON-RPC, and that difference is the point of the exercise rather than an excuse for it.
- **It records facts, not a mapping's accumulated state.** Every event becomes a row exactly as the chain emitted it. Running totals, prices and TVL are yours to declare, as SQL views or as incremental entities, rather than something it infers.
- **It is EVM only.**
- **It is a public good, not a company, and nobody pays for it.** No grant, no investor, no sponsor: I have built it in my own time and I maintain it alone. That is a real bus factor, and I would rather you heard it from me. Everything is open source and anyone is welcome to fork it or contribute, so the code is never hostage to one maintainer.

It is for the indie developer, the self-hosting crowd and the small project that would rather own its index than rent it. For larger teams, GraphOps is our design partner: one of The Graph's core developer teams, with many years of running indexing and data infrastructure behind it.

## Be your own indexer

The README demo is four lines and indexes the last 300 blocks of USDC in seconds on the bundled endpoints:

```sh
curl -fsSL https://nuthatch-indexer.com/install.sh | sh
nuthatch init 0xA0b86991c6218b36c1D19D4a2e9Eb0cE3606eB48 --alias usdc
nuthatch dev --backfill 300
nuthatch sql "SELECT count(*) FROM usdc__transfer"
```

The source, the issue tracker and the progress log are at [github.com/nightswatchhq/nuthatch](https://github.com/nightswatchhq/nuthatch). If it breaks on your contract, that is the most useful thing you can tell me.
