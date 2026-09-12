---
title: "We tried to drop-in replace a dead subgraph. We could not. Here is what we built instead, and why we stopped."
description: "A subgraph stops, nobody fixes it, and your app goes dark. We spent three weeks trying to make a nest answer the same GraphQL so you could change a URL and carry on. It does not work, for a reason worth understanding. This is what we measured, what we built anyway, what it is genuinely good for, and why we are parking the rest."
date: 2026-09-12
author: "cargopete"
tags: ["nuthatch", "the-graph", "subgraphs", "graphql", "postmortem", "honesty"]
---

*Three weeks ago we set out to make a nuthatch nest answer a dead subgraph's GraphQL, so that a
consumer could change one URL and carry on. We got a long way and then measured it properly. It does
not work, and the reason it does not work is more interesting than the reason we thought it might. This
post is the whole account: the premise, the build, the measurement that killed it, the parts that are
genuinely useful and staying, and why we are stopping rather than grinding on.*

## The problem, which is real

A subgraph is a small program that reads a blockchain and turns it into a queryable database. You write
some TypeScript that says "when this contract emits this event, write this row", you deploy it to The
Graph, and your application queries it with GraphQL. It is a good design and an enormous amount of the
industry runs on it.

Subgraphs stop. Sometimes an RPC provider changes behaviour and a call that used to return a number
returns null. Sometimes a contract gets deployed that the mapping did not anticipate and a handler
throws. When a subgraph hits a deterministic error, graph-node halts the deployment. It does not
half-work. It stops, at a block, forever, until somebody redeploys it.

And often nobody does. The person who wrote it moved on. The DAO that funded it wound down. The
protocol still exists, the contracts are still emitting events, and the index that told you what was
happening is frozen at a block eight months ago. Your application is now showing stale data or nothing
at all, and your options are to write and operate a replacement yourself or do without.

We sampled fifty-six subgraphs and found fourteen genuinely frozen. Not slow, not lagging: stopped, with
a head that does not move when you read it twice.

That is a real problem and it is the one we wanted to solve.

## The premise, which was seductive

Nuthatch indexes chains into your own DuckDB and Parquet, on your own machine, with one binary. It
already knew how to read a subgraph's *inputs*: point it at a deployment and it fetches the manifest,
the verified ABIs, the start blocks and the factory patterns, and builds a nest that indexes the same
contracts.

So the idea more or less suggests itself. If we already index the same events, and we can read the
subgraph's `schema.graphql`, could we not generate the same GraphQL API over our own tables? The
consumer changes a URL. Nothing else. Their queries, their client, their code all stay as they are.

We called it a drop-in replacement, and that name did us real damage for three weeks, in a way I will
come back to.

## What we built

This part is not a failure and it is worth describing, because it all works and it is all still here.

**Schema generation.** graph-node generates a GraphQL schema from your entity definitions: singular and
collection root fields, a filter input type per entity with a specific operator set per scalar, order-by
enums, `_meta`, and reverse lookups for `@derivedFrom` relations. We generate the same thing. Not
approximately: we read graph-node's own source, which is MIT and Apache licensed and perfectly
readable, and implemented the rules it implements. `Bytes` gets ten filter operators and `String` gets
twenty, because that is what graph-node does. An enum gets four and none of them is a comparison,
because an enum has no ordering.

When we needed to pluralise an entity name for its collection root, we did not write a rule. graph-node
calls `to_plural` from a specific inflection library, so we call the same function from the same library
at the same version. Our own version of the rule gave `matchs` for an entity called `Match`. The library
gives `matches`. It also gives `persons` for `Person` and `childs` for `Child`, which is not correct
English, and that is exactly the point: the target is not correct English, it is one specific library's
output, because that is what the client was generated against.

**A query compiler.** GraphQL in, SQL out. Singular roots, collections, `where` filters with the full
operator set, `and` and `or` trees, filters that reach through a relation, ordering, pagination,
traversals to a related entity by join, and `@derivedFrom` lists by aggregating the child rows into one
JSON column rather than doing a query per parent.

**The value contract.** graph-node maps every stored value to a GraphQL value in one function, and only
one of its numeric types stays a number. `Int` is a JSON number. `Int8`, `Timestamp`, `BigInt` and
`BigDecimal` are all JSON *strings*, because a number above 2^53 does not survive JavaScript. We send
what graph-node sends.

**Time travel, partly.** The `block` argument has three forms and one of them turned out not to be time
travel at all. `block: { number_gte: N }` means, in graph-node's own words, "execute on the latest block
only if the subgraph has progressed to or past this block". That is a precondition on the head, not a
request for a past state, and a nest can answer it exactly with no history stored. It is also the form
clients actually send, because it is how you get read-your-writes after a transaction. We answer it. The
forms that name a specific past block are refused, by name.

All of that is real, it is tested, and it is on main.

## The measurement that killed it

We picked two subgraphs and measured, rather than reasoning. Uniswap V4, because it is the shape of
thing people care about, and Carbon, because it is a different shape.

On Uniswap V4, a nest answers **70 of 184** fields that our own analysis classifies as reproducible from
decoded events. Thirty-eight percent. On Carbon it answers 41 of 92, forty-four percent.

Thirty-eight percent sounds like a partial success. It is not, for two reasons, and neither of them was
in our plan.

### GraphQL has no partial answer

If a query names five fields and the server cannot answer one of them, the client does not get four
fields and an error. It gets an error. The whole query fails.

So field coverage is an upper bound on query coverage, and a very loose one. A surface answering
thirty-eight percent of fields might answer thirty-eight percent of queries, or five percent, or none,
depending entirely on how the fields are distributed across the queries people actually send.

We had been tracking field coverage for three weeks as though it were progress toward usefulness. It is
not. It is progress toward a number.

### The fields divide by kind, and we got the wrong half

The split is not a random thirty-eight to sixty-two. Look at what answers and what does not.

**Answers:** ids, timestamps, block numbers, log indices, addresses, token ids, transaction hashes,
values taken straight out of an event's parameters, and relations between those.

**Does not answer:** `Token.symbol`, `name`, `decimals`. `Pool.volumeUSD`, `feesUSD`,
`totalValueLockedUSD`, `token0Price`, `token1Price`, `liquidity`, `txCount`, `feeTier`. `Swap.amount0`,
`amount1`, `amountUSD`. And `PoolDayData`, `PoolHourData`, `TokenDayData`, `UniswapDayData`, `Bundle`
and `PoolManager` have no table at all.

One list is identity and structure. The other list is every economic quantity in the schema.

Nobody builds a product on `Swap.logIndex`. A perfectly ordinary query against this subgraph looks like
`pools(orderBy: totalValueLockedUSD) { totalValueLockedUSD volumeUSD token0 { symbol } }`. Four fields.
A nest answers none of them. That consumer does not get a degraded experience, they get an error.

For a dashboard, an analytics product, anything with a number on the screen, this is not a partial
replacement. It answers nothing they would ask for.

## Why the missing half is missing

This is the part that makes it a design boundary rather than a backlog.

A field like `Swap.amount0` is not in the event. The event carries a signed 128-bit packed value, and
the mapping decodes it, divides by ten to the power of the token's decimals, and stores the result. To
get the decimals, it calls the token contract. To store the result in USD, it looks up a price, which it
computes from the pool's own reserve ratio, which it computed on a previous event, which depended on a
price it computed before that.

That chain is the subgraph's mapping code, running in order, accumulating state. Reproducing it
byte-for-byte means running that code with the same host semantics, in the same order, against the same
intermediate values. That is not a compiler over stored data. That is a second indexer.

We decided, well before this work, that nuthatch would not be that. Our entity derivation is
deterministic and re-executable, it does not run AssemblyScript in the indexing path, and we do not
promise byte-identical output for values that are the product of ordered stateful mapping code. That
decision is written down, we still think it is right, and it is the reason this half of the surface is
not a matter of more effort.

There is a third possibility we have not taken: serve a *converged* value, clearly marked as computed
differently. For some of these fields our number would arguably be more correct than the reference, because
the reference carries artefacts of the order its writes happened to occur in. But "arguably more correct"
and "the number your existing client expects" are different things, and deciding whether a nest may serve
the first while a client asks for the second is a real decision we have not made. It is written up and
parked with the rest.

## What went wrong in how we worked

Two things, and they are more useful than the architecture story.

**We measured the wrong thing for three weeks.** Field coverage was easy to compute and went up
satisfyingly. Query coverage was the number that decided whether anyone could use this, and we never
measured it once. We are parking the work before measuring it, which is itself a small indictment: we
now think the answer is "approximately none for an analytics client" from inspecting the field lists,
but we have not run a real query corpus through it.

**The name made us stupid.** Calling it a drop-in replacement made "can a client adopt it unmodified"
feel like a thing that would arrive gradually as coverage rose. It is not gradual. Because one
unanswerable field refuses a whole query, adoption is close to binary per query, and the fields we were
missing were the ones every query names. A more honest name at the start would have prompted the
question three weeks earlier.

## What did go right, which was the correctness discipline

Every single defect we found in review was a **silent substitution**. Not one was a crash. That is worth
saying in detail, because it is the thing we would want a user to trust.

A `BigInt` was going out as a JSON number where graph-node sends a string. Two of our own tests
asserted the wrong value, because they were written before there was anything to check them against, and
they had the defect pinned for weeks.

Ordering on a big number compared text rather than numbers, because a nest stores large integers as
canonical decimal strings. So `9000351` ranked above `60000353`, since `'9'` is greater than `'6'`. A
client asking for the largest pools by value would have got a plausible, ranked, wrong list with no
error anywhere. Text order agrees with numeric order exactly when every value has the same number of
digits, which is why a test fixture never shows it and real data always would.

A filter value of `null` compiled into a comparison against the four-character string `'null'`.

An alias inside a nested list was silently replaced by the underlying field name, so a client asking for
`sid` got `id`.

Each of those returns something that looks like an answer. We found them by writing the test, then
deliberately breaking the code to check the test actually fails, and treating a test that stays green
against broken code as a finding in its own right. Several times that caught a test proving nothing. One
of them was an end-to-end test we were rather pleased with, which passed while never exercising the
storage layer it existed to exercise, because our fixture was too small to trigger it.

The result of all that: **there is no known path through this surface that returns a wrong number.**
Every field either answers exactly or is refused by name with a reason. That property held all the way
through and it is the one we are keeping.

## So what is it actually good for

This is not consolation. It is a real and narrower thing.

If you want the **event record**, it works today and it works exactly. Every swap on a pool since some
block, with the sender, the transaction hash, the log index and the raw amounts as the contract emitted
them. Every transfer, every position change, every subscription. Over the full history, spanning the hot
store and sealed Parquet, with filters and ordering and pagination that behave the way you expect.

That is bots, reconciliation, audit trails, backfills, anyone rebuilding their own view from primary
data, anyone who needs to know what happened rather than what it was worth at the time.

And it depends far more on the shape of your subgraph than on how much of this we built. Carbon, our
second target, has no priced fields at all. Its entities mirror its events. It answers forty-four percent
today and the missing half is ordinary engineering rather than a design boundary. A good number of
subgraphs are shaped like that.

There is one command that tells you which you are. `nuthatch port-emit` prints a coverage line, writes it
into the nest's README, and names every single unanswered field with the reason it is unanswered. Check
your own queries' fields against that list. The percentage at the top is not the number that matters;
whether *your* fields are in it is.

## Why we are stopping

The work is sound and the remaining grind is real: a hundred and fourteen more fields, an unbuilt path
for contract-call metadata like token symbols, an entity-history store for real time travel. None of it
is blocked. We could keep going.

We are stopping because we do not have the user. We built this for someone with a dead subgraph, and
then discovered that for the most likely version of that person, it answers nothing they would ask. The
version of that person it does serve, we have not met. Building the next hundred fields on the guess that
they exist is how you spend another three weeks measuring the wrong thing.

So it is parked, with the trigger written down: **a named consumer with a stopped subgraph whose queries
fall inside the event-shaped surface, asking for it.** Not a coverage figure. A person.

What shipped stays shipped, supported, and documented for what it is. If that is you, the endpoint is
there, it will tell you honestly what it cannot answer, and it will never hand you a number that is
quietly wrong.

If it is not you, we would rather say so here than let you find out one query at a time.
