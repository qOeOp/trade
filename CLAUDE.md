# Repository Instructions (Claude Code host)

@AGENTS.md carries the repository authority; read it first and follow it. This file adds only the
deltas that exist because the host is Claude Code instead of Codex. Where the two disagree on a
repository rule, AGENTS.md wins; this file governs only host mechanics.

## Skill discovery on this host

Claude Code discovers Skills under `~/.claude/skills`, project `.claude/skills`, and plugins. It does
not scan `~/.agents/skills`, so the AGENTS.md bootstrap alone leaves `run-bounded-mission`
undiscoverable here. The installation chain on this host extends the bootstrap by one mirror step:

1. AGENTS.md bootstrap steps 1-3 install and verify `~/.agents/skills/run-bounded-mission` against the
   `origin/main` `codex-skills.lock.json` pin;
2. mirror that verified copy byte for byte, without editing it:

   ```bash
   cp -R ~/.agents/skills/run-bounded-mission ~/.claude/skills/run-bounded-mission
   ```

3. before any non-trivial implementation or delivery, and after every pin change, prove the mirror:

   ```bash
   diff -rq ~/.agents/skills/run-bounded-mission ~/.claude/skills/run-bounded-mission
   ```

A missing, mismatched, or unverifiable mirror freezes implementation and delivery exactly as a failed
bootstrap check does. The mirror is a copy under pin custody, not a source: Skill content changes
still go to `qOeOp/pareto` first, then to this repository's pin, then through steps 1-3 again.

AGENTS.md bootstrap step 4 trusts an installed Codex `SessionStart` hook. That hook is a Codex host
capability; `qOeOp/pareto` installs no Claude-side hook and no Claude-side behavior depends on one, so
its absence here is an unavailable capability that freezes nothing. The step 3 mirror proof is this
host's equivalent check.

## Invoking the Skill

`$run-bounded-mission` is Codex invocation syntax. On this host, invoke it as `/run-bounded-mission`,
through the Skill tool, or by naming it affirmatively in a request; the `$`-prefixed form in AGENTS.md
and in the Skill's own description still reads as an affirmative invocation. The Skill's
`codex://threads/...` trigger clause cannot be satisfied here and never activates it.

## Agent lanes

The Skill's lane roles are Codex agent profiles under `~/.codex/agents/*.toml`. This host maps them to
user-level subagents:

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
