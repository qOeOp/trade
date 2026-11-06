# Remote Paper

This overlay puts the existing IDE and Paper deployment behind Caddy HTTPS and OAuth2 Proxy. GitHub
usernames are explicitly allowlisted; neither an email domain nor the page's CSRF token grants login.
Only ports 80 and 443 are published. Paper, Dolt, OAuth2 Proxy and Docker remain internal.

Use a Linux **arm64** Docker host for the currently published product images. Docker Compose must support
`!reset` (2.24.4 or newer). Live execution and cross-host takeover are not enabled by this overlay.
The existing Paper limit stays four runs. The example's 8 GiB ledger cap is a candidate deployment budget,
not a tested capacity result; do not change an existing deployment's cap without evaluating its load.

1. Choose the server, retain its public IPv4, and point `www.vibe-trading.info` to it. Check inbound HTTPS
   and the container's actual public egress independently. Permit ports 80/443 for ACME and HTTPS;
   do not expose 8765, 8767, 13330 or the Docker API.
2. Register a GitHub OAuth App with homepage `https://www.vibe-trading.info` and callback
   `https://www.vibe-trading.info/oauth2/callback`. Confirm `TRADE_GITHUB_USERS`; the example is `qOeOp`.
   Use this dedicated OAuth App, not an exchange API key or a GitHub personal access token.
3. Copy `env.example` to a private deployment env file and set the actual non-secret configuration.
   Put the OAuth client secret in the named private file. Generate a separate raw random 32-byte cookie secret
   (no trailing newline) in the other private file. Keep both readable only by the configured runtime uid and
   outside Git, logs and the public ledger. OAuth2 Proxy alone mounts these files; IDE and Paper do not.
4. Prepare the ledger/market profiles and persistent directories as described in `../README.md`.
   This does not authorize switching the active ledger or migrating an existing run. An existing active
   run cannot be copied to this host and called resumed; its current protocol requires its original container.
5. Review the resolved configuration with **dummy** secret files first. Relative compose paths below
   are resolved against `deploy/compose.yaml`, the first compose file.

```sh
docker compose --env-file deploy/remote/.env \
  -f deploy/compose.yaml -f deploy/remote/compose.yaml config --quiet
docker compose --env-file deploy/remote/.env \
  -f deploy/compose.yaml -f deploy/remote/compose.yaml pull
docker compose --env-file deploy/remote/.env \
  -f deploy/compose.yaml -f deploy/remote/compose.yaml up -d --wait
```

Caddy manages certificates in its own volumes. Keep those volumes on updates. OAuth2 Proxy keeps encrypted
sessions in secure HttpOnly cookies and does not pass provider tokens or user headers into the IDE.
The GitHub identity session is independent of Paper process lifetime. `/api/…` returns 401 when login
expires; a full page navigation uses GitHub login. After login, the existing same-origin/CSRF checks still
apply to start, stop and resume. Streaming is flushed without an upstream whole-request deadline.

Do not enable skip-auth routes, wildcard GitHub membership or public origin ports. The existing internal
Docker API proxy filters paths but not create bodies; its controller remains a privileged trust boundary.
Before exposing a host to untrusted strategy authors, validate a rootless execution host or the stricter
container-launch boundary described in the server plan. GitHub allowlisting does not isolate hostile users
from one another; this first deployment is for the specified trusted operator accounts.

Acceptance requires: unauthenticated page/API/SSE denial, a disallowed GitHub user denied, an allowed user
admitted, expired login does not stop runners, source/host/CSRF checks still hold, bounded logs, and a native
checkpoint resume using the same run. Config validation alone is not an actual GitHub callback/HTTPS test.
