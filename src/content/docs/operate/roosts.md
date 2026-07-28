---
title: Run a roost
description: One runtime hosting many nests across one or more chains - one isolated cursor per chain.
order: 3
---

A **roost** is one runtime hosting many nests. Nests on the same chain share a single cursor and
one `getLogs` per window - N nests for roughly one nest's RPC cost - and a roost can also span
**multiple chains**, running one isolated cursor per chain: a Base nest and an Arbitrum nest in one
process. Each cursor has its own tip, finality, and reorg boundary, and a per-cursor footprint
budget.

## Layout

A roost is a directory with a `roost.toml` and a `nests/` folder of ordinary nests:

```text
my-roost/
  roost.toml
  nests/
    usdc/        # a normal nest - nuthatch.toml, abis/, views/, …
    weth/
```

```toml
[roost]
name = "my-roost"
chain = "mainnet"
chain_id = 1
rpc_urls = ["https://…"]
nests = ["usdc", "weth"]     # subdirectories under nests/ to mount
max_rss_mb = 2048            # optional per-cursor RAM ceiling
```

A nest can't tell it's co-hosted: its config, storage, and routes are identical to a solo `dev`.
Mount an existing nest by copying (or [`nest load`](/docs/operate/registry/)-ing) it into `nests/`
and adding its name.

## Run it

```sh
nuthatch roost dev
```

This brings up every mounted nest and serves them behind one listener (`--listen`, default
`127.0.0.1:8288`):

- `GET /nests` - the roster: each nest's name, chain, registry hash, table count, and footprint.
- `GET /<name>/…` - each nest's **full API** under its prefix: `/usdc/sql`, `/usdc/tables`,
  `/weth/_admin/`, and so on. Byte-identical routes to a solo nest, just prefixed.

The backfill flags you know from `dev` apply to every mounted nest: `--backfill N`,
`--seal-direct`, `--concurrency`, `--window`, `--rpc` overrides, `--no-admin`.

## When one nest goes wrong

A roost survives its sick nests (RFC-0026). A nest that faults is **quarantined**, not fatal: its
healthy siblings keep indexing and serving, and it is re-admitted on a backoff if the fault was
retryable. A terminal fault (a corrupt registry, a config that can't load) stays quarantined until
you fix it. The blast radius is bounded in both directions - a nest's error doesn't kill its cursor,
and a cursor's death doesn't kill the roost.

You see it in three places: `GET /nests` carries each nest's live health and re-admission time,
`GET /ready` at the roost root answers roost-wide while `GET /<name>/ready` answers per nest, and
`nuthatch_nest_health` / `nuthatch_nest_quarantine_total` / `nuthatch_cursor_live` cover the
[metrics](/docs/operate/metrics/) side.

Pass `--fail-fast` to opt out and exit on the first fault instead - the right call for CI and
deterministic tests, and for operators who would rather a process die loudly than serve partially.

## Multichain

To span more than one chain, drop the top-level `chain`/`chain_id`/`rpc_urls` and list chains under
`[[chains]]` (a top-level array beside `[roost]`); each nest declares its own `chain` in its
`nuthatch.toml`:

```toml
[roost]
name = "my-roost"
nests = ["usdc", "base-app"]   # usdc → mainnet, base-app → base
max_rss_mb = 2048              # per-cursor; a roost's total budget is Σ cursors

[[chains]]
chain = "mainnet"
chain_id = 1
rpc_urls = ["https://…"]

[[chains]]
chain = "base"
chain_id = 8453
rpc_urls = ["https://…"]
```

Exactly one form: top-level `chain` **or** `[[chains]]`, never both or neither.

## Isolation

Chain identity is shared per cursor; **stores are per-nest and isolated** - each nest keeps its own
redb hot store and its own sealed segments. A reorg rolls back every nest on that cursor's hot
store together (same chain, same boundary); sealed history is immutable everywhere. The roster and
[per-nest metrics](/docs/operate/metrics/) let you see each nest's own progress and footprint
rather than one blended number.

One rule to keep: **one cursor per chain, one chain per cursor.** To index a second chain, add a
second `[[chains]]` cursor (or run a second process) - never try to multiplex chains behind one
cursor.
