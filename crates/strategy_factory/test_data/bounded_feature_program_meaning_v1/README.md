# Declared Bounded Feature Program meaning: ten authored programs

Ten declarations of `BoundedFeatureProgramMeaningV1`, with the six Strategy Designs they name.
`every_authored_declaration_reassembles`, in `src/bounded_feature_program_derivation_v1.rs`, reads
them: each one is assembled by `derive_bounded_feature_program_proposal_v1` against the newest
published catalog, exactly as `declare` does, and the assembled proposal is then put through
`prepare_bounded_feature_program_v1`.

`derivation_reproduces_a_known_good_proposal` next to it proves the same claim once, against a
proposal this crate builds itself. These ten were written outside it, as declared meaning only.
Between them they reach every availability rule, every state sizing rule and every input rule the
catalog has, which is the part one fixture cannot carry: a derivation that mishandled a single rule
would still reproduce a proposal that never used it.

`a0` and `a0v3` share one Design and differ only in reaching for the square root catalog version 3
added. `t4`/`t5` and `t7`/`t8`/`t9` likewise share a Design, which is why there are six Designs and
ten meanings.

## Regenerating

```
./generator/install.sh
```

It regenerates into `generator/out/`, installs the sixteen files here, and leaves `git status`
showing exactly what moved. Nothing in CI runs it.

Every program is grown from the Design and proposal in `generator/templates/`, which is why they
are committed rather than read from a temporary directory: reading them from `/tmp` made
regeneration succeed only on the one machine that still had them, and the check that regeneration
reproduces the corpus could never have caught that, because it runs where those files exist.

**Fix the generator, never a file here.** Four of these programs once carried a defect the
generator had already fixed behind a flag only the later three passed: their entry branch and their
exit branch shared one target-variant constant, so the entry branch read correctly while the exit
branch and the default frame were both wrong. Derivation does not look at the graph, so all four
kept assembling, and the defect survived until something prepared them. A correction applied here
instead of in `generator/programs.py` comes back the next time anyone regenerates.

## What these files are not

The Designs carry plugin manifest and source digests that no production writer produced; they are
shaped to canonicalize, not sampled from anything. That is enough for what the test asserts, because
it checks each derived identity, digest and bound against the Design, the catalog and the manifest
rather than against a value stored here. It is not enough to make any digest here a reference value.
