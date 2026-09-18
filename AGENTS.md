# Repository Instructions

Prioritize clean architecture and the smallest implementation that closes the requested outcome.
Preserve unrelated work. Real trading or another production write requires explicit user authority.
Use the repository's current Makefile, pre-commit configuration, and CI workflows as check authority;
do not reconstruct a missing historical entrypoint. An Owner implementation is accepted when its
entries in the ordered Owner PostgreSQL chains pass on Linux CI - the `owner-chains` workflow on a
`test-chain/<lane>` push, or the chain jobs of `build` on `test-ci` or `main` - and a local pass is a
working state, not acceptance.

## Architecture authority

The documentation is the highest-level architecture authority for this project. Every implementation
must strictly conform to the architecture and design described in the documentation. If a documented
design cannot be implemented as written, or implementation reveals that the documented top-level
design must change, stop the task and request explicit user authorization before changing the
documentation or continuing the implementation.

## Dashboard implementation status

The Dashboard documentation under `docs/guide/dashboard.md` and `docs/guide/dashboard.zh.md` is the
governing route, component, and geometry contract for `product/dashboard`. It is no longer a
blueprint-only artifact: it now carries per-slice admission status, and the user has admitted specific
routes as `DRAWABLE_EXACT / IMPLEMENTATION_ADMITTED`.

Dashboard work is admitted only for a route or reusable atom that document marks
`IMPLEMENTATION_ADMITTED`, and only as the bounded, separately reviewable slice described there.
Everything below that gate stays blueprint-only and must not be developed, scaffolded, deployed, or
packaged; a route name, a navigation entry, or retained upstream source is not implementation
authority. `IMPLEMENTATION_ADMITTED` is permission to build and verify. It never proves that a backend,
Owner consumer, or effect path exists, and it never authorizes a production effect, an executor cutover,
or real trading. Widening the admitted set requires changing that document first under the Architecture
authority rule above.

## Local API keys

An agent may use the following API keys from the local environment when an admitted repository task
requires them:

- `DEEPSEEK_API_KEY`
- `FIRECRAWL_API_KEY`
- `SILICONFLOW_API_KEY`
- `DATABENTO_API_KEY`

Treat their values as local secrets: never commit, print, log, or copy them into repository artifacts.
Availability authorizes credential use only within the admitted task's scope; it does not authorize
real trading or another production write.

## Agent bootstrap

This gate binds every agent that performs repository work, not only Codex. Claude Code and any other
agent must satisfy it on the same terms; an agent that cannot satisfy a step records that step as
unavailable and freezes, rather than treating the step as somebody else's obligation.

`qOeOp/pareto` is the sole source for `run-bounded-mission` and its agent profiles. Before any
non-trivial implementation or delivery, and after switching branch or worktree:

1. fetch `origin/main` and read `codex-skills.lock.json` from that exact ref;
2. materialize its exact `qOeOp/pareto` commit in an immutable user cache outside this repository, as a
   Git checkout that carries `origin` and `refs/remotes/origin/main`; step 3 verifies the pin against
   both, so an archive or any other Git-less materialization fails there instead of installing;
3. run that checkout's
   `node scripts/install-codex.mjs --host <codex|claude> --lock <origin-main-lock> --install-trade-session-hook`,
   then the same command with `--check`. The host selects the Skill root, the profile format and
   directory, and the hook configuration the installer writes; `--agents-root` and `--host-root`
   override those defaults. The installer verifies content and file mode, so step 2's cache must
   actually be immutable or `--check` reports a Skill mismatch for every agent;
4. after hook content changes, review the exact installed user `SessionStart` command in the current
   agent's own hook configuration - `~/.codex/hooks.json` for Codex, `~/.claude/settings.json` for
   Claude Code - and trust only that command. The command names the host it was installed for. An
   agent host the pinned installer does not support records this step as unavailable;
5. freeze implementation and delivery if the pin, install, hook trust, or check is unavailable or
   mismatched. A red `--check` freezes every agent equally. Proceeding anyway requires the user's
   explicit authorization for that exact delivery, and the unmet step must be named in the handoff.

Normal branches use the latest `origin/main` pin, not their historical copy. A dedicated pin-update PR
may use its candidate lock only after the referenced commit is merged to `qOeOp/pareto/main`. A branch
that still tracks `.agents/`, `.codex/`, or `.claude/` Skill or profile sources is outdated and must
absorb the migration from main before further work. This migration cannot retroactively govern a
worktree that has not absorbed it; treat such a worktree as unsafe rather than loading its
repository-local Skill.

Do not edit installed copies or add repository-local Skill/profile sources. Skill, profile, installer,
and eval changes go to `qOeOp/pareto` first; after merge, update only this repository's pin. The
project keeps `.agents/`, `.codex/`, and `.claude/` ignored.

After bootstrap, non-trivial implementation or delivery must use `$run-bounded-mission`. Answer-only,
explain/audit/diagnose-only, mechanical edits, routine status, and task management do not auto-trigger
it. Skill activation does not itself authorize a new task or an external effect.
