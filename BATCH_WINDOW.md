# batch window: OPEN

Owner: Lane 0 (platform).

    state:        open
    main:         b0ca33ba203e661f4e27bffc25ff880ebb208a51
    main_at_open: b0de5ea48acec4652a7e146dde711e56d1b5965d
    last_landed:  686 680 684 688 675 663 676
    landed_by:    various - the window is open, so this is expected
    opened_at:    2026-09-19T07:45Z
    refreshed_at: 2026-09-20T04:20Z

## The three members and #686 landed without me, and main is healthy

#686, #680, #684 and #688 were merged between 07:37:23Z and 07:37:38Z, fifteen
seconds apart, in the order that was required - the clippy fix first, then the
three documentation PRs. I did not merge them, and the commit metadata does not
say who did: every squash through GitHub's API records `gopher` as author and
`GitHub` as committer, identically to the merges Lane 0 performed earlier today.

Main was checked afterwards and is sound:

    crates/testkit/src/postgres.rs:534   `let Err(refused) = outcome else {`
                                         the clippy fix is present
    ledger count                         75 -> 77  (rd 9 -> 11, which is exactly
                                         what #684 adds)
    main's own build                     running on b0de5ea48

So this is recorded, not complained about. The batch I had assembled was void
anyway - it sat on a red baseline - and whoever merged did it in the one order
that works. The outcome is the outcome my process would have reached, sooner.

What was skipped is the batch evidence: no round ever ran on the assembled tree
of those three together. For three documentation PRs with no overlapping files
that is a small thing, and it is worth naming rather than leaving implied.

## Correcting the record twice: the prose, then the fields

The previous revision rewrote the prose to say the evidence did not exist, and
left the machine-readable fields untouched. Lane 3's scanner parses the fields,
so it went on reporting `window=closed`, `members=[680,684,688]`, and handing out
two run ids that are cancelled and mislabelled.

That is the same failure as the one the prose was correcting, one layer in: I
fixed what I had been reading and not what the readers read. A file with both a
narrative and a contract has two places to be wrong, and correcting one of them
feels like correcting the file.

## The evidence this file previously advertised does not exist

An earlier version of this file recorded:

      > chains_run   35427329533   (owner-chains)
      > full_run     35427331514   (build, test-ci)

    (quoted with `>` and no colon on purpose: a verbatim quote of a field block
    is indistinguishable from a live field to anything that greps for
    `^\s*full_run:`. The live values are the ones at the top of this file, and
    they are the only ones written in field syntax.)

Both entries were wrong, and both errors are mine.

**The chains run is cancelled.** I cancelled it myself, deliberately, because the
batch was doomed - and then did not come back and update this file. For a period
this file advertised a proof that I had personally destroyed. Lane 2 found it by
re-reading the runs rather than trusting the record.

**`35427331514` is `security-audit`, not `build`.** The build is `35427331535`.
I read them from adjacent lines of one `gh run list` output and took the wrong
one. So the line claiming "both rounds are on the same commit, which is
checkable" was checkable and wrong.

## Why the batch was doomed, and what has to happen first

`scripts/ci/plan.sh:32` routes any non-main push to full validation, so pushing
the assembled tree to `test-ci` runs `prek run --all-files`, which runs clippy.
The assembled tree is `41b6df615` plus three documentation PRs - it does not
contain #686, so it still carries the `manual_let_else` error in
`crates/testkit/src/postgres.rs`.

The batch never had a chance, and it never had a chance for a reason that has
nothing to do with its members. **Check that the baseline is green before
assembling a batch.** I did not.

So: #686 lands first. Then the batch is rebuilt on the new main, and only then is
there evidence to cite.

## This is the first batch with full evidence

Previous batches proved only the two Owner chains. This one is pushed to
`test-ci` as well, so `build` runs in full on the assembled tree - clippy, rust
tests, doctests and the docs gates included. Both rounds are on the same commit,
`43482ed5f`, which is checkable: the two runs' head SHAs must match, and they do.

`test_ci_pin` records where `test-ci` stood when assembly began. Before the
evidence is used, that value is checked again. If `test-ci` moved, the run
belongs to someone else and the batch is rebuilt rather than cited - this is the
same move as checking that main's tree equals the proven tree, with the channel
as the object.

All three members are documentation-only, which is deliberate: the cheapest
possible trial of a procedure that has never run. If the procedure is wrong, it
is better to find out on three .md files.

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

## main moved at 41b6df615 - every green and every merge ref is now stale

#685 landed. That means, for EVERY other open pull request:

    its merge ref still carries the previous main
    any green it already has was taken against the previous main

Neither refreshes on its own. A push recomputes the merge ref (and costs almost
nothing - build.yml ignores `synchronize`); the green only returns when the
checks re-run.

This is not a defect, it is what merging means. It is written here because it
recurs after every single merge and was missed after the last one: six of ten
open pull requests were sitting on a superseded base.

The two questions are different and both are needed:

    run.pull_requests[0].base.sha   what the EXISTING green tested   <- gates a merge
    refs/pull/N/merge's first parent  what the NEXT run would test   <- schedules a push

`green-base == main` implies the merge ref is current (main cannot be
force-pushed - ruleset 19718837 carries `non_fast_forward`), so for a pull
request that already has a green, only the first question adds anything.

## Batch evidence goes to `test-ci`, and why not a dedicated channel

The batch round has been `test-chain/<lane>` until now. That workflow's own header
says what it covers: "The two isolated PostgreSQL Owner chains, and nothing else."
So the ASSEMBLED tree has never had clippy, rust tests, doctests or the docs gates
run on it - those ran only on each member's own binary merge with main, which is a
different tree from the one all members produce together.

From the next batch, the assembled tree is also pushed to `test-ci`, which
`build.yml` accepts as a push branch and runs in full. One extra round per BATCH,
not per member, so the cost stays O(N).

A dedicated `test-batch/**` channel would avoid contention and would be wrong.
`build.yml` hardcodes `main || test-ci` in seven places, and two of them are not
cache switches:

    :539  CARGO_CI_PROFILE   main/test-ci -> ci-pr,  anything else -> nextest
    :545  CARGO_TARGET_DIR   likewise

A new branch falls to the `nextest` profile and a different target directory, so
the evidence would describe a compilation main does not use. That is the
profile/target mismatch this repository has already been bitten by. `test-ci` is
right precisely because it already has profile parity with main, and parity is
the property batch evidence needs. (The other five references are cache switches;
missing the cache on a batch branch is desirable anyway - non-main branches should
not be populating a 10 GB quota.)

### Contention, handled by pinning rather than by discipline

While a batch is being assembled, `test-ci` belongs to Lane 0; other lanes use
`test-chain/<lane>`, which is two cheap jobs and exists for exactly this. Outside
assembly `test-ci` is shared as before.

Someone will push it without reading this. That has already happened once with a
stale copy of this file. So the remedy is not the rule, it is the measurement:
record `test-ci`'s SHA when assembly starts and check it again before using the
evidence. If it moved, the run belongs to someone else - rebuild rather than cite
it. Same move as checking that main's tree equals the proven tree, with the
channel as the object instead of main.

### Order matters: full evidence first, then exempt members

Members are exempt from 0b because the batch tree carries the evidence. That
exemption is only sound once the batch tree actually has full evidence. Doing it
the other way round leaves a window where the batch has chains-only evidence AND
members are exempt - the thinnest coverage in either scheme.

## Lane 0 tells each member it is a member - reading this file is not enough

A pull request cannot tell from its own side that it has been added to a batch.
`members` is written here by Lane 0, and a member may well read it only AFTER the
round has started - at which point it may already have pushed and voided the
round without ever having been able to know.

So the obligation is on Lane 0, not on the member: **name each member to its lane
when adding it**, in the same action that writes the list. A member's duty begins
when it is told, and until then a push is not a mistake.

From that moment the member freezes its head until Lane 0 says merged or void.
Moving a member's head does what moving main does: the evidence was assembled
from each member's head as it stood.

## A green's strictness depends on whether it is the only evidence

Sharper formulation, from Lane 4:

> The question is not "should we be strict here". It is "is this green the only
> evidence there is".

    merged alone, no batch tree    its own green IS the evidence - staleness is fatal
    merged inside a batch          its green satisfies the ruleset's form; the batch
                                   tree carries the evidence - staleness is harmless

That is why #685 was held to the strict reading and #645's in-flight round was
allowed to finish. Same rule, different answers, and the difference is structural
rather than a judgement call about how much risk to accept.

## After a merge: a finished green and a running job need opposite actions

Both are invalidated by main moving, but what to do about them differs, and the
in-flight one is time-sensitive.

    a finished green      re-trigger when convenient - it is already sitting there
                          misleading anyone who reads the panel
    a run still in flight CANCEL, then push - it is burning concurrency right now
                          in order to produce something already known to be void

Cancelling an in-flight run early wastes only what it has burned so far; letting
it finish wastes all of it AND leaves a green on the panel in the meantime. A
cancelled run leaves a red, which misleads in the direction of "go look" rather
than "safe to merge" - the same reason every criterion here fails toward refusal.

## Merging one pull request invalidates every other one

Measured after #685 landed: of fourteen open pull requests, ZERO had a green
against the new main. Six carried a stale green, eight had no build at all. The
clippy fix everyone was waiting on was among the stale ones.

    merge one -> main moves -> the other N-1 greens die -> each needs a round
    -> merge the next -> ...            N pull requests cost O(N-squared) rounds

This is what a merge queue exists to prevent, and this repository cannot have one
(personal-account owner; the API returns 422 `Invalid rule 'merge_queue'`).

So batching is not a convenience. It is the only thing that brings the cost back
to O(N): one evidence round covers the whole batch, each member's own green
satisfies the ruleset's form, and the real evidence is the batch tree.

Merging a single pull request outside a batch is sometimes still right - #685 was
on the critical path and unblocked four others - but the price is that every
other open pull request needs refreshing. Put that number on the table before
deciding.

## Three arguments for acting, one for waiting, and the one wins

The review session's position on their six documentation pull requests, kept here
because it is the shortest complete statement of why this file exists:

> I have evidence I just verified, a measured zero overlap with everything in
> flight, and an action costing 24 jobs. All three say act now. The only thing
> saying wait is that the tree will move once more. Waiting wins, because none of
> the first three guarantee that the tree that was proven equals the tree that
> will be merged.

Zero overlap is an argument about CONTENT. Every incident this repository has had
this week was not a content conflict - not the silent revert in #679, not the
evidence round thrown away earlier, not the greens taken against a superseded
base. Each was the same thing: the tree that was proven was not the tree that
would be merged. Content arguments are blind to that by construction, because
they ask whether changes collide, and the harm comes from proving the wrong tree.

A required check's green is evidence bound to a tree, exactly like a chain round
is. The difference is that nobody builds it by hand, so nobody remembers it has
a base.

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

## A draft toggle does not refresh the tree CI tests (2026-09-19, measured)

This changes what waiting for a queue slot buys you, so it belongs here rather
than in one lane's notes.

`build.yml` checks out `refs/pull/N/merge`. That ref is *not* recomputed when
main moves, and - this is the part that was not known - **it is not recomputed by
a draft->ready toggle either**. Measured on #681:

    09:26Z   toggled draft->ready
    09:35Z   the run started; its job log says
               BASE_SHA: b0de5ea48...        while main was a9a699276

Eleven commits behind. The mechanism is "main as it stood when the head was last
pushed", and it holds across every open PR:

    #681 #645 #662   head pushed 07:43-07:56Z  ->  base b0de5ea48 (07:37Z tip)
    #690 #691 #682   head pushed 09:08Z        ->  base 9040557d8 (08:48Z tip)
    #692             head pushed 08:48Z        ->  base 9040557d8

So a toggle is a re-run, not a re-base. Getting evidence on current main is two
steps, and the order matters:

    1. merge origin/main into the branch and push   refreshes the merge ref.
                                                    Costs no queue: build.yml
                                                    deliberately ignores
                                                    `synchronize`.
    2. toggle draft->ready                          takes the build. Costs a slot.

Doing only step 2 gives a green about a tree nobody will merge.

### Two consequences of this that I checked and had to drop

Both looked like harms of a stale base. Neither is one, and saying so here saves
the next person the same two investigations.

**It does not force a Rust gate onto a docs PR.** #681's plan said `rust=true`
and its title says `docs(...)`, which looked like other people's crate changes
leaking in. Its own diff touches a crate file. A type prefix in a title is not
evidence of what a PR changed.

**It does not misattribute other people's changes to your PR.** `plan.sh:80`
takes `git merge-base "$base_commit" HEAD`, and HEAD is the merge commit whose
first parent *is* that base - so the diff is exactly the PR's own changes. A
stale base is self-consistent: it tests (old main + PR) and diffs (old main ->
old main + PR).

The one real harm is the one already written above: the tree that was proven is
not the tree that will be merged.

## main is red, and every Rust build taken before #702 lands is red with it

    main            red on ONE test of 26520
    the test        vibe-binance::spot
                    exec_client::test_ws_trading_connect_retry_succeeds_after_setup_failure
    why it matters  `quality` has seven `needs`; `rust tests` failing makes `quality` fail, and
                    `quality` is the ONLY required status check in the repository - so this one
                    test makes every lane's merge criterion unusable at once
    the fix         #702, queued

It is not a flake. `wait_for_ws_setup_response` treated `recv()` returning `None` - every sender
dropped, so no setup error will ever arrive - as a reported error. On a reconnect the previous
stream's teardown drops that sender while the new setup is succeeding, and a closed channel is
ready immediately while `select!` is preemptive, so that arm does not sometimes win: it wins the
moment the channel closes.

### Do not take a Rust build until #702 lands

Ask the branch, not the calendar and not the PR title:

    git show <your branch>:crates/adapters/binance/src/spot/execution.rs \
      | grep -c errors_can_still_arrive
    # 0 = the fix is not in your tree

A pure-documentation PR is unaffected: `plan.sh` routes it past the Rust gates and its
`rust tests` job reports `completed/skipped`. Confirm by reading that run's job list rather than
by reasoning from the PR title - a `docs(...)` title does not mean the diff is documentation, and
reasoning from the title in either direction has already produced one wrong call today in each
direction.

The production sweep for this defect class is complete, so #702 is the whole of it rather than the
first instalment: of 33 `select!` arms in `crates/**/src/` that bind the whole `Option` from
`recv()`, one collapsed it, twenty have an explicit `None` arm, five use let-else, three are empty,
and three delegate to a function returning `ControlFlow` (spot-checked: `ControlFlow::Break`).
Three more sites exist in bybit's tests and are tracked separately; none is on the critical path.

## `build` on main produces nothing while merges are fast, so the pre-merge check is the only gate

Measured 2026-09-20. Eight consecutive runs of `build.yml` on `main` concluded
`cancelled`, and the one before them was the last to reach a verdict.

    2026-09-19 10:17 / 11:42 / 12:36 / 13:38   success
    2026-09-19 15:58                           failure   (the binance defect)
    2026-09-20 03:01 onwards                   cancelled, every one

The concurrency key did not change. `build.yml` groups main runs as `build-main`
with `cancel-in-progress: true`, which means "always be testing the newest main" -
correct when a build outruns the merge rate, and silent when it does not:

    merge gaps on main, last eleven   6  2  23  8  31  0  0  1  13  0  2 minutes
    one full build                    ~60 minutes

So this is a merge-rate observation, not a configuration defect, and it is self
limiting: stop merging for about an hour and the pending run reaches a verdict.

Do not "fix" it by changing the key. A per-commit key would put roughly twenty
concurrent main builds of twenty-six jobs each against an account limit of twenty
jobs, starving every lane. `cancel-in-progress: false` queues them instead, and the
queue grows without bound at this rate while its answers get older.

### What follows for merging

`cancelled` is not green and not red - it is *not measured*, and in a run list it
looks almost exactly like *still running*. While main is in this state, nothing
verifies a tree after it lands, so the pre-merge check is not a formality:

    green base == current main        merge
    interval is docs-only             merge
    interval touches a gate file      run that gate on the merge tree
    otherwise                         compile the merge tree, whole workspace

Three merges today carried that evidence rather than assuming: #702 (512 crates),
#645 (511), #710 (513, plus the changed gate re-run on the merge tree).

`test-chain/<lane>` is unaffected by any of this - it is a separate workflow with
its own concurrency, and it remains a first-class acceptance channel under
AGENTS.md rather than a substitute for one.
