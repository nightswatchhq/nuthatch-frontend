---
title: "Verifying a deployment"
description: An acceptance runbook that proves a deployment works, step by falsifiable step - and an honest table of what we have verified ourselves and what we have not.
order: 6
---

Most projects tell you what they support. This tells you **how to prove it on your own hardware**, and
which claims we have and have not tested ourselves.

The full runbook lives in the repo at
[`docs/verification.md`](https://github.com/nightswatchhq/nuthatch/blob/main/docs/verification.md).
Levels 0 - 4 are automated:

```sh
./scripts/verify.sh 0 4
```

## What we have verified

| level | verified by us? | how |
|---|---|---|
| **0** Artifact | yes | every release - checksums, the binary runs, `--version` matches the tag |
| **1** Single nest | yes | CI, plus a production box serving public traffic |
| **2** Correctness | yes | CI - deterministic fixtures, reorg property tests |
| **3** Runtime | yes | a live two-chain run and an 8-nest density run |
| **4** Guards | yes | CI, plus a live `/sql` adversary pass |
| **5** Scaled mode | yes, across real machines | three boxes on a private network, published artifacts |

Level 5 is where independent verification is worth the most, and where we have most recently been
wrong - see below.

## Level 5 is worth reading before you trust it

Until v0.9.3, **the writer pool did not write.** A worker registered, took a cursor lease, loaded
secrets and reported - and contained no indexing code at all.

Ten level-5 checks passed throughout. They were real checks and they genuinely passed: registration,
scheduling, lease fencing with a store-enforced fence, fleet-wide version pinning, write-only secrets.
**Not one of them asserted that a row appeared.**

That is the failure worth learning from - a suite that verifies the machinery *around* a thing reads
exactly like a suite that verifies the thing. The runbook now has a check that could not have passed
before the fix: `last_block` advancing in the shared store.

## What level 5 proves now

Measured on three Hetzner boxes on a private network, from published release artifacts - control plane
and store on one, writers on their own:

- workers registering and being scheduled from another machine
- a **real lease handover** under contention, with the store-enforced fence advancing
- a **10-minute clock jump** moving lease expiry rather than ownership
- **indexing into the shared store** - the check that could not have passed before 0.9.3
- **377 blocks indexed through a 90-second control-plane outage**

That last one is the design claim with a number attached: losing the control plane must stop
*rescheduling*, not *ingestion*. If it stopped ingestion, a database blip would be a fleet-wide outage.

**Not yet run on real machines:** the registry-pull check, which deletes a writer's nest entirely and
asserts it pulls one from a registry anyway.

## Running the fleet lab yourself

The distributed levels need more than one machine. `scripts/fleet-lab.sh` stands up a throwaway lab on
Hetzner Cloud, runs the runbook against the **published release artifacts**, and destroys it:

```sh
export HCLOUD_TOKEN=...            # a Hetzner Cloud project API token
export HCLOUD_SSH_KEY="my-key"     # the name of a key already in that project

./scripts/fleet-lab.sh up multi    # three boxes and a private network
./scripts/fleet-lab.sh verify
./scripts/fleet-lab.sh partition   # cut a writer off the control plane, assert it keeps indexing
./scripts/fleet-lab.sh skew        # push a writer's clock forward, assert the lease does not move
./scripts/fleet-lab.sh pull        # delete a writer's nest, assert it pulls one from the registry
./scripts/fleet-lab.sh down        # destroy everything it created
```

Hetzner bills hourly - three boxes are roughly €0.03/hr - which is only cheap if you destroy them, so
`down` is a first-class verb and every resource is tagged.

It installs the **published artifacts**, not a local build, so what gets verified is what you would
actually download.

## Please report either outcome

A level someone else ran is worth more than a level we assert, and passes are as useful as failures.
Useful to include: the level and step, expected versus actual, `nuthatch --version`, chain and
contract, embedded or scaled, and for level 5 how many writers and FE nodes.

Known-unverified items are tracked in
[`docs/prod-readiness.md`](https://github.com/nightswatchhq/nuthatch/blob/main/docs/prod-readiness.md);
anything you confirm can move with your evidence attached.
