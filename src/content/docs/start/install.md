---
title: "Install"
description: "Install the nuthatch binary - curl | sh, cargo install, or a prebuilt release."
order: 2
---

nuthatch is **one static binary**. No Postgres, no Docker, no IPFS, no account - install it and
you're done.

## The one-liner

```sh
curl -fsSL https://nuthatch-indexer.com/install.sh | sh
```

The script detects your platform, downloads the matching release binary, verifies its checksum, and
puts `nuthatch` on your `PATH`. It's short and
[readable on GitHub](https://github.com/nightswatchhq/nuthatch-frontend/blob/main/public/install.sh) -
audit it first if `curl | sh` makes you itch.

Prebuilt binaries cover **macOS (Apple Silicon)** and **Linux x86_64**. Intel Mac is deliberately not
built. Checksums ship with every release; a Homebrew tap and detached release signatures are on the
[roadmap](/roadmap).

## Container image

```sh
docker run --rm ghcr.io/nightswatchhq/nuthatch:2.4.0 --version
```

`linux/amd64` only for now. The image carries the **same binary attached to the GitHub Release**, so
the two cannot drift. Scaled mode needs the `-scaled` tag: the default image is the embedded build and
carries no database driver. See [Deploy it](/docs/operate/deploy/) for running it properly.

## From source

Only needed on a platform we do not publish a binary for. **The toolchain pin is required, not
advisory:**

```sh
rustup toolchain install 1.95.0
cargo +1.95.0 install --git https://github.com/nightswatchhq/nuthatch nuthatch
```

`rust-toolchain.toml` pins 1.95.0 because `dbsp` hits a next-trait-solver ICE on 1.97 - and **that
file does not apply to `cargo install --git`**, which builds in a temporary directory of its own. So
the pin cannot protect this path and you have to ask for it. Without `+1.95.0`, a 1.97 default
toolchain fails after a full dependency build with `error: could not compile dbsp` and installs
nothing.

This page previously said a plain `cargo install` on recent stable worked. It does not, and has not
since rustc 1.97 - see [#534](https://github.com/nightswatchhq/nuthatch/issues/534).

## Verify

```sh
nuthatch --version
```

Then take the two-minute path: [Quickstart](/docs/start/quickstart/) - from a contract address to a
live, queryable API.

```sh
nuthatch init 0xA0b86991c6218b36c1D19D4a2e9Eb0cE3606eB48   # USDC - chain auto-detected
nuthatch dev
```

Nothing phones home: no telemetry, no API token, no gated data service. AI features are BYO-key or
local models and degrade gracefully offline.
