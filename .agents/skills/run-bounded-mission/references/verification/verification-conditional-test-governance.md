# Select Conditional Test Evidence

Load this reference only after test-effectiveness governance identifies a decision about executable
behavior examples, a test-first implementation loop, assertion strength, Gherkin/Step integrity, or
a test-deletion candidate. Do not load it for an ordinary Mission, a mechanical change, or a
localized regression whose authority and cheapest decisive oracle are already clear.

This reference selects evidence. It does not require BDD, TDD, mutation, or test cleanup; add a test
framework; create a traceability ledger; or authorize a Spec, test, production, or deletion change.

## Bind authority and relationships

Freeze the current intent and acceptance authority before choosing test authority. Bind the current
solution/test authority when one exists, the candidate or acceptance boundary, and the observable
consumer behavior. Treat requirements, rules, examples, tests, Steps, implementation units, and
consumer evidence as a many-to-many relationship graph:

- one rule may need several examples and tests;
- one example or test may cover several rules or implementation units;
- one implementation unit may support several behaviors;
- a Step definition may serve several scenarios without making files or names the relationship
  authority.

Record only the relations needed to explain selection and acceptance in the current Plan and evidence
prose. Do not require one requirement, Spec file, scenario, test, or code file per peer object, and do
not create a durable matrix when current locators close the relationship.

Keep a Spec immutable only after its authority and the current candidate/acceptance boundary are
frozen. If consumer evidence proves that authority wrong, return to Plan, revise the final-state Spec
and dependent evidence, and remove superseded exploration or diary material. Never preserve a known-
wrong Spec merely to keep its digest stable.

## Choose the cheapest decisive method

Start with no special method. Select one only when its observation can change the candidate or
acceptance more cheaply than the strongest alternative. Add another method only when it covers a
different unresolved risk; do not stack the rows as ceremony.

| Method | Activate only when | Decisive evidence and Stop |
| --- | --- | --- |
| BDD outer loop | shared intent or acceptance remains ambiguous, or cross-boundary user/domain behavior needs executable examples as acceptance | agreed rules and examples fail before implementation and pass through the real behavior boundary; stop when examples close the disputed behavior |
| Selective TDD inner loop | the current evidence decision asks whether test-first feedback would expose a design or boundary error in an already-admitted narrow implementation rule | select or reject that evidence route, then pass an admitted route through [agent lane routing](../orchestration/orchestration-agent-routing.md), which loads [Mission execution](../execution/execution-mission-routing-policy.md) without requiring an agent lane |
| Targeted mutation | tests pass but a named plausible fault could survive because assertion strength is uncertain | the bounded fault is killed or exposes a scenario/oracle gap; stop after the named risk is resolved or the method ceases to be decisive |
| Step governance | Gherkin and Step definitions exist or are proposed for the current behavior | the effective runner configuration gives every executable Step one intended match and no unconsumed glue; stop after semantic and runtime matching close |
| Test GC | test or glue cost, redundancy, obsolescence, or reachability is a current decision | authority, reachability, unique value, replacement, and runtime evidence support an owner-reviewed action; stop at a proposal when deletion safety is not closed |

When no row activates, use the normal consumer check and narrowest owner regression. Counts, coverage,
method popularity, an available tool, or a request to add tests do not activate a row.

## Select the outer and inner evidence conditionally

Use BDD as an outer loop only when collaborative examples clarify or decisively exercise user- or
domain-visible behavior.
Formulate scenarios in domain language around observable outcomes, not UI gestures, database state,
API plumbing, or implementation order. A scenario is acceptance evidence, not a one-to-one wrapper
around a unit test or source file.

For TDD, decide here only whether test-first feedback is relevant evidence for the current
implementation risk. If selected, treat it as the concrete execution-route question and load
[agent lane routing](../orchestration/orchestration-agent-routing.md); it may keep the work in main and loads
[Mission execution](../execution/execution-mission-routing-policy.md), which owns route prerequisites,
loop mechanics, fallback, concurrency, and closure. BDD does not imply TDD for every unit, and TDD
does not require a Gherkin outer loop.

If the requirement, Spec, test, and code disagree, repair the authority that is wrong. Do not make a
lower-authority test green by changing correct consumer behavior, and do not freeze a scenario that
consumer evidence disproves.

## Govern Gherkin and Step glue

Inspect the features, Step definitions, support code, and effective runner configuration together.
Static text or a directory listing alone cannot prove which glue is loaded. Check these failure
classes:

- **low cohesion:** group Steps by domain concept and one meaningful state transition or outcome, not
  by feature file, keyword, UI page, or maximum textual reuse;
- **duplicate:** detect identical expressions and semantically equivalent Steps that restate one
  domain behavior;
- **ambiguous:** fail when one Step can match multiple definitions, including overlaps introduced by
  broad expressions or custom parameter types;
- **dead glue:** nominate a definition only when no executable scenario reaches it under the real
  configuration; dynamic registration or an unobserved entry remains unresolved;
- **parameter soup:** split Steps whose captures combine unrelated concepts, optional branches, or a
  miniature command language; use tables or narrower domain Steps when the data itself is cohesive;
- **shadow Step:** expose near-duplicates or load-scope differences that hide the intended definition,
  and require the effective matcher set rather than relying on file order;
- **implementation leakage:** rewrite Steps that encode selectors, endpoints, database operations,
  internal calls, or code structure instead of observable domain behavior.

Runtime discovery must prove that every executable Step has exactly one intended match and report
undefined or ambiguous Steps. Semantic review decides cohesion, duplication, parameter soup, and
implementation leakage; a linter count cannot decide them. Consolidate glue only after every affected
scenario and support-code consumer is known.

## Falsify assertion strength with targeted mutation

Admit mutation only when all of these hold:

1. a named consumer risk and plausible fault operator can invalidate an assertion;
2. the production path, affected tests, and mutation scope are bounded;
3. the unchanged baseline tests pass and the runner/tool can restore the exact candidate;
4. the expected runtime and review cost fit the Mission's evidence budget;
5. a surviving mutant would change the test or candidate decision.

Use an existing compatible mutation tool when available. Otherwise a temporary manual fault is
acceptable only when it is exact, reversible, and followed by a clean-candidate check; do not add a
repository script or dependency for one probe. A killed mutant supports only the named fault. A
survivor exposes a scenario, selection, or oracle gap. Timeout, compile failure, runtime error,
equivalent mutants, and out-of-scope changes remain unresolved rather than increasing confidence.

Never use a global mutation score as acceptance, mutate the whole repository by default, or retain
temporary faults. Stop when the smallest representative faults settle assertion strength; do not
chase a numeric threshold.

## Propose Test GC without autonomous deletion

Use coverage, static reachability, import analysis, execution history, duplicate signals, runtime,
and maintenance cost only as leads. Before proposing removal, bind the test or glue to current intent,
contract, production consumer, selection path, unique failure value, and any replacement evidence.
Missing entries, dynamic loading, unsupported languages, stale coverage, an unexecuted test, or a low
count keeps reachability or value unresolved.

Return the existing test-effectiveness action: `keep`, `strengthen`, `replace`, `lower_layer`,
`delete_candidate`, or `further_investigation`. Only `delete_candidate` names a proposal; it never
deletes a file or authorizes a refactor. Deletion requires the responsible Mission to admit the exact
write, preserve or replace every required behavior, exercise affected consumers and tests, and review
the complete diff. No Agent, helper, coverage threshold, static analyzer, or test count may delete
autonomously or serve as proof of safety.

Keep the decision in the current Plan and evidence. Record the selected method, question, bounded
scope, decisive observation, cost, and remaining risk without adding a report schema or change diary.
