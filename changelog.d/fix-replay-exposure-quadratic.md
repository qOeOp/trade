- Replay, Paper and Live (doctor 20261121-02): the entry exposure rule reads only the strategy's unclosed orders on
  the contract instead of building every order the run ever sent, so a replay's time no longer grows with the square
  of its orders. A one-contract replay with about 1,400 plans a month took 525 s natively over ten months and 6.6 s
  over one; the rule's verdicts are unchanged.
