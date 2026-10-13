---
name: research-start
description: Gather the ledger, candidate forest, strategy templates and fixed market-data state, present research-route options for the user, and open or resume continuous candidate research.
---

# Research entry

Read `AGENTS.md`, ledger status, open goal, `candidate list` and latest knowledge/notes before asking.
Use explicit research and market profiles; market access is read-only during research. Inspect market
freshness and pin one commit for the whole comparable development experiment. Verify individual
contracts' listing, gaps, LAST/MARK and funding coverage. Do not invent missing data or substitute
five-minute execution for the current one-minute contract. Explain departures from the user's data
window/pool; only the user changes their targets or goal window.

An existing selected route resumes under `research-round`. An absent candidate forest, or the user's
explicit choice to leave all existing routes, leads to root selection. Losses, incomplete runtime,
low priority or a review counter do not automatically cause a new root.

Present current comparable candidates and templates with reports, limitations and reasons. The
non-dominated group is a useful recommendation range, not a qualification boundary; historical
candidates outside it may be selected. A template starts a root without a parent. User-created
artificial roots remain user-initiated. Preserve prior routes and their evidence for reassessment.
The user selects the route; explicit authorization to choose a test template is sufficient and need
not be requested again. Then advance hypotheses autonomously within that route.

If no goal is supplied, gather only missing user values: maximum native MARK drawdown, minimum
annual net return, minimum plan net win rate, market/development window and initial capital. Explain
the fixed native 100,000 USDT account if it differs from their request. No default total research
budget, target change or cap is inferred. Optional run limits only pause execution.

Open a fresh isolated ledger for engineering tests; actual research uses its selected ledger through
the official CLI. `round open --goal` records user values exactly. Missing runtime or data blocks the
execution it needs, not candidate identity or the scientific validity of a route. Report the precise
blocker and retain recovery state. Follow `research-round` for registrations, feedback and review.
