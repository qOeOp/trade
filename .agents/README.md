# Skills and evals

`.agents/` is the plugin root (manifest `.claude-plugin/plugin.json`): skills under `skills/`
(`.claude/skills` links here), their eval suites under `evals/<skill>/`, where the runner needs them.
Run suites from the repository root: `claude plugin eval .agents`.

Skill text is product code. Only a skill's frontmatter description loads into every session; its
body and references load when it triggers. A skill change restates or deletes what it supersedes,
states its net words, checks that what it names exists and is not said elsewhere, and runs the eval
cases it adds or changes; cases it makes wrong are fixed in their own PR. Runner votes are a coarse
read; to keep or delete a rule or case, re-judge stored answers per question, on stdin, with
`claude -p --model {sonnet,haiku} --setting-sources '' --tools ''`.
