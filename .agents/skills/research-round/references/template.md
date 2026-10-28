# Roots from templates and user sources

Read when transcribing a strategy-library template or a source the user gave into a root,
publishing the root and producing its first report.

## First batch

EMA crossover, Supertrend, Donchian/Turtle system 1, Turtle system 2, Channel BreakOut, Dual
Thrust, Keltner breakout, Bollinger Bands, RSI, Connors RSI(2), single-instrument time-series
momentum, Pivot Reversal. Each trades one instrument.

- For the first batch, transcribe only templates on the user-confirmed list above, unless the user
  explicitly approves a roster replacement. Later batches follow the scope below. One whose source cannot be verified waits with the reason and leaves a
  gap; never relax the source requirement or replace it automatically to fill the batch.
- The Agent discovers, verifies and nominates replacements, presenting the mechanism, primary
  source, parameter verification, replacement reason and unresolved questions. Keep originals and
  verification notes in existing evidence bundles; do not add a candidate table or scheduler.
  The user decides both roster replacement and use of the template, and may authorize both once.
  Within that authorization, continue transcription, publishing, precheck, independent review and
  the first replay through the existing process without asking for the same authority again.
- A root the Agent designs itself is not a template and needs no template authorization; it goes
  through the same precheck, independent review and registration.

## Later batches

- Cross-sectional momentum, pairs and funding carry are research directions, not admitted templates
  or a fixed second roster. Nominate concrete templates on demand under the source and user-authority
  rules above. Enable them individually after at least one first-batch template has completed the
  First report workflow below; neither all 12 first-batch templates nor all later directions must
  be ready. A user may authorize admission and use once, conditional on the required evidence.
- Before enabling a template, use the existing native precheck and independent review, with the
  smallest sufficient probe for unobserved behavior, to verify what it needs: cross-sectional
  selection, shared-capital allocation and old positions/orders on membership changes; for two-leg
  structures also verify one leg filling before the other, an unfilled leg and loss of eligibility.
  Multiple contracts running together, two independent replays or normal two-leg fills alone do not
  establish these behaviors. Probes never replace registration and the first formal replay;
  Nautilus still owns orders, fills, settlement and account state.
- Defer a template lacking required data, instrument support or native evidence. Perpetual inputs
  and a per-contract strategy instance do not establish spot support or two-leg coordination.
  Spot/perpetual carry waits for a verified spot data and execution path; never stand in a
  perpetual price or a separate replay for the spot leg.

## Transcription

- Locate every default parameter (lookbacks, multiples, thresholds, entry and exit conditions) in
  the primary source: page, section, equation number or page anchor. Enter the original as an
  evidence bundle first. The parameter-to-location table goes into the header and the publish
  description. If any parameter cannot be located, drop the template.
- Rewrite the rules and defaults from the source into one strategy file. Do not copy code that
  came with the source or any third-party code, and do not add stops, targets, filters,
  confirmation conditions or parameters the source does not have. What running needs and the
  source leaves open is an implementer choice: one line of reason each, marked `implementer` `default` in the
  header.
- The header starts with the source: DOI, arXiv id or URL with its version or date, and the
  source bundle name. Then the 27 duty lines in nine groups (the header template `candidate new` supplies), each with its
  source label; a rule carried to another market, timeframe or instrument is labelled `researcher`.
- A source the user gives goes through the same steps. A parameter it does not give is an
  implementer default, listed as such; never label it the source's own words in the header, notes
  or publish description, and do not drop the source for it. The source line names the user's
  source, the date it was given and its bundle.

## First report

- Choose the native precheck's smallest sufficient window and contract set for the technical
  behavior: a single-instrument defect may need one contract; allocation, membership transitions
  and two-leg exceptions need their relevant scenarios. Never choose a window for its return.
  Existing identity, exposure and independent-review requirements still apply. Report unobserved
  behavior as unverified; a passed short precheck is not the formal first report or proof of a
  larger scope. Do not introduce a separate pilot-first-report stage.
- The formal first report covers the selected line's full development window and chosen contract
  scope, locked in the registration's input identity: all of the pool when chosen, or the explicit
  subset when chosen, not a universal all-pool requirement. If environment, data or capacity blocks
  it, report the concrete blocker and affected scope; never silently drop contracts, shorten the
  window or substitute a short run. The user may choose bounded formal research through the
  existing line-selection and registration process. Its report applies only to that scope;
  expansion requires a new registration, and a different development window follows line selection.
  Never reuse an old registration or extrapolate the bounded result to the full pool.
  New registration is necessary, not guaranteed: existing prior-exposure and retry checks still
  apply. A passed bounded run is not a retry exemption for expanding the same source.
- Publish the root without a parent (`candidate publish`), precheck and review it. A repair
  before its first report is published again without `--parent` (the repair in the description),
  prechecked and reviewed again; the line starts at the revision whose review passed
  (`line select`). Register it as a root (no parent, no control, empty `changed_duties`) on the
  line's development window and replay that point once (`replay run`, purpose research): this run
  is its first report. An exploration never stands in for it. An invalid or interrupted replay
  consumes the point; another try is a new registration naming it in `retry_of`.
