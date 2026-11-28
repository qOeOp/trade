- Registration: `retry_of` must name a registration that consumed a grid source of the new one, or one testing the
  same change (the same published parent and difference; for a root, the same strategy_id) with a retryable trial;
  otherwise `RETRY_NOT_ALLOWED`, before the interpretation gate. An unrelated candidate can no longer name a failed
  registration to skip `INTERPRETATION_REQUIRED` for its invalid run (#3662).
