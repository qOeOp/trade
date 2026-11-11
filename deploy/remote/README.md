# Remote Paper

**Who this is for.** The automatic release below (CD) serves the author's own deployment only. Its source
repository (`qOeOp/trade`), image names (`ghcr.io/qoeop/trade-*`) and `deploy-ready` channel are written into
`deploy/release_host.py` and `.github/scripts/release-ready.cjs` on purpose and are not settings: a host that
installs it follows the author's `main`. Another operator runs the base deployment ([`deploy/README.md`](../README.md))
and updates it by hand, or forks the repository and changes those names in the fork.

The [continuous Web release plane](../../docs/plans/remote-continuous-delivery.zh.md) runs the Web, its
single Agent writer and the Paper controller, and publishes successful main builds without recreating Paper
runs, the ledger or strategy containers. Install its reviewed control code once on a new host with
`sh deploy/remote/install-release.sh`, after the whole-project `up` below (step 6). It creates the first
Paper controller, Web and Agent from the newest admitted main build, starts the internal Web and Paper
routers and moves OAuth2 Proxy onto the Web router, waits until the first release is ready behind the OAuth
allowlist, then enables `trade-release.timer`. Web switches reload the internal proxy.

`release-ready` in GitHub Actions checks the same source's workflows and third-party checks, downloads
the native tested digest artifact for that run/attempt, and appends `{revision,image,service,runtime}`, the
exact tested IDE, service and runtime digests, to the operational `deploy-ready` branch. A
runtime carries forward only when its complete build inputs match the service source and its source
still has successful CI and a retained tested artifact. Each candidate resolves that qualification afresh;
without a match, a null image withholds admission. The image resolver and Paper controller also check
the actual runtime image revision's inputs before accepting a pair. See the
[runtime pairing contract](../../docs/plans/runtime-release-pairing.zh.md) for input coverage, retained
artifact expiry and the installed-controller update. The host polls this public Git channel every
two minutes, not the Actions API, and does not need a new key or token. A 15-minute CI reconciliation
backs up completion events when third-party checks finish late. Candidates warm the research lines of
active Paper runs (the newest line when none matches; nothing while the ledger has no line), then pass routed health, authentication, container-identity and data-progress checks.

The [Paper release](../../docs/plans/paper-continuous-delivery.zh.md) publishes the admitted service and
runtime digests once the Web of the same revision is routed. It warms a read-only controller, pauses new writes while draining the existing lifecycle lock, then
switches the API. During observation only new starts wait; commit enables the new fixed runtime default.
Existing runner/egress containers, checkpoint originals and image_ref stay unchanged. Schema or protocol
changes must remain compatible with existing runs; incompatible candidates keep the previous service.

The release plane reads these host paths; the install steps below make the first two:

| Path | What it is | Made by |
|---|---|---|
| `/etc/trade/remote.env` | the deployment settings (`env.example`), read by every compose command | the operator, before installing |
| `/opt/trade-app` | a checkout holding `deploy/compose.yaml` and `deploy/remote/compose.yaml` | the operator, before installing |
| `/opt/trade-release` | the installed control code, `cd.compose.yaml` and `paper-cd.compose.yaml` | `install-release.sh` |
| `/var/lib/trade-release` | release state, including `router/active.json` | `install-release.sh` |

The host control program is installed from reviewed source and does not update itself by executing the
fetched checkout ([Updating the installed control code](#updating-the-installed-control-code)). Agent-format
changes must retain backward compatibility for rollback. Release handoffs can renew only a positively
identified pre-forward same-origin nonce rejection, preserving the original operation ID.

Use `systemctl list-timers trade-release.timer` and `journalctl -u trade-release.service` for publication
status. A failed/interrupted target stays blocked in `/var/lib/trade-release/failed/`; use a corrected
new main commit rather than looping on the same failed target. A pending transaction is recovered before
any new selection. Paper has a separate recovery journal and `paper-failed/` marker, with starts
kept paused until commit so rollback never replaces a newly started account. Unknown independent routing/Agent changes stop automatic operations and preserve
the journal for the operator. After a settled tick the three newest good containers of each kind (Web, Agent, Paper controller,
Live controller) and the newest failed one stay, older stopped ones are removed, and so are IDE and service images no container
uses (and old docker-api images), since they can be pulled again by digest. A Live controller also stays while it is the account's owner or its Web
remains, and its `live/<revision>/` directory goes with it. A runtime image goes when no container uses it, neither a
Paper controller nor a kept Live directory names it, and the registry still serves its digest: a run that needs it
again pulls it by digest. Running containers, the active routes, runs, ledger records and market inputs are never pruned.
A whole-project `compose up` starts only the ledger, the Docker API proxy, OAuth2 Proxy and `edge` (its `ide` and `paper`
services are workstation-only); it never updates the Web or Paper. Control-program updates require reviewing and
installing the new files; the timer is not a host-code execution channel from main.

### Optional Live control pairing

Live is enabled for the release plane only by an explicitly installed, private
`/var/lib/trade-release/live/configuration.json`. It is an operator declaration with
`format: "live-deployment-v1"` and the existing `root`, `research_ledger`, `research_at`, `universe_file`,
`symbols`, `sources`, `defaults` (with `leverage`, the account's Binance leverage on the symbol), `memory` and
`market_root` (the market directory `$TRADE_DATA/market`, mounted read-only for the contract terms) fields from
`live/configuration.py`. Omit `runtime` and
`socket`: the admitted release supplies the runtime and derives its socket. Do not put an API key or secret
in this file.
Removing a source row retires it once the next paired control reads the declaration: a prepared run keeps
its own copy of the inputs, and past runs of that source show no declared purpose.

A control is created with the same service revision as its Web image and the same qualified runtime pair as
the release record. The routed Web's control is the route's owner: the route's `@id` (`live-<revision>`) when
present, otherwise the Web's own revision. A candidate whose change from the owner's revision touches only
paths the control never loads (`ide/web/`, `ide/overview/`, `ide/agent/`, `docs/`, `tests/`, `.agents/`,
`.github/`, `deploy/remote/`, `deploy/README.md`, `deploy/compose.yaml` and top-level Markdown) is released as a
Web alone: it mounts the owner's socket, the route records that owner, and the account is neither inspected
nor locked. Any other change pairs a new control. Each revision gets `live/<revision>/configuration.json` and `live/<revision>/socket/`.
Web mounts only that socket directory read-only and keeps `--live-router=ide-router`; Agent, Paper and
the browser never mount the custody root. Control retains its existing operator UID/GID, mounts that
root at the same path, and uses read-only research/source inputs. It is a privileged Docker controller,
with the host Docker socket and `DAC_READ_SEARCH` for existing private reader metadata, not a hostile-code
sandbox. It has no TCP listener or frontend-network membership.

A paired release builds its control's snapshot from the installed declaration; a running control and
its prepared runs keep the snapshot they started with. To change the catalog fields (sources,
`research_at`, defaults and the rest), wait until no run on the Live page shows **Account custody held**
Yes and no request is unresolved, pause
the release timer and let any release service finish. Stage new source files beside the existing inputs
(regular, root-owned, read-only) and keep the old ones while an old control is retained, since it mounts
them. Then replace the declaration atomically (0600, written beside it and renamed over it) and resume
the timer. From the swap on, the old control serves only reads and STOP. The next main release pairs a
new control from the declaration, even if it touches only Web paths; nothing changes until one lands.
A main release is a main commit that builds the service image (the paths in `.github/workflows/ide-image.yml`);
a merge of docs, skills or host-side files outside the image (`deploy/remote/`, `deploy/compose.yaml`,
`deploy/README.md`) alone builds none and leaves the swap waiting; those reach the host through its
`/opt/trade-app` checkout and `install-release.sh`.
Restoring the previous declaration undoes a swap that has not paired yet. The custody `root` cannot
change this way; a release refuses it. Missing or
malformed configuration cannot silently remove Live from an already paired Web. Without an installed
declaration, a host that has never enabled Live retains its existing Web/Paper release behavior.

To enable Live on a host whose first release is verified, make the custody `root` outside `TRADE_DATA`,
the Paper directories and Git, mode 0700, owned by the operator UID/GID the control will run as, and in it an
empty `account.lock` (mode 0600, the same owner): a release opens that existing lock and never creates it.
Stage the declared strategy, universe and research files as regular, root-owned, read-only files. Then pause
the timer, let any release service finish, write the declaration (0600, in a 0700
`/var/lib/trade-release/live/`) and resume the timer. The next main release pairs
the first control. Do not save a credential or start a run as part of installing.

When Live is busy or unresolved, the timer still releases a Web-only candidate beside the owner control
(memory headroom permitting). A candidate that changes the control goes **Web first** when its
`live/protocol.py` `PROTOCOL` equals the owner's: its Web, named `trade-release-web-<revision>-pre`, serves
beside the owner control exactly as a Web-only one does, and the journal logs `ahead of Live control
<owner>`; once Live is idle the same revision pairs its own control under the plain name. An undeclared, malformed or
different protocol keeps the current Web/control pair, and so does a held account lock, which is a
read in progress rather than a busy account
([design](../../docs/plans/live-web-first-release-20261108.zh.md)). During an idle update,
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
The same dialog sets up Telegram notifications: create a bot with @BotFather, send it any message, then save
its token. The control binds the one private chat that messaged the bot and keeps both in
`LIVE_ROOT/notify/telegram.json` (0600); it then sends run starts and ends, fills, runs needing attention and a
daily summary at the first check after 00:00 UTC, from the control container to `api.telegram.org` over the backend
network. Each run notice ends with the run's page, `https://<TRADE_DOMAIN>/?live=<run_id>`, which a phone opens as
that run's page. `LIVE_ROOT/notify/state.json` records what was sent, so a restart or a second control does not resend.
The release tick sends to the same chat, from the host, what fails outside Live: a tick that failed, a Paper run
that stopped and could not resume, and a research ledger whose publish has failed for 30 minutes or whose origin
history changed elsewhere (read through the routed Web). Each is sent once while it lasts and again only after it
cleared; `/var/lib/trade-release/notices.json` records what was sent. It reads the token file named by the Live
declaration's `root`; without Live or a saved token nothing is sent.

The page remains a controller: closing it does not stop a strategy. **Request stop** remains available
while a start response is pending or observations cannot refresh. Wait for native terminal evidence and
account reconciliation; a recorded control request alone does not prove a fill or a flat account. Use
explicit request recovery for an uncertain response instead of submitting another start. Controlled test
sources are labelled separately and do not establish natural-signal performance.

This overlay puts the existing IDE and Paper deployment behind Caddy HTTPS and OAuth2 Proxy. Only members of
one GitHub team get in; neither organization membership, an email domain nor the page's CSRF token grants login.
Only ports 80 and 443 are published. Paper, Dolt, OAuth2 Proxy and Docker remain internal.

Use a native Linux **amd64** host: the release plane admits and accepts amd64 images only. It needs Docker
Engine with the Compose plugin 2.28 or newer (`!reset`, `!override`, and `config --environment`, with which
the release control reads `/etc/trade/remote.env`), `python3` 3.12 or newer and `git` (the release control
fetches the public channel with it); no `uv`. Ubuntu 26.04's Docker 29.1, Compose 2.40
and Python 3.14 packages qualify. Live is enabled only by the declaration above.
Paper runs are admitted by memory, not by count (`TRADE_PAPER_MEMORY`,
[paper-admission-by-memory](../../docs/plans/paper-admission-by-memory.zh.md)), one per source. The example's 2 GiB ledger cap is a candidate deployment budget,
not a tested capacity result; do not change an existing deployment's cap without evaluating its load.

1. Choose the server, retain its public IPv4, and point your `TRADE_DOMAIN` to it, and any
   `TRADE_DOMAIN_ALIASES`, which redirect to it. Check inbound HTTPS
   and the container's actual public egress independently. Permit ports 80/443 for ACME and HTTPS;
   do not expose 8765, 8767, 13330 or the Docker API.
2. Register a GitHub OAuth App with homepage `https://<TRADE_DOMAIN>` and callback
   `https://<TRADE_DOMAIN>/oauth2/callback`; it can stay on your own account. Login is by membership of one
   team: make a GitHub organization (a free one is enough) and a team in it, add the people allowed in, and set
   `TRADE_GITHUB_ORG` and `TRADE_GITHUB_TEAM` to the organization's login and the team's slug. A new organization
   restricts OAuth App access, and until it approves this app every login is refused: as its owner, open the
   organization's **Settings**, **Third-party Access**, **OAuth app policy**, then **Review** and **Grant access**
   next to the app. People are then added and removed on GitHub with no server change; a removed member's
   session lasts until it expires (`cookie_expire`, 8 hours).
   Use this dedicated OAuth App, not an exchange API key or a GitHub personal access token.
3. As root, put a checkout at `/opt/trade-app` and the settings at `/etc/trade/remote.env`, then set the
   values in it. The commands below run from `/opt/trade-app`.

   ```sh
   git clone https://github.com/qOeOp/trade /opt/trade-app && cd /opt/trade-app
   install -d -m 700 /etc/trade /srv/trade-private
   install -m 600 deploy/remote/env.example /etc/trade/remote.env
   ```

   Put the OAuth client secret in the file `TRADE_GITHUB_CLIENT_SECRET_FILE` names (with an editor, not on a
   command line), and a base64url-encoded random 32-byte cookie secret, with no trailing newline, in the
   `TRADE_OAUTH_COOKIE_SECRET_FILE` one. Make both mode 0400 and owned by `TRADE_UID:TRADE_GID`. Keep them out of
   Git, logs and the public ledger; OAuth2 Proxy alone mounts them.

   ```sh
   python3 -c 'import base64, os, sys; sys.stdout.write(base64.urlsafe_b64encode(os.urandom(32)).decode())' \
     > /srv/trade-private/oauth-cookie-secret
   chown 1000:1000 /srv/trade-private/github-client-secret /srv/trade-private/oauth-cookie-secret
   chmod 400 /srv/trade-private/github-client-secret /srv/trade-private/oauth-cookie-secret
   ```

   Name the admitted images in that file: `python3 -m deploy.images --env /etc/trade/remote.env`
   ([Image versions](../README.md#image-versions)).
4. Make the data directories under `TRADE_DATA`, owned by `TRADE_UID:TRADE_GID` (here the example's
   `/srv/trade` and 1000). Docker would make a missing one owned by root, which the ledger cannot write,
   and a release cannot bind mount a missing market directory into the Web and Paper controller.

   ```sh
   install -d -m 755 -o 1000 -g 1000 /srv/trade /srv/trade/dolt /srv/trade/dolt/paper /srv/trade/ledgers \
     /srv/trade/dolt-backups /srv/trade/market
   install -d -m 700 -o 1000 -g 1000 /srv/trade/paper-tmp
   ```

   `ledger mirror` bootstraps the public research origin without a DoltHub publishing key and creates a
   separate, empty `paper` execution database. `TRADE_RESEARCH_ORIGIN` must name a research ledger already
   published from a workstation ([First start](../README.md#first-start)); the mirror never publishes. The
   Agent chat runs inside the IDE and is reached only through the same authenticated HTTPS entry. Its provider
   settings and chats persist in the dedicated `trade-ide-agent` volume; configure a provider in the Agent panel.
5. Start the ledger, the Docker API proxy, OAuth2 Proxy and `edge`. Relative compose paths are resolved against
   `deploy/compose.yaml`, the first compose file. `up` waits until the mirror has cloned the research ledger.

   ```sh
   compose() {
     docker compose --env-file /etc/trade/remote.env -f deploy/compose.yaml -f deploy/remote/compose.yaml "$@"
   }
   compose config --quiet
   compose pull
   compose up -d --wait
   ```

   Paper and the Web read the market directory, and a Paper start refuses a window its universe does not
   cover. Fill it with the existing importer, the directory's only writer: check that Binance answers from
   this host, put the range in `TRADE_MARKET_ARGS` in `/etc/trade/remote.env` ([What the market range
   costs](../README.md#what-the-market-range-costs); start the bars a month before the first month Paper runs
   in, since the first imported month has no members), then start it with its profile. Do not copy a
   workstation's research cache.

   ```sh
   curl -sS -o /dev/null -w '%{http_code}\n' https://fapi.binance.com/fapi/v1/time
   compose --profile local-research-import up -d --no-deps market-import
   ```

6. Wait for at least one admitted main build in `deploy-ready`, then run `sh deploy/remote/install-release.sh`
   as root from `/opt/trade-app`. It stops at the first failure; remove the `trade-release-*` containers and
   the `router` and `paper-router` directories under `/var/lib/trade-release` it left, then run it again.

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
Before exposing a host to untrusted strategy authors, validate a rootless execution host. Team membership does not isolate hostile users
from one another; the team is for trusted operators only.

Acceptance requires: unauthenticated page/API/SSE denial, a GitHub user outside the team denied (a member of the
organization outside the team included), a team member admitted, expired login does not stop runners, source/host/CSRF checks still hold, bounded logs, and a native
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
limits and 4-core/8-GB evaluation scope.

## Rolling back

The release plane only moves forward along `main`, so a rollback is a new commit, not a reselection:

1. Name what runs: the IDE's About (version and commit), or the Web container in
   `/var/lib/trade-release/router/active.json` (`trade-release-web-<commit>`).
2. Stop further releases while you work: `sudo systemctl stop trade-release.timer`. A release already running
   finishes by itself; do not kill it.
3. Revert the bad merge on a branch (`git revert -m 1 <merge-commit>`), or revert back to the last good tag
   ([`CHANGELOG.md`](../../CHANGELOG.md)), and merge it through the usual checks. Then
   `sudo systemctl start trade-release.timer`: the next tick releases that commit like any other.
4. Check the About dialog names the new commit, and `journalctl -u trade-release.service` shows it routed.

What a rollback does not undo: ledger records and the market directory only grow, and running Paper and Live runs
keep the runtime image and controller they started with. A schema or protocol change therefore has to stay readable
by the revision before it; a revert that needs the ledger rewound is a destructive write for the user to decide.
A target that failed stays in `/var/lib/trade-release/failed/`, and the three newest good Web, Agent and controller
containers stay on the host for inspection. A workstation without the release plane goes back with
`deploy.images --revision` ([Image versions](../README.md#image-versions)).

## Live on this host

The operator-only Live CLI is documented in [`engine/README.md`](../../engine/README.md#live-execution). The base Paper
overlay mounts no Binance credential; the optional Live control pairing above adds the authenticated browser entry
and its private controller. The ledger's Dolt port stays unpublished. The CLI can run as a one-off container of the
admitted service image on the backend network, reading research through the
reader profile the release plane writes (`/var/lib/trade-release/profiles`, made by `install-release.sh`). It starts
each run's runner and egress as sibling containers through the host's Docker socket, so every path it passes is
mounted at the same path inside. Account-mode changes and order tests need the operator's explicit scope; a
successful preflight is not evidence of a completed real trade.

The installed declaration `/var/lib/trade-release/live/configuration.json` is mandatory. `LIVE_ROOT` must equal
its existing canonical root; it is an assertion, not a new account namespace. A missing declaration/mount, another
root or a mismatched release refuses preparation, credential use and new connections before their effects.
All keys accepted by this installation share the original durable run/reconcile custody. REST-only preflights
retain their existing overlap behavior and do not certify a later start's account state.

Keep that fixed private root outside `TRADE_DATA`, the Paper directories and Git, with
the strategy and universe files (`LIVE_INPUTS`) beside it. The CLI example uses an external API key file (`KEY`,
mode 0600); credentials saved through the Live page instead have private versions under `LIVE_ROOT/credentials/`.
Name the images for the **currently committed owner revision**, not simply the newest CI build, from a checkout of
main. Read it from `/var/lib/trade-release/router/active.json`: the route's `@id` after `live-` when present,
otherwise the routed Web's revision; pass it as `LIVE_REVISION` below.
`deploy.images` verifies its admitted service/runtime digests and OCI build provenance. Capture that selected revision
and those images together, independently of later route changes. The CLI requires the captured `--release-web` identity
for preflight/start/reconcile and carries it through every locked effect. It never assigns itself the current route.
Publication therefore invalidates a waiting invocation, including an old selected image started after the switch.
Then define the command:

```sh
readonly LIVE_SELECTED_REVISION="$LIVE_REVISION"
python3 -m deploy.images --revision "$LIVE_SELECTED_REVISION" --env /root/live-images.env || exit
. /root/live-images.env
readonly LIVE_SELECTED_SERVICE="$TRADE_SERVICE_IMAGE" LIVE_SELECTED_RUNTIME="$TRADE_RUNTIME_IMAGE"
readonly LIVE_SELECTED_WEB="trade-release-web-$LIVE_SELECTED_REVISION"
live() {
  case "$1" in
    preflight|start|reconcile) set -- "$@" --release-web "$LIVE_SELECTED_WEB" ;;
  esac
  docker run --rm --network trade-ide_default --read-only --cap-drop ALL --cap-add DAC_OVERRIDE \
    --security-opt no-new-privileges --user 0:0 --tmpfs /tmp:rw,nosuid,size=1g --env TRADE_DOLT_HOST=ledger \
    --env HOME=/tmp --env DOCKER_CONFIG=/tmp/docker-public --env DOCKER_HOST=unix:///var/run/docker.sock \
    --mount type=bind,src=/var/lib/trade-release,dst=/var/lib/trade-release,readonly \
    --mount type=bind,src=/var/lib/trade-release/profiles,dst=/run/trade/ledgers,readonly \
    --mount type=volume,src=trade-ide_trade-ledger-readers,dst=/run/trade/ledger-readers,readonly \
    --mount "type=bind,src=$LIVE_ROOT,dst=$LIVE_ROOT" \
    --mount "type=bind,src=$LIVE_INPUTS,dst=$LIVE_INPUTS,readonly" \
    --mount "type=bind,src=$KEY,dst=$KEY,readonly" \
    --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
    --entrypoint python "$LIVE_SELECTED_SERVICE" -m cli.main live "$@"
}
live preflight --root "$LIVE_ROOT" --run-id RUN --research-ledger /run/trade/ledgers/research.json \
  --research-at COMMIT --candidate CANDIDATE --symbols BTCUSDT \
  --strategy-file "$LIVE_INPUTS/strategy.py" --strategy-class CLASS --universe-file "$LIVE_INPUTS/universe.json" \
  --credentials-file "$KEY" --runtime "$LIVE_SELECTED_RUNTIME" --budget-usdt BUDGET \
  --max-loss-usdt LOSS --duration-seconds SECONDS --leverage LEVERAGE
live start --root "$LIVE_ROOT" --run-id RUN --credentials-file "$KEY" --confirm-real-orders SOURCE_SHA256
live status --root "$LIVE_ROOT" --run-id RUN
```

Use a fresh shell to select a new release after publication; do not re-label an old selected service image.
The supported wrapper verifies OCI provenance through `deploy.images`; the CLI release assertion is not protection
against an administrator deliberately running a different raw image with forged arguments.

Historical `status` and `logs` are pure observations: they do not release custody, archive logs or recycle containers.
The current paired controller owns host maintenance.

Pass `--runtime` as the admitted digest, not the default tag. `stop`, `logs` and `reconcile` take the same
`--root` and `--run-id` (`reconcile` also `--credentials-file`). Before `preflight` and `start` this container
itself reads the key's permissions from `api.binance.com`, so the backend network needs that egress.

### Backing up the Live root

`LIVE_ROOT` holds what nothing else can give back: each run's inputs, journal, account snapshots, native cache and
logs, and the account slot. Back it up after every run and before host maintenance, when `live status` shows no run
`running` and no other Live command or credential change is in progress (runners write without the root's lock).
Keep the archive private and off this host. It holds account balances and credential paths; when credentials were
saved through the Live page, it also includes their API keys and secrets under `credentials/`, and a saved Telegram
bot token under `notify/`. These files and the
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

## Updating the installed control code

A new `deploy/` module or a Live pairing on a host whose release plane runs is installed by hand, never by
the timer or `install-release.sh`. Install only after the concrete host change is authorized. Pause the existing release timer without
changing its unit or schedule, and let any active release service finish naturally. Confirm that no
service process or queued job remains before taking the existing `/var/lib/trade-release/lock` and
Live account lock, then confirm that no Web or Paper transaction needs recovery. The controller imports
modules before acquiring its lock; holding that lock alone does not prevent an in-flight process from
importing mixed versions. Do not terminate the release
service or any strategy to make installation proceed.

Stage the reviewed `deploy/__init__.py`, `release.py`, `release_host.py`, `runtime_inputs.py`,
`live_host.py`, `live_configuration.py`, `paper_host.py`, `paper_release.py` and `telegram.py` as one complete directory, root-owned with module
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

Preserve the Live `root`, its owner, `account.lock`, credentials and execution originals.
Do not rerun the installer or the whole-project `up`. The systemd service needs no additional
writable path, and the existing timer schedule remains unchanged.

Before enabling the next checked main revision, verify that the installed systemd service can open the
original private `account.lock` read-only, that it sees the same regular-file inode as control, and that
the filesystem supports local read-only-fd exclusive flock. The release host itself holds that fd over
the read-only service-image `live release-inspect` call and transaction/route writes. It never creates a
missing account.lock or changes its permissions. Install this integration before the planned next main
release: an already active revision is not recreated in place under its retained container identity.
