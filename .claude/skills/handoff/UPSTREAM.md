# Upstream and local integration

- Source: https://github.com/cskwork/agent-handoff/tree/76c33262553daf72bc4ffec8828d8ac5c2571e04/handoff
- Revision: `76c33262553daf72bc4ffec8828d8ac5c2571e04`
- License: MIT; the upstream repository license is retained in `LICENSE`.
- Installed in `.claude/skills/handoff` for project-scoped Claude Code discovery. No user-level settings or hooks were installed.
- Local changes: the two illustrative example project paths use `./acme-api` instead of a fictional home directory. All other upstream skill files are unchanged.

For Trade handoffs, use repository-relative paths in committed documents. Locate external Dolt configuration with `TRADE_RECORDS_CONFIG` and sealed results with `TRADE_RESEARCH_ARTIFACT_ROOT`; confirm their host-specific locations separately. Do not copy databases, strategy source, credentials, or sealed research outputs into a handoff. Read the root `AGENTS.md` and relevant directory instructions before continuing product work. A handoff records task context; it does not expand authorization or override the latest user instruction.
