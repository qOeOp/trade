"""The release tick's failure notices: what fails outside Live, sent from the host to the chat the Live page bound."""

import contextlib
from datetime import UTC, datetime
import json
from pathlib import Path
import re
import sys
import time

from .live_configuration import ROOT
from .release_host import FOLLOWERS, durable_json
from .telegram import Failure, settings, telegram


# What a notice may quote from a probe: a Paper run's candidate and its refusal code.
NOTICE_TEXT = re.compile(r"[A-Za-z0-9_.@:-]{1,80}\Z")
# What it may quote from the last output of market-import's health check (market/follow.py check), the one check
# that prints only its own reason: words, numbers, kinds and scopes.
HEALTH_TEXT = re.compile(r"[A-Za-z0-9_.@:+/(),; -]{1,300}\Z")
QUOTED_HEALTH = frozenset({"market-import"})
# A sealed Paper run that ended by itself is noticed for a day after its end: older ends were sealed before this
# notice existed or were already noticed, and the seal keeps each one's reasons.
ENDED_NS = 86400 * 10**9
ASKED = frozenset({"STOP_FILE", "DURATION"})  # the user's Stop, and the duration the user set at its start
LEDGER_LAG_SECONDS = 1800  # the ledger service retries a publish every 5 minutes: six retries have failed
# What the routed Web serves beside its own pages, each read through the router every tick (doctor 20261116-03).
WEB_HEALTH = (("/api/overview/health", "The Market overview"), ("/api/agent/health", "The Agent"),
              ("/api/paper/health", "The Paper controller"))
# What an unhealthy compose service's own health check says (deploy/compose.yaml).
UNHEALTHY = {"ledger": "its check cannot read the research ledger",
             "market-import": "an import is stopped or lagging, or its status is a day old"}


class Notices:
    """Failures outside Live, sent to the chat the Live page bound (deploy/telegram.py): a release tick that failed;
    an admitted version that waits for the host (deploy/release.py Release.waits); a routed Web that does not
    answer, or whose overview, Agent or Paper controller is not healthy behind it; a ledger or market-import
    container that is unhealthy, was killed out of memory or restarted; a Paper run that stopped and could not
    resume, or that is held with a position no working stop protects (paper.serve unprotected) or that ended by
    itself (a refusal, a runner exit, a stop the user did not ask for); a research ledger whose publish has failed
    for LEDGER_LAG_SECONDS or whose origin history changed elsewhere; a compose service that does not follow the
    active version (deploy/services.py `drift`); and, once per version, the routed version against its admitted
    record (deploy/services.py `settled`).

    Each kind the tick observed replaces that kind's facts; one it could not observe keeps what was sent. A fact
    is sent when it first appears and again only after it has cleared. Without a saved token nothing is sent
    and nothing is marked sent. Sending never raises into the tick. Each new fact's text is also printed with its
    outcome to the tick's log (`journalctl -u trade-release.service`), since notices.json keeps only the keys.
    """

    def __init__(self, state: Path, call=telegram, log=lambda line: print(line, flush=True), now=time.time_ns):
        self.state, self.call, self.log, self.now = state, call, log, now
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
                    output = found.get("output")
                    said = output.strip() if service in QUOTED_HEALTH and isinstance(output, str) else ""
                    services[f"service:{service}:unhealthy"] = (
                        f"The {service} service reports unhealthy: {UNHEALTHY[service]}"
                        + (f" (its check: {said})." if HEALTH_TEXT.fullmatch(said) else "."))
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
                stop, stopped, reasons = run.get("stop_reason"), run.get("stopped_ns"), run.get("reasons") or []
                if (run.get("state") == "sealed" and type(stopped) is int and self.now() - stopped <= ENDED_NS
                        and stop not in ASKED and "START_FAILED" not in reasons):
                    stop = stop if isinstance(stop, str) and NOTICE_TEXT.fullmatch(stop) else \
                        "no_summary" if stop is None else "other"
                    shown = [reason for reason in reasons if isinstance(reason, str) and NOTICE_TEXT.fullmatch(reason)]
                    paper[f"paper:{paper_id}:ended:{stop}"] = (
                        f"Paper run {paper_id}{named} ended by itself: {stop}. It is sealed with its journal and "
                        f"runner log ({', '.join(shown[:8]) or 'no reasons'}); see the Paper page.")
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
        with contextlib.suppress(Exception):  # unknown this tick: what was sent stays sent
            self.observe("drift", read())

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
        waiting = None  # a failure worth retrying: it and every later fact wait for the next tick, in order
        for kind, key, text in new:
            if found is None:
                outcome = "not sent: no Telegram chat saved"
            elif waiting is not None:
                outcome = f"not sent ({waiting}): retried next tick"
            else:
                token, chat = found
                try:
                    self.call(token, "sendMessage", {"chat_id": chat, "text": text[:4000]})
                    outcome = "sent"
                except Failure as error:
                    if error.status is None or not 400 <= error.status < 500 or error.status == 429:
                        waiting, outcome = error.code, f"not sent ({error.code}): retried next tick"
                    else:
                        outcome = f"refused by Telegram ({error.code})"
                if waiting is None:
                    sent[kind].add(key)  # delivered, or refused by Telegram: retrying cannot deliver it
            moment = datetime.now(UTC).isoformat(timespec="seconds")
            self.log(f"Notice {moment} {kind} {key} {outcome}: {json.dumps(text, ensure_ascii=False)}")
        if {kind: sorted(keys) for kind, keys in sent.items()} != record:
            durable_json(path, {kind: sorted(keys) for kind, keys in sorted(sent.items())}, mode=0o600)
