# Resume checklist — for the agent RECEIVING a handoff

You were given a handoff document (a `handoffs/handoff-*.md` file, or a `<handoff-context>` block).
Do this before you touch any code.

1. **Read the whole document top-to-bottom first.** Do not start from the Next Step in isolation.
2. **Check for staleness.** Compare the Metadata git branch + HEAD against the live repo
   (`git rev-parse --abbrev-ref HEAD`, `git rev-parse --short HEAD`, `git status --porcelain`), or
   run `scripts/check-staleness.sh <path-to-handoff>`. If the branch diverged or referenced files
   moved, reconcile before trusting the plan.
3. **Honor "DO NOT REDO."** Treat the Done list as settled. Do not re-implement or re-investigate it.
4. **Honor settled decisions.** Do not reverse a Key Decision without a stated reason; the rationale
   is recorded — argue with that, not from scratch.
5. **Surface the open thread.** If Open Questions contains a pending user request, address THAT
   before improvising new work.
6. **Latest intent wins.** If the user has since said something newer than this document, the user's
   latest instruction overrides the recorded plan. If nothing remains to do, say so briefly — do not
   invent busywork.
7. **Start at the Immediate Next Step**, then verify with the document's Verification block.
