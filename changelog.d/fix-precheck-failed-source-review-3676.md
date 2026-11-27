- Registration refuses a precheck citation (`SOURCE_PRECHECK_FAILED`) while the source has a failed review of any
  precheck on the same image that a later traded precheck has not resolved (`review_activity.resolved`), as line
  selection already does; before, a second precheck with a passed review let a source that failed causal review
  register and replay (#3676).
