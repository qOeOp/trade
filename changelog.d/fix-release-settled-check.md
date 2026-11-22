- Release (host): on each tick that releases nothing, the release compares the host with the routed version's
  admitted record (Web, Agent, Paper controller and Live control by revision label, image digest and route, and
  every running compose service by that version's definition) and sends one Telegram notice per version:
  `vX.Y.Z live: N/N services on <revision>` with the Web revisions kept, what the tick cleaned and the `failed/`
  markers, or a notice naming each part that differs. The drift notice now covers every compose service and its
  definition, not only the service and docker-api images (doctor 20261122-33).
