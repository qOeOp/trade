- CI: a daily `ghcr-retention` workflow lists the pull request image versions (`pr-N` tags) of `trade-ide`,
  `trade-service` and `trade-docker-api` last tagged more than 30 days ago; a dispatch on main with `delete` deletes
  them. A version that also carries `main`, a version tag or the `sha-` of a main commit, or whose digest this
  repository pins, stays, as do untagged versions and every `trade-runtime` version.
