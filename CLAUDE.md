# Repository Instructions (Claude Code host)

@AGENTS.md carries the repository authority; read it first and follow it. This file adds only the
deltas that exist because the host is Claude Code instead of Codex. Where the two disagree on a
repository rule, AGENTS.md wins; this file governs only host mechanics.

## Skill discovery on this host

Claude Code discovers Skills under `~/.claude/skills`, project `.claude/skills`, and plugins. It does
not scan `~/.agents/skills`, so this host runs the AGENTS.md bootstrap with `--host claude`:

```bash
node scripts/install-codex.mjs --host claude --lock <origin-main-lock> --install-trade-session-hook
node scripts/install-codex.mjs --host claude --lock <origin-main-lock> --install-trade-session-hook --check
```

That installs the pinned Skill under `~/.claude/skills/run-bounded-mission`, the four lane profiles
under `~/.claude/agents/`, and the pin hook in `~/.claude/settings.json`, all from the same
`codex-skills.lock.json` pin the Codex host uses. The installed copies are under pin custody, not
sources: Skill or profile content changes still go to `qOeOp/pareto` first, then to this repository's
pin, then through the bootstrap again. No repository-local mirror, copy, or `~/.agents` step is
required here, and `--check` is this host's proof exactly as it is on Codex.

AGENTS.md bootstrap step 4 trusts the exact installed `SessionStart` command. On this host that
command lives in `~/.claude/settings.json` and names its host (`--host claude`). Claude Code ignores
`continue: false` on `SessionStart`, so the hook reports a failed pin, a drifted install, or a
project-scoped Skill or profile override as session context instead: treat that context as the freeze
it names, exactly as a red `--check` freezes Codex. `fork_turns` has no Claude Code counterpart, so no
`PreToolUse` hook is installed here and its absence is not a gap.

## Invoking the Skill

`$run-bounded-mission` is Codex invocation syntax. On this host, invoke it as `/run-bounded-mission`,
through the Skill tool, or by naming it affirmatively in a request; the `$`-prefixed form in AGENTS.md
and in the Skill's own description still reads as an affirmative invocation. The Skill's
`codex://threads/...` trigger clause cannot be satisfied here and never activates it.

## Agent lanes

The Skill's lane roles ship as one profile per host: `~/.codex/agents/*.toml` on Codex and
`~/.claude/agents/*.md` here, both installed and verified by the same pinned installer. The bootstrap
owns those files; do not hand-edit an installed profile. They bind these user-level subagents:

| Skill role           | Claude Code subagent | Tools                                 | Model  |
| -------------------- | -------------------- | ------------------------------------- | ------ |
| `mission_planner`    | `mission-planner`    | Read, Grep, Glob                      | opus   |
| `mission_researcher` | `mission-researcher` | Read, Grep, Glob, WebSearch, WebFetch | sonnet |
| `mission_evaluator`  | `mission-evaluator`  | Read, Grep, Glob, Bash                | opus   |
| `fast_builder`       | `fast-builder`       | Read, Write, Edit, Grep, Glob, Bash   | haiku  |

`explorer` maps to the built-in `Explore` subagent; `worker` has no dedicated profile on either host
and runs on the host default route. `fork_turns: none` has no Claude Code counterpart because a
subagent always starts from a fresh context; the requirement that the sole launch prompt carry the
complete lane packet is unchanged.

Claude Code has no per-subagent read-only sandbox. `mission-planner` and `mission-researcher` hold the
read-only boundary by tool grant; `mission-evaluator` holds Bash for Git reads and safe checks, so its
read-only boundary is prose-enforced. Treat an observed Git write from any of the three as a boundary
breach that invalidates that lane's evidence.

## Session mode

The Skill owns one conversation-scoped Mission and agent lanes; it has no second lifecycle model and no
peer-Task custody on any host. A request that needs an outcome with its own lifecycle - outliving this
conversation, with its own durable worktree, branch/PR, or effect custody - is not a Mission this Skill
can run. Request Admission returns `needs_user_alignment` or `not_admitted` for it; Claude Code's
subagents, background tasks, worktree isolation, and cloud sessions are host mechanisms you drive, not
substitutes the Skill may adopt on its own.
