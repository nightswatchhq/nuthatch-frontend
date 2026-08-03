---
title: "Security"
description: The advisories you need to know about, what the guards actually stop, and what to decide before you expose /sql.
order: 10
---

## Upgrade first

Two released defects, both on `/sql`, both fixed. If you expose that surface to anyone you do not
fully trust, be on a current release before reading further.

> **v0.9.3 - arbitrary file read.** DuckDB accepts a **quoted** function name, and the guard matched a
> forbidden name only when the next non-space character was `(`. So `SELECT * FROM "read_csv"('/etc/passwd')`
> passed both guards and executed. Confirmed against a live connection during a pre-1.0 adversary pass,
> returning the contents of `/etc/hosts`. **Every earlier release is affected.**

> **v0.6.2 - arbitrary file write.** Releases up to 0.6.1 accepted `;`-stacked statements. Since
> `COPY … TO` and `ATTACH` write to disk regardless of the in-memory connection, a stacked statement
> was a file-write primitive for anyone who could reach the endpoint.

Both have published advisories on the repository's Security tab. Both were fixed by a binary swap with
no data migration, so there is no reason to sit on either.

**They are the same class of bug seen twice:** the guard was right about the shape it imagined, and the
shape had another spelling. That is what shaped the fix below.

## What guards `/sql`

Two controls with deliberately **different failure modes**, not one behind the other.

**A denylist** rejects the file-reading and environment-disclosing functions by name, scanning after
quotes are normalised away - so `"read_csv"(`, `read"_"csv(`, and anything else quoting can do to break
a name apart all collapse to the same match.

**An allowlist** (since v0.9.3) asks DuckDB's own parser what a statement references and refuses
anything unrecognised: a table function must be one of three, and a base table must be *named like an
identifier* - which is what catches a replacement scan, `FROM '/x.parquet'`, that the parse tree
otherwise reports as an ordinary table whose name happens to be a path.

The allowlist **fails open** if the parse is unavailable, which is why it does not replace the
denylist: a parse failure must not take down `/sql` while a control that has guarded this surface since
RFC-0008 is still in front of it.

> **DuckDB's `allowed_directories` does not enforce** on the build we bundle. We measured it, and a
> test pins which control actually blocks a file read. Do not budget for it as a layer behind the two
> above. An unmeasured defence-in-depth layer is worse than none, because it gets counted on.

## Resource guards

Denying a query is cheaper than an OOM that takes co-tenants with it:

| guard | default |
|---|---|
| query timeout | 30 s |
| row cap | 50,000 |
| result bytes | 64 MiB |
| concurrent analytical queries | 2 |
| query text length | 16 KiB |
| unsealed tip rows per query | 2,000,000, then `503` |

The tip bound **refuses rather than truncates** - a partial tip would silently change the answer to an
aggregate, and a wrong number is worse than an error. The `503` names `sealed_through` so a caller can
narrow to sealed data and get a correct answer immediately.

## Exposure

nuthatch binds `127.0.0.1` by default and is built to be **fronted**. TLS, authentication and metering
are the operator's layer.

- **`/_admin/`** mutates state (mounting and unmounting nests). Open on localhost; off it, every
  request requires `NUTHATCH_ADMIN_TOKEN`. Bind localhost and leave the token unset to disable remote
  admin entirely.
- **The scaled-mode control plane** *refuses to start* off-localhost without `NUTHATCH_CONTROL_TOKEN` - 
  a refusal, not a warning. It decides what an entire fleet runs.
- **Token comparison is constant-time**, on both surfaces.
- **`/health` and `/ready`** stay unauthenticated so a load balancer can probe them. They reveal
  nothing.

## Running someone else's nest

A nest bundle is content-addressed and hash-verified on install: the manifest, every file's bytes, and
the decode registry regenerated from the inputs must all agree, or it is refused. That makes a bundle
*tamper-evident*, not *safe* - a valid bundle can still declare endpoints you would rather it did not.

So `nest load` **warns about every non-loopback outbound endpoint** a bundle declares - webhooks, alert
sinks, RPC URLs - with credentials redacted. Link-local and cloud-metadata addresses (`169.254.169.254`)
are logged at `error` rather than buried among them, because that is where an SSRF actually pays: on a
cloud host, instance credentials are served there.

It warns and proceeds rather than refusing. Refusing is a policy decision that belongs to you.

In a fleet, **pin the `bundle_hash`**, not just the version. A pinned worker fetches by content address
and never consults the registry's mutable index, so re-tagging a version cannot change what your fleet
runs. Unpinned, your fleet is exactly as trustworthy as your registry.

## Secrets

Private RPC URLs and webhook HMAC secrets never enter a published bundle - baking a credential into a
content-addressed artifact would leak it *and* break addressing.

- **Embedded**: they live in the nest's `nuthatch.toml`. Keep the directory `0700`, owned by the
  service user.
- **Scaled**: they live in the control plane and are injected per nest, per worker, scoped to the
  cursors that worker actually holds. The interface is **write-only** - you can list which keys exist
  and never read a value back. Rotating one changes no bundle hash, so it neither invalidates segment
  reuse nor forces a re-index.

## The full audit

A pre-1.0 adversary pass found one exploitable issue (the file read above) and six others. All seven
are closed, and the write-up records *how* - including finding 3, closed as **not ours to fix** rather
than fixed, because the belief attached to it was the actual problem.

Read it at
[`docs/security-audit-2026-07-31.md`](https://github.com/nightswatchhq/nuthatch/blob/main/docs/security-audit-2026-07-31.md).

## Reporting something

Please report privately through the repository's Security tab rather than opening a public issue. See
[`SECURITY.md`](https://github.com/nightswatchhq/nuthatch/blob/main/SECURITY.md).
