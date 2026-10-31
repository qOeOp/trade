# Audit coverage

## Contents

- Assignment
- Behavior and decision evidence
- Data and usage cost
- Product contracts and delivery
- Removal test

## Assignment

For a full audit, assign one fresh read-only reviewer to each workstream. Share the pinned raw
evidence and timeline, not another reviewer's conclusions. Report coverage and anything
unexamined.

| Workstream | Coverage combined |
|---|---|
| Behavior and decision evidence | Failures; Method |
| Data and usage cost | Data; Efficiency |
| Product contracts and delivery | Mechanisms; Product state |

## Behavior and decision evidence

Inspect failures, refusals, retries, workarounds and latent wrong or missing outputs. Identify the
product cause and current-main status. Follow the actual output into the agent's interpretation
and decision, including where information was lost or an unsupported inference arose.

Check applicable research instructions against the session, ambiguous or conflicting guidance,
strategy source (lookahead, sizing, fees, protection) and the validity of later comparisons.
Distinguish faithful execution from justified interpretation: what observation supports the
claim, what alternatives remain, and what information the next step could add? Assess product
support for that reasoning without making research selections or claiming economic validity.

## Data and usage cost

Trace session ledger commits to their commands and changed rows. The ledger fidelity test
(SKILL.md) shows whether the ledger alone reconstructs the research. Check wrong, missing or duplicated
facts, derivable storage, failed-attempt remnants against the schema, identity consistency, original
records and corrections, and whether normal reads preserve their meaning. Compare blob sizes with
physical database growth, backup identity and query scaling.

Measure phase and replay time, tokens, discovery reads, repeated calls and polling, temporary
scripts and oversized outputs. Attribute unnecessary work to a demonstrated cause; a help call or
script alone is not a defect. Give observed cost and the basis for expected savings; leave
uncertain attribution unknown.

## Product contracts and delivery

Evaluate the whole current product against external norms, beyond the paths reached by the
session. Check the rules themselves independently of the behavior review's compliance assessment.
External norms include, for the research method the product encodes (what the ledger stores, what
reports and comparisons compute, how evidence qualifies), the research-methodology literature read
through `research-sources` with only the calls that need no key (AGENTS.md); a source left
unsearched is a coverage gap.

For refusals, audits, eligibility, gates and skill rules, distinguish: should have fired; fired
without value; fired usefully; silent but uniquely protective; silent with no distinct value.
Explain every missed risk or removal proposal.

Trace contracts from their owner through actual distribution, invocation and presentation
consumers. Compare delivered behavior, help, reports, skills and design claims; source agreement
alone does not verify a consumer. Check repaired claims along the same path before closure.
AGENTS.md owns common permissions; identify duplicated or conflicting policies without silently
resolving them by changing authority.

- Skills: use [Anthropic authoring guidance](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
  and [Claude Code skill documentation](https://code.claude.com/docs/en/skills). Check focused runtime
  content, third-person capability/trigger descriptions, progressive disclosure, consistent terms,
  references one level from SKILL.md, navigation for long references and an entry under 500 lines. Remove history, design ids, case accumulations and redundant
  instructions. Evals outside skills are this repository's AGENTS.md policy, not an external rule.
- Code: inspect configured static checks on this checkout and the latest main CI quality log.
  Account for every error and warning, including ResourceWarning and deprecations, with its cause.
- Design: compare published pages and their presentation consumers with current code and skills,
  including commands, fields, rules, paths and eval references. Distinguish published state from
  checkout changes awaiting delivery.
- Human use: for what the user reads or does (the IDE, CLI and report output, ledger queries),
  check that a researcher finds target attainment, line state and decisions waiting on them, and
  reaches the views and actions the research skills hand to them, against a published usability
  norm such as [Nielsen's ten heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/).
  Count a task's steps where that decides a finding. A whole-product review reads `ide/`.

## Removal test

For each branch, exception and rule of the touched mechanism, and each touched command, field or
test, ask:
1. What concrete risk does it guard? Do its branches follow from that risk or list past cases? For
   a test, would its failure mean the product is broken?
2. What other check covers that risk?
3. What did evidence matching its responsibility show: protection, ceremony or an unreached path?

Match evidence to the responsibility: native probes, reports, ledger audits and isolated tests for
execution or identity boundaries; source originals and actual tool calls, session behavior and
independent checks for source verification, authority and interpretation; observed errors, repeated
work and downstream decisions for workflow effects. Ledger visibility or replay alone is not the
only test, and a passing eval vote never replaces inspecting the relevant behavior.

Unreached paths and insufficient evidence stay unverified; neither alone justifies deletion.
Propose removal or merging only after confirming no distinct protection remains, another mechanism
fully covers it, or it adds only useless ceremony. Keep a uniquely useful boundary even if it
never fired.

For skill text, retain necessary runtime guidance; confirm any claimed replacement in actual
product output before deleting it.
