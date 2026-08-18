# R&D Workbench S1

This package is the first non-live Product Edge slice. It runs a digest-pinned Windmill CE server and worker, PostgreSQL persistence, and the native R&D Owner API. Windmill submits, resolves, and renders; only the Owner commits Research receipts, an initial frozen Intent, and the bounded Research View.

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
WINDMILL_TOKEN=... \
WINDMILL_WORKSPACE_ID=trade-rd \
WINDMILL_BASE_URL=http://127.0.0.1:18000 \
product/rd-workbench/scripts/deploy.sh
```

Open the deployed `Trade R&D Workbench` Raw App in Windmill. Its policy is authenticated `viewer`; it has no Data Table access.

## Native MCP profile

Mint a separate local token by submitting `mcp-profile.json` to Windmill's
authenticated `POST /api/users/tokens/create` endpoint. The file is a directly
mintable, workspace-bound token request with exactly these scopes:

- `mcp:scripts:f/trade/product_edge/research_goal_v1`
- `mcp:endpoints:getJob,getJobLogs`

The profile intentionally omits `mcp:all`, favorites, folder wildcards, flows, previews, deployment, workspace listing, and every create/update/delete tool. Folder filtering is not the security boundary.

## Status boundary

An HTTP or Windmill job success is not business acceptance. `ACCEPTED` and `REJECTED_NO_WRITE` are valid only when `owner_receipt` is present. A timeout, response loss, worker restart, or absent receipt stays `SUBMITTED_OR_UNKNOWN`; the only legal recovery is `RESOLVE` with the same `request_identity`.

Reusing an identity with different semantics is `IDENTITY_CONFLICT`, not a new
business disposition and not proof that the original Research Intent is absent.
Its only legal action is to resolve the original Owner receipt under that same
identity.

This slice does not implement Artifact, Backtest, Qualification, Scanner, Runtime, Portfolio, Recovery, capital, Risk, Execution, orders, or real trading.
