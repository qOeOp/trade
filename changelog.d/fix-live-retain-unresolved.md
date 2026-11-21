- Live entries whose submission Binance's answer did not settle (doctor 20261114-29, delegated decision): rc7 keeps
  the order SUBMITTED (`RETAIN_UNRESOLVED`) instead of judging it rejected after about 30 s; the run asks Binance for it
  every 10 s and closes entries as `unverified` until it is settled, so an order Binance filled settles to its own fill
  and gets its stop. One still unsettled after 120 s fails the run through the STOP path (`submission_unresolved`) and
  the run ends `unresolved`. rc7 takes a 429 on an order as such an answer too: a run whose entry meets one now ends
  `unresolved` within about 150 s instead of a clean stop after about 30 s.
