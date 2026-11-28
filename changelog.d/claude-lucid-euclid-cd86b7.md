- A Web release asks GitHub for `deploy-ready` eligibility once inside each Live barrier instead of also just before
  it (two fewer fetches per release); a withdrawal is refused at the same points as before.
