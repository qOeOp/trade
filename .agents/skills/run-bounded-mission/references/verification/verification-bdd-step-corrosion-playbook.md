# Repair BDD Step Corrosion

## Activation

Load only when Gherkin features and Step definitions exist or are proposed and current evidence raises
a matching, cohesion, duplication, reachability, or domain-language decision. A desire for BDD,
textual similarity, reuse percentage, or an available Cucumber tool does not activate it.

## Evidence

Inspect features, Step definitions, support code, custom parameter types, and the effective runner
configuration together. Bind every candidate Step to executable scenarios, intended domain behavior,
load scope, and support consumers. Use runtime discovery for effective matches; mark dynamic
registration or an unobserved entry `Unknown`.

## Taxonomy

- **duplicate:** identical or semantically equivalent expressions restate one domain behavior;
- **ambiguous:** one phrase matches multiple definitions or broad/custom parameter expressions;
- **dead glue:** no executable scenario reaches a definition under the real configuration;
- **universal Step:** one broad Step branches across unrelated states, actions, or outcomes;
- **parameter soup:** captures combine unrelated concepts, optional branches, or a command language;
- **shadow Step:** near-duplicates or load-scope differences hide the intended definition;
- **low cohesion:** grouping follows files, keywords, pages, or textual reuse instead of domain concept;
- **implementation leakage:** selectors, endpoints, database operations, calls, or source structure
  replace observable domain behavior.

## Decision

Prefer domain-semantic cohesion over maximum reuse. Choose `keep`, `narrow`, `split`, `consolidate`,
`replace`, `delete_candidate`, or `further_investigation` for each affected definition. Delete only
after effective reachability and every scenario consumer close. Use tables or narrower Steps when data
is cohesive; do not encode branches in captures.

## Repair

Rewrite scenarios and Steps in domain language around one meaningful transition or outcome. Narrow
expressions and parameter types until each executable phrase has one intended match. Consolidate
semantic duplicates only after all affected scenarios and support consumers are known. Split universal
Steps and parameter soup by responsibility. Remove dead glue only within an admitted deletion slice;
do not add another BDD framework or matcher layer.

## Anti-pattern

Do not group by feature file, Gherkin keyword, UI page, or maximum textual reuse. Do not rely on file
order to resolve ambiguity, treat a linter count as semantic proof, or call unexecuted glue dead without
the real configuration. Do not create one Step per sentence, a universal dispatcher Step, or a
traceability ledger.

## Verification

Run the effective runner's discovery and require every executable Step to have exactly one intended
match, with undefined and ambiguous Steps reported. Execute every affected scenario and its support
path. Review cohesion, domain language, parameter boundaries, and implementation leakage semantically;
runtime matching alone cannot decide them. Prove removed glue has no dynamic or configured consumer,
then run affected owner and root checks.
