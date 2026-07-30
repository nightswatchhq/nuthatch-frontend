---
title: "Upgrading a live indexer, three versions in one go"
date: "2026-07-22"
description: "The nuthatch behind Lodestar's dashboard had been on 0.3.0 since it shipped. We bumped it to 0.6.0 while it was serving real traffic - three minor versions in one swap. This is the operator's log, and the good news is that it was an anticlimax."
author: "cargopete"
tags: ["nuthatch", "operations", "self-hosting", "lodestar", "upgrades", "arbitrum", "deployment"]
---

*There is a particular kind of dread that attends upgrading software people are actively looking at. The indexer behind [Lodestar's dashboard](https://www.lodestar-dashboard.com) had been sat on nuthatch 0.3.0 since it shipped to production, quietly serving two panels off Arbitrum while the rest of us released 0.4.0, 0.5.0, and 0.6.0. Three minor versions had drifted past. Closing the gap turned out to be the least eventful thing we did all week, which is exactly the report an operator wants to read before doing the same.*

---

## What was running

One 8 GB VPS in Helsinki, two `nuthatch dev` services behind a single Caddy vhost with TLS and basic-auth, path-routed so Lodestar talks to one URL:

- a **staking nest** serving the delegation-activity feed (four HorizonStaking events), and
- a **gns nest** serving the developer-activity chart (L2GNS `SubgraphPublished`).

Both indexing Arbitrum One, both tip-following, both sat comfortably around 260-320 MB of RAM. Nothing exotic. The kind of deployment we keep insisting nuthatch should be: a binary, a config, a reverse proxy, and no committee of sidecars.

## The upgrade, in full

We took vitals first, because upgrading a healthy live service blind is how you turn a good afternoon into a bad evening. Both nests answered `/health` with `ok`, so we wrote down the numbers we expected to see afterwards - row counts on each table, the tip block - and only then touched anything.

The mechanics were unremarkable, which is the whole point:

1. Pull the prebuilt `nuthatch-x86_64-unknown-linux-gnu.tar.gz` for 0.6.0, verify its SHA-256.
2. Back up the old binary and `tar` the two data directories. They were about 110 MB each; the backup took longer to type than to run.
3. `install` the new binary over `/usr/local/bin/nuthatch`. A running process keeps hold of its old inode, so the *second* nest carried on serving 0.3.0 while we tried 0.6.0 on the first - a free canary, no coordination required.
4. `systemctl restart` the staking nest. Watch the logs. Check the numbers.

The numbers matched. Not "close enough" - identical. 93 delegations, 43 undelegations, 53-and-2 withdrawals, same tip. More reassuring still, 0.6.0 now stamps every query with a **provenance** block, and the `registry_hash` it reported was byte-for-byte the same value the old binary had been using. That hash is a fingerprint of the decode logic and schema; an unchanged hash across an upgrade is about as close to a mathematical proof of "same nest, same answers" as you get without a whiteboard. Then we restarted the gns nest, and its numbers matched too.

## The bit we were bracing for, that didn't happen

The one genuine risk in a 0.3.0 to 0.6.0 jump is on-disk format drift. Between those versions we had landed data-corruption fixes and segment-recovery work, any of which *could* have changed the shape of the hot store or the sealed Parquet segments and forced a re-index. We planned for it: the fallback was to wipe the derived data (hot store, segments, DuckDB cache), keep the config, and re-backfill from scratch - cheap, given the sizes involved.

We never needed it. The 0.6.0 binary read 0.3.0's hot store and segments as they were. Every CLI flag the service files used still existed and still meant the same thing, so the unit files did not change a character. The upgrade was, start to finish, *swap the binary and restart* - which is exactly the promise [RFC-0020](https://github.com/nightswatchhq/nuthatch/blob/main/docs/rfcs/0020-nest-lifecycle-and-the-n-1-upgrade.md) makes about nest lifecycle, now with the smug satisfaction of having done it on something with real users.

## Did the dashboard actually notice?

This is the part that matters, and the part it is tempting to skip. A green `/health` is not the finish line; the finish line is a real panel rendering real data in a browser. Lodestar's frontend proxies nuthatch through its own server-side routes, each of which tags the response with where the data came from - `nuthatch`, or The Graph if the indexer had fallen over and the automatic fallback kicked in.

After the upgrade:

- `/api/delegation-events` returned `source: "nuthatch"`, sixty events, no errors.
- `/api/developer-activity` returned `source: "nuthatch"`, fifty-two weeks of non-zero counts.

Which means the little **"Indexed by nuthatch"** badge - it only lights when the source is nuthatch, never on a fallback - was still lit. The dashboard fetched from a freshly-upgraded indexer and displayed it, and nobody watching would have known a thing had changed underneath them.

## What we would still like to fix

Honesty compels one caveat. The upgrade was easy, but it was *manually* easy: download, verify, swap, restart, done by hand. There is not yet a `nuthatch self-update`, or a single command that does the back-up-and-swap dance for you. For a fleet of nests that would start to grate. It is on the list.

For now, though, we will take the anticlimax. Three versions, a live service, real users, and the most exciting thing that happened was a rate-limit warning from a public RPC endpoint. Be your own indexer; upgrade it on a Tuesday afternoon; go and have your tea.
