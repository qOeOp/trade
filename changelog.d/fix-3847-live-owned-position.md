- Live: a strategy source's own `owned_position` method is no longer shadowed by the runner's ownership check in
  Live, so Live calls the source's method as replay and Paper do; the runner keeps no public name beyond Nautilus's.
