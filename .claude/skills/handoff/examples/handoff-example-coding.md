# Handoff — JWT refresh-token endpoint (feature build)

> Generated: 2026-05-30T12-00-00-000Z · Continues from: none
> Variant of the general template, tuned for building a feature mid-flight. Read top-to-bottom.

## Metadata
- Project: ./acme-api
- Git branch: feat/refresh-tokens · HEAD: 9f3c1ab · Tree: dirty (3 modified, 1 untracked)
- Agent / model: Claude Code (opus)

## Current State (read this first)
The `/auth/refresh` endpoint is wired and compiles. Happy-path works; the failing piece is rotation:
a refreshed token must invalidate its predecessor, but the old token still verifies. 30/90 auth
tests pass; the 3 rotation tests fail. Everything else (login, logout, access-token issue) is green.
- Blocking right now: `revokeToken()` is a no-op stub — rotation cannot pass until it is implemented.

## Goal / Acceptance criteria
Add refresh-token rotation to the auth service so clients exchange a refresh token for a new
access+refresh pair, and the used refresh token can never be reused.
- [x] `POST /auth/refresh` issues a new access + refresh pair
- [ ] the consumed refresh token is revoked and fails on reuse (409)
- [ ] expired refresh tokens return 401, not 500

## Design / Approach (with rationale)
- **Store refresh tokens hashed (SHA-256) in `refresh_tokens` table, not raw**: a DB leak must not
  hand out usable tokens. Chosen over JWT-only (stateless) because we need server-side revocation.
- **One-time-use rotation with a `revoked_at` column**: simpler and auditable vs. a token-family
  reuse-detection tree; revisit if we need breach detection later.

## Progress
### Done — DO NOT REDO (4 of 6 slices)
- [x] migration `migrations/0007_refresh_tokens.sql` — table + unique index on `token_hash`
- [x] `issueRefreshToken()` at `src/auth/tokens.ts:54` — hashes + persists, verified by `tokens.test.ts`
- [x] `POST /auth/refresh` handler at `src/auth/routes.ts:88` — validates + issues new pair
- [x] expiry parsing fix at `src/auth/tokens.ts:31` (was using seconds as ms)
### In Progress
- [ ] `revokeToken(hash)` at `src/auth/tokens.ts:72` — currently `return;` stub; must set `revoked_at`
      and the rotation path must call it after issuing the new pair
### Pending
- [ ] map expired-token DB lookup to 401 in `src/auth/routes.ts` error branch (currently throws → 500)

## Immediate Next Step
Implement `revokeToken(hash)` at `src/auth/tokens.ts:72` to `UPDATE refresh_tokens SET revoked_at =
now() WHERE token_hash = $1`, then call it inside the refresh handler right after the new pair is
issued (`src/auth/routes.ts:101`). Then run `npm test -- src/auth/rotation.test.ts`.

## Files / Areas Touched
- `src/auth/tokens.ts` — token issue/verify/revoke; revoke is the open stub
- `src/auth/routes.ts` — `/auth/refresh` handler
- `migrations/0007_refresh_tokens.sql` — new table
<read-files>
src/auth/index.ts
src/auth/middleware.ts
src/db/client.ts
</read-files>
<modified-files>
src/auth/tokens.ts
src/auth/routes.ts
migrations/0007_refresh_tokens.sql
</modified-files>

## Conventions to match
- Handlers return via `reply.code(n).send(envelope)`; errors use `AppError` subclasses in
  `src/errors.ts` (e.g. `ConflictError` → 409). Do not throw bare `Error` from a handler.
- Tests use `tap` + an in-memory pg via `test/helpers/db.ts`.

## Tests
- New/affected: `src/auth/rotation.test.ts`, `src/auth/tokens.test.ts`
- Last run: 30/90 pass; rotation.test.ts fails 3/3 — `expected 409, got 200` on token reuse

## Gotchas / Landmines
- `now()` in tests is frozen by `test/helpers/clock.ts`; use the injected clock, not `Date.now()`.
- The unique index is on `token_hash`, not `token` — inserting a raw token will not collide.

## Verification (copy-paste, exact)
```bash
npm test -- src/auth/rotation.test.ts
npm test -- src/auth
git status --porcelain
```
Expected: rotation.test.ts 3/3 pass; full auth suite 90/90; reuse of a consumed token returns 409.

## Open Questions (preserve verbatim)
- User asked: "should a reused refresh token also revoke the whole session, or just 409?" — not yet
  answered; current code only 409s. Confirm before closing the rotation slice.

## Handoff Chain
- Continues from: none
- This doc: handoffs/handoff-2026-05-30T12-00-00-000Z.md
