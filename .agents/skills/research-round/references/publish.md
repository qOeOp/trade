# Records: read, publish and decide

Run every command from the repository root. Global options go before the subcommand: `--at
DOLT-COMMIT` reads one fixed snapshot and `--error-format text` prints errors for a human. Each read
uses one fixed Dolt commit; cite that commit and the object revision. A Git commit is not a record
identity.

## Read prior records

```bash
uv run --frozen python -m research.records.cli find --text "WORDS" [--family-id F] [--mechanism M] \
  [--component C] [--purpose P] [--outcome O] [--failure-layer L]
uv run --frozen python -m research.records.cli --at COMMIT show ATTEMPT-ID --brief
uv run --frozen python -m research.records.cli --at COMMIT show ATTEMPT-ID [--revision N]
uv run --frozen python -m research.records.cli --at COMMIT material show ID [--revision N] [--brief]
```

- `find` returns `storage`, `matches` (each with `revision` and `goal_id`) and `unreadable`
  (incompatible records with ID, revision and schema version; they do not block the read). `--text`
  requires every word in the attempt or goal ID, question, mechanism, hypothesis, contract or
  decision text; hashes are not searched. `--failure-layer economics --outcome failed` lists the
  economics failures for the progress check.
- `show --brief` stays within 32 KiB and gives a full-read command for what it omits. A full `show`
  returns the `registered_contract` and `registration_receipt` apart from the current decision.
- `show` and `compare` check only their fixed evidence graph; `validate` checks the whole store.
  `FIXED_DEPENDENCY_UNSUPPORTED` names a historical dependency and the `material show` command that
  reads it.
- Before extending or combining, name the exact prior claim supported or rejected, the hypothesis
  parents, any reused component (it does not inherit its source attempt's result), the source parent
  and the economic control.

## Publish the pending attempt

Publish before reading any new result. `contract attempt` prints the full schema without a
database. Write the payload to a temporary JSON file:

- `schema_version: 3`; `attempt_id` (a capital letter, then letters, digits or hyphens); `goal_id`;
  `kind` (`source`, `diagnostic` or `strategy`); `purpose` (`research`, `engineering`, `demo` or
  `unknown`); `question`, `mechanism`, `hypothesis`; `parents` (`[]` when none); `code_parent`
  (`null` when none); `evidence_refs: []`; `registration: {"status": "preregistered"}`.
- `strategy_binding`: the `binding` from `strategy publish`, unchanged
  ([strategy-authoring.md](strategy-authoring.md)).
- `contract: {scope, plan, selection}`. `selection` is exactly `family_id`, `primary_response` and
  `known_exposure: {status, run_refs}`. Status is `development_exposed`, `unknown` or
  `unexposed_declared` (a declaration, refused when `run_refs` is not empty); `run_refs` lists every
  inspected run as `{"id": "run:RUN-ID", "revision": N}`. Reuse the family ID of the same selection
  family. Budget, stopping rules and missing history go in `plan` and `scope`.
- `decision: {"layer": "pending", "outcome": "pending", "scope": "...", "next_action": "..."}`.

Scope and plan state:

- the single mechanism, the native event that shows it activated, the observation that refutes it,
  and separate source, data, execution and economic stop conditions;
- the legal comparison: a frozen control with the same strategy account, input identity,
  instruments, window, capital, risk and cost assumptions and dependency revision; the primary net
  account response; hard risk limits. Use a parent/child pair when B exists only with A, and
  `00/10/01/11` only when both changes switch independently on one origin;
- the candidates considered, the selection rule, the maximum number of new runs, and the windows,
  metrics and results already seen; which data can still confirm independently, or `none`. Failed
  source or pilot gates stay in the candidate history.

```bash
uv run --frozen python -m research.records.cli ledger status   # current "version"
uv run --frozen python -m research.records.cli contract attempt
uv run --frozen python -m research.records.cli publish attempt --file /tmp/ATTEMPT.json \
  --expected-version VERSION --operation-id OPERATION-ID --dry-run
uv run --frozen python -m research.records.cli publish attempt --file /tmp/ATTEMPT.json \
  --expected-version VERSION --operation-id OPERATION-ID
```

Fix any `read_preflight` finding (an `evidence_refs` path that `show` cannot read) first. Keep the
returned `registration_receipt` (attempt ID, revision 1 and Dolt commit); the payload file is then
disposable.

## Frozen fields

A later revision can change only `decision`, `evidence_refs` and `comparison_family`; anything else
is refused (`FROZEN_ATTEMPT_CONTRACT`), and parent and component references keep their registered
revisions. Different intent, dependencies or source need a new attempt. Do not list runs in
`comparison_family` before they exist.

## Publish a decision

Republish the whole attempt with the new decision, a new operation ID and the current version,
dry-run first. A completed decision sets `layer` (`source`, `data`, `execution` or `economics`),
`outcome` (`passed`, `failed` or `inconclusive`), `scope`, `next_action` and `basis`. `basis` is
`{"mode": MODE, "evidence_refs": [...], "candidate_run_ref": {"id": "run:RUN-ID", "revision": N}}`;
`mode` and `evidence_refs` are required (`[]` when empty):

- `paired`: `candidate_run_ref` is this attempt's registered candidate; its registered control is
  derived, never declared.
- `descriptive`: a `candidate_run_ref`, or at least one `evidence_refs` entry.
- `source`: `evidence_refs` only, no run.

Every reference is a fixed `{id, revision}` with a typed ID (`run:`, `attempt:`,
`review_evidence:`); `register` returns a run's ID as `record`. Another attempt's run is evidence,
never `candidate_run_ref`. Record source and execution failures with their actual evidence; only a
paired economics reading needs both runs to pass integrity.

## Retain evidence originals

Keep readers, results, reviews and reconstruction recipes in a private directory outside Git and
`/tmp`, then:

```bash
uv run --frozen python -m research.records.cli material retain \
  --file /retained/reader.py SHA256 --file /retained/result.json SHA256 \
  --expected-version VERSION --operation-id OPERATION-ID --dry-run
```

Repeat without `--dry-run`. Cite each returned `{"id": "review_evidence:SHA256", "revision": 1}` in
`decision.basis.evidence_refs`; bytes already stored are reused (`already_published: true`).
`material restore ID --destination NEW-FILE` checks the stored hash and never overwrites.

## Compare a registered pair

```bash
TRADE_RESEARCH_ARTIFACT_ROOT="$ARTIFACT_ROOT" uv run --frozen python -m research.records.cli \
  --at COMMIT compare CANDIDATE-RUN CONTROL-RUN --analysis
```

- `compare` refuses unless the candidate registered this control, both runs passed integrity and
  audit, and input identity, instruments, window, account, cost model text, Nautilus version,
  image, platform, runtime contract and effective configuration match. A refusal carries `code`
  (`decision_pair_role_mismatch`, `decision_pair_integrity` or `decision_pair_incomparable`), `path`
  and `expected`.
- `--analysis` adds both seals' reconciled readings, the frozen `selection` and, when
  `primary_response` is `final_equity_usdt`, a paired ISO-week interval. A reading that cannot be
  derived is null with its reason in `limitations`. The output is a temporary read: cite the runs,
  their `manifest_sha256` and the `analysis` source hashes. Field definitions:
  `docs/plans/native-rd-analysis-fields.zh.md`.
- `--engineering-audit` reads an environment migration; it is not a research comparison and cannot
  be combined with `--analysis`.

## Errors, retries and versions

- Errors are JSON on stderr with `code`, `path`, `expected`, `next_actions` and `write_status`.
- `not_written` covers only this invocation. `already_committed`: the original publication
  exists; read it back. `unknown`: read the operation receipt before retrying, and never change the
  operation ID to get past an unconfirmed write.
- The same operation ID with the same content returns the original result; other content under that
  ID is refused.
- A stale `--expected-version` means another write landed: reread and resolve it rather than retry
  at the next version. A dry-run cannot reserve a version.
- Every write refuses a Dolt working set with uncommitted SQL changes.
