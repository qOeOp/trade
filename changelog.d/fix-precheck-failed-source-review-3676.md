- Registration refuses a precheck citation (`SOURCE_PRECHECK_FAILED`) while the source has a failed review of any
  precheck, on any runtime image, that a later traded precheck on that image has not resolved
  (`review_activity.resolved`); before, a second precheck with a passed review let a source that failed causal review
  register and replay (#3676), and a failure on another image did not count (#3815). A run's evidence reads the same
  way (`SOURCE_REVIEW_FAILED` for a failed review on any image; a passed review counts only on the run's image), and a
  rebuild retry on a new image is refused while a review on the old image failed. Line selection likewise
  resolves an activity failure only by a traded pass on its own image.
