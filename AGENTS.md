# Project Principles

- **Agent first.** External Agents choose research methods, parameters, comparisons and next actions.
  Use their existing tools and analysis scripts; do not build another research workflow, optimizer or research preset system.
- **Minimal deterministic services.** Code provides explicit parameterized operations, durable tasks,
  reproducible evidence and enforced boundaries. Determinism alone does not justify a new product service.
- **Build on Nautilus.** Reuse and extend its data, Strategy, backtest, Risk, Execution and Portfolio capabilities
  through native APIs. Within confirmed product bounds, adopt verified native mechanisms and extensions, record the
  decision and evidence, and do not ask users to reselect native behavior. Ask only for unresolved product intent
  or tradeoffs requiring their judgment. Do not create parallel engines or ledgers, or product-specific strategy languages and compilation chains.
- **Resolve technical uncertainty with Nautilus first.** Check this repository's Nautilus source, APIs, tests and
  adapter wiring, then compare version-matched official guidance and concrete community strategy/backtest examples.
  Prefer a verified native pattern within confirmed product bounds. Community examples do not prove that this version
  or venue adapter supports a behavior; record a named gap when it cannot be verified. Leave product intent and
  risk tradeoffs to the user.
- **Clean ownership.** Give each responsibility one owner. Merge overlapping components; add a module only for
  an independent need. Shared storage never permits access to another owner's private tables or write authority.
- **Local context.** Organize product extensions by independent capability, not individual MCP tools.
  Keep related entry points, behavior, adapters and tests together; keep shared Nautilus foundations shared.
  Use short local `AGENTS.md` files for responsibilities, source entry points, contracts and checks.
  Migrate existing paths only when needed by a delivery slice; do not copy shared code to make directories self-contained.
- **Deliver user stories.** Build the smallest complete vertical flow for the current milestone. Close higher
  design layers before lower details; replay research stories against the design before adding general infrastructure.
- **Keep one current blueprint.** Documentation defines the intended product and may lead implementation.
  Revise it when evidence changes the design; keep chapters, diagrams and contracts coherent, without patch diaries.
- **Verify outcomes.** Check native capabilities and actual consumers before inventing solutions. Test observable
  results, failures and recovery; avoid tests tied to document wording or a prescribed Agent call sequence.

## Working Boundaries

- Preserve unrelated work. Use the current Makefile, pre-commit and CI workflows; Owner implementation acceptance
  requires the affected Linux Owner chains, not merely a local pass or a successful build.
- Real trading or another production write, changing product purpose/user routes, or weakening a stated refusal,
  seal, bound or invariant requires explicit user authority. Dashboard implementation stays within documented admitted slices.
- Use approved research credentials only within the task. Never expose secrets or use exchange trading credentials.
