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
receipt cannot replace the sealed handoff. The production custody resolver,
signature verifier, anti-rollback witness, credential resolver, and receipt
store adapters are currently unavailable. Consequently `required` mode can
only fail closed during startup. It does not claim that a governed Market Data
repository has been composed. Do not enable `required` until those production
adapters and their deployment authority are separately available.

## Start

Create a private environment file outside the repository or copy `.env.example` and replace every
placeholder with a local value. `RD_OWNER_DATABASE_URL`, `RD_FACT_WRITER_DATABASE_URL`,
`MARKET_DATA_OWNER_DATABASE_URL`, `MARKET_DATA_RD_ROLE_SET_DATABASE_URL`,
`QUALIFICATION_OWNER_DATABASE_URL`, `OPERATOR_AUTHORIZATION_DATABASE_URL`,
`PRODUCT_EDGE_DATABASE_URL`, and `REPLAY_POLICY_CATALOG_ADMIN_DATABASE_URL` must be private
PostgreSQL connection URLs for the Compose `postgres` service, with credentials matching the
`*_DB_PASSWORD` values. Do not commit it.

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
