---
title: "Architecture"
description: "The pipeline, storage, the IVM core, and the transform runtime."
order: 1
---

One codebase, two modes. **Embedded mode** (the default, and the product) is a single process with
zero external services. **Scaled mode** swaps the storage backends behind the same crates for
operator-run deployments (RFC-0022 - designed, deferred). Everything below describes embedded mode.

## The pipeline

```text
RPC ingestion                     (a colocated reth ExEx mode is planned, RFC-0003)
  → deterministic decode          (ABI → typed rows; the decode registry)
  → redb hot store                (the mutable tip: entity point-reads, reorg rollback)
  → sealed Parquet segments       (immutable, content-addressed, past finality)
  → IVM views                     (incrementally-maintained derivations, e.g. balances)
  → serve                         (axum HTTP + the MCP bridge)
```

The load-bearing properties:

- **Determinism in the core.** Decode, reorg handling, and anything feeding stored state is
  deterministic and re-executable - same inputs, same bytes. LLMs may generate code and tests;
  LLM output never sits in the runtime data path.
- **Single writer.** Only the ingestion thread writes. DuckDB attaches the sealed segments
  **read-only** for analytical SQL; never design around concurrent DuckDB writers.
- **The hot/cold seam.** Reorgs only ever touch the hot store; a sealed segment is immutable and
  content-addressed. The `/sql` surface unions both so queries never see the seam.
- **The footprint budget.** ≤2 GB RAM per active-chain cursor, CI-enforced. A design that
  threatens it must surface the tradeoff first.

## The module map

The crate is a library (`lib.rs`) so a second front-end - notably a colocated reth-ExEx build
(RFC-0003) - can reuse the same core rather than fork it; the `nuthatch` binary is one front-end,
and both drive the pipeline through the `Source` trait (`source.rs`).

- **Ingest & decode**: `rpc` (batched extraction, failover, the adaptive getLogs window), `chunker`,
  `abi`, `chains`, `factory` (dynamic child discovery), `indexer` (the loop), `progress`.
- **Storage**: `store` (redb hot store), `seal` (Parquet segments), `blob` + `distribution` +
  `registry` (content-addressed bundles and the nest registry).
- **Derivation & query**: `views` (authored SQL), `recipes`, `analytics` (IVM balances), `serve`
  (the HTTP surface), `sql_errors` (errors-as-prompts), `transform` (the WASIp2 component runtime).
- **Meaning & agents**: `semantic` (the governed semantic layer), `mcp`, `skill` (the generated
  CLI reference), `metadata`.
- **Compliance**: `labels`, `lists`, `screen`, `flags`, `velocity`, `exposure`, `alerts`,
  `webhooks`, `pack`, `audit`.
- **Lifecycle & ops**: `config`, `project` (init/add/scaffolding), `lifecycle` (diff/upgrade),
  `roost`, `metrics`, `bench`, `check`, `cli`, `starlark_config` (legacy, retired).

## Where to start reading

`CLAUDE.md` states the non-negotiables every change is judged against (single static binary; the
2 GB budget; no phone-home; determinism; MIT OR Apache-2.0). The [RFC series](/docs/contributing/rfcs/) is
the design record - each module's header comments name the RFC that shaped it. The progress log in
`docs/` narrates how it actually went.
