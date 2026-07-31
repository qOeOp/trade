# contracts/strategy-policy

## Type

contract module

## Owns

- Strategy markdown frontmatter parsing for lightweight policy metadata.
- Strategy directory reads from an explicit directory.
- Optional JSON config file reads from an explicit path.

## Inputs

- Strategy markdown files.
- Explicit strategy directory path.
- Explicit JSON file path.

## Outputs

- `StrategyPolicy` metadata records with body text.
- Parsed frontmatter records.
- Parsed JSON records, or `{}` when an optional JSON file is absent.

## Boundaries

- Does not compile or lint the full `## Trade Contract`; that belongs to `contracts/strategy-contract`.
- Does not discover fallback strategy directories.
- Does not read exchange state, research artifacts, trade state, or write any files.
