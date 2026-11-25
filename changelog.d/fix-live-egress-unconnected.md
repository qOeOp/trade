- A Live start interrupted after Docker made its egress container and before the container joined the bridge network is
  finished by the next start. Before, every later start of that run ended in `LIVE_IDENTITY_CHANGED`.
