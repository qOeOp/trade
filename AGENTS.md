# Repository Instructions

Prioritize clean architecture and the smallest implementation that closes the requested outcome.
Preserve unrelated work. Real trading or another production write requires explicit user authority.
Use the repository's current Makefile, pre-commit configuration, and CI workflows as check authority;
do not reconstruct a missing historical entrypoint. An Owner implementation is accepted when its
entries in the ordered Owner PostgreSQL chains pass on Linux CI - the `owner-chains` workflow on a
`test-chain/<lane>` push, or the chain jobs of `build` on `test-ci` or `main` - and a local pass is a
working state, not acceptance. The R&D chain's pass is its shard jobs together with the
`rd owner chain report` job, which fails unless every chain position was recorded exactly once: each
shard runs its entries in chain order on a cluster of its own, and an entry is ordered after exactly
the entries `scripts/ci/rd-owner-chain-needs.tsv` declares for it, a declaration that is measured,
never estimated. The daily 20:17 UTC `build` on `main` runs the chain serially instead, every entry
after every earlier one, as the standing check on those declarations; GitHub drops scheduled slots
without notice, so when no serial run has reached a verdict on `main` in 48 hours, dispatch one:
`gh workflow run build.yml --ref main -f rd-chain=serial`.

## Architecture and design records

The documentation records the project's current design, decisions, and intended user route. It is a
working design, not an infallible or final blueprint. Read it before implementation, but check its
claims against the current code, real consumers, and measurements. Neither an old document nor an
implementation by itself settles a conflict between them.

Implementation may reveal a better or necessary design. Within the requested outcome and the
authorization boundaries below, the agent decides the change and updates the documentation and
implementation in the same reviewable delivery. The delivery names the observation or measurement
that changed the design and shows how the resulting behavior was verified. Do not force code to fit
outdated text, silently let code supersede the design record, or reinterpret text to hide a mismatch.
An unverified target remains a target; documentation and a passing build alone do not establish a
working product path.

Three changes still require explicit user authorization before either the documentation or the
implementation moves:

- one that widens what may reach real money - real trading, another production write, or admitting a
  Paper or Live execution path;
- one that changes what this product is for, or the user route the documentation states;
- one that removes a stated refusal, seal, bound or invariant rather than relocating it or making it
  implementable. Relocating a property leaves it provable somewhere; removing it does not, and an
  agent cannot tell from inside one delivery what the removed property was protecting.

Everything else is the agent's to decide. Recording what the repository has reached, revising a
design as implementation teaches us more, and making a design implementable without weakening a
protected property need no separate authorization or documentation-only PR.

## Dashboard implementation status

The Dashboard documentation under `docs/guide/dashboard.md` and `docs/guide/dashboard.zh.md` is the
current route, component, geometry, and per-slice admission record for `product/dashboard`. Its
design details may change with implementation evidence under the rule above. The user has admitted
specific routes as `DRAWABLE_EXACT / IMPLEMENTATION_ADMITTED`.

Dashboard work is admitted only for a route or reusable atom that document marks
`IMPLEMENTATION_ADMITTED`, and only as the bounded, separately reviewable slice described there.
Everything below that gate stays blueprint-only and must not be developed, scaffolded, deployed, or
packaged; a route name, a navigation entry, or retained upstream source is not implementation
authority. `IMPLEMENTATION_ADMITTED` is permission to build and verify. It never proves that a backend,
Owner consumer, or effect path exists, and it never authorizes a production effect, an executor cutover,
or real trading. Widening the admitted set requires an explicit, reviewable update to those documents
as part of the bounded slice before the newly admitted surface is delivered; it does not require a
separate documentation-only PR. The authorization boundaries above still apply.

## Local API keys

An agent may use the following API keys from the local environment when an admitted repository task
requires them:

- `DEEPSEEK_API_KEY`
- `FIRECRAWL_API_KEY`
- `SILICONFLOW_API_KEY`
- `DATABENTO_API_KEY`
- `OPENAI_API_KEY`
- `OPENALEX_API_KEY`
- `SEMANTIC_SCHOLAR_API_KEY`
- `CORE_API_KEY`
- `FRED_API_KEY`
- `STACKEXCHANGE_KEY`
- `KAGGLE_API_TOKEN`

Exchange trading credentials such as `BINANCE_API_KEY` and `BINANCE_API_SECRET` are not on this list: an agent
never uses them, whatever the task.

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
