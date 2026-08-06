---
title: "Configuration"
description: "nuthatch.toml and mounts.toml, field by field."
order: 2
---

Three files, all TOML. `nuthatch.toml` is written by `init` and yours to edit; `semantic.toml` is
covered in [The semantic layer](/docs/build/semantic/); `mounts.toml` mounts many nests. A nest
declaring a `schema_version` newer than the binary understands is rejected on load - the guard that
makes `init --from` and `nest load` safe.

## `nuthatch.toml`

```toml
[nest]
name = "usdc"                 # nest name (also the runtime mount name)
chain = "mainnet"             # mainnet | arbitrum-one | base
chain_id = 1
rpc_urls = ["https://…"]      # tried in order, with failover
schema_version = 1            # managed by nuthatch
block_timestamps = true       # default; set at init, not editable afterwards - see below


### `block_timestamps`

Whether every row carries `block_timestamp`. On by default, and the most consequential decision
`init` makes on your behalf.

Timestamps cost a block-header round trip per block - around **85% of backfill wall clock** - for a
column many nests never query. A nest that will never ask a time-series question can drop it:

```sh
nuthatch init 0xAddr --no-timestamps
```

**It is an init-time choice, deliberately not a flag you can flip.** Changing it later removes a
column that consumers may be reading, which RFC-0020 classifies as *breaking*, and it means a full
re-index. Blocks give you ordering; only timestamps give you time. If you are unsure, keep them - 
the default is on for a reason.

Flipping the value in `nuthatch.toml` by hand is refused at startup rather than honoured silently,
because a store written one way cannot be read the other.

[[contracts]]                 # one or more
alias = "usdc"                # table prefix → usdc__transfer, usdc__approval, …
address = "0xA0b8…eB48"
start_block = 6082465         # optional; deployment block (init detects it)
abi = "abis/usdc.json"        # vendored ABI path, relative to the nest dir
events = ["Transfer"]         # optional allowlist; omit to decode every ABI event
```

The per-contract `events` allowlist is how a nest indexing e.g. GraphToken keeps only `Transfer`
instead of millions of irrelevant rows. A name the ABI doesn't define is a config error, caught at
registry build.

### Any other EVM chain

Ethereum mainnet, Arbitrum One and Base are **built in** - keyless public endpoints, a tuned
`eth_getLogs` window, chain-appropriate finality, and bytecode probing so `init` can detect which of
them a contract lives on.

**Any other EVM chain works too** - World Chain, Base Sepolia, your own devnet - it just has to be
configured by hand. `dev`, `sql`, `bench`, and `dev` are chain-agnostic; `init` and `add` are
not, since ABI resolution is chain-gated. So the recipe is: write `nuthatch.toml` yourself, vendor
the ABI, and run.

```toml
[nest]
name = "my-nest"
chain = "world-chain"        # any label you like - not looked up for an unlisted chain
chain_id = 480               # MUST match what your endpoints report; verified at startup
rpc_urls = ["https://your-endpoint.example"]
schema_version = 1

[[contracts]]
alias = "router"
address = "0x…"
start_block = 1234567        # no bytecode probing here, so supply it yourself
abi = "abis/router.json"     # vendor the ABI by hand
events = ["Swapped"]
```

Then `nuthatch dev --dir .` as usual - decode, sealing, `/sql`, views, MCP, runtimes, and bundles are
all chain-agnostic downstream. Two caveats worth knowing:

1. **You inherit default finality and window.** An unlisted chain gets depth-64 finality and a
   20-block `eth_getLogs` window, because nuthatch has no per-chain policy for it. Depth-64 is an
   Ethereum-L1-shaped assumption; if your chain finalises differently, the conservative direction is
   *deeper*. The 20-block window will make a long backfill crawl - raise it with `--window` (a
   sparse contract can often take 50000) up to your provider's range cap.
2. **`chain_id` is enforced.** Every endpoint in `rpc_urls` is checked against it at startup and a
   mismatch is refused - get it wrong and nuthatch tells you immediately rather than three days into
   a backfill.

### Factories (RFC-0009)

```toml
[[templates]]
name = "pool"                 # shared table prefix for all discovered children
abi = "abis/pool.json"
filter = "topic0"             # optional: force the topic0-only backfill strategy
events = ["Swap"]             # optional: which of the ABI's events to decode (default: all)

[[factories]]
watch = "factory"             # the *alias* of the watched contract (or a template, for nesting)
event = "PoolCreated"         # the announcing event
child_param = "pool"          # the event param holding the child's address
template = "pool"             # which [[templates]] the child uses
start = 12369621              # optional: ignore discoveries before this block
```

All children of one template share tables (`{template}__{event}`), distinguished by the implicit
`address` column. `filter = "topic0"` is a strategy override for templates known to have many
children; omit it for the automatic address-list → topic0 flip (around ~500 children). See
[Factories](/docs/build/factories/).

`events` chooses **what is decoded**, where `filter` chooses **how the range is fetched** - two
different questions that are easy to confuse. Without it the vendored ABI is the only filter, so a full
`UniswapV2Pair` ABI decodes Swap, Sync, Mint, Burn, Transfer *and* Approval when the nest wanted Swap:
not wrong, but a different workload, and nothing said so. An absent or empty list still decodes
everything, so existing nests are unaffected. A name the ABI does not define is a config error, caught
when the nest loads rather than surfacing as an empty table after the backfill.

`--from-subgraph` fills this in for you: a subgraph declares `eventHandlers` per template, so an
imported nest decodes what the subgraph decoded rather than a superset of it.

### Screening, flags, alerts (RFC-0008)

```toml
[screening]
lists = ["<list-hash>"]           # snapshot hashes from `nuthatch lists fetch`

[flags]                           # amounts are token BASE UNITS as decimal strings (i128)
threshold = "1000000000000"       # flag any single transfer ≥ this
velocity_amount = "5000000000000" # flag an address whose windowed outbound volume ≥ this
velocity_window = 7200            # window in BLOCKS (default 7200 ≈ 24h of 12s mainnet blocks)

[[alerts]]                        # route annotations to webhook sinks
kinds = ["sanction_hit", "threshold_flag"]
url = "https://…"
```

All three are opt-in: absent means no screening, no flags, no alerts, zero cost. Alert delivery is
at-least-once via a durable outbox; a stalled sink never blocks indexing. Note `velocity_window` is
a **block count**, not wall-clock - an honest approximation, since the chain has no clock.

### Webhooks (RFC-0010)

```toml
[[webhooks]]
name = "large-transfers"
table = "usdc__transfer"
where = "value_dec > 1000000"     # optional SQL predicate (note the key is `where`)
url = "https://…"
batch_max = 100                   # optional rows-per-POST cap
finality = "sealed"               # "sealed" (default, and the only mode today); "tip" is planned
since = "registration"            # "registration" (default) | "genesis" | a block number
secret = "…"                      # optional; adds X-Nuthatch-Signature: sha256=<hex> (HMAC)
```

`since = "registration"` means a `--seal-direct` backfill won't fire history at your endpoint. See
[Webhooks](/docs/build/webhooks/).

## `mounts.toml`

```toml
[runtime]
name = "my-runtime"
chain = "mainnet"
chain_id = 1
rpc_urls = ["https://…"]
nests = ["usdc", "weth"]      # subdirectories under nests/ to mount
max_rss_mb = 2048             # optional per-cursor RAM ceiling (default 2048)
```

See [Run a runtime](/docs/operate/many-nests/) for the multichain `[[chains]]` shape (RFC-0021).

## A note on `nest.star`

An earlier Starlark front-end (`nest.star`, RFC-0018 §2) could *compute* a nest's config. It is
**retired**: author nests in plain `nuthatch.toml`. The loader still evaluates a legacy `nest.star`
hermetically for backward compatibility, but don't write new ones.
