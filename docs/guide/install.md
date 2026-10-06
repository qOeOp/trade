# Install

Installation establishes a reproducible development foundation. It does not activate a strategy,
connect a live execution adapter, or grant authority to create external trading effects.

The backend and Web Dashboard target server deployment; local tools support development and verification. External Agent model configuration is not an R&D prerequisite. See [Service architecture](../architecture/) for deployment boundaries.

## Prerequisites

- A supported Python and Rust toolchain for the repository revision being built.
- Node.js for the documentation site.
- Credentials only for the data or execution adapters you deliberately configure.
- An isolated environment for generated strategy code and exploratory work.

Always follow the repository's current Makefile and CI workflows rather than copying historical commands
from older documentation.

## Credentials and configuration

Configure credentials only for adapters actually enabled. Market Data uses provider-supported public endpoints or authorized data credentials. Trading services use trading credentials only after independent effect authorization. An environment variable proves neither data rights, interface capability nor trading permission.

The Agent obtains papers, articles and videos with existing host tools. Host model/tool configuration is not a server installation prerequisite; do not prescribe planned server connectors for possible research sources. R&D retains source references and explanations, while market files still pass Market Data admission.

Secrets belong only in the authorized service runtime or ignored local secret files. Never commit, print, log or copy them into requests, results, artifacts or audit packets. Repository Agents must not use exchange trading credentials. [Market Data intake](./market-data-intake/) defines rights, cost authority and PIT checks; [source intake](./source-intake/) separates host research tools from product-managed acquisition.

## Build the foundation

From the repository root, use the current build entrypoint:

```bash
make build-debug
```

Build and test success proves only that the local software foundation is reproducible. It does not prove
data fitness, strategy validity, qualification, capital approval, live connectivity, or safe recovery.

## Before using data

Configure a Market Data adapter and verify instrument identity, timestamps, coverage, corrections,
licensing, and point-in-time availability. Missing or ambiguous facts must stop dependent research,
backtest, scan, valuation, or trading work.

## Before real trial or formal operation

The product path must provide a qualified artifact, a Governance deployment decision, a Risk policy,
an Execution adapter, reconciliation, and a Recovery path. Paper and live use the same intent, risk,
order, and feedback semantics; only the Execution adapter changes.

Real trial and formal operation require separately admitted effects, current authority and first trial confirmation. Paper is separately admitted native simulation verification, not a promotion prerequisite. Repository agents must never use exchange trading credentials; installation or documentation work grants neither credential use nor order authority.
