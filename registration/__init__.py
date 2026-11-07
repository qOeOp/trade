"""Registration and admission: the registration body and its lock (register), comparability
(comparability), input identity (inputs), native prechecks and independent source reviews
(precheck), out-of-sample registration and binding (validation), and the strategy duties with the
measure catalogue (duties), on top of the research ledger (`ledger`).

The research-chain chapters state the rules; `registration.<name>` in them is the function
`<name>` in this package. Dependencies on later phases (runtime images, market export,
qualification) go through `registration.seams`.
"""
