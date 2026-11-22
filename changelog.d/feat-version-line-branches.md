- Breaking (deployment): the research ledger is one DoltHub repository (`TRADE_RESEARCH_ORIGIN`, never suffixed) with
  one branch per version line (`v0.<minor>` before 1.0, `v<major>` from 1.0): the local `main` is published as the
  line's branch, and bootstraps, publishes and mirror syncs fetch that branch alone, never another line's data. The
  repository per schema generation (`<TRADE_RESEARCH_ORIGIN>-g<N>`), the DoltHub API token (`TRADE_DOLTHUB_TOKEN_FILE`,
  `$TRADE_DATA/dolthub-token`) and repository creation are gone: a missing repository stops the update, to be created
  once on dolthub.com. A version of a new line starts a new data generation on every deployment even when its schema did
  not change; a schema change within a line is refused (the release workflow already refuses it in a patch version).
  The first 0.5.3 update on a workstation and the first 0.5.3 release on the release host move the v0.5 ledger from
  `<TRADE_RESEARCH_ORIGIN>-g2` to the branch `v0.5` (the ledger names the repository its origin at its next start; the
  release host waits until `v0.5` holds its mirror's head); `-g2` and the repository's `main` stay as they are. Run
  `deploy/update.sh` from a 0.5.3 or later checkout; it refuses to move a workstation to a version before 0.5.3. A
  cutover journal 0.5.2 left unfinished (`$TRADE_DATA/deploy/generation.json`, or the release host's `generation.json`)
  is not read: finish it with 0.5.2 first.
