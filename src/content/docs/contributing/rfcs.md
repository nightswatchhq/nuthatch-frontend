---
title: "RFCs"
description: "The numbered design record - every decision, what shipped, what's deferred."
order: 2
---

Every non-trivial design decision in nuthatch is written down first, as a numbered RFC in
[`docs/rfcs/`](https://github.com/nuthatch-indexer/nuthatch/tree/main/docs/rfcs). They're numbered
in build order, each states its dependencies and what it blocks, and the status lifecycle is
**Draft → Accepted → Implemented → (Superseded / Parked)**. Statuses are reconciled against the
progress log; measured numbers are cited, and targets are labeled as targets, never as results.

## The series

- **0001 Generalized decode & nests** *(Implemented)* - the foundation: multi-contract nests, the
  decode registry.
- **0002 The Horizon nest** *(Implemented)* - the first real-world nest.
- **0003 reth ExEx tip mode** *(Accepted; deferred)* - colocated-node ingestion.
- **0004 Backfill throughput** *(Implemented)* - measure first, optimise second; seal-direct.
- **0005 Release engineering** *(Implemented)* - the v0.1.0 bar and beyond.
- **0006 Grant funding** / **0007 Launch & validation** *(Accepted; process)* - the non-engineering
  record.
- **0008 The compliance pack** *(Implemented)* - labels, lists, screening, flags, exposure, the
  signed audit pack.
- **0009 Factories** *(Implemented)* - dynamic child-contract discovery.
- **0010 Admin UI & webhooks** *(Implemented)* - ease-of-use parity.
- **0011 The graph-network nest** *(Parked after pilot)* - the wedge proven in prod.
- **0012 Multi-nest runtime & packaging** *(Implemented)* - roosts and content-addressed bundles.
- **0013 Storage & query-engine direction** *(Accepted)* - the DuckDB union shipped; DataFusion
  convergence gated.
- **0014 Firehose-class extraction** *(Draft; deferred)* - traces and state diffs via ExEx.
- **0015 The delightful core** *(Implemented)* - the REPL, magical init, live feedback, `add`, the
  MCP one-liner.
- **0016 The semantic layer & agent-grade MCP** *(Implemented)* - `semantic.toml`, errors-as-
  prompts, `explain`, result shaping, resources & prompts, the eval harness.
- **0017 The builder skill** *(Implemented)* - the generated, drift-gated CLI reference.
- **0018 What a nest is** *(§1 implemented; §2 retired; §3 deferred)* - authored SQL views;
  the Starlark front-end, retired.
- **0019 The nest registry** *(Implemented)* - publish and pull by `name@version`.
- **0020 Nest lifecycle & the N-1 upgrade** *(Implemented)* - `diff`, hot-swap, deprecation,
  segment reuse. The resync tax, killed.
- **0021 The multichain roost** *(Accepted; slice 1 shipped)* - one runtime, one isolated cursor
  per chain.
- **0022 Distributed scaled mode** *(Accepted; design only)* - read/write planes for operators.
- **0023 Contract state, derive-first** *(Accepted; tiers 1-2 shipped)* - the `eth_call` you don't
  need: derived-view recipes and the immutable-metadata cache.
- **0024 The eth_call execution engine** *(Draft)* - a demand-driven state cache, if the residue
  demands it.
- **0025 Adaptive MCP tool advertisement** *(Implemented)* - advertise only the tools a nest can
  answer, so an agent is never handed an inert tool that returns `{"count":0}`.
- **0026 Fault quarantine & partial health** *(Implemented)* - a roost survives its sick nests: a
  nest's error no longer kills its cursor, and a cursor's death no longer kills the roost.
- **0027 The live roost** *(Draft; slices 1-2a merged)* - mounting and unmounting nests without a
  restart, so onboarding one tenant doesn't restart every co-tenant.
- **0028 Adaptive log-range control** *(Draft; slices 1-3 merged)* - a fix pack for `eth_getLogs`
  range control: classify RPC failures properly rather than retrying an auth rejection forever.

## Conventions

Every RFC honours the non-negotiables (single static binary, the ≤2 GB budget, no phone-home,
determinism in the core, AGPL-3.0) and carries the standard structure: Abstract, Motivation,
Goals/Non-goals, Design, Implementation, Testing, Risks, Alternatives, Open questions. Companions
in `docs/`: **backlog.md** (everything deferred across the series), **prod-readiness.md** (the bar
a release clears before it's pointed at a real workload unattended), and the **progress log** (the
running narrative the statuses are reconciled against).

Proposing a change? Open a [discussion](https://github.com/nuthatch-indexer/nuthatch/discussions)
first; if it survives contact, it becomes the next number.
