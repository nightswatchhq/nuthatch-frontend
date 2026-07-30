---
title: "The Graph put Nuthatch in their hackathon bounty"
description: "ETHGlobal Lisbon's $7,000 Best AI Tooling track names Nuthatch as an accepted data backend, alongside Subgraph Studio. What it means, and a field guide for anyone building on the bird this weekend."
date: 2026-07-22
---

*ETHGlobal Lisbon runs this weekend, July 24-26. The Graph is sponsoring $15,000 across three tracks, and their biggest one (Best AI Tooling for The Graph, $7,000) names Nuthatch twice: once as a suggested project, and once in the qualification requirements as an accepted data backend, alongside Subgraph Studio and The Graph Market. This post is what that means, what we make of it, and a field guide for anyone in Lisbon who decides to build on the bird.*

---

## What the prize page actually says

Buried in the AI Tooling track's example projects is this: a project built on Nuthatch, extending its MCP tools, adding new SKILLs, or wiring its output into an agent workflow. That's flattering, but examples are cheap: sponsors list a dozen and mean maybe three.

The qualification requirements are the part that matters. The rule is that submitted tooling must work against live blockchain data, and the accepted sources are a Graph provider *or* "a self-hosted indexer such as Nuthatch." That's not an example; that's eligibility. A team can build their entire $7,000 submission against a local nuthatch binary, no gateway, no API key, and qualify. Someone at The Graph wrote that sentence on purpose.

## The part where we acknowledge the elephant

Our homepage carries a comparison table with The Graph in it. It's polite (we say plainly that it states facts, not a verdict), but let's not be coy: Nuthatch exists because we spent five years inside that ecosystem and wanted a way to index a contract without renting anything from anyone. The Graph is the incumbent our slogan routes around.

So there's something genuinely gracious about them putting us in their bounty. The cynical read is that a rising tide of indexer tooling lifts all boats and the marginal hackathon team was never going to pay query fees anyway. The generous read is that the people writing these tracks care more about builders getting structured on-chain data into agents than about which binary does the structuring. Having spent years around those people, we lean toward the generous read, and either way, we'll take it in the spirit offered. Good sportsmanship deserves the same in return.

## Why the track fits, mechanically

The track asks for reusable infrastructure that makes on-chain data easier to use from AI environments: MCP servers, agent SKILLs, plugins, client configs. Judging weights usefulness to other builders at 30% and reusability at 25%. That is, more or less, a description of the surface nuthatch already ships:

- A built-in MCP server: 12 tools, 3 resources, 3 prompts, covering schema discovery, SQL with pre-flight `explain`, entity and balance lookup, flags, exposure, sanctions screening.
- A governed semantic layer, so a failed query comes back as a fix hint rather than a shrug.
- `llms.txt` and a Claude Code skill scaffolded by `nuthatch init`, so an agent drives the indexer against the real query surface instead of hallucinating one.
- All of it fully local. Your agent talks to your box. Nothing meters, nothing phones home.

For a 36-hour hackathon, the practical pitch is blunter: `init` to live indexed API is under two minutes, the whole thing is one static binary, and the Lodestar deployment we wrote about last week serves a public dashboard on 86 MB of RAM. You will not spend Saturday fighting Docker Compose.

## A field guide for Lisbon

If you're at Pavilhão Carlos Lopes this weekend and pointing at the bird, here's the fast path.

Install:

```
$ curl -fsSL https://nuthatch-indexer.com/install.sh | sh
```

Point it at a contract:

```
$ nuthatch init <address> --chain <chain>
$ nuthatch dev
```

That resolves the ABI from Sourcify, scaffolds config, schema, `semantic.toml`, `llms.txt`, and the Claude Code skill, then follows the tip and serves entities, `/sql`, `/balances`, and MCP on one local endpoint. The [worked example](https://nuthatch-indexer.com/example) rebuilds a real Graph Horizon subgraph as a nest if you want something meatier than a token contract.

Directions we'd genuinely love to see someone take, and which map cleanly onto the judging criteria:

- **New MCP tools or prompts.** The server is a surface, not a ceiling. Cross-nest joins, cohort queries, anomaly summaries: if you find yourself wanting a tool that isn't there, that absence is your project.
- **New SKILLs.** The shipped skill teaches an agent to drive nuthatch. Skills that teach it to *author* nests (schema design, view-writing, backfill strategy) are the obvious next rung, and one we've only partially climbed ourselves.
- **Wiring nuthatch into agent frameworks.** The track explicitly rewards plugins and one-click configs. A nuthatch provider for your framework of choice is a tidy, judgeable, reusable artifact.
- **Composing with the rest of The Graph's stack.** Nothing says a submission can't use nuthatch for one contract and the Subgraph MCP for fifteen thousand others. Layered tooling that treats them as peers would be a lovely thing to exist, and rather on-message for everyone involved.

Two honest caveats, because this blog doesn't do brochures: the escape-hatch WASM component story is young, and there's no calldata or IPFS ingestion yet, so if your idea needs those, check the [roadmap](https://nuthatch-indexer.com/roadmap) before you commit your weekend to it. When in doubt, ask.

## We're on call

For the duration of the hackathon we'll be watching [GitHub Discussions](https://github.com/nightswatchhq/nuthatch/discussions) and issues with unusual attentiveness. Sharp edges found under 36-hour pressure are the most valuable bug reports there are, and we'd rather you lose ten minutes asking than three hours guessing. If you hit a wall, open a discussion with what you ran and what it said; if you hit a genuine bug, we'll do our best to cut a fix while the weekend is still young. The deadlock war story from the last post should reassure you that we take "it just stopped" reports seriously.

And if you build something on nuthatch, win, lose, or abandoned-at-4am, tell us. The [stories](https://nuthatch-indexer.com/stories) page exists for exactly this.

## The moral, if there is one

Eleven weeks ago this project was a manifesto and an empty repo. Today it's load-bearing under a public dashboard and named in the qualification rules of a $7,000 track at one of the largest Ethereum hackathons, written by the very protocol whose gateway it lets you skip. We'd be lying if we said we planned that trajectory, and lying harder if we said it wasn't satisfying.

Good luck in Lisbon. Bring endpoints, plural. You've read why.

*Nuthatch is [github.com/nightswatchhq/nuthatch](https://github.com/nightswatchhq/nuthatch): one Rust binary, MIT OR Apache-2.0. Point it at a contract; be your own indexer.*
