---
title: "CLI guide"
description: "The everyday Nuthatch commands, with the generated full reference linked below."
order: 1
---

The whole product is meant to be two commands - `init` and `dev` - and everything else serves them.
The **authoritative, machine-generated full reference** (every subcommand and flag, rendered from clap's
own metadata and drift-gated in CI) ships in the repo as
[`skills/nuthatch-builder/cli-reference.md`](https://github.com/nightswatchhq/nuthatch/blob/main/skills/nuthatch-builder/cli-reference.md).
If a flag isn't there, it doesn't exist. This page is the guided tour: use it to understand the
workflow, then use the generated reference when you need the exact spelling of an option.

Every command that operates on a nest takes `--dir` (default `.`).

## The two commands

- **`nuthatch init <address>…`** - scaffold a nest from one or more contract addresses: resolve
  each ABI (Sourcify → Etherscan), detect the deployment block, and write the project. Omit
  `--chain` - init probes the known chains for the contract's bytecode and picks the one it lives
  on. `--alias` names the contracts (default `c0, c1, …`); `--rpc` prefers your own endpoints;
  `--from <git-url|dir>` initialises from a published nest instead of addresses (nothing is
  resolved - ABIs are vendored, so it's cloned, copied, and validated).
- **`nuthatch dev`** - run it: backfill, follow the tip, serve the API. `--listen` (default
  `127.0.0.1:8288`), `--rpc` runtime overrides, `--backfill N` (recent-history mode),
  `--seal-direct` (backfill finalized history straight to Parquet - much faster from deployment),
  `--concurrency` (concurrent window fetches; 8-16 against your own node), `--window` (override the
  `getLogs` block-window - large for sparse contracts), `--no-admin`.

## Everyday companions

- **`nuthatch add <address>…`** - grow an existing nest with another contract; no re-init.
- **`nuthatch sql [query]`** - query the live tip ∪ sealed history; prints a table. No query opens
  a REPL (`.tables`, `.schema <t>`, history). `--json` emits NDJSON for piping to `jq`.
- **`nuthatch schema`** - regenerate the derived artifacts (`schema.json`, `llms.txt`, the
  `semantic.toml` footguns) after hand-editing `nuthatch.toml`.
- **`nuthatch mcp`** - serve MCP over stdio, bridging to a running `dev` (`--url`).
  `--print-config` prints a copy-paste client config instead. See [MCP](/docs/ai/mcp/).
- **`nuthatch check [name]`** - run the nest's invariant/parity checks (`checks/*.sql`) against
  recorded expected results; `--update` records current results as the fixtures.

## Derive-first reads (RFC-0023)

- **`nuthatch recipe list`** / **`recipe add <name>`** - add a derived view that computes a read
  (e.g. `total_supply`) from indexed events instead of an `eth_call`. No archive node,
  deterministic, free.
- **`nuthatch metadata fetch`** - fetch and cache a token's immutable `decimals`/`symbol`/`name`
  once; remembered in `metadata.json`.

## Packaging & lifecycle (RFC-0012, 0019, 0020)

- **`nuthatch nest bundle`** - package a nest's authored inputs into one portable,
  content-addressed `.bundle`; prints the content address. `--as-dir` writes an inspectable
  directory instead.
- **`nuthatch nest load <bundle|url|dir>`** - verify a bundle (manifest format, every file's hash,
  and that the regenerated decode registry matches) and install it as a runnable nest. `--expect`
  asserts the hash; `--registry` resolves a `name[@version]` reference instead.
- **`nuthatch nest publish <bundle> --registry <store>`** - publish under `name@version`, advancing
  `latest`.
- **`nuthatch migrate --dir <dir>`** - move a pre-2.0 directory to identity-keyed datasets, and apply
  a staged nest upgrade. Classifies the change and **refuses a breaking one by name**
  (`--allow-breaking` to accept). Moves data and never re-indexes; `--dry-run` prints the plan.
- **`nuthatch prune --dir <dir>`** - reclaim datasets and shared segments nothing mounts any more.
  Lists by default; `--yes` deletes.

- **`nuthatch dev`** - run many nests behind one listener; `--fail-fast` exits on the first
  fault instead of quarantining it (RFC-0026). See
  [Run a runtime](/docs/operate/many-nests/).

## The compliance pack (RFC-0008)

- **`nuthatch labels import|list`** - labeled address sets as content-addressed snapshots.
- **`nuthatch lists fetch|list`** - sanctions/watch lists (`ofac-sdn`, `eu-consolidated` have
  default URLs; any other name takes `--url` or `--file`).
- **`nuthatch screen --list <hash> --from N --to N`** - screen sealed transfers, recording
  replayable `sanction_hit` annotations.
- **`nuthatch pack keygen|build|verify`** - the signed compliance-pack manifest (ed25519).
- **`nuthatch audit replay|report`** - re-prove the annotations from scratch, or summarise them
  over a range (`--json`).

## Measurement

- **`nuthatch bench backfill --from N --to N`** - events/sec, wall-clock, peak RSS over a pinned
  range (`--runs 3`; the report is the median). `--seal-direct` measures the direct-to-Parquet
  path.
- **`nuthatch bench query`** - the read path: entity point-read p50/p99 and the `/sql` hot∪cold
  scan cost. Run offline against an already-indexed nest (stop `dev` first).
- **`nuthatch transform <component.wasm>`** - run a WASIp2 transform component over stored
  transfers.
