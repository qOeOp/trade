# Remote Paper

**Who this is for.** The automatic release below (CD) serves the author's own deployment only. Its source
repository (`qOeOp/trade`), image names (`ghcr.io/qoeop/trade-*`) and `deploy-ready` channel are written into
`deploy/release_host.py` and `.github/scripts/release-ready.cjs` on purpose and are not settings: a host that
installs it follows the author's versions. Another operator runs the base deployment ([`deploy/README.md`](../README.md))
and updates it by hand, or forks the repository and changes those names in the fork.

The [continuous Web release plane](../../docs/plans/remote-continuous-delivery.zh.md) runs the Web, its
single Agent writer, its Live control and the Paper controller, and publishes admitted versions without recreating Paper
runs, the ledger or strategy containers. A merge to `main` is not a release: only a version tag
([`CHANGELOG.md`](../../CHANGELOG.md)) moves this host, and each version is released by its own control code
([Release control code](#release-control-code)). Bootstrap the plane once on a new host with
`sh deploy/remote/install-release.sh`, after the whole-project `up` below (step 6). It hands control to the newest
admitted version, whose control creates the first Paper controller, Live control, Web and Agent, starts the internal Web and
Paper routers that OAuth2 Proxy forwards to, waits until the first release is ready behind the OAuth
allowlist, then enables `trade-release.timer`. Web switches reload the internal proxy.

`release-ready` in GitHub Actions checks the same source's push workflows (except `docs-pages`: the
documentation site is not part of a release) and third-party checks, downloads
the native tested digest artifact for that run/attempt, and appends `{revision,image,service,runtime}`, the
exact tested IDE, service and runtime digests, to two operational branches: `main-ready` for every `main`
build (staging; no host reads it), and `deploy-ready`, which this host reads, only for the commit of the highest
version tag that `main` contains. `deploy-ready` never moves back to an older version, and a newer
untagged `main` build never touches it; each admission also records a GitHub deployment to `production`, which
says only that the version was admitted, since the host does not report back. A
runtime carries forward only when its complete build inputs match the service source and its source
still has successful CI and a retained tested artifact. Each candidate resolves that qualification afresh;
without a match, a null image withholds admission. A commit a channel already admitted keeps its recorded
digests while its checks stay green, so its expired artifacts are not read again. The image resolver and Paper controller also check
the actual runtime image revision's inputs before accepting a pair. See the
[runtime pairing contract](../../docs/plans/runtime-release-pairing.zh.md) for input coverage, retained
artifact expiry and the installed-controller update. The host polls this public Git channel every
two minutes, not the Actions API, and does not need a new key or token. A 15-minute CI reconciliation
backs up completion events when third-party checks finish late. Candidates warm the research lines of
active Paper runs (the newest line when none matches; nothing while the ledger has no line), then pass routed health, authentication, container-identity and data-progress checks.

The [Paper release](../../docs/plans/paper-continuous-delivery.zh.md) publishes the admitted service and
runtime digests inside the Web release of the same version: a version moves Web, Agent, Live control and the Paper
controller together, or none of them. After the Web candidate starts, it warms a read-only controller, pauses new
writes while draining the existing lifecycle lock, then switches the Paper API, so the Web candidate warms and is
observed against the Paper controller of its own version. Only new starts wait until the Web commits; the Paper
commit follows and enables the new fixed runtime default. A failure on either side before the Web commit rolls
back the Paper controller, then the Web, and marks the version failed; a crash after the Web commit finishes the
Paper commit on recovery.
Existing runner/egress containers, checkpoint originals and image_ref stay unchanged. 0.x keeps no compatibility
between versions (the user's decision of 2026-11-14): a new controller does not read or migrate a run an earlier
version left in another format; it stays on disk.

The release plane reads these host paths; the install steps below make the first two:

| Path | What it is | Made by |
|---|---|---|
| `/etc/trade/remote.env` | the deployment settings (`env.example`), read by every compose command | the operator, before installing |
| `/opt/trade-app` | a checkout holding `deploy/compose.yaml` and `deploy/remote/compose.yaml` | the operator, before installing |
| `/opt/trade-release` | the launcher `trade-release-tick`, the bootstrap copy of `deploy/*.py`, `cd.compose.yaml` and `paper-cd.compose.yaml` | `install-release.sh` |
| `/var/lib/trade-release` | release state, including `router/active.json` and the release control code under `control/` | `install-release.sh`, then the release control |

The host runs only the release control code inside the service image `deploy-ready` names
([Release control code](#release-control-code)). Release handoffs can renew only a positively
identified pre-forward same-origin nonce rejection, preserving the original operation ID.

Use `systemctl list-timers trade-release.timer` and `journalctl -u trade-release.service` for publication
status. A failed/interrupted target stays blocked in `/var/lib/trade-release/failed/`, so the
timer never loops on it; to retry it after fixing the cause, delete its marker, and the next tick removes the
stopped candidate containers of that revision before creating them again. A pending transaction is recovered before
any new selection. Paper keeps its own recovery journal beside the Web's (one `failed/` marker covers the
version), with starts kept paused until commit so rollback never replaces a newly started account. Unknown independent routing/Agent changes stop automatic operations and preserve
the journal for the operator. After a settled tick the three newest good containers of each kind (Web, Agent, Paper controller,
Live controller) and the newest failed one stay, older stopped ones are removed, and so are IDE and service images no container
uses (and old docker-api images), since they can be pulled again by digest. A Live controller also stays while its Web
remains, and its `live/<revision>/` directory goes with it. A runtime image goes when no container uses it, neither a
Paper controller nor a kept Live directory names it, and the registry still serves its digest: a run that needs it
again pulls it by digest. Running containers, the active routes, runs, ledger records and market inputs are never pruned.
A whole-project `compose up` starts only the ledger, the Docker API proxy, OAuth2 Proxy and `edge` (its `ide` and `paper`
services are workstation-only); it never updates the Web or Paper. The release control code changes only with an
admitted version ([Release control code](#release-control-code)).

### Live control pairing

Every release pairs a Live control with its Web; the operator installs nothing for it. The control is created with
the same service revision as its Web image and the same qualified runtime pair as the release record, and the routed
Web uses the control of its own revision, so every release pairs a new control, one that changes only Web paths
included. Each revision gets `live/<revision>/configuration.json` (a `live-control-v2` snapshot of what the host gives
it: the custody root, the research reader `/var/lib/trade-release/profiles/research.json` each tick writes, the
market directory `$TRADE_DATA/market` mounted read-only for the contract terms, the admitted runtime and its socket)
and `live/<revision>/socket/`. Web mounts only that socket directory read-only and keeps `--live-router=ide-router`;
Agent, Paper and the browser never mount the custody root. The control mounts the custody root at the same path
and the release state read-only. It runs as root with every capability dropped but `DAC_READ_SEARCH`, which reads
the root-only (0700) release state and the private reader metadata: Docker gives a non-root `--user` none of the
capabilities it adds. A run's runner and egress containers and the daily comparison run as the same user. The
runner and egress have no capabilities at all and write only their own root-owned run directories. It is a privileged Docker controller, with the host Docker socket, not a hostile-code sandbox.
It has no TCP listener or frontend-network membership, and a 768 MiB memory cap.

The custody root is `/var/lib/trade-release/live-root` (`LIVE_ROOT` below). The first release that pairs a control
creates it, mode 0700 and owned by root, together with its empty `account.lock` (0600, the same owner); a host released before every release paired one gets it on its next release, with no step by hand. Once it
exists a release only checks it: a root or lock with another owner or mode, a symbolic link or a missing lock is
refused and never repaired or recreated, and the release keeps the current pair. The root never moves.

The candidate, its contracts and leverage are chosen for each run on the Live page, as on the Paper page: the
version selected in the research graph, read from the research ledger's head when the run is prepared and frozen in
it. No strategy file is staged and no API key or secret is written on the host.

A release waits until Live is idle: no run holds account custody and no request is unresolved. The current control
inspects the account inside the account lock (`live release-inspect`) before anything is prepared, and the
candidate's control again before the journal and at commit; a host with no runs answers idle (one 256 MiB helper
run). While Live is busy or unresolved, or a read in progress holds the lock, the current Web/control pair stays,
Web-only changes included, and the next tick asks again; an inspection that fails to run counts as unavailable. 0.x
keeps no compatibility between versions (the user's decision of 2026-11-14): a new control does not take over, read
or migrate a run an earlier version prepared. Such a run stays on disk under `runs/`, and while its runner container
still runs the account counts as unavailable. During a paired update, new effect-producing Live requests wait for a
committed owner; reads and STOP remain available. Existing runners are never restarted for publication. Once the new
pair is committed, the host verifies each retired control's exact Id, disables only its restart policy and sends
cooperative SIGTERM. It observes completion asynchronously; a slow CLI or handler keeps its old process and
originals, without forced kill or deletion. Pairing does not query a venue, read a key, arm a strategy or change
account settings. See the [storage and locking decision](../../docs/plans/live-web-control.zh.md).

Once the paired release is verified, operators use the **Live** page in the existing authenticated IDE.
Save a credential version, choose the candidate, its contracts and leverage, and prepare its run. **Check account**
makes a read-only venue connection; **Start live** presents the frozen source hash and configuration before
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
cleared; `/var/lib/trade-release/notices.json` records what was sent. It reads the token file under `LIVE_ROOT`;
without a saved token nothing is sent.

The page remains a controller: closing it does not stop a strategy. **Request stop** remains available
while a start response is pending or observations cannot refresh. Wait for native terminal evidence and
account reconciliation; a recorded control request alone does not prove a fill or a flat account. Use
explicit request recovery for an uncertain response instead of submitting another start.

This overlay puts the existing IDE and Paper deployment behind Caddy HTTPS and OAuth2 Proxy. Only members of
one GitHub team get in; neither organization membership, an email domain nor the page's CSRF token grants login.
Only ports 80 and 443 are published. Paper, Dolt, OAuth2 Proxy and Docker remain internal.

Use a native Linux **amd64** host: the release plane admits and accepts amd64 images only. It needs Docker
Engine with the Compose plugin 2.28 or newer (`!reset`, `!override`, and `config --environment`, with which
the release control reads `/etc/trade/remote.env`), `python3` 3.12 or newer and `git` (the release control
fetches the public channel with it); no `uv`. Ubuntu 26.04's Docker 29.1, Compose 2.40
and Python 3.14 packages qualify. Every release pairs a Live control beside its Web.
Paper runs are admitted by memory, not by count
([paper-admission-by-memory](../../docs/plans/paper-admission-by-memory.zh.md)), one per source, within a 3.5 GiB
budget, or `TRADE_PAPER_MEMORY` (a size such as `4g`) in `/etc/trade/remote.env`. The release plane passes it to each
Paper controller it creates, so a change applies from the next admitted version's controller. The example's 2 GiB ledger cap is a candidate deployment budget,
not a tested capacity result; do not change an existing deployment's cap without evaluating its load.

1. Choose the server, retain its public IPv4, and point your `TRADE_DOMAIN` to it, and any
   `TRADE_DOMAIN_ALIASES`, which redirect to it. Check inbound HTTPS
   and the container's actual public egress independently. Permit ports 80/443 for ACME and HTTPS;
   do not expose 8765, 8767, 13330 or the Docker API.
2. Register a GitHub OAuth App with homepage `https://<TRADE_DOMAIN>` and callback
   `https://<TRADE_DOMAIN>/oauth2/callback`; it can stay on your own account. Login is by membership of one
   team: make a GitHub organization (a free one is enough) and a team in it, add the people allowed in, and set
   `TRADE_GITHUB_ORG` and `TRADE_GITHUB_TEAM` to the organization's login and the team's slug, and
   `TRADE_GITHUB_CLIENT_ID` to the app's client ID. A new organization
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
   Git, logs and the public ledger; OAuth2 Proxy alone mounts them. Keep `DOCKER_SOCK` at the example's
   `/var/run/docker.sock`: the Docker API proxy mounts it, and the release control and the Live control use that path.

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
   separate, empty `paper` execution database (`ledger/paper.sql`); the Paper controller gets that database's
   accounts and the mirror's reader, never the service administrator. `TRADE_RESEARCH_ORIGIN` must name a research ledger already
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

6. Wait until `deploy-ready` admits a version: its newest record has a non-null image and names
   that tag's commit (`git log -p origin/deploy-ready -- release.json`, `git tag --points-at <revision>`). If step 3
   named images before the version was admitted, run its `deploy.images` again. Then run `sh deploy/remote/install-release.sh`
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

The mirror's controller syncs the configured read-only research mirror from DoltHub at start and every
60 s; the toolbar's **Sync DoltHub** starts one at once. DoltHub itself trails the writing ledger by up to its
service's 5-minute publish round, unless that host runs `ledger publish`. Fetch is validated at an immutable commit, then
fast-forwarded; errors keep the previously displayed version and show in the sync status.
No browser request can choose an origin or database. Paper captures the selected strategy's exact source
and required parent inputs into its own database before launch; research updates do not replace running
inputs. Stop, native resume and logs use the execution records. No execution writes are pushed to research.

The databases share a Dolt process to keep the deployment small. The Paper controller sees only what the
mirror writes for it (`--controllers`): the Paper database's writer and reader and the research reader, never
the service administrator or a DoltHub key. Deleting a sealed run uses the Paper writer, which may delete in
the Paper database only. This is separation of business data paths, not containment of a compromised
controller. Execution records and native originals need persistent disk and separate backup; their `isolated`
profile prevents DoltHub publication. See
[`remote-paper-data-split.zh.md`](../../docs/plans/remote-paper-data-split.zh.md) for the storage decision,
limits and 4-core/8-GB evaluation scope.

## Rolling back

The release plane only moves forward along `main` (CI ignores a version behind the one admitted), so a rollback
is a new commit and a new version, not a reselection:

1. Name what runs: the IDE's About (version and commit), or the Web container in
   `/var/lib/trade-release/router/active.json` (`trade-release-web-<commit>`).
2. Stop further releases while you work: `sudo systemctl stop trade-release.timer`. A release already running
   finishes by itself; do not kill it.
3. Revert the bad merge on a branch (`git revert -m 1 <merge-commit>`), or revert back to the last good tag
   ([`CHANGELOG.md`](../../CHANGELOG.md)), merge it through the usual checks and ship that merge commit as a new
   version (`gh release create`, [`CHANGELOG.md`](../../CHANGELOG.md)). Then `sudo systemctl start trade-release.timer`:
   once CI admits that version, the next tick releases it like any other.
4. Check the About dialog names the new commit, and `journalctl -u trade-release.service` shows it routed.

What a rollback does not undo: ledger records and the market directory only grow, and running Paper and Live runs
keep the runtime image and controller they started with. 0.x keeps no compatibility between versions, so a revision
may not read what a later one wrote; a revert that needs the ledger rewound is a destructive write for the user to decide.
A target that failed stays in `/var/lib/trade-release/failed/`, and the three newest good Web, Agent and controller
containers stay on the host for inspection.

## Live on this host

Live runs are prepared, started and reconciled only from the Live page, through the Live control pairing
above, with a credential saved there ([`engine/README.md`](../../engine/README.md#live-execution)). The base Paper
overlay mounts no Binance credential. The ledger's Dolt port stays unpublished. Account-mode changes and order tests
need the user's explicit scope; a successful preflight is not evidence of a completed real trade.

`/var/lib/trade-release/live-root` is the only Live root. A missing snapshot or mount, another root or a mismatched
release refuses preparation, credential use and new connections before their effects. All keys accepted by this
installation share the original durable run/reconcile custody. REST-only preflights retain their existing overlap behavior and do not certify a later
start's account state.

Once an hour from 00:30 UTC the Live control starts a comparison container of its own image (2 GiB, one CPU,
removed when it exits) that replays each run's previous day on the market directory and keeps a summary in
`LIVE_ROOT/runs/<run>/compare.json`; its replay stages have the research replay's memory limit and work in
`LIVE_ROOT/compare-tmp/` ([daily comparison](../../docs/plans/live-continuous-step7b-daily-compare-20261113.zh.md)).
A Live contract outside `TRADE_MARKET_ARGS` is never covered, so its comparison waits.

The release state holds that fixed private root (`LIVE_ROOT`), outside `TRADE_DATA`, the Paper directories and Git.
Saved credentials have private versions under `LIVE_ROOT/credentials/`, and each run's contract membership under
`LIVE_ROOT/universes/`.

`live status`, `logs` and `stop` stay on the command line for observation and STOP; they read the root and its containers. Run
them as a one-off container of the admitted service image, named for the currently committed owner revision: read
it from `/var/lib/trade-release/router/active.json` (the route's `@id` after `live-` when present, otherwise the
routed Web's revision) and pass it as `LIVE_REVISION`. `deploy.images` verifies its admitted digests and OCI build
provenance.

```sh
LIVE_ROOT=/var/lib/trade-release/live-root
python3 -m deploy.images --revision "$LIVE_REVISION" --env /root/live-images.env || exit
. /root/live-images.env
live() {
  docker run --rm --read-only --cap-drop ALL --cap-add DAC_OVERRIDE --security-opt no-new-privileges --user 0:0 \
    --tmpfs /tmp:rw,nosuid,size=1g --env HOME=/tmp --env DOCKER_CONFIG=/tmp/docker-public \
    --env DOCKER_HOST=unix:///var/run/docker.sock --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
    --mount "type=bind,src=$LIVE_ROOT,dst=$LIVE_ROOT" \
    --entrypoint python "$TRADE_SERVICE_IMAGE" -m cli.main live "$@"
}
live status --root "$LIVE_ROOT" --run-id RUN
live stop --root "$LIVE_ROOT" --run-id RUN
```

`status` and `logs` are pure observations: they do not release custody, archive logs or recycle containers.
The current paired controller owns host maintenance.

### Backing up the Live root

`LIVE_ROOT` holds what nothing else can give back: each run's inputs, journal, account snapshots, native cache and
logs, and the account slot. Back it up after every run and before host maintenance, when `live status` shows no run
`running` and no other Live command or credential change is in progress (runners write without the root's lock).
Keep the archive private and off this host. It holds account balances and credential paths; when credentials were
saved through the Live page, it also includes their API keys and secrets under `credentials/`, and a saved Telegram
bot token under `notify/`. These files and the
archive are not encrypted by the product.

```sh
umask 077
tar -C / -czf "/root/live-root-$(date -u +%Y%m%dT%H%M%SZ).tgz" "${LIVE_ROOT#/}"
```

To restore, stop the release timer and let any release service finish (the next release creates an absent root),
extract into an absent `LIVE_ROOT` at the **same absolute path** (`tar -C / -xpzf ARCHIVE`), preserving private
permissions, the root owner and the saved credential versions and metadata, start the timer, then
`live status` each run. Docker resource names come from the root's path, so a
root restored elsewhere cannot find an unresolved run's network or runner. A run that was unresolved stays
unresolved and keeps the slot; settle it as in [Unresolved Live runs](../../engine/README.md#unresolved-live-runs).

## Release control code

The host executes only the release control code inside the CI-built, digest-pinned service image that
`deploy-ready` names, which only a version tag moves. That is the trust root that already picks which images run;
on a Live host the service image already mounts the Docker socket. The host never runs deployment code from a
fetched checkout or from `main`, and no one installs control code by hand.

`trade-release.service` starts the fixed launcher `/opt/trade-release/trade-release-tick`. It runs the tick
(`python3 -m deploy.release tick`) in `/var/lib/trade-release/control/current`, a symlink to `control/<revision>`,
the directory whose name is the running control's revision. A tick first recovers a pending Web or Paper
transaction under the control that wrote it; a tick that recovered ends there. In a settled state, when the admitted
`deploy-ready` revision differs from the running control's, the control hands over before releasing anything:

1. it pulls the admitted service image by digest and checks it as for a release (this repository, that revision,
   amd64, the admitted digest);
2. it copies `/opt/trade/deploy/*.py` out of a container it creates and never starts, then removes the container;
3. it stages the files in `control/<revision>.new/deploy/`, syncs them, checks that `deploy.release` and
   `deploy.control` import with the host's `python3`, renames the directory to `control/<revision>` and atomically
   repoints `current`;
4. it removes older control directories, keeping the new one and the one that handed over, prints
   `Handed release control from … to …` and exits with status 3.

The launcher then runs the tick once more under the new control, which releases its own version; it never runs a
third. A handoff touches no route and no release container. A refused handoff (an image that differs from
admission, a control that does not import) leaves `current` where it was, fails the tick and is noticed like any
release failure. A version later marked failed keeps its control, and that control hands the next admitted version
over. `deploy/control.py` is the handoff every next version passes through: keep it small and its contract stable
(`deploy.release` and `deploy.control` importable with the host's `python3`, exit status 3).

`install-release.sh` installs the launcher, the unit and timer, the compose overlays and a bootstrap copy of
`deploy/*.py` in `/opt/trade-release`. The bootstrap copy has no revision: it recovers nothing, refuses a pending
transaction (the control that wrote it must recover it) and only hands over to the admitted version. On a new host
the installer runs that handoff itself (`python3 -m deploy.release handoff`) before the first release.

**A host installed before the handoff** (its unit runs `python3 -m deploy.release tick` in `/opt/trade-release`)
takes it once. Its installed control would otherwise release the next version itself, so stop its timer before
that version is tagged:

1. Before the version that brings `deploy/control.py` is tagged, run `sudo systemctl stop trade-release.timer` and
   wait until `systemctl show -p ActiveState --value trade-release.service` says `inactive` or `failed`. Do not
   kill a running tick. Check that `/var/lib/trade-release/transaction.json` and `paper-transaction.json` do not
   exist; if one does, start the timer, let the installed control recover it, and stop it again.
2. Once `deploy-ready` admits that version (its record names the tag's commit), update `/opt/trade-app` to the
   tag (`git fetch --tags && git checkout vX.Y.Z`) and run `sudo sh deploy/remote/install-release.sh control`
   from it. It refuses while the timer or a tick runs; otherwise it installs the launcher, the unit, the overlays
   and the bootstrap copy, reloads systemd and starts the timer.
3. The next tick (`journalctl -u trade-release.service`) prints `Handed release control from the bootstrap copy
   to <revision>`, then the same service run releases that version under its own control.

Run `install-release.sh control` again only for a change to the launcher, the unit, the timer or the compose
overlays (`deploy/remote/`), the same way. Started before the admitted version contains `deploy/control.py`, the
bootstrap handoff refuses it (the admitted control does not import) and every tick fails until such a version is
admitted.

The release host holds the original private `account.lock` read-only over the service-image `live release-inspect`
call and the transaction and route writes. The systemd service must open that file read-only, see the same
regular-file inode as the Live control, and use a filesystem with local read-only-fd exclusive flock. The release
creates the custody root and its lock together, once ([Live control pairing](#live-control-pairing)); it never
recreates a missing `account.lock` in an existing root or changes its permissions.
