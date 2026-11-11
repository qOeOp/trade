"""The declared command line, the one entry Agents use: `python -m cli.main <noun> <verb> [options]`.

Every command opens at most one ledger connection, prints one JSON result on standard output and
exits 0; a refusal prints {code, message, missing, expected, next_actions, write_status,
operation_id} on standard error and exits 1. The commands hold no product logic: each parses its
arguments, calls the package function the design names and passes its result or refusal through.

The research-chain chapters state the rules; `cli.<name>` in them is the function `<name>` of
`cli.main` or of the command group module that owns its noun (`cli.<group>_commands`).
"""
