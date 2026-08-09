# Repository Instructions

Prioritize clean architecture and the smallest implementation that closes the requested outcome.
Preserve unrelated work. Real trading or another production write requires explicit user authority.
Use the repository's current Makefile, pre-commit configuration, and CI workflows as check authority;
do not reconstruct a missing historical entrypoint.

## Codex bootstrap

`qOeOp/skills` is the sole source for `run-bounded-mission` and its Codex agent profiles. Before any
non-trivial implementation or delivery, and after switching branch or worktree:

1. fetch `origin/main` and read `codex-skills.lock.json` from that exact ref;
2. materialize its exact `qOeOp/skills` commit in an immutable user cache outside this repository;
3. run that checkout's `node scripts/install-codex.mjs --lock <origin-main-lock> --install-trade-session-hook`,
   then the same command with `--check`;
4. after hook content changes, review the exact user `SessionStart` command in `/hooks` and trust only
   that installed command;
5. freeze implementation and delivery if the pin, install, hook trust, or check is unavailable or mismatched.

Normal branches use the latest `origin/main` pin, not their historical copy. A dedicated pin-update PR
may use its candidate lock only after the referenced commit is merged to `qOeOp/skills/main`. A branch
that still tracks `.agents/` or `.codex/` is outdated and must absorb the migration from main before
further work. This migration cannot retroactively govern a worktree that has not absorbed it; treat
such a worktree as unsafe rather than loading its repository-local Skill.

Do not edit installed copies or add repository-local Skill/profile sources. Skill, profile, installer,
and eval changes go to `qOeOp/skills` first; after merge, update only this repository's pin. The
project keeps `.agents/` and `.codex/` ignored.

After bootstrap, non-trivial implementation or delivery must use `$run-bounded-mission`. Answer-only,
explain/audit/diagnose-only, mechanical edits, routine status, and task management do not auto-trigger
it. Skill activation does not itself authorize a new task or an external effect.
