---
title: Authoring modes
description: Declarative incremental views (the default) and imperative WASM components (the escape hatch).
order: 6
checked: 4.12.0
---

There are two ways to author what a nest computes. The default is declarative; the escape hatch is
imperative. Both feed the same deterministic core.

## Declarative (default)

Entities are **incremental views over decoded events**, maintained by the IVM core (DBSP / Feldera
crates). You *state* a derivation - "balance = Σ(in) − Σ(out)" - as a circuit, and it's maintained
incrementally: a new transfer is a +1 delta, a reorg is the *same* transfer re-fed with weight −1 (a
retraction). Backfill and tip run the identical circuit.

This is the differentiator. You never hand-write "on transfer, load balance, add, save." You declare the
answer, and reorgs, backfills, and tip-following all fall out of the same statement. Your own
maintained relations are [incremental entities](/docs/build/entities/), declared in `entities.toml`.

[Authored SQL views](/docs/build/views/) and [recipes](/docs/build/recipes/) are declarative too, but
not incremental: they are named queries evaluated when a reader asks, over hot and sealed data. Between
them, the happy path needs zero user-written components.

## Imperative (the escape hatch)

For logic a view can't express, a nest may use **WASM component handlers** - a transform runtime ported
from the *liminal* prototype (Wasmtime, the component model, WASIp2). The contract is strict:

- **Components are pure functions** - `batch of blocks → batch of facts`. All state lives host-side.
- **The boundary is batched.** WIT interfaces take *lists* of events or Arrow IPC buffers - never one
  event per call. Arrow is the interchange format everywhere.
- **Components never see reorgs** and have no rollback interface; the host handles reorg via hot-store
  rollback and IVM retractions.
- **Capabilities are injected per component** at composition time - `wasi:http`, key-value, filesystem -
  never per pipeline.

## Purity by construction

The rule that ties it together: **only zero-capability components may feed entity derivation.** A
component granted no capabilities is deterministic by definition, so its output can be a canonical
entity. An *effectful* component (an HTTP enricher, say) produces **annotations only** - never canonical
entities. Purity is checkable from the composition manifest - no code inspection required.

This is what keeps the [determinism](/docs/concepts/determinism/) guarantee intact even with an imperative
escape hatch: effects live at the edge and are labelled; the data path stays pure.

> Components are the escape hatch, not the front door. A freshly-`init`-ed nest is a working indexer with
> **zero user-written components** - generated decode plus declarative views.

## Next

- [Authored SQL views](/docs/build/views/) - the declarative logic layer
- [Recipes](/docs/build/recipes/) - derive contract reads with no eth_call
- [Determinism](/docs/concepts/determinism/) - the purity rule this enforces
