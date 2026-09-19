# batch window: CLOSED

Owner: Lane 0 (platform). Machine-readable fields below are the contract; prose
is commentary.

    state:        closed
    evidence_run: 35422504127
    evidence_sha: 09e929b71
    evidence_tree: 721afd0dc2ac4846c918f7e1af968b95e3896040
    base_main:    0e23622ce
    members:      642 653 659 666 677 679
    deferred:     645 681 663 682 683 668 669 671 672 673 676
    opened_at:    2026-09-19T04:53:59Z

## What closed means

Do not merge anything to main while state is closed - including documentation-only
PRs, including PRs that touch no file any member touches.

The evidence proves ONE tree: base_main plus the members. Any merge to main makes
the tree that would result from merging the members differ from the tree that was
proven, so the evidence stops proving the merge and the round is wasted.

This is not a judgement about whether a change is important. It is tree equality.
A PR touching only .md files voids the round exactly as a PR touching the chain
does.

## What the window does NOT constrain

Closed constrains three things: merging to main, pushing `test-chain/*`, and
starting a new full PR build (opening a non-draft PR, or toggling draft->ready).
Everything else that cannot change the tree the members produce is unaffected.
So these stay open:

    rebasing your own branch                    fine, UNLESS it is a member
                                                (a rebase force-pushes, which
                                                 moves the head and voids the round)
    force-pushing your own branch               fine, UNLESS it is a member
    opening PRs, pushing new commits, review    fine
    ordinary PR CI on your own branch           allowed, but NOT free - see below

### Do NOT take chain evidence while closed - corrected

An earlier version of this file said running CI on your own branch is
unconstrained. That is wrong for `test-chain/*` pushes, and it is wrong in the
expensive direction.

A closed window is the WORST time to take chain evidence for a PR outside the
batch. Your evidence would be a merge tree of `base_main + your PR`; when the
members land, main changes and your evidence is void the moment the window opens.
You pay a full round and throw it away.

It is also the time that hurts most. Evidence rounds are what actually consume
runners - the window's "do not merge" rule does not stop them. At the time of
writing, the gating round for THIS window sat queued behind twelve other runs.
An out-of-batch lane taking evidence during a closed window voids its own
evidence AND delays the unfreeze for everyone.

So: while closed, do not push `test-chain/*`. Take evidence after the batch lands
and main is settled - then your merge tree is built on the main that will still
be there.

### draft->ready: do not, while closed - upgraded from "priced" to "don't"

An earlier version priced this instead of forbidding it, on the grounds that
`quality` is a required check and a PR that is never toggled stays BLOCKED
forever. That objection is real but it does not apply to a CLOSED window, because
a window is bounded: the toggle is not forbidden, it is postponed by roughly one
round.

The reason to postpone is not only cost. `opened:false` and `ready_for_review`
are build.yml's only two full PR-side triggers, so a round started while closed
proves a tree that expires the moment the members land. It does not merely
compete with the gating round - it spends capacity producing something already
known to be void.

If a window stays closed long enough that postponing actually blocks you, say so
to Lane 0 rather than toggling; a window that long is a problem with the window.

### the measured cost, for when you do toggle

Measured on a real PR build: 26 jobs created, 4 skipped, 22 actually run. An
owner-chains round is 2 jobs. So one draft->ready costs about eleven times a
chain round in jobs, and it competes with the gating round for the same runners.

This is NOT forbidden, because `quality` is a required check and a PR that is
never toggled stays BLOCKED forever - banning it would mean no non-member PR
could reach a mergeable state at all.

So it is a priced choice, not a free one: if your toggle can wait for the window
to open, let it wait. If it cannot, toggle and know what it costs.

### The exception, which is not obvious

Force-pushing a MEMBER branch voids the round. The evidence was built from each
member's head as it stood when the branch was assembled; moving that head changes
what "merge the members" produces, exactly as moving main does. Members are listed
above. If you need to move a member's head, tell Lane 0 first - the round has to
be rebuilt, and it is cheaper to know before it finishes than after.

## deferred: a RULE first, a list second

**The rule.** While state is closed, every open PR that is not in `members` is
deferred by default. It cannot merge, it must not be toggled (see below), so
there is nothing for anyone to chase. A scanner should apply this rule and report
nothing, rather than consulting the list.

**The list** names PRs whose owners told Lane 0 they are waiting, usually because
they touch the chain closure and would need re-proving. It is a convenience, not
the source of truth.

The distinction matters because the list is REPORTED. "Not in the list" means
only "nobody reported it" - never "should not be deferred". Two PRs were being
chased every few scans for exactly this reason, and an earlier version of this
file omitted six more because I built the list from who had spoken to me rather
than from `gh pr list`. A reported table inherits the gaps of whoever reports;
a rule does not.

## Members are being proven, not stalled

A PR listed in members has no build on its own head only because it is being
proven here. Do not toggle it draft->ready to "refresh" it; that starts a
competing round and changes nothing about this one.

## Why this file exists

The previous round (35420401594) went green and was thrown away. Its evidence was
built on 4473e8c6b, and #670 merged to main nine minutes after the round started,
so the proven tree no longer equalled the merge tree. Nobody did anything wrong
except me: I started a round and then merged. There was no artifact anyone could
have consulted to know a round was in flight - this file is that artifact.
