"""The declared command line, the one entry Agents use: `python -m cli.main <noun> <verb> [options]`.

Every command opens at most one ledger connection, prints one JSON result on standard output and
exits 0; a refusal prints {code, message, missing, expected, next_actions, write_status,
operation_id} on standard error and exits 1. The commands hold no product logic: each parses its
arguments, calls the package function the design names and passes its result or refusal through.

The design page design-code-cli is the specification; a design id `cli.<name>` is the function
`<name>` of the module the design names (`cli.main`, `cli.replay`).
"""
