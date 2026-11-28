# Perspectives

A full audit exercises each line, recorded with `doctor.py run DIR ITEM OBJECT:SCENARIO`; brackets name the scenarios
that must run at least (`any`: one of the pass's choosing); today's product may have more. Data that starts and ends together, one mode and the idle or
successful state alone leave an object unexamined: take the tracks that start apart, the modes that differ, what is
running, cut short and at a limit.

## Correctness

- **results** [any]: one number against an outside original, a conservation sum, or an input made so its answer is known.
- **flow** [single pool]: research end to end on a temporary ledger and market, `line select` to
  `line close`, then Paper and `paper compare`, then Live's research-side refusals, short windows,
  no credential and no run.
- **parity** [any]: one market history through replay, Paper and Live's adapter fakes.
- **research** [any]: noise, a true edge and a leaking strategy through the tests and verdicts; each
  line's history read through the product's read commands, never ad hoc SQL.
- **gates** [empty failed partial]: every admission, eligibility and refusal with a state never
  started, failed or cut short; a stated reason is tested, not trusted, and a good case must pass.

## Failure

- **faults** [live docker]: fault fixtures (live loopback, fake Docker).
- **interrupt** [any]: a many-step operation stopped after each step and resumed, on fakes that,
  like the real thing, do not give back what the stopped step had consumed.
- **operation** [any]: what an operator learns, and when, as a service degrades or a disk fills.
- **logs** [any]: each deployed service's own log since the last audit (where `deploy/remote/README.md`'s Logs and the
  local compose say): restarts, kills, and errors or warnings that repeat or grow, each traced to the code that
  wrote it. A finding names a line's kind, count and time, never a Live or Paper record.
- **lifecycle** [any]: first install, upgrade, idle, moving host, on copies.

## Contracts

- **consumers** [ledger report cli ide]: one state through every reader; no stored column
  without a reader.
- **words** [any]: a document or help followed literally; published pages against the code they name.

## Scale

- **storage** [any]: backup restore and ledger rebuild on copies; growth per unit of use.
- **cost** [replay import reports ledger]: each long path at three or more sizes (`doctor.py cost`).

## Outside

- **external** [any]: what outside parties say now against what the product keeps or assumes,
  including terms and licences (legal questions go to the user).
- **security** [any]: what each process may reach, dependencies; no credential is read.

## Shape

- **structure** [any]: layers, cycles, native capability rebuilt, one change that touches many places.
- **size** [any]: net lines by area and type of change since the last audit, attributed to feature,
  guard, patch on patch, residue or bypass; counts alone show nothing: each patch on patch or residue named
  ends in a `remove` issue or the use that keeps it. A removal claim is a removal run
  ([slim.md](slim.md)).
- **value** [any]: what nobody uses, what the user asked for and never got; from use counts and their words.
- **governance** [any]: rules nothing enforces, copies that disagree, rules whose reason has gone.

## Use

- **pages** [empty records offline reload]: each IDE page in a real browser on its own
  `ide/ide.py serve`, never the user's; the artifact is the drawn text. A wrong address can silently
  draw the first page with status 200, so check which page was drawn; judge at realistic density.
- **usability** [any]: keyboard, contrast, narrow screens, and a reader without context deciding
  from what is shown.
- **agents** [any]: from transcripts, skills that did not fire, reports that claim more than was done,
  duplicated work.
- **burden** [any]: what the user was asked, made to decode or wait for.
- **delivery** [any]: what CI, release and merge cost and where they waited, failed or were
  repeated (GitHub's own records).

## Audit

- **checks** [any]: whether a test, eval or CI gate fails for a wrong product and passes a right one.
- **unchanged** [any]: an object the last audits' findings and the recent commits leave alone.
- **fixed** [any]: `doctor.py recheck` on closed issues (`no test`: their own probe, `--control-tree` the
  repair's parent) and the old rows linked in the header of `docs/plans/doctor/index.zh.md`.
- **self** [any]: what the user found first, rerun claims overturned, lenses that ran and found
  nothing for several audits (say so).
