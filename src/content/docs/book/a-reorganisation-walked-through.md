---
title: "Appendix B. A reorganisation, walked through"
description: "A concrete hot-store rollback, the shared-cursor fan-out, and the line Nuthatch will not cross."
order: 11
---

Reorganisations are where an indexer either demonstrates that it understands a blockchain or
quietly begins preserving fiction. The normal case is recoverable precisely because Nuthatch keeps
the recent part of history hot and reversible.

Consider a cursor that has processed blocks 100 through 110. Its finality policy has sealed through
block 104. Blocks 105 through 110 remain in the hot store, along with block-hash checkpoints. A
transfer in block 108 has incremented a derived balance view. At this instant that is a valid,
useful result, but it is not yet final.

## The chain changes its mind

On the next poll, the cursor obtains a head which does not agree with its recorded checkpoint for
block 110. It walks backwards through the known checkpoints and the source's current block hashes
until it finds the deepest common ancestor. In this example, block 106 still agrees; blocks 107 to
110 were replaced. The ancestor is 106.

The cursor does not try to patch individual logs based on a hunch. It performs a rollback to the
ancestor. The hot store deletes rows above 106, resets its last-block metadata to 106 and removes
the checkpoints that belonged to the old branch. The derived balance view retracts the effect of
the former transfer in block 108. Factory child discovery that occurred only on the discarded
branch is rolled back as well. The cursor then starts again at 107 and indexes the canonical
replacement blocks in the normal path.

The application may have observed a provisional balance before the rollback. That is inherent to
serving near-tip data. What Nuthatch promises is convergence: once it notices the reorg, neither
the raw table nor a maintained derivation may retain the old branch.

## Shared cursor, many datasets

Now place three nests on the same chain cursor. The cursor detects the hash disagreement once at
its shared boundary, then fans the rollback out to every live dataset. Each dataset may have a
different sealed watermark because it may have been mounted at a different time or progressed
differently. A nest already at or below the ancestor does nothing. A nest whose hot range contains
the discarded blocks retracts them. If one nest cannot roll back, it is quarantined rather than
making the other datasets lie about their state.

This is why a shared cursor does not require shared mutable tables. Fetching and reorg detection are
shared chain work. Row ownership, store mutation and local failure handling remain per dataset.
The structure is slightly more machinery than one giant database, but much less machinery than
trying to explain which tenant's rows were inadvertently removed by a global repair.

## The finality line

Return to the example. A reorg to ancestor 106 is repairable because the seal watermark was 104.
Every affected block is still in the reversible hot layer. But imagine the source reports an
ancestor of 102. Blocks 103 and 104 have already been sealed as immutable history. Deleting only
the hot rows above 104 would leave sealed data from the discarded branch in the query surface.

Nuthatch refuses this condition. It reports a finality violation and halts the affected index rather
than silently presenting a half-correct history. This is not a graceful recovery in the marketing
sense. It is the only honest behaviour once the external finality assumption has been violated.
The operator must investigate the chain source, finality configuration and recovery procedure
instead of allowing a plausible but inconsistent index to keep serving.

The same line applies to direct sealing. That fast backfill path only processes a range already
behind the finality boundary. Its performance comes from avoiding hot writes, not from relaxing the
definition of permanent history.

## What to look for in practice

`nuthatch_reorgs_total` records ordinary detected reorgs. The health and readiness surfaces expose
the last indexed and sealed watermarks. A sudden tip lag accompanied by reorg growth calls for a
look at the source and chain conditions. A finality violation is a hard incident, not a counter to
wave away.

The important operational habit is to distinguish “we are behind” from “we are wrong”. Being behind
can often be fixed by an RPC change or smaller windows. A reorg below seal means the system has
lost the ability to correct historical facts automatically, and it should be treated accordingly.
