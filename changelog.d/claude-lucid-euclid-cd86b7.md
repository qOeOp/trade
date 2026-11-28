- A Web release asks GitHub for `deploy-ready` eligibility once inside each Live barrier instead of also just before
  it (two fewer fetches per release). A withdrawal met while Live turns busy at the final admission now rolls back as
  a wait (no failed marker) instead of a failure; the next tick does not choose a withdrawn record.
