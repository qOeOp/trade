# R&D Workbench S1 V2 + S2 + Exploratory Replay V2 candidate

This package is the non-live Product Edge candidate through Strategy Artifact Formation. The default Web path uses S1 V2: Windmill submits policy but no family identity, while R&D atomically derives and persists the frozen Intent, TrialFamily root, initial INTENT Census member/head, receipts, and outbox. S2 atomically binds its immutable Artifact and Build Receipt to that Owner family. Exploratory Replay V2 then identifies, submits once, resolves, and renders the Owner-sealed replay request and readback; it does not execute Backtest. Windmill submits, resolves, and renders; only the Owner commits or directly resolves those facts.

## Deployment Store Admission boundary

The Workbench defaults `DEPLOYMENT_STORE_ADMISSION_MODE` to `disabled`. In that
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

Create a private environment file outside the repository or copy `.env.example` and replace every placeholder with a local value. `WINDMILL_DATABASE_URL` and `RD_OWNER_DATABASE_URL` must be private PostgreSQL connection URLs for the Compose `postgres` service, with credentials matching `POSTGRES_PASSWORD` and `RD_OWNER_DB_PASSWORD` respectively. Do not commit it.

Operator Authorization and Product Edge genesis are explicit administrative
operations and never run as part of service startup. Before the first Owner
start on either a fresh or existing named volume, run the idempotent custody
migration. It creates/updates only PostgreSQL roles, ownership, and grants; it
does not insert, update, delete, backfill, or reinterpret an Owner fact:

```bash
docker compose \
  --project-name trade-rd-workbench \
  --env-file /absolute/path/to/private.env \
  -f product/rd-workbench/docker-compose.yml \
  --profile authority-admin run --rm authority-custody-migrate
```

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
Factory, the R&D API, Windmill server, and Windmill worker cannot issue
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
`authority-admin` profile remains disabled:

```bash
docker compose \
  --project-name trade-rd-workbench \
  --env-file /absolute/path/to/private.env \
  -f product/rd-workbench/docker-compose.yml \
  up -d --build
```

The sole default browser entry is `http://127.0.0.1:18000`. On a fresh volume, complete Windmill's authenticated first-user setup in that browser and create the local `trade-rd` workspace. Create a workspace token for deployment, keep it outside the repository, and deploy the repository projection:

```bash
WINDMILL_TOKEN_FILE=/absolute/path/to/private-deployment-token \
WINDMILL_WORKSPACE_ID=trade-rd \
WINDMILL_BASE_URL=http://127.0.0.1:18000 \
product/rd-workbench/scripts/deploy.sh
```

`deploy.sh` reads the token only from that regular, non-symlink file. It gives
the CLI an ephemeral private profile and gives `curl` a private header file, so
the credential is not placed in process arguments or repository state.

Open the deployed `Trade R&D Workbench` Raw App in Windmill. Its policy is authenticated `viewer`, and Windmill isolates the authored bundle in its opaque-origin Raw App sandbox. It declares no frontend SDK scopes and has no Data Table access.

## Native MCP profile

Mint a separate local token by submitting `mcp-profile.json` to Windmill's
authenticated `POST /api/users/tokens/create` endpoint. The file is a directly
mintable, workspace-bound token request with exactly these scopes:

- `mcp:scripts:f/trade/product_edge/research_goal_v2`
- `mcp:scripts:f/trade/product_edge/artifact_build_v1`
- `mcp:scripts:f/trade/product_edge/exploratory_replay_v2`
- `mcp:scripts:f/trade/product_edge/develop_composer_v2`
- `mcp:endpoints:getJob,getJobLogs`

The profile intentionally omits `mcp:all`, favorites, folder wildcards, flows, previews, deployment, workspace listing, and every create/update/delete tool. Folder filtering is not the security boundary.

The versioned profile declares the same `research_goal_v2` operation used by the default Web backend. This repository change modifies only the profile declaration; it does not mint, use, rotate, revoke, or otherwise broaden any actual credential.

The `source_intake.openalex_work_by_doi.submit_or_resolve.v1` script is a bounded
Windmill transport in this slice. `RUN` accepts only a canonical DOI and bounded
interpretation, while `RESOLVE` queries the same request identity without a new
provider instruction. The script calls only the fixed internal R&D Owner endpoint;
it never calls OpenAlex or another provider directly. Only a complete terminal
Owner receipt can project `RETRIEVED`, and every transport ambiguity exposes only
same-request resolution.

## Status boundary

An HTTP or Windmill job success is not business acceptance. S1 V2 `ACCEPTED` additionally requires direct Owner readback of the root receipt, INTENT membership receipt, and Census frontier. S2 `SUCCESS` additionally requires the durable ArtifactTrialFamilyBinding receipt. Missing or corrupt root/member/head/digest/outbox/binding state stays `SUBMITTED_OR_UNKNOWN`; the only legal recovery is `RESOLVE` with the same request and attempt identities. Commit-before-response-loss resolves to the exact Owner bytes. A pre-commit timeout closes without an Artifact.

Reusing an identity with different semantics is `IDENTITY_CONFLICT`, not a new
business disposition and not proof that the original Research Intent is absent.
Its only legal action is to resolve the original Owner receipt under that same
identity.

The `artifact_build.submit_or_resolve.v1` script is the one App/MCP operation. `RUN` reads canonical frozen Intent bytes from the Owner, invokes a bounded server-side provider, and submits only a typed untrusted candidate. Missing provider configuration and provider/parse failures fail closed through the Owner without a template fallback. The sandbox has no network, secret, Docker socket, host effect port, or ambient input mount; its schema-v2 receipt binds the pinned image, Dockerfile, toolchain, target, offline policy, and byte-identical double build before runtime admission.

The Develop Composer V2 Agent entry is one typed App/MCP transport operation at
`f/trade/product_edge/develop_composer_v2`. `RUN` forwards only an unchanged,
untrusted `DevelopComposerRunRequestV2`-compatible Design, binding-request set,
and bounded plugin capsule set to the existing R&D Owner endpoint. `RESOLVE`
sends no request body and can address only that exact request identity. The
script never calls a database, creates an Owner fact or receipt, handles a
verified-build token, or turns transport ambiguity into success. The default
Owner composition remains truthfully `UNAVAILABLE`; only the compile-time
sealed acceptance composition can expose its bounded positive proof.

This entry is CURRENT only as a typed, fail-closed transport. Durable Composer
custody and the composed Source Intake-to-Research-to-Composer path remain the
documented TARGET/SEALED_ACCEPTANCE work. Complex-strategy production readiness,
ATR/RSI behavior, joined or multi-timeframe data, Backtest, Paper, Live,
deployment, and trading effects are NOT_ADMITTED by this script or MCP scope.

Legacy V1 receipts, Intents, and Artifacts are not backfilled; direct family resolution returns `TRIAL_FAMILY_UNAVAILABLE_LEGACY`. This slice creates and resolves Owner-sealed Exploratory Replay V2 requests; it does not implement Backtest, Selection, Candidate, Qualification, Scanner, Runtime, Portfolio, Recovery, capital, Risk, Execution, orders, or real trading. The candidate is not `PRODUCT_CURRENT` until its exact-head dynamic default-Web evidence and repository gates pass and the PR is merged and accepted.
