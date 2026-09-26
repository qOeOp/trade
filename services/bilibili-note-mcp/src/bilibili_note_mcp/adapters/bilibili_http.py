from __future__ import annotations

from bilibili_note_mcp.application.errors import BilibiliNoteFailure

BILIBILI_BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)


def bilibili_browser_headers(*, referer: str) -> dict[str, str]:
    return {"User-Agent": BILIBILI_BROWSER_USER_AGENT, "Referer": referer}


def raise_named_envelope_refusal(code: int) -> None:
    """
    Raise the named cause for a Bilibili envelope code whose meaning is documented.

    Bilibili also refuses inside an HTTP 200, in the envelope's own `code`: -412 is its risk-control
    block and -403 its permission refusal. Any other code is left to the caller's own rejection.
    """
    if code == -412:
        raise BilibiliNoteFailure("RATE_LIMITED", "source_risk_control_blocked")
    if code == -403:
        raise BilibiliNoteFailure("ACCESS_DENIED", "source_access_forbidden")
