---
title: "Hosted nests: the same binary, run by us"
date: "2026-09-24"
description: "platform.nuthatch-indexer.com runs the stock nuthatch binary for people who would rather not. Sign in with GitHub or a wallet, point it at a repo or paste an ABI, and get a SQL endpoint with CORS open. Here is how to use it, what it costs, and what it does not do yet."
author: "cargopete"
tags: ["nuthatch", "hosting", "platform", "usdc"]
draft: true
---

Two weeks ago we [offered to host hackathon nests by hand](/blog/we-host-your-hackathon-nest), free
and the same day. People took us up on it, and running other people's nests by hand turned out to be
exactly as sustainable as it sounds. So we built the thing we kept doing manually. **As of today,
[platform.nuthatch-indexer.com](https://platform.nuthatch-indexer.com) runs nuthatch for you: sign
in, give it a repository or a contract address, and you get a live SQL endpoint.**

It is not a different product. It runs the published image, `ghcr.io/nightswatchhq/nuthatch:3.9.0`,
unmodified. Everything it adds, sign-in, plans, payments, lives in a separate private repository and
none of it enters the nuthatch tree. Delete the platform and a self-hoster loses nothing; that is a
rule we set before we wrote a line of it, and the binary you download is the one we run.

## What you get, and what it is made of

Each version of each nest is its own container: `nuthatch dev` over its own directory, capped at 2 GB
of memory with no swap and 2 CPUs, all Linux capabilities dropped, and its admin surface turned off.
Containers cannot see each other, and they cannot reach our network: a firewall on their bridge
drops anything bound for a private or tailnet address, which we checked against a positive control
rather than assumed. One nest's runaway factory or bad record stays in its own box.

What you query is the ordinary nuthatch HTTP surface, behind our proxy:

- `/sql?q=` for SQL over your decoded tables and your `views/`
- `/tables`, `/ready` and the rest of the read routes
- open CORS, so a browser dashboard can call it directly

A control plane probes every nest's `/ready` every 30 seconds and pages us after three minutes down.
Separately, a probe on another machine watches the platform from outside, because a monitor that
lives on the box it monitors is the one that stays quiet when the box dies. We rebooted the host on
24 September to test exactly that: the public URL answered again in 99 seconds, every nest came back
on its own, and the outside probe reported both the outage and the recovery.

## From sign-in to a live endpoint

**Sign in.** GitHub (public profile only, no scopes) or a browser wallet. A wallet signs a
[Sign-In with Ethereum](https://eips.ethereum.org/EIPS/eip-4361) message: no transaction, no gas.
You can link both to one account later, from the Account page.

**Deploy from a repository.** Any public repo laid out like a nuthatch project works: one directory
with a `nuthatch.toml`, an `abis/` folder, and optionally `views/`. A repo that indexes several chains
keeps one config per chain, and you pick which one this nest uses:

```text
arcaidia-nest/
  nuthatch.toml            # Arc Testnet
  nuthatch.sepolia.toml    # Sepolia
  abis/
  views/
```

Name the nest, paste the repository URL, choose the branch, directory and config, and press Deploy.
The platform clones it, runs `nuthatch schema` and `nuthatch nest nid` in a throwaway container with
no network, and starts it.

**Or deploy from contracts.** No repository needed: pick a chain, name up to three contracts, and
give each an address, a start block and an ABI. The ABI can be pasted JSON or a Hardhat or Foundry
artifact. If one contract creates others, name it as the factory and every child it emits is
indexed from its own creation block.

**Query it.** Your endpoint is `https://platform.nuthatch-indexer.com/q/<your login>/<nest>/`:

```bash
E=https://platform.nuthatch-indexer.com/q/cargopete/arcaidia-sepolia

curl -s "$E/ready"            # last_block, tip, ready
curl -s "$E/tables"           # every decoded table and its columns
curl -s -G "$E/sql" --data-urlencode "q=select count(*) from intents"
```

How fast a nest is ready depends on the chain and its RPC far more than on us. The Arcaidia nest on
Sepolia, backfilling on our keyed RPC, went from block 11,688,303 to the tip in 42 seconds, 161,739
events, on 24 September. The same contracts on Arc Testnet's public RPCs managed roughly 51,000
blocks a minute, which is why we pay for RPC on the chains we list.

## A URL that does not move when you redeploy

Every deploy is a new version with its own container. Your endpoint follows the current version, and
the previous one keeps serving until you retire it, so a redeploy never breaks a reader mid-query.
Each version also has a pinned URL, `/q/<login>/<nest>@v2/`, for a client that must not move.

Redeploying unchanged inputs does not start a second copy: a nest's identity is its content address,
and an identical one reuses the running container. Retire a version when nothing reads it. Delete a
nest when you are done with it; that removes every container and all indexed data, and gives the
slot back.

If a deploy fails, the nest page says why in words: `Repository not found`, or
`./nuthatch.mainnet.toml is not in the repository`. We would rather you read the error than wonder.

## Paid is twenty dollars in USDC, and never automatic

| | Free | Paid |
|---|---|---|
| Nests | 3 | 50 |
| Backfill | up to 5 million blocks behind the tip | unlimited |
| Endpoint | 10 requests/s, bursts of 100 | 100 requests/s, bursts of 1,000 |
| Chains | Sepolia and Arc Testnet on our RPC, or any chain with your own RPC | every chain we run |
| People | | we write your views, port your subgraph, same-day answers |

The rate limits are not decorative. We measured them on 24 September: of 150 simultaneous requests at
a free nest, 103 were served and 47 got `429`; of 1,500 at a paid one, 1,133 were served. Burst,
then refill, as the table says.

**Paid is $20 a month, at an introductory price until the end of 2026, in USDC on Ethereum, Base or
Arbitrum.** There is no card and no subscription. On the Billing page you choose a chain and get an
amount such as `20.005051 USDC` and an address. The odd cents are how the payment is known to be
yours; a watcher reads the chain and extends your plan by 30 days once the transfer has enough
confirmations. Pay more and it still counts, provided it is clear whose invoice it pays. Nothing is
ever charged automatically, because crypto cannot pull from a wallet and we would not want it to.
When a paid month ends you drop back to Free, and your nests keep running under the free limits.

We tested this with real money, which is the only kind of test a billing system believes. The first
payment, 21 USDC on Arbitrum against a 20.005051 invoice, was flagged as not matching, because the
watcher only knew exact amounts. It now accepts an overpayment when the invoice is unambiguous, and
anything it cannot place is listed for a human rather than guessed at.

## What it does not do yet

- **It runs on one machine of ours.** It is not replicated and not in a data centre. We watch it from
  outside and it recovers on its own, but there is no SLA and no second region. If your dashboard
  cannot tolerate a few minutes of downtime, run nuthatch yourself.
- **Public repositories only.** Private repos, and redeploying on every push, both need a GitHub App.
  Today redeploy is a button.
- **SQL, not GraphQL.** Nests serve nuthatch's SQL surface. The GraphQL compatibility layer is a
  partial read surface and we do not offer it as a subgraph replacement here.
- **Your own chain means your own RPC.** A chain we do not list works on Free if you supply an RPC
  URL, and it has to be a public address; we refuse anything that resolves to a private network.
- **We do not email you.** Alerts reach us, not you, for now. Poll `/ready` if you need to know.

## Leaving costs you nothing

The nest you deploy here is an ordinary nuthatch project, and the binary is the same one we publish.
To take it home:

```bash
curl -fsSL https://nuthatch-indexer.com/install.sh | sh
git clone <your repo> && cd <your repo>
nuthatch dev
```

Same tables, same SQL, same endpoint shape, on your own machine. Nothing here is designed to make
that harder, which is the point of running the stock binary.

[Sign in and deploy a nest](https://platform.nuthatch-indexer.com). If something breaks, tell us;
the first few users are the ones who find the edges.
