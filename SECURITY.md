# Security

## Reporting a vulnerability

Report it privately through GitHub: **Security → Report a vulnerability** on this repository
([advisories/new](https://github.com/qOeOp/trade/security/advisories/new)). Do not open a public issue or pull
request for it. Expect an answer within a week; this is a one-person project with no bounty.

Fixes land on `main` and reach the author's host with the next checked build. The latest commit of `main` is the only
supported version; older tags ([`CHANGELOG.md`](CHANGELOG.md)) get no fixes.

## What it protects

This is a self-hosted tool for one operator and a few trusted people ([`README.md`](README.md#start-here)). The
deployment's trust boundaries, and what a report against each one would be:

- **The edge**: only members of one GitHub team get past OAuth2 Proxy (`deploy/remote/oauth2-proxy.cfg`); the IDE,
  ledger, Paper and Live ports are never published on a public interface. Anything reaching them without that
  login is in scope.
- **The page**: `deploy/remote/Caddyfile` sends HSTS and a Content-Security-Policy that names every outside origin
  the IDE loads from and forbids framing. Script injection into the IDE is in scope.
- **The ledger**: written only through `python -m cli.main` with the writer account; readers get a read-only account.
  Its DoltHub copy is public by design: research there is not a disclosure.
- **The Docker API proxy** (`deploy/docker-api`): lets the services create only containers of the runtime image, as
  one user, with mounts under fixed roots. Any way past its checks to the host's Docker is in scope.
- **Live**: the operator saves the exchange credential from the Live page to the Live control on their host, which
  alone reads it; no Agent, the ledger or Git ever holds it. Any path that reads it or places an order without the
  operator is in scope.
- **Images and supply chain**: images are built only in CI from a commit of this repository and run by digest. Each
  `main` build records signed SBOMs of its images as GitHub attestations and a vulnerability scan in the run summary
  (`.github/workflows/ide-image.yml`; for the runtime's execution and replay images, `.github/workflows/runtime-image-sbom.yml`). Check one
  with `gh attestation verify oci://IMAGE@DIGEST --repo qOeOp/trade --predicate-type https://spdx.dev/Document/v2.3`.

Out of scope: a strategy's results, Binance's data, and anything that needs the operator's own machine or GitHub
account already compromised.
