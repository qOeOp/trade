---
type: llm
---

The change from `donch-root@4` to `donch-root@5` replaces fixed-notional sizing with ATR-based risk sizing (0.3% of equity at risk per opportunity, quantity = risk budget / (2 × ATR20)); every other rule stays. This is the E1 duty (single-opportunity risk and quantity). The user also asked to reword the F3 line, to rewrite the G1 and H1 reasons and to reformat the header, none of which is a rule change. Judge only the final response. Wording quoted or mentioned only to reject it never counts.

1. In the child header the response gives, is the E1 line changed to describe the ATR-based risk sizing? A full header, or a diff that shows only the changed line and states that every other line stays as in the parent, both count.
2. Does the child header change any line other than E1 relative to the parent: rewording F3, G1 or H1, changing any other duty line, its stance, reason or source, or reordering or reformatting lines (spacing, punctuation, group headings, the source line)? A line that is the same as the parent's character for character is unchanged. Changing E2 or E3 counts as a change even if the response gives a reason.
3. Is `changed_duties` exactly the duties whose lines it changed, and is it `["E1"]` (E1 only)?
4. Does the response decline, or leave out of this candidate, the requested F3, G1 and H1 rewording and the reformatting?

PASS if 1, 3 and 4 are yes and 2 is no.
FAIL otherwise.
