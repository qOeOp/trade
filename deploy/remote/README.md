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
runtime carries forward only when its complete build inputs match the service source and its source
still has successful CI and a retained tested artifact. Each candidate resolves that qualification afresh;
without a match, a null image withholds admission. The image resolver and Paper controller also check
the actual runtime image revision's inputs before accepting a pair. See the
[runtime pairing contract](../../docs/plans/runtime-release-pairing.zh.md) for input coverage, retained
artifact expiry and the installed-controller update. The host polls this public Git channel every
two minutes, not the Actions API, and does not need a new key or token. A 15-minute CI reconciliation
backs up completion events when third-party checks finish late. Candidates warm the research lines of
active Paper runs, then pass routed health, authentication, container-identity and data-progress checks.

The [Paper release extension](../../docs/plans/paper-continuous-delivery.zh.md), installed once with
`sh deploy/remote/install-paper-release.sh`, also publishes the admitted service and runtime digests.
It warms a read-only controller, pauses new writes while draining the existing lifecycle lock, then
switches the API. During observation only new starts wait; commit enables the new fixed runtime default.
Existing runner/egress containers, checkpoint originals and image_ref stay unchanged. Schema or protocol
changes must remain compatible with existing runs; incompatible candidates keep the previous service.

The release plane reads these host paths, which the manual commands below do not use:

| Path | What it is | Made by |
|---|---|---|
| `/etc/trade/remote.env` | the same settings as `deploy/remote/.env` in the manual commands | the operator, before installing |
| `/opt/trade-app` | a checkout holding `deploy/compose.yaml` and `deploy/remote/compose.yaml` | the operator, before installing |
| `/opt/trade-release` | the installed control code and `cd.compose.yaml` | `install-release.sh` |
| `/var/lib/trade-release` | release state, including `router/active.json` | `install-release.sh` |

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
the journal for the operator. After a settled tick the three newest good containers of each kind (Web, Agent, Paper controller)
and the newest failed one stay, older stopped ones are removed, and so are IDE and service images no container
uses, since they can be pulled again by digest. Running containers, the active routes, runtime images, runs, ledger
records and market inputs are never pruned. Do not run
whole-project `compose up` as the Web update mechanism. Control-program updates require reviewing and
installing the new files; the timer is not a host-code execution channel from main.

### Optional Live control pairing

Live is enabled for the release plane only by an explicitly installed, private
`/var/lib/trade-release/live/configuration.json`. It is an operator declaration with
`format: "live-deployment-v1"` and the existing `root`, `research_ledger`, `research_at`, `universe_file`,
`symbols`, `sources`, `defaults` and `memory` fields from `live/configuration.py`. Omit `runtime` and
`socket`: the admitted release supplies the runtime and derives its socket. Each source must retain its
explicit `single_order_source_reviewed` value. Do not put an API key or secret in this file.

The control uses the same service revision as its Web image and the same qualified runtime pair as the
release record. Each revision gets `live/<revision>/configuration.json` and `live/<revision>/socket/`.
Web mounts only that socket directory read-only and keeps `--live-router=ide-router`; Agent, Paper and
the browser never mount the custody root. Control retains its existing operator UID/GID, mounts that
root at the same path, and uses read-only research/source inputs. It is a privileged Docker controller,
with the host Docker socket and `DAC_READ_SEARCH` for existing private reader metadata, not a hostile-code
sandbox. It has no TCP listener or frontend-network membership.

An update inherits the operator fields from the committed snapshot and requires the installation
declaration to agree. Changing the declaration requires an explicit installation change. Missing or
malformed configuration cannot silently remove Live from an already paired Web. Without an installed
declaration, a host that has never enabled Live retains its existing Web/Paper release behavior.

Install only after the concrete host change is authorized. Pause the existing release timer without
changing its unit or schedule, and let any active release service finish naturally. Confirm that no
service process or queued job remains before taking the existing `/var/lib/trade-release/lock` and
Live account lock, then confirm that no Web or Paper transaction needs recovery. The controller imports
modules before acquiring its lock; holding that lock alone does not prevent an in-flight process from
importing mixed versions. Do not terminate the release
service or any strategy to make installation proceed.

Stage the reviewed `deploy/__init__.py`, `release.py`, `release_host.py`, `runtime_inputs.py`,
`live_host.py`, `paper_host.py` and `paper_release.py` as one complete directory, root-owned with module
mode 0644. Inventory and preserve the installed `remote/` compose files and every other reviewed asset;
retain the original directory intact. Use an atomic directory exchange on the same filesystem so an
interruption cannot leave a mixture of module versions. Do not execute deployment code from a fetched
checkout. Recheck main/CI eligibility immediately before committing the reviewed installation.

Publish the new 0600 Live declaration last, in its 0700 directory. Declaration publication is the commit
boundary: before it, a verified reverse directory exchange can restore the old installation; after it,
do not automatically remove the declaration or roll back because a completion receipt is missing.
Recovery must inspect the actual module hashes and declaration. Restore the previously active timer
only after the resulting installation is verified. A stopped but enabled timer can resume after a host
restart; atomic complete directories protect code consistency, not a cross-reboot pause.

Preserve `/srv/trade-private/live`, its original owner, account.lock, credentials and execution originals.
Do not rerun the bootstrap installer or whole-project Compose. The systemd service needs no additional
writable path, and the existing timer schedule remains unchanged.

Before enabling the next checked main revision, verify that the installed systemd service can open the
original private `account.lock` read-only, that it sees the same regular-file inode as control, and that
the filesystem supports local read-only-fd exclusive flock. The release host itself holds that fd over
the read-only service-image `live release-inspect` call and transaction/route writes. It never creates a
missing account.lock or changes its permissions. Install this integration before the planned next main
release: an already active revision is not recreated in place under its retained container identity.

When Live is busy or unresolved, the timer keeps the current Web/control pair. During an idle update,
new effect-producing Live requests wait for a committed owner; reads and STOP remain available. Existing
runners are never restarted for publication. Once the new pair is committed, the host verifies each
retired control's exact Id, disables only its restart policy and sends cooperative SIGTERM. It observes
completion asynchronously; a slow CLI or handler keeps its old process and originals, without forced
kill or deletion. This installation does not query a venue, read a key, arm a strategy or change account
settings. See the [storage and locking decision](../../docs/plans/live-web-control.zh.md).

Once the paired release is verified, operators use the **Live** page in the existing authenticated IDE.
Save a credential version, choose a deployed strategy source and prepare its run. **Check account** makes
a read-only venue connection; **Start live** presents the frozen source hash and configuration before
submitting a trading start. Credential inputs clear after submission and saved secrets are never returned
by the page. An active or unresolved run retains its credential version until local custody is resolved.

The page remains a controller: closing it does not stop a strategy. **Request stop** remains available
while a start response is pending or observations cannot refresh. Wait for native terminal evidence and
account reconciliation; a recorded control request alone does not prove a fill or a flat account. Use
explicit request recovery for an uncertain response instead of submitting another start. Controlled test
sources are labelled separately and do not establish natural-signal performance.

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

## Live on this host

The operator-only Live CLI is documented in [`engine/README.md`](../../engine/README.md#live-execution). The base Paper
overlay mounts no Binance credential; the optional Live control pairing above adds the authenticated browser entry
and its private controller. The ledger's Dolt port stays unpublished. The CLI can run as a one-off container of the
admitted service image on the backend network, reading research through the
reader profile the release plane writes (`/var/lib/trade-release/profiles`, made by `install-release.sh`). It starts
each run's runner and egress as sibling containers through the host's Docker socket, so every path it passes is
mounted at the same path inside. Account-mode changes and order tests need the operator's explicit scope; a
successful preflight is not evidence of a completed real trade.

Keep one fixed private root for the account (`LIVE_ROOT`), outside `TRADE_DATA`, the Paper directories and Git, with
the strategy and universe files (`LIVE_INPUTS`) beside it. The CLI example uses an external API key file (`KEY`,
mode 0600); credentials saved through the Live page instead have private versions under `LIVE_ROOT/credentials/`.
Name the images from a checkout of main, then define the command:

```sh
python3 -m deploy.images --env /root/live-images.env   # prints the admitted images and writes them there
. /root/live-images.env
live() {
  docker run --rm --network trade-ide_default --read-only --cap-drop ALL --cap-add DAC_OVERRIDE \
    --security-opt no-new-privileges --user 0:0 --tmpfs /tmp:rw,nosuid,size=1g --env TRADE_DOLT_HOST=ledger \
    --mount type=bind,src=/var/lib/trade-release/profiles,dst=/run/trade/ledgers,readonly \
    --mount type=volume,src=trade-ide_trade-ledger-readers,dst=/run/trade/ledger-readers,readonly \
    --mount "type=bind,src=$LIVE_ROOT,dst=$LIVE_ROOT" \
    --mount "type=bind,src=$LIVE_INPUTS,dst=$LIVE_INPUTS,readonly" \
    --mount "type=bind,src=$KEY,dst=$KEY,readonly" \
    --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
    --entrypoint python "$TRADE_SERVICE_IMAGE" -m cli.main live "$@"
}
live preflight --root "$LIVE_ROOT" --run-id RUN --research-ledger /run/trade/ledgers/research.json \
  --research-at COMMIT --candidate CANDIDATE --symbols BTCUSDT \
  --strategy-file "$LIVE_INPUTS/strategy.py" --strategy-class CLASS --universe-file "$LIVE_INPUTS/universe.json" \
  --credentials-file "$KEY" --runtime "$TRADE_RUNTIME_IMAGE" --budget-usdt BUDGET --max-notional-per-order CAP \
  --max-loss-usdt LOSS --duration-seconds SECONDS --single-order-source-reviewed
live start --root "$LIVE_ROOT" --run-id RUN --credentials-file "$KEY" --confirm-real-orders SOURCE_SHA256
live status --root "$LIVE_ROOT" --run-id RUN
```

Pass `--runtime` as the admitted digest, not the default tag. `stop`, `logs` and `reconcile` take the same
`--root` and `--run-id` (`reconcile` also `--credentials-file`). This is the command of the 2026-11-07 server
trial, plus the options added since. Not yet run here: before `preflight` and `start` this container itself
reads the key's permissions from `api.binance.com`, so the backend network needs that egress.

### Backing up the Live root

`LIVE_ROOT` holds what nothing else can give back: each run's inputs, journal, account snapshots, native cache and
logs, and the account slot. Back it up after every run and before host maintenance, when `live status` shows no run
`running` and no other Live command or credential change is in progress (runners write without the root's lock).
Keep the archive private and off this host. It holds account balances and credential paths; when credentials were
saved through the Live page, it also includes their API keys and secrets under `credentials/`. These files and the
archive are not encrypted by the product. An external CLI key file is outside this archive and needs separate
private backup.

```sh
umask 077
tar -C / -czf "/root/live-root-$(date -u +%Y%m%dT%H%M%SZ).tgz" "${LIVE_ROOT#/}"
```

To restore, extract into an absent `LIVE_ROOT` at the **same absolute path** (`tar -C / -xpzf ARCHIVE`), preserving
private permissions and the saved credential versions and metadata. Restore any external CLI key file to its old
path, then `live status` each run. Docker resource names come from the root's path, so a
root restored elsewhere cannot find an unresolved run's network or runner. A run that was unresolved stays
unresolved and keeps the slot; settle it as in [Unresolved Live runs](../../engine/README.md#unresolved-live-runs).
