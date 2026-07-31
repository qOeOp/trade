# contracts/catalog-contract

## Type

contract module

## Owns

- Shared catalog client shell used by modules that must not import artifact-catalog DB implementation.
- Stable catalog command payload mapping.

## Inputs

- Catalog DB path.
- Artifact refs.
- Strategy evidence records.
- Strategy R&D run records.

## Outputs

- Artifact registration result.
- Strategy evidence rows.
- Strategy R&D run rows.

## Boundaries

- Does not own catalog schema or DB implementation.
- Does not scan, garbage-collect, or mutate files directly.
- Delegates catalog writes to `ops/artifact-catalog` CLI.
