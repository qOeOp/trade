# Classify Canonical Task Types

Load this reference only when one of the following consumers requires a task type: the task workflow
is creating or revalidating a packet; Hub dispatch is classifying an approved node; or lifecycle QA is
aggregating terminal facts by type. Ordinary Missions, child preflight with a frozen title,
single-Mission recovery, delivery, agent routing, and evaluators must not load it merely to read the
code table.

This file is the sole owner of canonical task type codes, names, and responsibility boundaries. The
task workflow continues to exclusively own packets, titles, numbering, consent, identity, and
dispatch; recovery and QA consume only the compact metadata it projects. Do not copy the code list,
legacy dispositions, or classification rules into a consumer, and do not create an alias map,
registry, ledger, scheduler, CLI, or wrapper.

## Classify one primary owner domain

Classify by the Outcome's primary consumer, owner, and Acceptance, not by its verb, implementation
mechanism, filename, historical prefix, lane, model, or current lifecycle stage. Each task has exactly
one canonical code. If a request contains multiple independently acceptable primary Outcomes, first
use the task workflow to determine whether they should be split into multiple Missions. If two codes
remain possible, keep the packet `deferred` and return main classification; do not choose one
arbitrarily or create a temporary code. When the Outcome is an identifiable ordinary product,
runtime, correctness, security-fix, or data/schema implementation and no other specialized domain in
the table owns its primary Acceptance, classify it as `DEV`; do not use `DEV` merely because the
Outcome includes implementation or code changes.

All codes are fixed three-letter uppercase ASCII values. In Allowed lifecycle role, `primary` means
that only an independently acceptable Mission Outcome may create a task. Internal work such as
planning, research, building, evaluation, routine testing, QA routing, and delivery steps remains in
its existing Mission and does not acquire task identity from a code.

| Code  | Canonical name                | Owner / domain boundary                                                                                                                                                   | Positive example                                                                                            | Negative example                                                                                                                                                                                                             | Allowed lifecycle role                                                                                                                  |
| ----- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ARC` | Architecture                  | Cross-owner structure, authority, dependency direction, and cohesion; defer to a specialized domain when it already owns the problem                                      | Thin lifecycle kernel; cross-domain reference-tree cohesion                                                 | Task identity and Hub DAG belong to `ORC`; pure latency targets belong to `OPT`                                                                                                                                              | `primary`; architecture advice is internal evidence                                                                                     |
| `DLV` | Delivery                      | PR, CI, provider review, merge, release handoff, and exact-head delivery barriers                                                                                         | PR title contract; provider-review waiter; merged cleanup policy                                            | Evaluator admission belongs to `VER`; worktree environments belong to `OPS`                                                                                                                                                  | `primary`; ordinary publish, review, and merge steps remain in the original Mission                                                     |
| `DEV` | Product / Runtime Engineering | Ordinary product, runtime, correctness, security-fix, or data/schema implementation Outcomes; only when no other specialized canonical domain owns the primary Acceptance | Add user functionality; fix runtime correctness or security defects; implement a product data/schema change | Research -> `RSH`; planning -> `PLN`; architecture -> `ARC`; optimization -> `OPT`; test governance -> `TST`; verification -> `VER`; QA -> `QUA`; delivery -> `DLV`; orchestration -> `ORC`; environment operations -> `OPS` | `primary`; ordinary implementation steps remain in their specialized domain Mission, and `DEV` is not an implementation lifecycle stage |
| `OPS` | Operations                    | Local or runtime environments, worktrees, toolchains, and operational capability; does not own the GitHub delivery lifecycle                                              | Managed-worktree environment/bootstrap contract                                                             | PR and merge effects belong to `DLV`; Hub task topology belongs to `ORC`                                                                                                                                                     | `primary`; ordinary deterministic bootstrap is an internal operation                                                                    |
| `OPT` | Optimization                  | Latency, context, cost, throughput, or efficiency is the primary Acceptance while Outcome and owner remain unchanged                                                      | Critical-path compression; empirical execution-route optimization                                           | Authority migration belongs to `ARC`; task dispatch correctness belongs to `ORC`                                                                                                                                             | `primary`; the routing owner still decides route and model selection                                                                    |
| `ORC` | Orchestration                 | Task identity, title, type, dispatch, Hub DAG, dependency release, monitoring, checkpoint recovery, and portability                                                       | Hub DAG; single-Mission recovery; task-type authority                                                       | Plan decision policy belongs to `PLN`; generic environments belong to `OPS`                                                                                                                                                  | `primary`; Hub controls and status work do not create separate tasks                                                                    |
| `PLN` | Planning                      | Frame and Plan, decision evidence, Design Loop, representation admission, and planning projection contracts                                                               | Plan Design Loop; Frame/Plan projection contract                                                            | Task recovery belongs to `ORC`; candidate audit belongs to `VER`                                                                                                                                                             | `primary`; `mission_planner` is a support lane                                                                                          |
| `QUA` | Quality Assurance             | Cross-lifecycle mismatch discovery, classification, aggregation, root-owner routing, and corrosion assurance                                                              | Lifecycle QA; RBM self-QA aggregation; owner corrosion routing                                              | Frozen-candidate audit belongs to `VER`; test governance belongs to `TST`                                                                                                                                                    | `primary`; ordinary QA signal routing does not create a task                                                                            |
| `RSH` | Research                      | Decision-changing evidence acquisition, research admission, and the independent research system; does not own the subsequent decision                                     | Prior-art gate; domain-premise research contract                                                            | Plan choice belongs to `PLN`; fixed-oracle audit belongs to `VER`                                                                                                                                                            | `primary`; `mission_researcher` is a support lane                                                                                       |
| `TST` | Test Governance               | The test system, test policy, effectiveness, BDD/Step, fixtures, or Test GC is itself the primary deliverable                                                             | Conditional test governance; test-effectiveness audit contract                                              | Running or supplementing tests for another Mission remains part of that Mission                                                                                                                                              | `primary`; ordinary test and revision work is internal verification                                                                     |
| `VER` | Verification                  | Independent verification of candidates, instructions, judges, or evidence; reviewer integrity; and audit contracts                                                        | Minimum independent-review contract; independent Skill evaluation system                                    | Lifecycle aggregation belongs to `QUA`; provider delivery barriers belong to `DLV`                                                                                                                                           | `primary`; reviewer support lanes do not create tasks                                                                                   |

## Bound the legacy inventory

The following table disposes only historical facts observed in this bounded inventory; it is not an
alias table. Titles, task identities, branches, PRs, and evidence from before this authority's
canonical merge are `historical-only`: retain their exact bytes and do not rename, backfill, or
renumber them. `mapped` means the same literal code may be used for a new task that, after
reclassification, satisfies the current boundary. `merged` means the old synonymous prefix is no
longer used for new tasks. `retired` means the prefix describes a mechanism or component and cannot
stably determine a domain; only the listed existing instances receive this disposition.

| Observed prefix or exact group | Disposition | Canonical disposition for the observed Outcome                                                                                                                                                                                                    |
| ------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARC`                          | `mapped`    | `ARC`                                                                                                                                                                                                                                             |
| `DLV`                          | `mapped`    | `DLV`                                                                                                                                                                                                                                             |
| `OPT`                          | `mapped`    | `OPT`                                                                                                                                                                                                                                             |
| `ORC`                          | `mapped`    | `ORC`                                                                                                                                                                                                                                             |
| `PLN`                          | `mapped`    | `PLN`                                                                                                                                                                                                                                             |
| `RSH`                          | `mapped`    | `RSH`                                                                                                                                                                                                                                             |
| `QA`, `PLAY`                   | `merged`    | `QUA`                                                                                                                                                                                                                                             |
| `ASM`, `SQA`                   | `merged`    | Observed assessment-rubric, evaluator admission, containment, and terminal-integrity Outcomes -> `VER`                                                                                                                                            |
| `TEST`                         | `merged`    | `TST`                                                                                                                                                                                                                                             |
| `PERF`, `EFF`, `SPK`           | `merged`    | `OPT`                                                                                                                                                                                                                                             |
| `VFY`, `VRY`, `EVAL`, `SKR`    | `merged`    | `VER`                                                                                                                                                                                                                                             |
| `PRV`, `PR`, `CLN`             | `merged`    | `DLV`                                                                                                                                                                                                                                             |
| `NAM`, `SGL`, `TYP`, `PRT`     | `merged`    | `ORC`                                                                                                                                                                                                                                             |
| `RPL`, `FRM`                   | `merged`    | `PLN`                                                                                                                                                                                                                                             |
| `KRN`, `COH`                   | `merged`    | `ARC`                                                                                                                                                                                                                                             |
| `RES`                          | `merged`    | `RSH`                                                                                                                                                                                                                                             |
| `WT`                           | `merged`    | `OPS`                                                                                                                                                                                                                                             |
| `ORG`                          | `retired`   | Observed Skill organization/cohesion work -> `ARC`; reviewer-transition work -> `VER`                                                                                                                                                             |
| `RBM`                          | `retired`   | Observed evaluator/evidence integrity -> `VER`; session/lifecycle orchestration -> `ORC`; importer/test-audit -> `TST`; review waiter/terminal -> `DLV`; Plan capability/impact evidence -> `PLN`; structural kernel/transition contract -> `ARC` |
| `HLP`                          | `retired`   | Observed unsupported-import/test helper -> `TST`; historical evaluator binding/packet helpers -> `VER`                                                                                                                                            |
| `HOOK`                         | `retired`   | Observed host lifecycle capability reachability/no-change probe -> `OPS`                                                                                                                                                                          |
| `REF`                          | `retired`   | Observed Git-history efficiency refactor -> `OPT`                                                                                                                                                                                                 |

Do not infer unlisted tasks from the table or generate metadata directly from a legacy prefix. When
recovering a historical task, preserve its exact title and identity; only current main may reclassify
it under the current Frame, Outcome, owner, and Acceptance.

## Project metadata without policy

After successful classification, the task workflow projects the code, canonical name, exact revision
locator for this file, and a one-sentence Outcome/owner basis. Consumers retain only this compact
projection; they must not copy the table or rerun legacy mapping. Task type may be used as
non-authorizing metadata for QA aggregation, telemetry, or subsequent routing research, but it must
not by itself decide the lane, model, reasoning effort, priority, dependency, lifecycle route,
verdict, repair owner, or effect.

A missing value, a value that is not three letters, a non-member, evidence insufficient to identify
the owner domain, multiple owners still competing for the same Outcome, authority locator drift, or
a value the consumer does not recognize must all fail closed as `unknown`: preserve the raw value and
locator, freeze type-dependent creation, dispatch, or aggregation claims, and return main
classification. When sufficient evidence establishes that the primary Outcome is an ordinary
product, runtime, correctness, security-fix, or data/schema implementation, it must be classified as
`DEV` and must not remain deferred indefinitely. Do not use `DEV`, `GEN`, `MISC`, the nearest code, or
a historical prefix as a fallback for a genuinely unknown value.

A new code may be added only in an independent Plan on current main: prove that no existing code
matches, that the proposed code is mutually exclusive with every adjacent boundary, that a real
creation, dispatch, or QA consumer exists, and provide positive and negative examples plus the
allowed lifecycle role. Update this table and rerun real consumer probes in the same authority
change. A task that depends on the new code remains `deferred` until the canonical authority is
merged.
