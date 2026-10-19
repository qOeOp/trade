# Readiness

Read before the first replay of a line, when a coverage receipt shows a gap, zero volume or
missing funding, and when a new month of data arrives. `market coverage --at COMMIT --start START
--end END [--symbols ...]` gives the per-contract facts at the line's pinned commit; it judges
nothing.

- **E.1.2.3** Before a replay, check three things: the runtime reference resolves to exactly one
  image; the market database has every month of the development window; every contract's coverage
  can be read. When anything is missing, report the exact block (image, market commit, contracts
  and intervals), the range that can run without changing anything and the state kept for
  resuming, then ask. Never drop coins, shorten the window, fill data or change the commit or the
  window yourself, and never call the block a failed candidate or an invalid line.
- **W.3.3.2** Keep coverage gaps, zero-volume minutes and missing funding apart, each a fact with
  the cause not yet proven. None of them is an economic failure, and none is a reason to drop
  coins, shorten the window or fill data; the runnable range and the block go to the user to
  choose. Candidate identity and the line's validity do not change because of them.
- **J.6.3.1** When a new month arrives, read the latest complete month and compare it with the
  line's window and pinned commit. Report only how far the window could extend and the exact
  blocks (missing image, market commit or coverage receipt, and which part each affects), then end
  by asking the user to choose the market commit and the development window. Do not change the
  window, register or replay meanwhile. The user's choice is one new line record; the old record
  stays.
