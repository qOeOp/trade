# Lenses

Each lens is a separate read-only sub-agent. Every item it returns carries the session location
and a product proof (SKILL.md step 4).

## Failures

Look at every command that failed, was refused, was retried, or gave a wrong or surprising result,
and every point where the agent worked around the product. For each one, report:
- the root cause in the product;
- whether main already fixes it;
- the fix.

Also report latent defects the session exposed without failing: wrong or missing values in a
report or stored record, refusal text whose fix points nowhere, an argument that silently does
something else.

## Mechanisms

List the refusals, audit and eligibility checks, gates and skill rules that the session's steps
pass through. Put each one in exactly one class:

| Class | Meaning |
|---|---|
| should have fired | the session hit the risk it guards, but it stayed silent (gap or defect) |
| fired, no value | always true, duplicated by another check, or only produced ceremony or a workaround |
| fired, useful | caught a real problem |
| silent, useful | did not fire, but guards a real risk that no other check covers |
| silent, no value | cannot matter for this product, or is fully covered elsewhere |

Cover every item in the first two classes and the last. Apply the removal test to each.

## Efficiency

Measure:
- wall-clock time per phase, and the replay time within it;
- tokens over time;
- `--help` calls and source reads the agent needed before it could use a command (each one points
  to a gap in a skill or in the CLI help);
- repeated commands and polling;
- scripts the agent wrote in /tmp, and whether a skill should have given them;
- oversized outputs.

For each finding, give the cost, the cause, the cheapest remedy (skill text, CLI output or
nothing) and the expected saving. Product code is the remedy only for a trust boundary, a defect,
or something an agent cannot do (AGENTS.md).

## Method

Go through the session's steps against the current research skills, rule by rule, and report:
- which rule applied and whether the agent complied;
- where the skill text was ambiguous or contradictory and led the agent astray;
- what the agent should have done instead;
- the smallest wording change that would prevent it.

Judge the strategy source too: lookahead, sizing, fees and protection. Also judge whether the
setup keeps later comparisons valid.

## Data

Report:
- every ledger commit in the session's span, with the command that made it and the rows it
  changed;
- stored facts that are duplicated, or that stored data already derives;
- wrong or missing values;
- records left by failed attempts, and whether the schema intends them;
- inconsistent identities;
- blob sizes, compared with the physical growth of the database;
- whether the backup matches;
- query patterns that scale badly with the number of rounds.

Use only read-only statements.

## Removal test

For a mechanism, rule, command, field or test, answer three questions:
1. Which concrete risk does it guard? For a test, ask instead: if it fails, is the product broken?
2. Does another check already cover that risk?
3. What do the sessions show: caught something, only ceremony, or never reached?

Propose removal when no distinct risk remains, or when the sessions show only ceremony while
another check holds the risk. Keep it when it guards a real risk on its own, even if it has never
fired. A removal of a refusal or audit check is an `authority` item (SKILL.md K.3).
