- Paper stream: a `readings` event carries the equity path only from `equity_from` on (the points the stream has not
  sent, or from the first one a late funding settlement changed) instead of the whole path every minute; a three-day
  run sent about 145 KB a minute, now under 100 bytes. The page keeps the path it holds before `equity_from`.
