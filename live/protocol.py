"""The browser's contract with a Live control, as one number.

A release may serve a newer Web beside the older control that keeps a busy account only while both declare
the same number (docs/plans/live-web-first-release-20261108.zh.md); the host reads this line as text from
each revision and never imports it. A control declaring a number also admits a routed `-pre` Web
(live/release.py SERVING).

Raise it when an older control of this number could not serve the newer browser: a write route or its exact
body fields change (an older control refuses them, and a refused Request stop is lost, not safe), the same
fields come to mean something else, or the browser needs an answer an older control does not give. Then
record the new number's baseline. tests/live/test_protocol.py and ide/web/scripts/liveProtocol.test.mjs hold
the code to it.
"""

PROTOCOL = 3
