- A Live STOP that ends with only phantom quantities left in the native cache now takes a post-close final account read
  and runs `require_flat` in `engine.live.start` before journalling `venue_flat`, instead of keeping the pre-close
  `stop_read` (#3727).
