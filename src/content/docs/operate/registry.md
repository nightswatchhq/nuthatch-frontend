---
title: The nest registry
description: Publish and pull nests by name - a filesystem folder or an S3 bucket, with private nests, decoupled and never mandatory.
order: 8
---

A nest is a content-addressed bundle (`nest bundle`). The **registry** gives that bundle a home to be
published to and pulled from *by name* - with private nests behind auth, backed by a plain directory or
any S3-compatible bucket.

> **Decoupled, and never mandatory.** The registry is not part of the nuthatch binary and is never
> required. A self-built bundle and `nest load <file|dir>` work forever with no registry in the loop.
> nuthatch *pulls*; it never *becomes* the registry, and it never *requires* one. This is a convenience
> for sharing - think crates.io or an OCI registry - not a dependency.

## Publish and pull

**1. Bundle a nest** into one portable, content-addressed file.

```sh
nuthatch nest bundle ./my-nest        # → my-nest-<hash>.bundle
```

**2. Publish it** to a registry under a name and version.

```sh
nuthatch nest publish my-nest-<hash>.bundle --registry <path|s3://bucket/prefix> --as horizon@1.2.0
```

**3. Pull and run it** anywhere - resolved by name, fetched, and **hash-verified** on install (a pull is
exactly as safe as a hash-pinned file load).

```sh
nuthatch nest load horizon@1.2.0 --registry <path|s3://bucket/prefix>
```

## Backends

**Filesystem (default).** A directory *is* a registry - zero extra dependencies, the self-hosted-first
default:

```text
<root>/blobs/<hash>.bundle          # immutable, content-addressed
<root>/index/<name>/<version>       # name@version → hash
<root>/index/<name>/latest          # the one movable pointer
```

**S3 / object store.** Any S3-compatible bucket (MinIO, S3, R2) - the fleet path. Build with the feature
flag; configure via the standard `AWS_*` env (including `AWS_ENDPOINT` for self-hosted MinIO):

```sh
cargo build --features object-store
nuthatch nest publish my.bundle --registry s3://nests/prod --as horizon@1.2.0
```

## Private nests

A private namespace is access-controlled by the store itself (bucket policy on S3, filesystem
permissions locally). nuthatch carries a configured credential and **fails loudly and early** - a
rejected or missing credential gives a clear _"this nest is private, or your registry credential was
rejected"_, never a silent empty result, and never mistaken for "not found".

> **Two kinds of credential - don't conflate them.** *Registry auth* fetches a private *bundle*. *Nest
> runtime secrets* - a private RPC URL, an enricher's API key - are a different thing: they're injected
> per-nest at mount time and are **never** baked into a content-addressed bundle (that would both leak
> the secret and break addressing).

## See also

- [Upgrading a nest](/docs/operate/upgrades/) - how a new version of a published nest is rolled out
- [Run a runtime](/docs/operate/many-nests/) - mounting nests from a registry across a fleet
