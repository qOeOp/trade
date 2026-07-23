# Forward Evidence Contracts

Owns admission and result contracts for post-freeze evidence sessions.

Forward admission requires a ready Draft Strategy binding、an immutable certified-source binding admitted by the Research owner、a Control Plane reservation、a strict freeze timestamp、a data watermark and a Replay request bound to the same Candidate and policy hash. The source binding joins the exact Registry candidate、Ops certification manifest、candidate commit and archive while explicitly carrying no deployment、promotion or trading authority.

A caller-supplied Draft alone is insufficient. `ForwardAdmissionRequest v3` rejects Draft/source/hash/revision drift before Replay.
