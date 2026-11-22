- Deployment: `deploy/update.sh` keeps each admitted version's `compose.yaml` and images at
  `$TRADE_DATA/deploy/<revision>/` (`current` names the one in use) instead of a temporary directory, so later
  recreates have one definition. It refuses while a Paper run or comparison is under way, reports each service's
  revision and definition (flagging a build the admitted version does not contain) and what `up -d` recreates, checks
  every service took the definition, then removes stale replay containers, dangling anonymous volumes and images
  nothing uses or names. `--check` reports without changing anything. `deploy/images.py` no longer takes `--compose`.
