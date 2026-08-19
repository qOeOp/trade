# R&D Workbench S1 + S2 candidate

This package is the non-live Product Edge candidate through Strategy Artifact Formation. It runs a digest-pinned Windmill CE server and worker, PostgreSQL persistence, the native R&D Owner API, and a separate network-disabled Development Sandbox. Windmill submits, resolves, and renders; only the Owner commits Research receipts, a frozen Intent, immutable Strategy Artifacts, Build Receipts, Artifact Reviews, and the bounded Research View.

## Start

Create a private environment file outside the repository or copy `.env.example` and replace every placeholder with a local value. `WINDMILL_DATABASE_URL` and `RD_OWNER_DATABASE_URL` must be private PostgreSQL connection URLs for the Compose `postgres` service, with credentials matching `POSTGRES_PASSWORD` and `RD_OWNER_DB_PASSWORD` respectively. Do not commit it.

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

Open the deployed `Trade R&D Workbench` Raw App in Windmill. Its policy is authenticated `viewer`; it has no Data Table access.

## Native MCP profile

Mint a separate local token by submitting `mcp-profile.json` to Windmill's
authenticated `POST /api/users/tokens/create` endpoint. The file is a directly
mintable, workspace-bound token request with exactly these scopes:

- `mcp:scripts:f/trade/product_edge/research_goal_v1`
- `mcp:scripts:f/trade/product_edge/artifact_build_v1`
- `mcp:endpoints:getJob,getJobLogs`

The profile intentionally omits `mcp:all`, favorites, folder wildcards, flows, previews, deployment, workspace listing, and every create/update/delete tool. Folder filtering is not the security boundary.

## Status boundary

An HTTP or Windmill job success is not business acceptance. S1 `ACCEPTED` and `REJECTED_NO_WRITE`, and S2 `SUCCESS`, `FAILED_NO_ARTIFACT`, `REJECTED_NO_WRITE`, or `OUTCOME_UNKNOWN`, are valid only when `owner_receipt` is present. An absent receipt stays `SUBMITTED_OR_UNKNOWN`; the only legal recovery is `RESOLVE` with the same request and attempt identities. Commit-before-response-loss resolves to the exact Owner Artifact receipt and review. A pre-commit timeout closes without an Artifact.

Reusing an identity with different semantics is `IDENTITY_CONFLICT`, not a new
business disposition and not proof that the original Research Intent is absent.
Its only legal action is to resolve the original Owner receipt under that same
identity.

The `artifact_build.submit_or_resolve.v1` script is the one App/MCP operation. `RUN` reads canonical frozen Intent bytes from the Owner, invokes a bounded server-side provider, and submits only a typed untrusted candidate. Missing provider configuration and provider/parse failures fail closed through the Owner without a template fallback. The sandbox has no network, secret, Docker socket, host effect port, or ambient input mount; its schema-v2 receipt binds the pinned image, Dockerfile, toolchain, target, offline policy, and byte-identical double build before runtime admission.

This slice does not create an Exploratory Replay Request and does not implement Backtest, Qualification, Scanner, Runtime, Portfolio, Recovery, capital, Risk, Execution, orders, or real trading. The candidate is not `PRODUCT_CURRENT` until its exact-head dynamic Web/MCP evidence and repository gates pass and the PR is merged and accepted.
