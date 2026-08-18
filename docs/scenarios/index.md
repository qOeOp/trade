# End-to-end scenarios

Scenarios are observable product stories, not deployment modes or implementation recipes. Each story starts
from a declared entry, crosses explicit owner boundaries, ends in durable proof, and names the transitions
that must fail closed.

Each generated scenario projection lists disjoint **PRIMARY** and **SUPPORTING** relations. PRIMARY is the
business-outcome spine needed to tell the scenario in order. SUPPORTING is context, proof, safety, or read-model
flow and is mandatory when its declared path applies. Their union is the complete relation coverage for the
scenario page and Flow, so a relation may not be silently omitted or appear in both lists.

For a scenario such as Recovery that declares trigger branches, the top-level PRIMARY/SUPPORTING union is
aggregate page coverage, not a conjunction requiring every relation for every trigger. The executable required
path comes from each applicable trigger branch's own primary and supporting relations. Simultaneous causes may
combine their applicable branch memberships in one case, but no branch may manufacture or require evidence that
belongs only to another branch.
In Recovery, `runtime-risk-incident-fence` carries `runtime-incident-fact` and
`execution-risk-drift-fence` carries `reconciliation-drift-fact` to Risk. Risk is the sole Recovery Fence writer;
either source-only branch can create or join the same Recovery Case type after its own admission, while
simultaneous admitted branches join one case without merging their facts.

| Scenario                | Entry                                                                     | Required proof                                            |
| ----------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| [Overview](./overview/) | Falsifiable idea                                                          | Committed owner facts across the closed product loop      |
| [Research](./research/) | Sourced hypothesis                                                        | Frozen Research Intent and Strategy Artifact              |
| [Backtest](./backtest/) | Frozen artifact and evidence pack                                         | Intake receipt plus branch‑specific proof                 |
| [Scan](./scan/)         | Scheduled tick                                                            | Auditable proposal or recorded no‑proposal reason         |
| [Paper](./paper/)       | Governed active strategy in paper mode                                    | Reconciled simulated effects and settled reservation      |
| [Live](./live/)         | Governed active strategy in live mode                                     | Authoritative venue readback and reconciled account state |
| [Recovery](./recovery/) | Readiness loss, Runtime incident, reconciliation drift, or Risk hard stop | `RecoveryCase.KNOWN_CLOSED`                               |

Paper and live share the same automated control chain and differ only at the Execution adapter. Recovery is
a separate no-add-risk path and cannot reuse an ordinary trade intent.
