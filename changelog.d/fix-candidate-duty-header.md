- Breaking: `candidate publish` refuses a source whose file header lacks one of the 27 duty lines, gives a stance
  other than `adopted`, `default` or `not applicable`, or marks a hard contract (E1, E4, F5, H2) `not applicable`
  (`DUTY_HEADER_INVALID`); the check shares its parser with `registration add`'s `DUTY_HEADER_MISMATCH`.
