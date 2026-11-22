- Release (host): every long-lived compose service (`ledger`, `market-import`, `docker-api`, `ide-router`,
  `paper-router`, `oauth2`, `edge`) is recreated on the first settled tick after a version commits when it differs
  from what that version's own compose definition creates: its image, compose's configuration hash, the host file
  of each file-based config or the content of each inline config. Before, only an image change moved `ledger`,
  `market-import` and `docker-api`, so a changed `Caddyfile`, `oauth2-proxy.cfg` or service definition needed the
  operator's `--force-recreate`; the 0.5.0 upgrade's manual OAuth2 Proxy and `edge` recreate is gone
  (doctor 20261122-32).
