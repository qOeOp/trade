"""The release tick's failure notices: what fails outside Live, sent from the host to the chat the Live page bound."""

import json
from pathlib import Path
import re
import sys

from .live_configuration import ROOT
from .release_host import FOLLOWERS, durable_json
from .telegram import Failure, settings, telegram


# What a notice may quote from a probe: a Paper run's candidate and its refusal code.
NOTICE_TEXT = re.compile(r"[A-Za-z0-9_.@:-]{1,80}\Z")
LEDGER_LAG_SECONDS = 1800  # the ledger service retries a publish every 5 minutes: six retries have failed
# What the routed Web serves beside its own pages, each read through the router every tick (doctor 20261116-03).
WEB_HEALTH = (("/api/overview/health", "The Market overview"), ("/api/agent/health", "The Agent"),
              ("/api/paper/health", "The Paper controller"))
# What an unhealthy compose service's own health check says (deploy/compose.yaml).
UNHEALTHY = {"ledger": "its check cannot read the research ledger",
             "market-import": "an import is stopped or lagging, or its status is a day old"}


class Notices:
    """Failures outside Live, sent to the chat the Live page bound (deploy/telegram.py): a release tick that
    failed; a routed Web that does not answer, or whose overview, Agent or Paper controller is not healthy behind
    it; a ledger or market-import container that is unhealthy, was killed out of memory or restarted; a Paper run
    that stopped and could not resume, or that is held with a position no working stop protects (paper.serve
    unprotected); a research ledger whose publish has failed for LEDGER_LAG_SECONDS or whose origin history changed
    elsewhere; and a host checkout or docker-api that does not follow the active version
    (deploy/release.py `drift`).

    Each kind the tick observed replaces that kind's facts; one it could not observe keeps what was sent. A fact
    is sent when it first appears and again only after it has cleared. Without a saved token nothing is sent
    and nothing is marked sent. Sending never raises into the tick.
    """

    def __init__(self, state: Path, call=telegram):
        self.state, self.call = state, call
        self.found: dict[str, dict[str, str]] = {}

    def observe(self, kind: str, facts: dict[str, str]) -> None:
        self.found[kind] = facts

    def released(self, summary: str | None) -> None:
        """The tick's outcome: None when it succeeded, else its failure_summary (deploy/release.py)."""
        self.observe("release", {} if summary is None else {
            f"release:{summary}": f"Release tick failed on the host: {summary}. Web and the Paper controller "
                                  "each stay on the route they last committed; see journalctl -u "
                                  "trade-release.service."})

    def watch(self, probe, condition) -> None:
        """Read the routed Web's health, then Paper runs and the ledger's publication from the active Web, and the
        compose services' containers. `probe(path, routed=False)` is the active Web's facts at `path`, read through
        the router when `routed`; `condition(container)` is DockerHost.condition."""
        failing = {}
        for path, name in WEB_HEALTH:
            try:
                value = probe(path, routed=True)
                healthy = value["status"] == 200 and bool(value.get("ok", True))
            except Exception:
                healthy = False  # a Web that does not answer is the fact, not an unknown
            if not healthy:
                failing[f"web:{path}"] = (f"{name} does not answer healthy through the routed Web ({path}); its "
                                          "part of the IDE is unavailable.")
        if len(failing) == len(WEB_HEALTH):
            failing = {"web:unreachable": "The routed Web does not answer on the host: its overview, Agent and "
                                          "Paper health probes all fail, so the IDE is unavailable. See docker ps "
                                          "and the active Web container's log."}
        self.observe("web", failing)
        try:
            services = {}
            for service, container, _ in FOLLOWERS:
                found = condition(container)
                if found is None:
                    continue  # not deployed on this host
                if found["health"] == "unhealthy":
                    services[f"service:{service}:unhealthy"] = (
                        f"The {service} service reports unhealthy: {UNHEALTHY[service]}.")
                if found["oom"] is True:
                    services[f"service:{service}:oom"] = (
                        f"The {service} container was killed out of memory at its last exit.")
                restarts = found["restarts"]
                if type(restarts) is int and restarts > 0:
                    step = 1 << (restarts.bit_length() - 1)  # 1, 2, 4, ...: a restart loop is not sent every tick
                    services[f"service:{service}:restarted:{step}"] = (
                        f"The {service} container has restarted {restarts} times since it was created; the next "
                        f"notice comes at {2 * step}.")
            self.observe("services", services)
        except Exception:
            pass  # unknown this tick: what was sent stays sent
        try:
            paper = {}
            for run in probe("/api/paper/runs")["runs"]:
                candidate, paper_id = run.get("candidate"), int(run["id"])
                named = f" ({candidate})" if isinstance(candidate, str) and NOTICE_TEXT.fullmatch(candidate) else ""
                code = run.get("recovery")
                if code is not None:
                    code = code if isinstance(code, str) and NOTICE_TEXT.fullmatch(code) else "other"
                    paper[f"paper:{paper_id}:{code}"] = (
                        f"Paper run {paper_id}{named} stopped and could not resume: {code}. It stays stopped "
                        "with its account and originals; see the Paper page.")
                for position in run.get("unprotected") or ():
                    # Held after an interruption with no working stop: kept held, named at once (user 2026-11-17).
                    position = position if isinstance(position, str) and NOTICE_TEXT.fullmatch(position) else "other"
                    paper[f"paper:{paper_id}:unprotected:{position}"] = (
                        f"Paper run {paper_id}{named} is held after an interruption and its position {position} has "
                        "no working stop. It stays held until its other orders or a stop close it; see the Paper page.")
            self.observe("paper", paper)
        except Exception:
            pass  # unknown this tick: what was sent stays sent
        try:
            ledger = probe("/api/about")["ledger"]
            if isinstance(ledger, dict):
                behind = ledger.get("behind_seconds")
                if ledger.get("diverged") is True:
                    facts = {"ledger:diverged": "The research ledger's origin history changed elsewhere; a "
                                                "publish retry cannot settle it. New writes stay unpublished."}
                elif ledger.get("unpublished") is True and type(behind) is int and behind >= LEDGER_LAG_SECONDS:
                    facts = {"ledger:behind": f"The research ledger has not been published for {behind // 60} "
                                              "minutes: its publish keeps failing (publish_failed)."}
                else:
                    facts = {}
                self.observe("ledger", facts)
        except Exception:
            pass

    def drifted(self, read) -> None:
        """What on the host does not follow the active version: `read()` is `drift`'s facts."""
        try:
            self.observe("drift", read())
        except Exception:
            pass  # unknown this tick: what was sent stays sent

    def send(self) -> None:
        try:
            self._send()
        except Exception as error:  # the type only: a payload could carry what a file held
            print(f"Failure notices not sent: {type(error).__name__}", file=sys.stderr, flush=True)

    def _token(self) -> tuple[str, int] | None:
        return settings(self.state / ROOT / "notify")  # None until a Live page saves one

    def _send(self) -> None:
        path = self.state / "notices.json"
        record = json.loads(path.read_text()) if path.exists() else {}
        sent = {kind: set(keys) for kind, keys in record.items()}
        for kind, facts in self.found.items():
            sent[kind] = sent.get(kind, set()) & set(facts)  # a cleared fact may be sent again
        new = [(kind, key, text) for kind, facts in self.found.items()
               for key, text in facts.items() if key not in sent[kind]]
        found = self._token() if new else None
        if found is not None:
            token, chat = found
            for kind, key, text in new:
                try:
                    self.call(token, "sendMessage", {"chat_id": chat, "text": text[:4000]})
                except Failure as error:
                    print(f"Failure notice not sent: {error.code}", file=sys.stderr, flush=True)
                    if error.status is None or not 400 <= error.status < 500 or error.status == 429:
                        break  # the next tick retries, in order
                sent[kind].add(key)  # delivered, or refused by Telegram: retrying cannot deliver it
        if {kind: sorted(keys) for kind, keys in sent.items()} != record:
            durable_json(path, {kind: sorted(keys) for kind, keys in sorted(sent.items())}, mode=0o600)
