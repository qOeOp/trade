# vibe-portfolio-owner

Portfolio Owner contracts and custody:

- `capacity_scope`: the immutable Capacity Scope identity for one account, one `PAPER` or `LIVE`
  mode, and one economic pool, its untrusted request vocabulary, and the sealed `BOUND` readback
  only a complete-registry resolution can mint.
- `capacity_scope_postgres`: the production PostgreSQL custody (`portfolio_private`) holding the
  append-only registry of complete membership censuses, its head, the sealed readbacks, and the
  read-only `portfolio_api` function Strategy Governance resolves a `BOUND` scope through.
- `portfolio_view`: the bounded Portfolio View R0 contract, fail-closed with no positive source
  resolver.

Portfolio never allocates capital, subtracts a Risk Reservation liability, computes remaining
headroom, or authorizes a trade. The inherited portfolio engine in `vibe-portfolio` stays a
migration source and holds no Owner fact. See `docs/owners/portfolio.md` for the contract and its
admission ledger.
