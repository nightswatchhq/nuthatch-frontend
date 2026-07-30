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

Prebuilt binaries cover **macOS (Apple Silicon)** and **Linux x86_64**. Checksums ship with every
release; a Homebrew tap, an OCI image, and detached release signatures are on the
[roadmap](/roadmap).

## From source

Any platform with a Rust toolchain:

```sh
cargo install --git https://github.com/nightswatchhq/nuthatch nuthatch
```

The pinned toolchain is in the repo's `rust-toolchain.toml`; a plain `cargo install` against a
recent stable Rust works.

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
