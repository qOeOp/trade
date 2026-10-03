# R&D deployment package

This package is the Docker Compose deployment manifest for the local R&D stack: PostgreSQL, the
R&D Owner API, the build sandbox, the administrative one-shot compositions, and the opt-in
first-party Dashboard. It is not a product surface. The product surface is `product/dashboard`;
its contract lives in `docs/architecture/product-edge.md` and `docs/guide/dashboard.md`.

The previous product shell that once executed Product Edge effects from this package is retired.
Its scripts, workspace manifest, and services are gone; `docs/architecture/capability-adoption.md`
records where each capability it supplied now lives. The Dashboard effect worker is the only
executor path, and it starts only under the `dashboard-preview` profile.

`make rd-workbench-check` validates the pinned manifests, image digests, authority wiring, and
`docker compose config` for this package.

## Local deployment in one command

```bash
make rd-workbench-up
```

`scripts/up.sh` brings up PostgreSQL and `rd-owner-api` as the compose project `trade-rd-local`,
on that project's own volumes, and publishes the API on `127.0.0.1:18080` only
(`RD_LOCAL_API_PORT` changes the port; `local/docker-compose.local.yml` is the only addition to the
compose file). It runs the administrative steps below in their order: environment file, images,
sealed Catalog commands, Product Edge genesis configuration, `postgres`, `schema-materialize`,
`authority-custody-migrate` (which also gives `market_data_reader` and `instrument_owner` their
passwords), `authority-schema-materialize`, `authority-bootstrap`,
`replay-policy-catalog-bootstrap`, the `replay-policy-catalog-owner-readback` check, and
`rd-owner-api`, ending with `GET /health`.

Every value it needs is generated on this machine into `product/rd-workbench/.local` (ignored by
Git; `RD_LOCAL_STATE_DIR` moves it): random database passwords and tokens in `.env`, the Catalog
signing seed, the sealed create and advance commands, and the Product Edge genesis configuration.
Nothing is printed. The Catalog content is `local/replay-policy-catalog.json`: venue `BINANCE`,
economic configuration schema 2, so each Replay takes the terms the Instrument Owner resolves for
its instrument. The script derives the policy's replay configuration digest from that economic
configuration. The local sealer runs in the Owner image with no network, so for this deployment
the signing seed is read inside a one-off container; a shared deployment seals on the
administrator's host as described below.

Docker runs with an empty environment plus that `.env`, so no key exported in the calling shell
reaches a container. Binance is read through its public endpoints only. If
`~/.docker/config.json` names a credential store, the script uses a private Docker config without
it.

Running it again is safe. Each step measures whether it has already happened and prints
`skip <step>: <reason>`: the store is already cut over, a Product Edge binding or Catalog V3 head
exists, a migration already ran on this volume with the same script and image, or the images were
already built from the current clean tree. The Catalog readback runs every time, because it is a
check, not a write. To start over, stop the project and remove its volumes and the state
directory:

```bash
docker compose --project-name trade-rd-local --env-file product/rd-workbench/.local/.env \
  -f product/rd-workbench/docker-compose.yml --profile authority-admin down --volumes
rm -rf product/rd-workbench/.local
```

`RD_LOCAL_ACCEPTANCE_SCRIPT` names a script to run last, as
`<script> probe http://127.0.0.1:18080` with `RD_OWNER_API_TOKEN` exported from `.env`.

## Deployment Store Admission boundary

The package defaults `DEPLOYMENT_STORE_ADMISSION_MODE` to `disabled`. In that
mode the three store identities may remain empty and no governed Market Data
repository is constructed.

`required` mode requires all three of these deployment identities before
`rd-owner-api` can listen:

- `DEPLOYMENT_STORE_ENVIRONMENT_IDENTITY`: the exact environment identity;
- `DEPLOYMENT_STORE_DEPLOYMENT_IDENTITY`: the exact deployment identity;
- `DEPLOYMENT_STORE_EXPECTED_HEAD_IDENTITY`: the expected current head as
  `sha256:` followed by 64 lowercase hexadecimal characters.

These values select the intended custody scope; they are not positive evidence
or credentials. A raw DSN, password, secret, private key, or caller-authored
receipt cannot replace the sealed handoff. The admission is composed from five
production ports, each named by the deployment's environment and built from a
file in `/run/deployment-store`, the directory `DEPLOYMENT_STORE_FILES_DIRECTORY`
mounts read-only:

- the custody store, as the custodian principal in `custodian-connection`;
- the store signer's Ed25519 public key in `signer-public-key.hex`, under
  `DEPLOYMENT_STORE_SIGNER_IDENTITY`;
- the anti-rollback mode `DEPLOYMENT_STORE_ANTI_ROLLBACK_MODE`, which must be
  exactly `SINGLE_TRUST_DOMAIN_NO_ROLLBACK_WITNESS`: on this one machine no
  witness can watch the store from outside it, and the user authorized running
  without one (Market Data's documentation and the architecture rules carry the
  authorization);
- the leased secret `leased/market-data-admitted-reader`, the admitted reader's
  connection string, whose lease lapses at the end of each
  `DEPLOYMENT_STORE_LEASE_PERIOD_MS` period;
- the store's TLS root in `postgres-root.crt`: the admission measures and reads
  the store only over TLS that trusts exactly that root.

Without any one of them `required` mode fails closed during startup, naming the
port that could not be built in its log, and `rd-owner-api` does not listen.
Each admission seals a receipt for its lease period; an admitted port re-admits
before and after every read, and a read whose two admissions fall in different
periods is refused once and succeeds when retried. Choose a period far longer
than a read.

`required` would not take credentials out of `rd-owner-api`. The service also
reads `MARKET_DATA_OWNER_DATABASE_URL` (`market_data_owner`, required by the
compose file) and `MARKET_DATA_RD_ROLE_SET_DATABASE_URL` (`market_data_reader`),
and six Market Data admissions - PIT intake, Source Binding, universe
selection, strategy-input binding, Instrument Master and Market Semantics -
connect with those raw DSNs directly, outside store admission. Store admission
proves which store the service reached; it isolates no credential until those
DSNs move behind the custodian.

### Turning on `required`

Run these on the deployment's machine, from this directory, with the stack's
private environment file in place. Every `docker compose --profile
authority-admin run` step is a one-shot service in the stack's own network,
because the store is measured from where `rd-owner-api` reaches it. Sealing is
the one step that runs on the host, so the signing key never enters a
container. Each step refuses rather than writes on anything unexpected.

1. Make three private directories outside the repository and name them in the
   environment file: `DEPLOYMENT_STORE_FILES_DIRECTORY`, which `rd-owner-api`
   reads, `DEPLOYMENT_STORE_ADMIN_DIRECTORY`, where the publication is written,
   and `POSTGRES_TLS_DIRECTORY`, the store's certificate and key. Also set
   `STORE_CUSTODY_PUBLISHER_DB_PASSWORD`,
   `STORE_CUSTODY_CUSTODIAN_DB_PASSWORD`,
   `MARKET_DATA_ADMITTED_READER_DB_PASSWORD`,
   and `STORE_CUSTODY_PUBLISHER_DATABASE_URL`, and export the variables these
   steps name into the shell.

2. Make the store's TLS root and the certificate it issues for the host name
   `postgres`, and turn TLS on. The root's key stays outside every directory a
   container mounts:

   ```bash
   (umask 077 && openssl req -x509 -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 \
     -subj "/CN=trade store root" -keyout /absolute/path/to/private-store-root.key \
     -out "$DEPLOYMENT_STORE_FILES_DIRECTORY/postgres-root.crt" \
     -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign")
   openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -subj "/CN=postgres" \
     -keyout "$POSTGRES_TLS_DIRECTORY/server.key" -out "$POSTGRES_TLS_DIRECTORY/server.csr"
   printf '%s\n' "basicConstraints=critical,CA:FALSE" "keyUsage=critical,digitalSignature" \
     "extendedKeyUsage=serverAuth" "subjectAltName=DNS:postgres" > "$POSTGRES_TLS_DIRECTORY/server.ext"
   openssl x509 -req -in "$POSTGRES_TLS_DIRECTORY/server.csr" \
     -CA "$DEPLOYMENT_STORE_FILES_DIRECTORY/postgres-root.crt" -CAkey /absolute/path/to/private-store-root.key \
     -CAcreateserial -days 825 -extfile "$POSTGRES_TLS_DIRECTORY/server.ext" \
     -out "$POSTGRES_TLS_DIRECTORY/server.crt"
   docker compose --profile authority-admin run --rm postgres-tls-install
   ```

3. Provision the custody store and the admitted reader, then restart
   `rd-owner-api` so the Market Data Owner's migration grants the reader its
   admitted read wrappers:

   ```bash
   docker compose --profile authority-admin run --rm deployment-store-provision
   docker compose restart rd-owner-api
   ```

4. Write the two connection files the deployment leases, readable by you
   alone. They name the principals provisioned in step 3, at
   `postgres:5432/rd_owner`:

   ```bash
   umask 077
   mkdir -p "$DEPLOYMENT_STORE_FILES_DIRECTORY/leased"
   printf 'postgres://market_data_admitted_reader:%s@postgres:5432/rd_owner\n' "$MARKET_DATA_ADMITTED_READER_DB_PASSWORD" \
     > "$DEPLOYMENT_STORE_FILES_DIRECTORY/leased/market-data-admitted-reader"
   printf 'postgres://deployment_store_custodian:%s@postgres:5432/rd_owner\n' "$STORE_CUSTODY_CUSTODIAN_DB_PASSWORD" \
     > "$DEPLOYMENT_STORE_FILES_DIRECTORY/custodian-connection"
   ```

5. Make the store signing key: an Ed25519 seed of its own, separate from the
   Replay Policy Catalog's, kept outside both directories:

   ```bash
   (umask 077 && openssl rand -hex 32 > /absolute/path/to/private-deployment-store-signing-key.hex)
   ```

6. Write `$DEPLOYMENT_STORE_ADMIN_DIRECTORY/draft.json`: everything a
   publication states except what is measured. The first publication names no
   earlier manifest and no previous head; each later one lists every earlier
   manifest identity, oldest first, and the head it replaces. Times are epoch
   milliseconds on the store's clock:

   ```json
   {
     "signer_identity": "trade-deployment-store-signer-v1",
     "environment_identity": "trade-rd-workbench-local",
     "deployment_identity": "trade-rd-workbench-local-v1",
     "prior_manifest_identities": [],
     "expected_previous_head_identity": null,
     "valid_from_epoch_ms": 0,
     "valid_through_epoch_ms": 4102444800000,
     "recovery": {
       "identity": "trade-rd-workbench-local-recovery-v1",
       "restart_requires_reverification": true,
       "ambiguity_forbids_business_retry": true
     },
     "rotation_fence_identity": "trade-rd-workbench-local-rotation-v1",
     "rotation_fence_closed_at_epoch_ms": 0
   }
   ```

7. Measure the store and complete the draft into `authoring.json`, as your own
   user, then seal it on the host:

   ```bash
   docker compose --profile authority-admin run --rm --user "$(id -u):$(id -g)" \
     deployment-store-publication-author
   DEPLOYMENT_STORE_PUBLICATION_AUTHORING_PATH="$DEPLOYMENT_STORE_ADMIN_DIRECTORY/authoring.json" \
   DEPLOYMENT_STORE_SIGNING_KEY_PATH=/absolute/path/to/private-deployment-store-signing-key.hex \
   DEPLOYMENT_STORE_SEALED_PUBLICATION_OUTPUT_PATH="$DEPLOYMENT_STORE_ADMIN_DIRECTORY/sealed.json" \
     cargo run --locked --release -p vibe-strategy-factory-rd-owner-api --bin deployment-store-publication-seal
   ```

   The sealer derives every identity, the history digest and both signatures,
   never prints the key and never overwrites a sealed file. It prints a summary
   naming `head_identity` and `signer_public_key_hex`.

8. Publish it as the publisher principal, and pin the signer's public key:

   ```bash
   docker compose --profile authority-admin run --rm --user "$(id -u):$(id -g)" \
     deployment-store-publication-publish
   printf '%s\n' "<signer_public_key_hex from step 7>" > "$DEPLOYMENT_STORE_FILES_DIRECTORY/signer-public-key.hex"
   ```

   It re-verifies the sealed file before writing. It exits zero only for
   `PUBLISHED` or `REPLAYED`, and writes nothing on a head mismatch or a
   conflict.

9. Set `DEPLOYMENT_STORE_ADMISSION_MODE=required`, the three identities from
   the draft and step 7's `head_identity`,
   `DEPLOYMENT_STORE_ANTI_ROLLBACK_MODE=SINGLE_TRUST_DOMAIN_NO_ROLLBACK_WITNESS`,
   `DEPLOYMENT_STORE_SIGNER_IDENTITY` from the draft, and
   `DEPLOYMENT_STORE_LEASE_PERIOD_MS` (for example `86400000`). Hand the files
   to `rd-owner-api`'s user, readable by it alone, and start it again:

   ```bash
   sudo chown -R 10001 "$DEPLOYMENT_STORE_FILES_DIRECTORY"
   sudo chmod -R go-rwx "$DEPLOYMENT_STORE_FILES_DIRECTORY"
   docker compose up -d rd-owner-api
   ```

The measurement names the endpoint as `rd-owner-api` reaches it, including the
address the store answers on. A stack recreated with a different address, a
changed role, function or grant, or a rotated certificate no longer matches the
manifest, and `required` refuses at startup. The next publication repeats steps
6 to 9, naming every earlier manifest and the current head in the draft. Take
the files back first, and move the last publication's files aside, since the
author and the sealer never overwrite one:

```bash
sudo chown -R "$(id -u):$(id -g)" "$DEPLOYMENT_STORE_FILES_DIRECTORY"
mv "$DEPLOYMENT_STORE_ADMIN_DIRECTORY/authoring.json" "$DEPLOYMENT_STORE_ADMIN_DIRECTORY/authoring.previous.json"
mv "$DEPLOYMENT_STORE_ADMIN_DIRECTORY/sealed.json" "$DEPLOYMENT_STORE_ADMIN_DIRECTORY/sealed.previous.json"
```

## Start

Create a private environment file outside the repository or copy `.env.example` and replace every
placeholder with a local value. `RD_OWNER_DATABASE_URL`, `RD_FACT_WRITER_DATABASE_URL`,
`MARKET_DATA_OWNER_DATABASE_URL`, `MARKET_DATA_RD_ROLE_SET_DATABASE_URL`,
`INSTRUMENT_OWNER_DATABASE_URL`, `QUALIFICATION_OWNER_DATABASE_URL`,
`OPERATOR_AUTHORIZATION_DATABASE_URL`, `PRODUCT_EDGE_DATABASE_URL`, and
`REPLAY_POLICY_CATALOG_ADMIN_DATABASE_URL` must be private PostgreSQL connection URLs for the
Compose `postgres` service, with credentials matching the `*_DB_PASSWORD` values. Do not commit it.

Operator Authorization and Product Edge genesis remain explicit administrative
operations and never run as part of service startup. Replay Policy Catalog
genesis is a separate mandatory startup gate described below. On a fresh named
volume, first run the bounded schema materializer. It reuses the Owner's Rust
migrations while `rd_owner` still owns `public`, creates no business fact, and
exits before the custody boundary changes:

```bash
docker compose \
  --project-name trade-rd-workbench \
  --env-file /absolute/path/to/private.env \
  -f product/rd-workbench/docker-compose.yml \
  --profile authority-admin run --rm schema-materialize
```

Then, before the first Owner start on either a fresh or existing named volume,
run the idempotent custody migration. It creates/updates only PostgreSQL roles,
ownership, and grants; it
also performs the single-transaction Catalog/Composer private-owner cutover.
The database/public schema custodian and both object owners are NOLOGIN roles.
`rd_owner` uses only fixed lock/read APIs. Composer mutation retains the dedicated
`rd_fact_writer` credential. Catalog mutation instead requires the broker-only
`replay_policy_catalog_admin_writer` credential provisioned from the explicitly supplied
`REPLAY_POLICY_CATALOG_ADMIN_DB_PASSWORD`. The Rust one-shot composition verifies the sealed Ed25519 request
before database access. PostgreSQL does not independently verify Ed25519; it trusts the exclusive
`replay_policy_catalog_admin_writer` principal as the broker mutation boundary. Never distribute this credential
to operators, ordinary services, the Dashboard, or generic SQL clients; possession or use outside the broker is a
trust-boundary breach. No default or fallback credential exists.
Existing relations are moved with `SET SCHEMA` without row rewrites. The
migration does not insert, update, delete, backfill, or reinterpret an Owner fact:

```bash
docker compose \
  --project-name trade-rd-workbench \
  --env-file /absolute/path/to/private.env \
  -f product/rd-workbench/docker-compose.yml \
  --profile authority-admin run --rm authority-custody-migrate
```

The default R&D API startup additionally requires the sealed Replay Policy Catalog
create command and independently trusted verifier configuration. Set
`REPLAY_POLICY_CATALOG_ADMIN_DATABASE_URL` to the dedicated Catalog broker connection, set
`REPLAY_POLICY_CATALOG_BOOTSTRAP_CREATE_COMMAND` and
`REPLAY_POLICY_CATALOG_BOOTSTRAP_ADVANCE_COMMAND` to the absolute paths of the two sealed
JSON commands, set `REPLAY_POLICY_CATALOG_TRUSTED_VERIFIER_IDENTITY`, and set
`REPLAY_POLICY_CATALOG_TRUSTED_VERIFIER_PUBLIC_KEY` to the absolute path of its
lowercase-hex public-key file. Keep every file private and outside the repository.
The verifier key is mounted separately from the commands; no Product Edge,
Dashboard, deployment, or environment setting can supply or generate policy
meaning.

An administrator authors each command as JSON in its authoring form - the command identity
and kind, the administrator and verifier identities, the expected predecessor and head, the
catalog record identity and version, the Replay execution policy with every identity, version
and digest spelled out, the economic configuration input and the runner profile input - and
seals it with the private Ed25519 signing key whose public half is the trusted verifier. The
sealer refuses to overwrite an existing sealed command, never prints the key, and proves the
sealed bytes verify before writing them. Run it on the administrator's machine, not in the
stack:

```bash
REPLAY_POLICY_CATALOG_COMMAND_AUTHORING_PATH=/absolute/path/to/private-create-command-authoring.json \
REPLAY_POLICY_CATALOG_SIGNING_KEY_PATH=/absolute/path/to/private-replay-policy-catalog-signing-key.hex \
REPLAY_POLICY_CATALOG_SEALED_COMMAND_OUTPUT_PATH=/absolute/path/to/private-sealed-replay-policy-catalog-create-command.json \
  cargo run --locked --release -p vibe-strategy-factory-rd-owner-api --bin replay-policy-catalog-command-seal
```

Seal the `CREATE` command for catalog version 1 with no expected predecessor or head, then the
`ADVANCE` command for the same record with the same expectations; the signing key file holds
the 32-byte seed as 64 lowercase hex characters.

`replay-policy-catalog-bootstrap` is an opt-in `authority-admin` one-shot service. It runs only
after successful custody migration, applies the sealed create command and then the sealed
advance command through the authenticated Catalog administration path, and exits only after
the current head reads back as exactly the record the create command described. It prints one
bounded receipt JSON to stdout carrying the published digests and nothing that could
reconstruct a command, signature, key, or database credential. A missing, invalid, conflicting,
or unreadable input exits nonzero and prevents `rd-owner-api` from listening. Exact replay of
the same two commands resolves without writing. An administrator may inspect the idempotent
result before starting the rest of the stack:

```bash
docker compose \
  --project-name trade-rd-workbench \
  --env-file /absolute/path/to/private.env \
  -f product/rd-workbench/docker-compose.yml \
  --profile authority-admin run --rm replay-policy-catalog-bootstrap
```

`replay-policy-catalog-owner-readback` gates every default startup: as `rd_owner`, holding no
mutation capability, it authenticates the sealed create command and refuses unless the current,
unrevoked Catalog head is exactly the record that command described.

Then an administrator may explicitly run the one-time bootstrap with the
private JSON path named by `PRODUCT_EDGE_BOOTSTRAP_CONFIG`. Exact replay joins;
changed meaning or nonempty history fails closed:

```bash
docker compose \
  --project-name trade-rd-workbench \
  --env-file /absolute/path/to/private.env \
  -f product/rd-workbench/docker-compose.yml \
  --profile authority-admin run --rm authority-bootstrap
```

The bootstrap binary is a dedicated administrative composition unit. Strategy
Factory, the R&D API, and every Dashboard role cannot issue
Operator Authorization or create a deployment genesis.

After an existing manifest interval has expired, an administrator may instead
run the separate recovery composition with the private schema-v1 JSON path
named by `PRODUCT_EDGE_RECOVERY_CONFIG`:

```bash
docker compose \
  --project-name trade-rd-workbench \
  --env-file /absolute/path/to/private.env \
  -f product/rd-workbench/docker-compose.yml \
  --profile authority-admin run --rm authority-recovery
```

The recovery config contains one identical content-addressed recovery epoch,
the complete Operator Authorization recovery proposal, and a Product Edge
successor template without an authorization locator. The binary validates the
complete config against the runtime deployment, trust, request proof, manifest,
identity, time, and policy bindings before the first Owner call. It then
issues or rejoins OA2 and derives Product Edge's locator only from that sealed
canonical readback before recovering or rejoining B2. These remain separate
Owner writes, not a cross-owner transaction: a crash after OA2 is recovered by
rerunning the exact same immutable config. Changed meaning fails closed. The
bounded JSON result contains only the recovery epoch, canonical OA locator, and
Product Edge binding locator/readback; it contains no token or database secret.
The service is opt-in under `authority-admin` and never runs during default
startup.

After those explicit administrative steps, start the default services; the
`authority-admin` profile remains disabled. Compose reruns schema materialization and
custody migration, then performs only the signed, exact `rd_owner` Catalog readback.
The readback locks and classifies the four-table census, accepts only exact `1/1/0/2`
state and exact records/head/audits, including the null genesis predecessor and signed actor/time provenance,
writes nothing, and must finish before the API listens:

```bash
docker compose \
  --project-name trade-rd-workbench \
  --env-file /absolute/path/to/private.env \
  -f product/rd-workbench/docker-compose.yml \
  up -d --build
```

The default services expose no host port and no browser entry. `rd-owner-api` is reachable only
on the internal Compose network; `rd-build-sandbox` shares only its socket volume with it.

## Dashboard preview profile

The opt-in `dashboard-preview` profile starts the first-party Dashboard and its runtime roles from
the standalone `trade-dashboard` image built by `product/dashboard/Dockerfile`:

- `rd-dashboard-owner-read-api` exposes only the authenticated Artifact directory/source, Research
  directory/exact-readback, Source Intake exact-readback, and Develop Composer exact-readback GETs
  plus its health check. Its state keeps separate typed domain ports and owns no sandbox,
  fact-writer pool, or mutation port. Configure `RD_DASHBOARD_OWNER_READ_API_TOKEN`; the Dashboard
  consumes the matching internal URL/token pair and fails closed when either half is missing.
- `product-edge-routing-read-api` answers `GET /v1/operation-routing` for
  `PRODUCT_EDGE_DEPLOYMENT_IDENTITY` behind `PRODUCT_EDGE_ROUTING_READ_API_TOKEN`, reading Product
  Edge's routing history in a read-only transaction. It commits nothing, and it refuses to start
  without a token, which keeps `dashboard-web` from starting too. Until an administrator
  commits a binding with `product-edge-authority-bootstrap route <proposal>`, every key answers
  `OPERATION_ROUTING_ABSENT` and the Dashboard admits no fresh `RUN`. Committing a
  `TRADE_DASHBOARD` binding in a deployed or shared environment is a separate explicit effect.
- `dashboard-run-store-migrate` materializes the Trade-owned operational RunStore, then exits.
- `dashboard-web` serves the browser shell and `/api/mcp` on `127.0.0.1:${DASHBOARD_PORT:-3100}`,
  the sole host-published port in this package. Browser access requires
  `DASHBOARD_LOCAL_OPERATOR_LOGIN_TOKEN` and `DASHBOARD_SESSION_HMAC_KEY`; the MCP endpoint is
  separately authenticated by `DASHBOARD_MCP_API_TOKEN`.
- `dashboard-effect-worker`, `dashboard-shadow-worker`, and `dashboard-shadow-scheduler` are
  separate least-privilege process roles over the RunStore. The effect worker is disabled by
  default and holds only the explicit disposable-local authority granted by the
  `DASHBOARD_DISPOSABLE_*_EXECUTION` flags; none of the roles carries production trading authority.

```bash
docker compose \
  --project-name trade-rd-workbench \
  --env-file /absolute/path/to/private.env \
  -f product/rd-workbench/docker-compose.yml \
  --profile dashboard-preview up -d --build
```

Starting the default services without the profile starts none of these roles. The Dashboard
contract, its admitted read surfaces, and its MCP tool set are defined in
`product/dashboard/README.md` and `docs/guide/dashboard.md`; this package only deploys them.

## Status boundary

An HTTP or operational run success is not business acceptance. S1 V2 `ACCEPTED` additionally requires direct Owner readback of the root receipt, INTENT membership receipt, and Census frontier. S2 `SUCCESS` additionally requires the durable ArtifactTrialFamilyBinding receipt. Missing or corrupt root/member/head/digest/outbox/binding state stays `SUBMITTED_OR_UNKNOWN`; the only legal recovery is `RESOLVE` with the same request and attempt identities. Commit-before-response-loss resolves to the exact Owner bytes. A pre-commit timeout closes without an Artifact.

Reusing an identity with different semantics is `IDENTITY_CONFLICT`, not a new
business disposition and not proof that the original Research Intent is absent.
Its only legal action is to resolve the original Owner receipt under that same
identity.

The build sandbox has no network, secret, Docker socket, host effect port, or ambient input mount;
its schema-v2 receipt binds the pinned image, Dockerfile, toolchain, target, offline policy, and
byte-identical double build before runtime admission. Missing provider configuration and
provider/parse failures fail closed through the Owner without a template fallback.

Legacy V1 receipts, Intents, and Artifacts are not backfilled; direct family resolution returns `TRIAL_FAMILY_UNAVAILABLE_LEGACY`. This package creates and resolves Owner-sealed Exploratory Replay V2 requests; it does not implement Backtest, Selection, Candidate, Qualification, Scanner, Runtime, Portfolio, Recovery, capital, Risk, Execution, orders, or real trading. There is no production deployment; every service here is a local, opt-in composition.
