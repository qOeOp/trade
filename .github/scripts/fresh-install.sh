#!/usr/bin/env bash
# A fresh install, from an empty host state to one replay, the way deploy/README.md installs the deployment:
# .env, the host directories, deploy/images.py, `docker compose up`, then the host's command line. Run by the
# fresh-install job of .github/workflows/ide-image.yml with this build's images.
#
#   fresh-install.sh IDE_IMAGE SERVICE_IMAGE RUNTIME_IMAGE   (each name@sha256:digest)
#
# Two steps differ from a person's install, because a hosted runner cannot take them:
# - The ledger's first start publishes to a file:// repository under $TRADE_DATA instead of DoltHub, with a
#   key `dolt creds new` makes (no DoltHub account): the same skip-the-page path (TRADE_RESEARCH_ORIGIN and a key
#   directory), with the remote the code also accepts. Nothing reaches DoltHub.
# - market-import is not started: Binance answers HTTP 451 to hosted runners. The market directory is written
#   from the command line tests' fixture (tests/cli/test_commands.py: BTCUSDT bars, funding and members).
# The ledger is the runner's own, new and empty: never a person's ledger. A replay is recorded on a research line,
# so the script opens one first from the candidate template (publish, precheck, review, line select).
#
# FRESH_ENV (default deploy/.env), TRADE_DATA (default ~/.local/share/trade) and COMPOSE_PROJECT_NAME move it
# elsewhere on a workstation, with TRADE_IDE_PORT and TRADE_LEDGER_PORT beside a running deployment. It refuses
# an existing env file or data directory, and removes what it made when it ends.
set -euo pipefail

ide="$1" service="$2" runtime="$3"
env_file="${FRESH_ENV:-deploy/.env}"
D="${TRADE_DATA:-$HOME/.local/share/trade}"
compose=(docker compose -f deploy/compose.yaml --env-file "$env_file")
project="${COMPOSE_PROJECT_NAME:-trade-ide}"
if [ -e "$env_file" ] || [ -e "$D" ] \
    || [ -n "$(docker ps -aq --filter "label=com.docker.compose.project=$project")" ] \
    || [ -n "$(docker volume ls -q --filter "label=com.docker.compose.project=$project")" ]; then
  echo "fresh-install: $env_file, $D or compose project $project exists; this needs an empty host state" >&2
  exit 2
fi

finish() {
  code=$?
  if [ "$code" != 0 ]; then
    "${compose[@]}" ps -a || true
    "${compose[@]}" logs --no-color --tail 200 || true
  fi
  "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  # The containers wrote as TRADE_UID, the user running this, so it can remove them.
  rm -rf "$D" "$env_file"
  exit "$code"
}
trap finish EXIT

step() { echo "::group::$*"; }
done_() { echo "::endgroup::"; }

step "deploy/README.md: .env, the host directories, the images"
printf 'TRADE_UID=%s\nTRADE_GID=%s\nTRADE_DATA=%s\nTRADE_MARKET_ARGS="%s"\n' "$(id -u)" "$(id -g)" \
  "$D" "--bar-symbols BTCUSDT ETHUSDT SOLUSDT --bars-from 2024-01" > "$env_file"
for name in TRADE_IDE_PORT TRADE_LEDGER_PORT; do
  if [ -n "${!name:-}" ]; then echo "$name=${!name}" >> "$env_file"; fi
done
mkdir -p "$D/dolt/paper" "$D/ledgers" "$D/dolt-backups" "$D/dolthub" "$D/market" "$D/paper-tmp"
uv run --frozen python -m deploy.images --env "$env_file"
# This build in place of the last admitted one, which deploy/images.py named.
sed -i.bak -e "s#^TRADE_IDE_IMAGE=.*#TRADE_IDE_IMAGE=$ide#" -e "s#^TRADE_SERVICE_IMAGE=.*#TRADE_SERVICE_IMAGE=$service#" \
  -e "s#^TRADE_RUNTIME_IMAGE=.*#TRADE_RUNTIME_IMAGE=$runtime#" "$env_file"
rm -f "$env_file.bak"
# First start without the page (deploy/README.md, First start), to a file:// repository.
mkdir -p "$D/dolt-backups/origin"
echo "TRADE_RESEARCH_ORIGIN=file://$D/dolt-backups/origin" >> "$env_file"
docker run --rm --user "$(id -u):$(id -g)" -e DOLT_ROOT_PATH=/key -v "$D/dolthub:/key/.dolt" \
  --entrypoint dolt "$service" creds new >/dev/null
grep -v '^TRADE_RESEARCH_ORIGIN=' "$env_file"
done_

step "docker compose up (every service but market-import)"
"${compose[@]}" config --quiet
"${compose[@]}" pull --quiet ide ledger paper docker-api
"${compose[@]}" up -d --wait --wait-timeout 900 ide ledger paper docker-api
"${compose[@]}" logs --no-color ledger
done_

export TRADE_LEDGER_HOME="$D/ledgers"
cli() { uv run --frozen python -m cli.main "$@"; }
work="$(mktemp -d)"

step "The market profile (after ledger is healthy) and the fixture market"
printf '{"name": "market", "holds": "market", "kind": "active", "root": "%s/market"}\n' "$D" > "$D/ledgers/market.json"
uv run --frozen python -c '
import json, sys
from tests.cli.test_commands import _fill_history, _fill_market
profile = json.load(open(sys.argv[1]))
_fill_market(profile)
_fill_history(profile)
' "$D/ledgers/market.json"
cli market coverage --symbols BTCUSDT --start 2026-01-01T00:00:00Z --end 2026-02-01T00:00:00Z
done_

# The development period lies before a two-year holdout ending at the last quarter end the market covers
# (2025-12-31). BTCUSDT is covered from 2023-01, twelve quarters, so a line gets the one-year period 2023
# (line-close-history-test-20261110.zh.md 3.1), where the fixture holds a week of bars.
window=(--symbols BTCUSDT --start 2023-01-02T00:00:00Z --trade-start 2023-01-03T00:00:00Z --end 2023-01-06T00:00:00Z)
step "A research line, as research-start opens one: the candidate template published, prechecked, reviewed"
cli candidate new --output "$work/candidate" --strategy-id fresh-install >/dev/null
cli candidate publish --file "$work/candidate/strategy.py" --strategy-id fresh-install --entry-class Strategy1 \
  --description "the fresh install's candidate template" >/dev/null
cli replay precheck --candidate fresh-install@1 --runtime "$runtime" --output "$work/precheck" -- "${window[@]}" \
  > "$work/precheck.json"
jq -e '.status == "passed"' "$work/precheck.json" >/dev/null
jq -n '["api", "causal", "activity", "readiness"] | map({(.): {status: "passed", note: "the fresh install'"'"'s precheck"}})
  | add' > "$work/items.json"
cli source review --candidate fresh-install@1 --runtime "$runtime" --precheck-trial "$(jq -r .trial_id "$work/precheck.json")" \
  --verdict passed --items "$work/items.json" --reviewer fresh-install >/dev/null
cli line select --start fresh-install@1 --slug fresh-install | jq -c '{line, window, market_day}'
done_

step "One replay: replay explore of the candidate template on $runtime, on that line"
cli replay explore --strategy-file "$work/candidate/strategy.py" --strategy-class Strategy1 --line fresh-install \
  --output "$work/run" --runtime "$runtime" -- "${window[@]}" > "$work/explore.json"
jq -c '{status, problems, trial_id, image_ref, market}' "$work/explore.json"
jq -e '.status == "passed" and .problems == [] and (.trial_id | type == "number")' "$work/explore.json" >/dev/null
done_

step "Publish, backup and review in the ledger container (it has Dolt; the host needs none), and the page reading the ledger"
# Writes only commit locally; the service publishes every 5 minutes, `ledger publish` at once.
"${compose[@]}" exec -T ledger python -m cli.main ledger publish > "$work/publish.json"
"${compose[@]}" exec -T ledger python -m cli.main ledger export --kind backup > "$work/backup.json"
"${compose[@]}" exec -T ledger python -m cli.main ledger review > "$work/review.json"
jq -c '{ok, findings, limitations}' "$work/review.json"
jq -e '.ok == true and .findings == [] and .limitations == []' "$work/review.json" >/dev/null
curl -fsS "http://127.0.0.1:${TRADE_IDE_PORT:-8765}/api/about" > "$work/about.json"
jq -c . "$work/about.json"
jq -e --arg commit "$(jq -r .ledger_commit "$work/backup.json")" \
  '.ledger.running == true and .ledger.unpublished == false and .ledger.commit == $commit' "$work/about.json" >/dev/null
done_

echo "fresh install: ledger first start, trial $(jq -r .trial_id "$work/explore.json") passed, published, backed up, reviewed"
