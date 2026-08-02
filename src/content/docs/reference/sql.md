---
title: "The SQL surface"
description: "Querying the hot ∪ cold DuckDB union, derived columns, and views."
order: 5
---

One SQL surface spans both stores: the live unsealed tip (redb) and the sealed Parquet history,
unioned as DuckDB views. You never think about the seam - a query over `usdc__transfer` sees every
row from deployment to the block indexed a moment ago. Reach it via `nuthatch sql` (a REPL when
called with no query), `GET /sql`, or the MCP `sql` tool.

## Naming

- Every decoded event is a view named **`{alias}__{event}`** in snake_case: `usdc__transfer`,
  `staking__stake_delegated`. `.tables` in the REPL (or `GET /tables`) lists them.
- Factory children share their template's tables (`{template}__{event}`), distinguished by
  `address`.
- [Authored views](/docs/build/views/) and [recipe](/docs/build/recipes/) derivations appear as
  ordinary views alongside the event tables, described in `/schema` like everything else.

## Columns

Every event table carries the implicit columns `block_number`, `block_timestamp`, `log_index`,
`tx_hash`, and `address` (the emitting contract), plus one column per event parameter.

Two footguns, both machine-tracked in [`semantic.toml`](/docs/build/semantic/):

- **Reserved words.** Solidity loves `from` and `to`; SQL reserves them. Double-quote:
  `SELECT "from", "to" FROM usdc__transfer`.
- **Big integers.** A `uint256` column like `value` is stored exactly and can't be summed
  directly. Every big-int column gets a derived **`*_dec`** sibling (`value_dec`) for arithmetic:
  `sum(value_dec)`, `value_dec > 1e6`.

Get either wrong and the error comes back with a fix hint derived from the real schema - the
binder knows the nearest table name, the quoting rule, and the `_dec` convention.

## Semantics & guards

- **SELECT/WITH only.** The surface is read-only by construction; the ingest thread is the single
  writer, and queries attach the sealed segments read-only.
- **One statement per request.** A `;`-stacked second statement is rejected before anything runs.
  This matters more than it looks: `COPY … TO` and `ATTACH` write to disk regardless of the
  in-memory connection, so a stacked statement was a file-write primitive. Fixed in **v0.6.2** -
  see [upgrades](/docs/operate/upgrades/) if you are running anything older.
- **No filesystem access.** Two controls, deliberately with different failure modes. A denylist
  rejects the file-reading functions outright, and since **v0.9.3** an allowlist asks DuckDB's own
  parser what a statement references and refuses anything unrecognised — a table function must be one
  of three, and a base table must be named like an identifier, which is what catches `FROM
  '/x.parquet'`. The allowlist fails *open* if the parse is unavailable, so it cannot be the only
  control; the denylist is still in front of it.

  DuckDB's `allowed_directories` is **not** enforced on the build nuthatch bundles — measured, and
  pinned by a test — so it is not a layer behind these two. Assume it buys nothing.

  > **Upgrade to v0.9.3 if you expose `/sql` to anyone you do not trust.** Every earlier release is
  > vulnerable to an arbitrary file read: DuckDB accepts a *quoted* function name, and the denylist
  > matched a forbidden name only when the next character was `(`. `SELECT * FROM "read_csv"('/etc/passwd')`
  > passed both guards and executed. See [upgrades](/docs/operate/upgrades/).
- **Deterministic and finality-aware.** Sealed segments are immutable; only the hot tip can change
  under a reorg, and the union converges with it.
- **Guarded:** a 30-second timeout, a 50,000-row cap, a 64 MiB result-byte ceiling, and 2
  concurrent analytical queries. A rejection is the node protecting itself - narrow the query
  rather than fighting the guard. Validate cheaply first with `explain`.
- **Provenance-stamped.** Results carry the block range and the content-addressed segment hashes
  they were computed from, so a number can be cited against immutable data and re-derived by
  anyone.

```sql
-- the shape of a typical answer
SELECT date_trunc('day', to_timestamp(block_timestamp)) AS day,
       count(*)                                          AS transfers,
       sum(value_dec) / 1e6                              AS volume_usdc
FROM usdc__transfer
WHERE block_number > 20000000
GROUP BY 1 ORDER BY 1 DESC LIMIT 30;
```
