# Frozen Docker-probe v2 — offline preparation only

2026-11-08. This folder implements the three contracts in `../docker-probe-plan/PLAN.md`. Nothing here has been run against Docker or CI. No user server, credential, exchange, systemd or product worktree was used. Frozen v3 is untouched.

## Small delivery

- `probe.py`: one finite executable. Default only checks exact frozen source/bundle bytes and initializer syntax. `--execute` additionally requires a non-root GitHub-hosted Ubuntu 24.04 amd64 job, a preinstalled local Unix Docker daemon, and entirely absent fixed fixture paths.
- `test_probe.py`: 15 offline tests. Only temporary files and fake process/Docker boundaries; no actual subprocess or fixed-host path is used by the tests.
- `ci-job.yml`: uninstalled workflow proposal for root's existing `codex/live-host-docker-probe-20261108` branch. It uses the exact action SHAs already in the successful mechanical workflow. It does not rerun the 50-test mechanics job or Native replay.
- `frozen-probe.sha256`: the two executable/test files to copy to `.one-off-docker-probe/` in that disposable CI branch. Root owns the copying/commit/push; none occurred here.
- `REVIEW-MANIFEST.json`: this complete local review handoff, including documentation and actual offline results.

The existing branch already contains `.one-off-host-upgrade/` with v3's seven exact scripts and `frozen-scripts.sha256`. The proposed job copies these to a fresh temporary `implementation-v3` sibling, uses original `prepare.py` to rebuild bundle `c8b424…`, and puts this probe beside it. The probe independently pins all seven script SHA256 values and the bundle digest. Original full v3 manifest SHA256 `d329d34…` is recorded as review provenance, not read as an additional runtime file: this avoids committing v3 prose/test logs or the generated bundle just to make CI imports work. No consumed code input is left unverified.

## Execution remains exactly three contracts

1. Safe production `CONTAINERS`/`IMAGE` templates run against the exact immutable image and a single **never-started** dummy container. The control-command expected list and boolean template come from the two original frozen `System.observe` assignments, extracted as AST; the rest of `observe` is never run. Docker must return boolean true for the original expected command and false for a different expected Web identity. No arbitrary Env/Cmd output is collected.
2. Original `System.inspector_command` runs in the fixed image with original private root, installed snapshot/state paths, socket GID, RO same-path binds, original capabilities and 256 MiB/180-second limits. Host test holds the original canonical lock EX. The real CLI must return exactly idle using real Docker inventory and existing idle reader.
3. Original `System.foreign_command` runs with the original foreign UID:GID, RO binds and SH lock, and must return exactly idle using the existing `idle_locked`. Empty-root history is intentional: this is not evidence for the reader's retained-native-container branch or a real owner's closure.

Image remains exactly `ghcr.io/qoeop/trade-service@sha256:abc97078d42fd5b7c2c7a268832474e0462bf1a55b8cbedf2d22d3a73dd849f9`, build revision `e81fd3ad17f80eb584927f54c0c608d7247b9e39`, native amd64. One anonymous digest pull; all later creates/runs use `--pull=never`. Public image identity and config digest must match before fixture initialization. A safe IDs-only query rejects preexisting `trade.live.run` resources before any product inventory could inspect unrelated containers.

The image initializer has no socket, uses only new own RW fixture mounts, and calls original `state.serialized`, `write_new`, `encode`, `durable_json`, shared parsers and `configuration.load`. It produces empty roots and original locks, a syntactically valid declaration/snapshot, and a harmless dummy source only in those ephemeral fixture paths. It creates no credential, run, request, native journal or invented terminal event; it never imports that dummy source or pulls the synthetic runtime reference. No generated dummy source is copied to Git.

## Containment, evidence and failures

At most four purposes may allocate containers: initializer, template dummy, canonical and historical. Helpers preserve their entire original argv; only unique lane name, lane label and private CID file are inserted. The client records the exact full ID while pending. No retry or guessed-ID cleanup exists. If a too-fast process removes its CID file before capture, the probe fails rather than inventing ownership evidence.

Only this invocation's local Docker client can be killed on helper timeout/error. Container removal requires a captured full ID and a fresh exact ID/name/lane-label match; absent owned containers are already clean. Cleanup never prunes, deletes images/networks, discovers by a name prefix, or touches unrelated IDs. If any container cleanup remains unproved, fixture directories are retained. Otherwise ordinary privileges remove only the contents of the two exact newly allocated parents. After rechecking original dev/inodes and emptiness, the recorded command runner invokes only sudo -n /usr/bin/rmdir -- for that exact empty parent. No privileged recursive removal is used; /srv and /var/lib remain untouched. A preexisting path or replaced fixture parent is preserved.

The empty client config is separate and no secrets are forwarded into Docker. Helpers still mount the local socket; RO bind does not make the Docker API read-only, which is why this may run only on the disposable dedicated CI VM with reviewed immutable code. It must never be pointed at a user server or a self-hosted runner.

`commands.json` retains exact argv, raw stdout/stderr, return code, elapsed time and timeout/error facts. `created.json` records exact own resource IDs. `result.json` keeps each completed contract, fixture fingerprints, original failure and any cleanup failures. Helper failures and cleanup failures are both retained. Non-idle, timeout, OOM, missing ID or changed fingerprint fails the probe without adjusting business parameters. Job-level cancellation/machine loss may leave only partial artifacts; absence of a complete passed result is not a pass.

## Actual local validation

- 15 offline unittest cases passed (`offline-tests.log`).
- Ruff passed (`ruff.log`).
- Default inert CLI passed (`offline-input-check.json`).
- Frozen v3 and earlier v1/v2 manifests remain unchanged.
- No Docker call, CI run, fixed host fixture allocation, root initialization, image pull, SSH, systemd, key read or venue connection occurred.

Still unproved until root reviews and executes this exact harness: actual daemon template evaluation, fixed image startup/CLI imports, non-root UID/socket/capability/RO mount compatibility, and unchanged originals under those helpers. Passing this CI would still not prove the current user's older service image, actual host ownership/units/history, RSI closure/recycling, account flatness, complete root discovery or installation readiness. Those remain separate host facts and authorization.
