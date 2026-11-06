# Remote Paper

The optional [continuous Web release plane](../../docs/plans/remote-continuous-delivery.zh.md) publishes
successful main builds without recreating Paper, ledger or strategy containers. Install its reviewed
control code once with `sh deploy/remote/install-release.sh` on the existing target host. It adopts the
current immutable IDE image, warms a replacement, splits the Agent into one writer, adds an internal
router behind the same OAuth allowlist, then enables `trade-release.timer`. Initial OAuth adoption
causes one browser reconnect; subsequent Web switches reload the internal proxy.

`release-ready` in GitHub Actions checks the same source's workflows and third-party checks, downloads
the native tested digest artifact for that run/attempt, and appends `{revision,image}` to the operational
`deploy-ready` branch. The execution extension adds the exact tested service/runtime digests; an
unchanged runtime carries forward its previous admission. A null image withholds admission. The host polls this public Git channel every
two minutes, not the Actions API, and does not need a new key or token. A 15-minute CI reconciliation
backs up completion events when third-party checks finish late. Candidates warm the research lines of
active Paper runs, then pass routed health, authentication, container-identity and data-progress checks.

The [Paper release extension](../../docs/plans/paper-continuous-delivery.zh.md), installed once with
`sh deploy/remote/install-paper-release.sh`, also publishes the admitted service and runtime digests.
It warms a read-only controller, pauses new writes while draining the existing lifecycle lock, then
switches the API. During observation only new starts wait; commit enables the new fixed runtime default.
Existing runner/egress containers, checkpoint originals and image_ref stay unchanged. Schema or protocol
changes must remain compatible with existing runs; incompatible candidates keep the previous service.

The host control program is installed from reviewed source and does not update itself by executing the
fetched checkout. Agent-format changes
must retain backward compatibility for rollback. Existing browser tabs need one refresh when adopting
the nonce-renewal client; future release handoffs can renew only a positively identified pre-forward
same-origin nonce rejection, preserving the original operation ID.

Use `systemctl list-timers trade-release.timer` and `journalctl -u trade-release.service` for publication
status. A failed/interrupted target stays blocked in `/var/lib/trade-release/failed/`; use a corrected
new main commit rather than looping on the same failed target. A pending transaction is recovered before
any new selection. Paper has a separate recovery journal and `paper-failed/` marker, with starts
kept paused until commit so rollback never replaces a newly started account. Unknown independent routing/Agent changes stop automatic operations and preserve
the journal for the operator. No old image, run, ledger record or market input is pruned. Do not run
whole-project `compose up` as the Web update mechanism. Control-program updates require reviewing and
installing the new files; the timer is not a host-code execution channel from main.

This overlay puts the existing IDE and Paper deployment behind Caddy HTTPS and OAuth2 Proxy. GitHub
usernames are explicitly allowlisted; neither an email domain nor the page's CSRF token grants login.
Only ports 80 and 443 are published. Paper, Dolt, OAuth2 Proxy and Docker remain internal.

Use a native Linux **arm64 or amd64** Docker host with the matching CI-built product images; the automatic release
plane above admits and accepts amd64 only. Docker Compose must support
`!reset` and `!override` (2.24.4 or newer). Live execution and cross-host takeover are not enabled by this overlay.
The existing Paper limit stays four runs. The example's 2 GiB ledger cap is a candidate deployment budget,
not a tested capacity result; do not change an existing deployment's cap without evaluating its load.

1. Choose the server, retain its public IPv4, and point your `TRADE_DOMAIN` to it. The second block of
   `Caddyfile` redirects the original deployment's bare domain: delete it on your host. Check inbound HTTPS
   and the container's actual public egress independently. Permit ports 80/443 for ACME and HTTPS;
   do not expose 8765, 8767, 13330 or the Docker API.
2. Register a GitHub OAuth App with homepage `https://<TRADE_DOMAIN>` and callback
   `https://<TRADE_DOMAIN>/oauth2/callback`. Set `TRADE_GITHUB_USERS` to the logins allowed in.
   Use this dedicated OAuth App, not an exchange API key or a GitHub personal access token.
3. Copy `env.example` to a private deployment env file and set the actual non-secret configuration.
   Put the OAuth client secret in the named private file. Generate a separate base64url-encoded random 32-byte cookie secret
   (no trailing newline) in the other private file. Keep both readable only by the configured runtime uid and
   outside Git, logs and the public ledger. OAuth2 Proxy alone mounts these files; IDE and Paper do not.
   Name the admitted images in that file: `python3 -m deploy.images --env <file>` (Python 3.12 or newer;
   [Image versions](../README.md#image-versions)).
4. Use **new, empty** service/data/profile directories. `ledger mirror` bootstraps the public research
   origin without a DoltHub publishing key and creates a separate, empty `paper` execution database.
   It refuses to take over an existing research writer. Prepare a valid execution market cache with the
   existing market CLI (at least current membership; historical chart inputs as needed); do not copy the
   entire workstation research cache. The default bulk market-import is disabled. The Agent chat runs
   inside the IDE and is reached only through the same authenticated HTTPS entry. Its provider settings
   and chats persist in the dedicated `trade-ide-agent` volume; configure a provider in the Agent panel.
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

Caddy manages certificates in its own volumes. Keep those volumes on updates. Web releases never touch this
proxy: a `Caddyfile` change reaches it by updating the host's checkout and recreating `edge` alone
(`up -d --no-deps --force-recreate edge`, with the compose files `install-release.sh` names). OAuth2 Proxy keeps encrypted
sessions in secure HttpOnly cookies and does not pass provider tokens or user headers into the IDE.
The GitHub identity session is independent of Paper process lifetime. `/api/…` returns 401 when login
expires; a full page navigation uses GitHub login. After login, the existing same-origin/CSRF checks still
apply to start, stop and resume. Streaming is flushed without an upstream whole-request deadline.

Do not enable skip-auth routes, wildcard GitHub membership or public origin ports. The internal Docker API
proxy checks create bodies, but a controller it serves can still win a symlink race and bind mount a host path
([measured](../../docs/plans/paper-compose-deployment.zh.md)), so that controller remains a trust boundary.
Before exposing a host to untrusted strategy authors, validate a rootless execution host. GitHub allowlisting does not isolate hostile users
from one another; this first deployment is for the specified trusted operator accounts.

Acceptance requires: unauthenticated page/API/SSE denial, a disallowed GitHub user denied, an allowed user
admitted, expired login does not stop runners, source/host/CSRF checks still hold, bounded logs, and a native
checkpoint resume using the same run. Config validation alone is not an actual GitHub callback/HTTPS test.

The toolbar's **Sync DoltHub** button updates only the configured read-only research mirror. Fetch is
validated at an immutable commit, then fast-forwarded; errors keep the previously displayed version.
No browser request can choose an origin or database. Paper captures the selected strategy's exact source
and required parent inputs into its own database before launch; research updates do not replace running
inputs. Stop, native resume and logs use the execution records. No execution writes are pushed to research.

The databases share a Dolt process to keep the deployment small. The existing privileged Paper CLI still
requires the service administrator for sealed-run deletion and publication-status checks. It receives no
DoltHub key; this is separation of business data paths, not containment of a compromised controller.
Execution records and native originals need persistent disk and separate backup; their `isolated` profile
prevents DoltHub publication and does not grant permission to delete data. See
[`remote-paper-data-split.zh.md`](../../docs/plans/remote-paper-data-split.zh.md) for the storage decision,
limits and 4-core/8-GB evaluation scope. The first target-host rollout and its actual acceptance boundaries
are recorded in [`remote-paper-production-acceptance.zh.md`](../../docs/plans/remote-paper-production-acceptance.zh.md).

The separate operator-only Live CLI is documented in [`engine/README.md`](../../engine/README.md#live-execution).
This overlay does not mount Binance credentials or add a Live browser endpoint. Deploy Live with its own
fixed private custody root and credential file, using the CI-built runtime digest; keep that root outside
the public research mirror and Paper directories. Account-mode changes and actual order tests require the
operator's explicit scope. A successful account preflight is not evidence of a completed real trade.
