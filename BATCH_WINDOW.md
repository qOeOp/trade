# batch window: CLOSED

Owner: Lane 0 (platform). Machine-readable fields below are the contract; prose
is commentary.

    state:        closed
    evidence_run: 35422504127
    evidence_sha: 09e929b71
    evidence_tree: 721afd0dc2ac4846c918f7e1af968b95e3896040
    base_main:    0e23622ce
    members:      642 653 659 666 677 679
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
