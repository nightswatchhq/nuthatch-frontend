---
title: "Upgrading a nest"
description: "nest diff + nest upgrade - the N-1 problem solved (RFC-0020)."
order: 6
---

The N-1 problem is the subgraph resync tax: version N is live, version N+1 needs days of backfill,
and consumers eat downtime or stale data during the flip. nuthatch solves it with two commands and
one classification.

## Classify first: `nest diff`

```sh
nuthatch nest diff ./current ./proposed
```

Compares two versions (nest directories or `schema.json` paths) and classifies the update:

- **Compatible** - additive only: new tables, new columns, new views. Nothing a current consumer
  reads changes shape. Safe to hot-swap on the same endpoint.
- **Breaking** - any consumer-observable change: a renamed or removed table/column, a changed type.
  Needs a new endpoint; the old one must live through a deprecation window.

## Compatible: the zero-downtime flip

```sh
nuthatch nest upgrade --to ./new-version
```

The old version keeps serving on its address while the new version indexes concurrently beside it.
When the new one catches up to the tip, the endpoint **atomically flips** to the new backing - the
served address never changes, and no request is dropped mid-flight. If the update's decode is
unchanged (views-only, semantics-only), the new version **mounts the old version's sealed
segments** instead of re-backfilling - the content addresses prove they're valid, so the "upgrade"
costs seconds, not days.

A breaking update is *refused* by this path. That's the guard working, not a bug.

## Breaking: two versions, one listener

For a breaking change, `nest upgrade` serves both:

- The **old** version stays at the root - unchanged, so current consumers keep working - but every
  response now carries `Deprecation: true` and a `Link: <…>; rel="successor-version"` header
  (RFC 8594, so tooling can see it coming).
- The **new** version is served under a prefix (`--new-endpoint`, default `/next`).

Both index concurrently; neither flips. Consumers migrate on their own clock, then you sunset the
old endpoint. The deprecation signal is standards-shaped precisely so downstream dashboards and
clients can automate the move.

## Where versions come from

Upgrades compose with [the registry](/docs/operate/registry/): `nest load name@version` prepares
the new version's directory, `nest diff` classifies it, `nest upgrade --to` performs it. Versions
are content-addressed, so what you diffed is exactly what you flipped to.

## Upgrading the nuthatch binary itself

Everything above upgrades a *nest* - its schema, views, or decode. A separate axis is upgrading the
*nuthatch runtime* serving your nests, from one release to the next. This is deliberately a plain
binary swap, not a migration:

> **Upgrade to v0.9.3 if you expose `/sql` to anyone you do not trust.** Every release before it is
> vulnerable to an **arbitrary file read**. DuckDB accepts a quoted function name, and the guard
> matched a forbidden name only when the next non-space character was `(` - so
> `SELECT * FROM "read_csv"('/etc/passwd')` passed both guards and executed. Confirmed against a live
> connection during a pre-1.0 adversary pass, returning the contents of `/etc/hosts`.
>
> Fixed by normalising quotes away before the scan, which collapses every placement at once rather
> than patching one spelling. Same class as the stacked-`COPY TO` write below: the guard was right
> about the shape it imagined, and the shape had another spelling. A binary swap, no data migration.

> **Upgrade to v0.6.2 if you are exposing `/sql`.** Releases up to and including 0.6.1 accepted
> `;`-stacked statements on the `/sql` surface. Since `COPY … TO` and `ATTACH` write to disk
> regardless of the in-memory connection, a stacked statement was an arbitrary file-write primitive
> for anyone who could reach the endpoint. v0.6.2 rejects statement stacking outright. nuthatch binds
> `127.0.0.1` by default, so the exposure is limited to whatever you have put in front of it - but
> this is a binary swap with no data migration, so there is no reason to sit on it.

- **On-disk state is forward-readable.** A newer binary reads an older release's hot store (redb) and
  sealed Parquet segments as they are. No re-backfill, no conversion step.
- **The `dev` flags and unit files are stable.** A release does not silently rename the flags your
  service files depend on, so `systemctl` units carry over untouched.

The procedure, canaried so nothing goes fully dark:

```sh
# 1. Fetch the release for your platform and verify it.
curl -fsSLO https://github.com/nightswatchhq/nuthatch/releases/download/vX.Y.Z/nuthatch-x86_64-unknown-linux-gnu.tar.gz
curl -fsSLO https://github.com/nightswatchhq/nuthatch/releases/download/vX.Y.Z/nuthatch-x86_64-unknown-linux-gnu.tar.gz.sha256
sha256sum -c nuthatch-x86_64-unknown-linux-gnu.tar.gz.sha256
tar xzf nuthatch-x86_64-unknown-linux-gnu.tar.gz

# 2. Back up the old binary and each nest's data directory first.
cp -a /usr/local/bin/nuthatch /usr/local/bin/nuthatch.bak
tar czf nest-backup.tar.gz -C /opt/nuthatch my-nest

# 3. Install over the running path. A running process keeps its old inode, so other nests
#    keep serving the old version until you restart them - a free canary.
install -m 0755 ./nuthatch /usr/local/bin/nuthatch

# 4. Restart one nest, verify, then the rest.
systemctl restart nuthatch@my-nest
curl -s localhost:8095/health          # expect: ok
```

**Verify parity, do not assume it.** Note a few row counts before the swap and re-run them after; they
should be identical. Query responses carry a `provenance` block whose `registry_hash` is a fingerprint
of the decode and schema - an unchanged hash across the upgrade is proof the nest is producing the same
answers. `as_of` running ahead of `sealed_through` confirms the nest is following the tip again.

**If a release ever does change the on-disk format** (a rare, called-out event in the release notes),
the fallback is cheap: stop the nest, delete only the derived data (`nuthatch.redb`, `segments/`,
`.duckdb/`), keep the config (`nuthatch.toml`, `abis/`, `schema.json`), and let it re-backfill.
