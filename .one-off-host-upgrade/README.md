# Disposable Linux host-upgrade mechanical checks

This branch is not a product PR and must not be merged. Seven exact reviewed v3 operator/test scripts run solely in temporary paths with FakeSystem. The bundle is rebuilt in RUNNER_TEMP from the pinned d6afd290126830cbaac5e827b2b72f73c8711d24 Git objects and verified against its fixed digest; no generated bundle, real baseline, strategy source or stored run is committed.

The 50 tests include six real Linux renameat2/flock/interrupted-child tests. They never call production Docker, systemd, SSH, credentials, exchange connections or actual installation. CI success establishes only these mechanical paths; real host compatibility, fresh history and installation authorization remain separate. The artifact contains only test output and a nonsecret generated-bundle identity receipt.
