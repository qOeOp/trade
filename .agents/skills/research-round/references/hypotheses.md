# Hypothesis registration

`hypothesis register` stores a validated, immutable `research-plan.json` evidence bundle. Study sources first,
publish all grid revisions, then complete their native engineering prechecks before registration. Their parent and `difference` must equal the registration's `parent` and
`change`. A root has `parent: null` and `control_run: null`; a descendant names both independently.
A fault or zero-activity parent remains a source lineage for repair/reassessment. A repair may
set `control_run: null`; economics/comparison are then unavailable until a usable control exists.
The comparison control is an already audited comparable run, not necessarily the parent.

A plan has these required keys (`retry_of` names a previously consumed registration; `prechecks` is required for v7) (working JSON under `/tmp`):

```json
{"parent":"ID@1", "control_run":1,
 "change":"One actual rule change, identical to the published difference.",
 "rationale":"External basis with original location/conditions and support role; fixed-run local diagnosis; Agent conjecture with falsifier and unproven transfer. State source search/reading limits.",
 "prediction":"Falsifiable observation and different resulting actions.",
 "sources":["retained-source-bundle"],
 "metric":"annual_return",
 "grid":[{"strategy":"ID@2", "parameters":"Complete fixed setting."}],
 "prechecks":{"ID@2":"EXACT-SOURCE-REVIEW-BUNDLE"},
 "conditions":"Source/parameter/input/window/runtime scope; repeated evidence limitations.",
 "comparison":{"method":"paired-circular-log-mean-v1", "block_days":7,
   "resamples":4999, "inner_resamples":199, "seed":20261013,
   "alpha":0.015, "minimum_effect":0.005,
   "design_reason":"Explain alpha/effect, error tradeoff, sample, dependence and detectable effect; these example numbers are not product constants."}}
```

The comparison method is implemented for annual-return evidence only. The p value tests mean daily
log difference <= 0; annual-return difference interval is a separate paired percentile reading.
Studentized log intervals, normal-approximate detectable effects and block sensitivity are supplied
with limitations. No result creates an adopted node. Non-return inferential designs remain undefined.

Grid length is one to five. Finish the locked grid, do not append points after seeing results.
A changed intent/source/grid is a new registration. The existing source notes hold originals and
hashes, not just links; conjectural mechanisms may be recorded explicitly instead of inventing papers.

Consumed cells, including interruption or invalid audit, are not executed again under the same
registration. A new retry registration must set `retry_of` to the earlier bundle that actually consumed this exact source, and identify the previous attempt in its conditions and sources; repeated same-condition evidence is not independent. A generic unregistered trial cannot
be backfilled into a registered result.


Before proposing the economic change, research relevant papers and credible practice with
research-sources; reuse applicable retained materials and search the mechanism gap. Sources may
hold a local diagnostic or explicit conjecture, so the product does not infer paper backing merely
from a nonempty sources list. Describe the three basis categories and support roles in rationale
and existing notes. No paper is an exploration-priority consideration, not a registration refusal.
Later materials are later evidence and cannot become prior support for this immutable plan.
