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

`s1` is the exception to all of this: every other program here was grown to drive a catalog rule,
so all of them are wider than the bounded family a first production path is admitted for. `s1` is
built to be minimal instead - one declared channel against one threshold, no state cell, no
cross-tick carry. With a single channel there is no choice of decision clock to make, so the clock
is that role and an Owner assembling this invents nothing.

Three things it measured that a minimal program runs into:

- a bound is a capacity and every capacity must be non-zero, so a program with no state cell still
  declares room for one; zero is not expressible;
- a declared constant no node or terminal consumes is refused, exactly as an unconsumed input role
  is, so the template's state seed had to be dropped along with the state cell;
- edges count terminal references, so this graph's two bindings sit inside an edge count of
  twenty-five. A minimal program does not get small bounds; the decision table sets the floor.

**Do not copy `s1`'s protection constants as the family's values.** It carries
`kernel.protection.replace.v1` with a stop loss of 90, a take profit of 120, trailing 5 and 95,
and a reconciliation of 1, and every one of those is inherited from the fixture template rather
than chosen. The family is a single channel against a single threshold, which carries no judgement
about protection at all, so its defining values are `kernel.protection.keep.v1` with zeros; an
assembler that emitted 90 and 120 would be inventing a judgement nobody declared. `s1` exists to be
a hand-written program that reassembles, not to show the family's normative values.

For the same reason `s1` names two target-variant constants that carry the same semantic id. That
keeps the branch and the default frame from ever sharing one constant, which is the shape that once
left four programs with a correct entry and a wrong exit, but it is a structural separation rather
than a semantic one. The family requires only that the two frames differ, which they do.

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
