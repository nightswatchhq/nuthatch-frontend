---
title: "Monad is built in. Here is what that means, and the first nest on it."
description: "Nuthatch now indexes Monad out of the box: one binary, one command, and a chain that does a block every 300 milliseconds becomes SQL tables on your own machine. The first real nest on it covers Perpl, the exchange that is seventy percent of Monad's traffic and had no public index until now."
date: 2026-09-05
author: "cargopete"
tags: ["nuthatch", "monad", "perpl", "self-hosting", "sql", "rust"]
---

*Nuthatch 3.3 added Monad to the chains it knows how to index without being told anything. This
post explains what that sentence means to someone who has never heard of either, what it unlocks
for people building on Monad, and walks through the first serious nest we built on it: every fill,
funding payment and liquidation on Perpl, the perpetual futures exchange that accounts for about
seventy percent of everything that happens on the chain.*

---

## Two things you need to know first

**A blockchain is a public log of events, and reading that log is harder than it should be.**
Every time someone trades on an exchange, moves a token or gets liquidated, the contract that did
it writes a small record, called an event, into the block. The records are public and permanent.
But the network only hands them out a few blocks at a time, in a raw encoding, and nothing keeps a
table of them for you. If you want to ask "what was the trading volume on this market yesterday",
somebody has to pull every relevant event out of every block since the contract was deployed,
decode it, and put it in a database. That job is called indexing, and historically it has meant
either running a heavy multi-service stack yourself or paying a hosted provider to run it for you
and query their API.

**Nuthatch is a single program that does the whole job locally.** You download one binary, point it
at a contract address, and it fetches the contract's interface, works out every event the contract
can emit, builds one table per event, backfills the chain's history into those tables and then
follows the chain live, serving SQL over HTTP the whole time. It runs on a laptop or a small
server, needs no database server, no Docker, no account with anybody, and never phones home. The
data lands in ordinary Parquet files you own. Its tagline is "be your own indexer", and it means
it literally.

```sh
curl -fsSL https://nuthatch-indexer.com/install.sh | sh
nuthatch init 0xYourContract --chain monad
nuthatch dev
```

That is the entire setup. A minute or two later you are running `SELECT` over the contract's
history.

## What Monad is, from an indexer's point of view

Monad is a new Layer 1 blockchain that runs the same smart contracts Ethereum does, but much
faster. Where Ethereum produces a block every twelve seconds, Monad produces one every 300
milliseconds. We measured 302 ms over a hundred consecutive blocks, and a block is final, meaning
it can never be undone, one block after it appears, about 600 milliseconds later.

For anyone building a product on Monad, that speed is the point. For anyone indexing it, that speed
is the problem. When we sampled a thousand blocks in September, they carried 110,232 events from
273 different contracts: about 110 events per block, arriving three blocks a second, from a chain
whose history already ran past a hundred million blocks. Public endpoints cap how many blocks you
may ask for at once (one of them at a hundred), and every provider refuses an oversized request in
its own dialect. A tool built for Ethereum's pace has to be taught all of this or it stalls.

So "Monad is built in" means specifically that nuthatch now carries, in its registry of chains:

- **three measured public endpoints** for Monad, so `--chain monad` works with no API key at all,
  the widest first, and the whole pool falls back across them;
- **a request window sized for dense blocks**, at the narrowest endpoint's documented cap, with the
  chunker narrowing further on the exact refusal messages Monad's providers send;
- **a sealing policy matched to Monad's finality.** Nuthatch writes immutable Parquet only past the
  point where a block cannot change. We shipped that conservatively, eight blocks behind the tip,
  because Monad executes a block a moment after it finalises it and we wanted proof the network's
  `finalized` tag never hands out a block before its receipts. We then read that tag and its
  receipts every 300 milliseconds for twenty-four hours on all three endpoints: 648,532 reads, zero
  short answers. The seal point is moving to the tag itself, 600 milliseconds behind the chain.

And it means the rest of nuthatch works unchanged: `init` from an address, automatic chain
detection from a contract's bytecode, factories that discover child contracts, SQL views, the MCP
server for coding agents. Monad is the eighth chain in the registry and needed no special code path,
which is how it should be for a chain that speaks Ethereum's language.

## Why that unlocks things on Monad

A fast chain generates data faster than most teams can build pipelines for it. The practical
consequence is that on Monad today, the data people actually want is hard to get at. Of the ten
busiest contracts on the chain, none is verified on Sourcify, the open contract registry, and most
have no public index of any kind. If you are a trader who wants your own view of a venue, a
researcher who wants to measure the chain, or a team whose product needs a number the contract
emits, your options have been the venue's own API or nothing.

Nuthatch changes the cost of the alternative. Indexing a Monad contract is now a config file and a
machine you already have. The data stays yours, on your disk, queryable with SQL you can read, and
checkable against the chain because every table is derived deterministically from public events.
That is a different relationship with a chain's data than "ask the API and hope", and it is one the
Monad ecosystem has mostly not had.

## The Perpl nest: seventy percent of Monad, as tables

Perpl is a perpetual futures exchange on Monad. Its exchange contract is the single busiest thing on
the chain: in our sample it emitted about seventy percent of all events, roughly seven per
transaction, as orders were placed, matched, funded and liquidated. Nothing indexed it publicly.

There was a reason for that. The contract is not verified anywhere, which means nobody outside
Perpl had its interface, and without an interface an indexer cannot tell one event from another.
Nuthatch will not guess a layout, and it should not: a guessed decoder produces a wrong number
with a confident column name. The interface turned out to be published after all, in Perpl's own
MIT-licensed SDK on GitHub, with 202 events in it. We checked every event signature the contract
actually emits against it: six of six matched. That file, with its exact commit recorded, is what
the nest carries.

From there it was one command, through the contract's proxy:

```sh
nuthatch init 0x34B6552d57a35a1D042CcAe1951BD1C370112a6F --chain monad --abi Exchange.json --alias perpl
```

That scaffolds 202 tables, one per event, named for what they are: `perpl__maker_order_filled`,
`perpl__funding_event_completed`, `perpl__position_liquidated` and so on. On the first test run
every observed event decoded, with nothing skipped. On top of the raw tables sit five views in the
units a person uses rather than the chain's fixed-point integers: markets, fills, daily volume by
market, funding history, and liquidations. Open interest and per-account profit are deliberately
absent for now, because they need the exchange's position state machine replayed rather than
summed, and that is a job for nuthatch's incremental entities once the simpler numbers have
proved themselves.

They are proving themselves. The backfill runs from Perpl's first block on 11 February, about
forty-seven million blocks of the densest single contract nuthatch has indexed, and as this is
written it is a fifth of the way through, at about eleven hundred events a second on one paid
endpoint, with the process sitting at 580 MB of memory and zero reorganisations touched. Along the
way it turned up that Perpl's first month of fills was emitted under an older event name than the
current one, which the view now unions; a nest built from the current interface alone would have
reported zero volume for February and March and looked perfectly healthy doing it.

Then we checked the numbers against the only other source there is: Perpl's own public API. Three
full days, chosen across the history. Every hourly funding event on every market matched row for
row, to the integer. Every hour's trade count matched. Every hour's traded notional matched to the
unit, once we understood what the API's number measures: the taker's size times the volume-weighted
price rounded up to the market's tick. That last detail took an afternoon to name, and it is the
kind of thing you only learn by having an independent index to compare against, which is rather
the argument for building one.

```sql
SELECT market, COUNT(*) AS fills, ROUND(SUM(notional_usd)) AS usd
FROM perpl_fills GROUP BY market ORDER BY fills DESC;
```

```
 market   |  fills | usd
----------+--------+-----------
 BTC Perp | 69,193 | 9,003,957
 MON Perp | 58,801 | 1,491,067
```

That was the first three weeks of the venue's life, from a query on our box. The nest itself,
config, vendored interface, views and the parity script, is public at
[nightswatchhq/perpl-nest](https://github.com/nightswatchhq/perpl-nest), and anyone with the
binary and a Monad endpoint can run the same thing:

```sh
nuthatch init --from https://github.com/nightswatchhq/perpl-nest
nuthatch dev --dir perpl-nest --rpc https://your-monad-endpoint --window 320 --seal-direct
```

## What to know before you try it

Two honest caveats, both measured rather than guessed.

**Bring an endpoint for anything serious.** The three built-in public endpoints serve the whole
chain's history of events, so a backfill from a contract's deployment works with no key. But they
are rate-limited, and Perpl at seventy percent of the chain is a matter of days on them. A keyed
endpoint from any of the usual providers indexes at about a thousand events a second per
connection. The endpoint never goes into the nest's config, which is content-addressed; it goes on
the command line or in the service's environment.

**Expect to bring the interface.** Keyless `init` fetches a contract's interface from public
registries, and on Monad's busiest contracts those registries are empty. If your contract is
verified, it is one command. If it is not, find the interface where the team publishes it, as we
did with Perpl's SDK, and pass it with `--abi`. Nuthatch will tell you, per event, whether it
decoded, and it will never fill a table with guesses.

Monad gives the ecosystem a chain fast enough that the data outruns the tooling. Nuthatch gives
anyone on it a way to own that data anyway: one binary, one command, and SQL over everything a
contract has ever said. The Perpl nest is the first proof at scale. The next one is whichever
contract you point it at.
