# Audit coverage

## Contents

- Assignment
- Behavior and decision evidence
- Data and usage cost
- Product contracts and delivery
- Removal test

## Assignment

A full audit exercises, not only reads, each of these on the current product, and reports
coverage and anything unexamined:
- the research flow end to end on a temporary ledger and market, for one contract and for a
  pool, kept small (short windows): `line select` through `line close`, then Paper and
  `paper compare`, then Live's research-side admission refusals against that ledger, without a
  credential or a run;
- every admission gate and eligibility check with partial and missing states (a run or segment
  never started, failed or cut short), not only the passing and failing ones;
- the cost of each long path (replay, import, reports, ledger reads) at two or more input sizes;
- fault paths through the existing fault fixtures (live loopback, fake Docker);
- each IDE page in a real browser on its own `ide/ide.py serve` over a temporary ledger, never the
  user's running IDE: with no records and with records, offline (no `--paper`) and after a reload;
- one state read through every consumer (ledger, report, CLI, IDE), which must agree.

## Behavior and decision evidence

Inspect failures, refusals, retries, workarounds and latent wrong or missing outputs. Identify the
product cause and current-main status.

Check applicable research instructions against the session, ambiguous or conflicting guidance,
strategy source (lookahead, sizing, fees, protection) and the validity of later comparisons.
Distinguish faithful execution from justified interpretation: what observation supports the
claim, what alternatives remain, and what information the next step could add? Judge whether the
method and the product's support for it hold: how hypotheses reach a mechanism and prior work
(`research-sources`), and whether a stop or switch rule can separate the compared effects on the
window it runs on. Never pick candidates or claim a strategy is profitable.

A full audit also reads each line's history longitudinally through the product's read commands
(`research status`, `research state`, `research history`, `hypothesis compare`, `replay report`) and the versions'
source diffs, never ad hoc SQL against the active ledger, and reports:
- a headline that improves while the worst sub-period or the result without the top instrument
  stays flat or worsens;
- `changed_duties` circling the same duties across a `Change of approach.`;
- complexity (rules, constants) that only grows, with no removal or ablation run;
- gains concentrated in removed trades (`trade_pairs` `removed_net` against `matched_delta_net`);
- improvements inside the comparison's detectable difference;
- mechanism predictions that are only mechanical consequences of the change (counting measures).

A product gap behind a pattern (a missing measure or refusal) is a finding, not skill text.

## Data and usage cost

Trace session ledger commits to their commands and changed rows. Check wrong, missing or duplicated
facts, derivable storage, failed-attempt remnants against the schema, identity consistency, original
records and corrections, and whether normal reads preserve their meaning. Before calling a fact
missing from the ledger, check that no record carries it and that a reader could not derive it.
Compare blob sizes with physical database growth, backup identity and query scaling.

Measure phase and replay time, tokens, discovery reads, repeated calls and polling, temporary
scripts and oversized outputs. Attribute unnecessary work to a demonstrated cause; a help call or
script alone is not a defect.

## Product contracts and delivery

Evaluate the whole current product against external norms, beyond the paths reached by the
session. Check the rules themselves independently of the behavior review's compliance assessment.
External norms include, for the research method the product encodes (what the ledger stores, what
reports and comparisons compute, how evidence qualifies), the research-methodology literature read
through `research-sources` with only the calls that need no key (SKILL.md, Boundaries); a source left
unsearched is a coverage gap.

For refusals, audits, eligibility, gates and skill rules, distinguish: should have fired; fired
without value; fired usefully; silent but uniquely protective; silent with no distinct value.
Explain every missed risk or removal proposal. A stated reason (doc, comment, design page) is a
claim to test, not an exemption: check whether a candidate that should be refused (wrong, partial
or adversarial) passes the gate. That test is also how a shape the index keeps on purpose is
rechecked (Structure). Test the reverse too: when the product or an agent declares a candidate
falsified, short of its targets or invalid, ask whether the mechanism failed or the test made an
artifact (segment boundaries, a whole-period rule dropping partial periods, a template or scaffold
defect, a risk budget far from the target it missed, one data defect). For a claimed confirmation,
ask whether a plainer mechanical cause gives the same numbers (fewer trades, a few removed losers,
one instrument or quarter). A false verdict path either way is a finding, and changing the gate
behind it an authority item; the doctor picks no candidate and changes no target.

Trace contracts from their owner through actual distribution, invocation and presentation
consumers. Compare delivered behavior, help, reports, skills and design claims; source agreement
alone does not verify a consumer.

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
  Count a task's steps where that decides a finding; the source alone does not show what a page
  draws (Assignment). Beyond whether controls work, ask what a researcher must see, and whether each
  answer is on screen together rather than split across panels or folds: what changed against the
  parent or control and whether it is better; which year, instrument, side or exit carries the
  result and what drawdown each year took; how far it is from buy-and-hold. A figure the product
  computes and no page shows is a finding. Judge pages at realistic density: a temporary ledger from
  the end-to-end run with many versions, instruments and history cells.
- Residue: start from what main removed or renamed since the last full audit's checkout (`git log`),
  then search code, tests, skills, evals, blueprints, READMEs, `deploy/`, `docs-site/` and `ide/`,
  dot paths and ignored files included, for what it left: code nothing consumes (always-empty or
  constant values passed along, wrappers, duplicates, unread results, retries of what the path cannot
  raise, refusal codes nothing raises); tests of what can no longer happen; text naming what no longer exists or claiming what the
  code no longer does. The search and an anchor prove it, no session call needed. Before calling code
  unused, check consumers a name search misses: pickling across worker pools, reflection,
  configuration, the replay image. Code without a consumer protects nothing; a guard that can still
  fire is not residue and takes the removal test. One finding per removed thing.
- Structure: before local smells, read the package layers (`tests/test_package_layers.py`),
  import cycles inside a package, and the largest and most often changed modules (`git log`), and
  name what holds each shape in place. A shape the index lists as deliberate is reported again only
  when its stated reason no longer holds.

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
