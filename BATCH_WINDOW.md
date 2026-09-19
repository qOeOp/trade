# batch window: OPEN

Owner: Lane 0 (platform). Machine-readable fields below are the contract.

    state:        open
    main:         f7b3fc60a33e3019ecb1e00dc1d7c25a6d7fcb05
    main_tree:    721afd0dc2ac4846c918f7e1af968b95e3896040
    last_batch:   642 653 659 666 677 679
    last_run:     35422504127
    opened_at:    2026-09-19T05:34:07Z

## What landed, and what was verified before it did

Six pull requests merged onto `0e23622ce`. Before merging, three things were
checked independently rather than taken on report:

    the round            completed/success, both legs green, head 09e929b71
    main unmoved         still 0e23622ce when the round finished
    tree equality        the merge tree rebuilt from scratch == the proven tree

And afterwards, the check that actually matters:

    main's tree          721afd0dc2ac4846c918f7e1af968b95e3896040
    proven tree          721afd0dc2ac4846c918f7e1af968b95e3896040

So main is, byte for byte, the tree the ordered chain passed on. That is the
whole point of the exercise: not "the tests were green somewhere" but "they were
green on this".

## Before you toggle draft->ready, look for a build already running

This rule does not depend on the window. It is true at all times, and it is the
cause of a large share of the "stale reds" seen today.

    no build on this head at all          -> toggling is the remedy
    a build queued or in progress         -> do NOT toggle; it is already coming
    a build completed                     -> read its result, do not toggle

Toggling again on the SAME commit starts a second run and cancels the first, and
a cancelled run reports `quality` as a failure. Toggle three times and the pull
request shows a red `quality` that no code ever caused.

Measured: #675's head carried three build runs - two `cancelled`, one `queued` -
all on one commit. Control: #686's head carries exactly one.

So a red on a head is worth attributing before acting on it. If the owning run is
`cancelled` and a newer run exists on the same SHA, nothing failed: someone
toggled. Diagnosed by Lane 3.

## Path routing exists; it is just not the `paths:` key

Two of us got this wrong in the same hour, so it is worth writing down.

`build.yml` has no `paths:` filter, and that is deliberate: a path filter makes
the workflow ABSENT for the PRs it excludes, and an absent required check blocks
forever. Routing happens in `scripts/ci/plan.sh` instead - `is_lightweight_prose`
at :92, after excluding `config/ schema/ tests/ fixtures/ data/ generated/
scripts/ .pre-commit-hooks/` so that files which look like prose but are build
inputs do not qualify. `quality` then runs with `if: always()` and evaluates the
plan outputs together with each job's result.

So the check genuinely runs and genuinely has nothing to do - the property a stub
job only pretends to have.

Measured on #679, docs-only, merged:

    26 jobs created, 22 SKIPPED, 4 ran      quality = success

**A cost figure taken from one pull request does not transfer to another.** I
previously told several lanes that a draft->ready costs 22 running jobs; that was
measured on a Rust PR and is inverted for a docs PR. Routing by content is the
whole point of plan.sh, so the job count is a property of the change, not of the
action.

## Reading this file correctly

    git fetch origin fleet/batch-window && git show FETCH_HEAD:BATCH_WINDOW.md

`FETCH_HEAD` is rewritten by every fetch, so this always reads the current file.

Do NOT use `git fetch origin 'refs/heads/fleet/batch-window:refs/remotes/...'`
without a leading `+`: when the local ref already exists, a non-forced refspec
does not update it, and you will read a stale window indefinitely. Lane 7 read
`closed` for some time after this file said `open` for exactly this reason.
`git ls-remote` is also safe.

## While open

Merging, `test-chain/*` pushes and draft->ready are all unconstrained. Take
chain evidence now if you need it - your merge tree is built on a main that is
settled.

Whoever opens the next batch closes this window first, and says so.

## One stale red worth knowing about

`#679` merged with a `quality` failure showing on its head. It was stale: the
failing check belonged to run 35420923137, which is `completed/cancelled`, while
the newest build on the same SHA (35421039927) is `completed/success` with
`quality` green. GitHub reported CLEAN, consistently.

A failing check on the current head does NOT mean the head failed. Attribute it
to its run first: a conclusion of `cancelled` on the owning run, plus a newer run
on the same SHA, is the signature of a red that never happened.
