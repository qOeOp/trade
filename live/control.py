"""Operator web commands over the existing Live custody and native lifecycle."""

from __future__ import annotations

import hashlib
from datetime import date, datetime
from pathlib import Path

from engine.live_errors import REFUSALS, LiveRefusal
from ledger import db
from live import authority, configuration, credentials, notify, release, requests, runs, state, views


MESSAGES = {
    "LIVE_RELEASE_UNAVAILABLE": "This Live control is not accepting new operations during release handover.",
    "LIVE_CONFIG": "Check the selected source and the supported run settings.",
    "LIVE_REQUEST_CONFLICT": "This request ID already belongs to a different operation.",
    "LIVE_REQUEST_UNRESOLVED": "A previous operation has an unknown outcome. Check that original request.",
    "LIVE_REQUEST_MISSING": "This request has not been recorded by Live.",
    "LIVE_REQUEST_CLOSED_UNCLAIMED": "This request ID was closed before acceptance and cannot be used again.",
    "LIVE_REQUEST_NOT_DISPATCHED": "The original runner was not dispatched. Existing resources still need their own checks.",
    "LIVE_CREDENTIAL_CHANGED": "The selected credential changed. Prepare a new run.",
    "LIVE_CREDENTIAL_BUSY": "An active or unresolved execution still requires its credential version.",
    "LIVE_CREDENTIAL_UNAVAILABLE": "The required local credential version is unavailable.",
    "LIVE_CREDENTIAL_UNMANAGED": "This historical run retains its original operator credential path.",
    "LIVE_ACCOUNT_OWNED": "Another Live execution is active or cannot yet be verified as resolved.",
    "LIVE_ACCOUNT_NOT_FLAT": "The account has existing positions or orders.",
    "LIVE_ACCOUNT_MODE": "The observed account settings do not match this Live configuration.",
    "LIVE_FUNDS": "Observed eligible USDT funds do not cover the configured run budget.",
    "LIVE_KEY_WITHDRAWAL": "This API key permits withdrawals and cannot start this Live run.",
    "LIVE_KEY_UNVERIFIED": "The API key permissions could not be verified.",
    "LIVE_CLOCK": "The observed server clock bounds exceed the existing Live limits.",
    "LIVE_RUN_FORMAT": "This historical run uses an earlier format. Prepare a new run for a new start.",
    "LIVE_IDENTITY_CHANGED": "The retained inputs, confirmation or resource identity do not match.",
    "LIVE_RESTART_REQUIRES_RECONCILIATION": "An attempted run cannot restart its strategy. Review the original execution.",
    "LIVE_NOTIFY_TOKEN": "Telegram did not accept this bot token. Copy it again from @BotFather.",
    "LIVE_NOTIFY_NO_CHAT": "No private chat has messaged this bot yet. Send it any message from Telegram, then save again.",
    "LIVE_NOTIFY_CHATS": "More than one private chat has messaged this bot. Create a new bot that only you message.",
    "LIVE_NOTIFY_TELEGRAM": "Telegram could not be reached or did not deliver. Try again later.",
    "LIVE_NOTIFY_UNCONFIGURED": "Save a Telegram bot token first.",
    "LIVE_NOTIFY_STORE": "The private notification settings are unavailable.",
    "LIVE_NOTIFY_BUSY": "Another Live control is sending notifications. Try again in a moment.",
}


def error(code: str, request_id: str | None = None) -> dict:
    known = code if code in REFUSALS else "LIVE_RECORD_UNAVAILABLE"
    body = {"ok": False, "error": {"code": known, "message": MESSAGES.get(
        known, "Live could not confirm this operation. Review the retained request and execution facts.")}}
    if isinstance(request_id, str) and requests.REQUEST_ID.fullmatch(request_id):
        body["request_id"] = request_id
    return body


def _profile(config: configuration.Configuration) -> db.LedgerProfile:
    return db.LedgerProfile.from_json(state.read(config.research_ledger))


def _prepare_claim(root: Path, run_id: str) -> dict:
    rows = runs._host_events(state.directory(root, run_id))
    prepared = next((row for row in rows if row.get("event") == "prepared"), None)
    claim = requests.read_locked(root, prepared["request_id"]) if prepared and prepared.get("request_id") else None
    if claim is None or requests.is_closed(claim) or claim["command"]["action"] != "prepare":
        raise state.fail("LIVE_RESEARCH_COMMIT", "the original managed preparation is unavailable")
    return claim


def _review(config: configuration.Configuration, root: Path, run_id: str) -> dict:
    claim = _prepare_claim(root, run_id)
    _, manifest = runs._manifest(root, run_id)
    result = runs.review(_profile(config), claim["command"]["inputs"]["research_at"], manifest)
    # The CLI serializer already formats these reader datetime values. Direct HTTP
    # reads need the same wire dates, without a general str(object) fallback.
    result["origin_candidate_validations"] = [
        {**row, **{name: row[name].isoformat() if isinstance(row.get(name), (date, datetime)) else row.get(name)
                   for name in ("window_start", "window_end")}}
        for row in result["origin_candidate_validations"]]
    return result


def run_view(config: configuration.Configuration, run_id: str, *, review: bool = True) -> dict:
    result = views.run_view(config.root, run_id)
    result["purpose"] = next((source.purpose for source in config.sources.values()
                              if source.source_sha256 == result["source"]["source_sha256"]
                              and source.entry_class == result["source"]["entry_class"]), None)
    if review:
        try:
            with state.reading(config.root) as root:
                result["review"] = _review(config, root, run_id)
            result["review_error"] = None
        except Exception as exc:
            result["review"] = None
            result["review_error"] = {"code": exc.code if isinstance(exc, LiveRefusal) else "LIVE_RESEARCH_COMMIT"}
    return result


def listing(config: configuration.Configuration, *, binding: release.Binding | None = None) -> dict:
    result = {"availability": "ready", "write_enabled": True, "write_reason": None, "maintenance_enabled": True,
              "sources": [source.view() for source in config.sources.values()],
              "defaults": config.defaults, "credentials": [], "runs": [], "notify": notify.view(config.root)}
    def availability() -> None:
        try:
            authority.retained(config, binding).admit_locked(config.root)
        except LiveRefusal as exc:
            result.update(write_enabled=False, write_reason=exc.code)
        try:
            authority.retained(config, binding).admit_locked(config.root, maintenance=True)
        except LiveRefusal:
            result["maintenance_enabled"] = False

    if not config.root.exists():
        availability()  # Pure derived display, never permission to perform a later effect.
        return result
    with state.reading(config.root) as root:
        availability()
        result["credentials"] = credentials.listing_locked(root)
        directory = root / "runs"
        if directory.is_symlink():
            raise state.fail("LIVE_RECORD_UNAVAILABLE", "the retained runs directory is unavailable")
        if directory.exists():
            ids = sorted(path.name for path in directory.iterdir())
            if any(not state.RUN_ID.fullmatch(run_id) for run_id in ids):
                raise state.fail("LIVE_RECORD_UNAVAILABLE", "the retained runs directory is incomplete")
            result["runs"] = [run_view(config, run_id, review=False) for run_id in ids]
    return result


def operator_preflight(root: Path, run_id: str, research: db.LedgerProfile, research_at: str,
                       candidate: str, symbols: list[str], universe_file: Path, credentials_file: Path,
                       runtime: str, *, scope: authority.Authority, **prepare_options) -> dict:
    """Original CLI preparation/review/launch sequence with one retained authority.

    Each existing mutation keeps its own admission and lock; review stays between
    them. No web request ID or receipt is fabricated for the operator protocol.
    """
    manifest = runs.prepare(root, run_id, research, research_at, candidate, symbols, universe_file,
                            credentials_file, runtime, scope=scope, **prepare_options)
    review = runs.review(research, research_at, manifest)
    result = runs.launch(root, run_id, credentials_file, "preflight", scope=scope)
    return {**result, "review": review}


def operator_start(root: Path, run_id: str, credentials_file: Path, confirm_real_orders: str, *,
                   scope: authority.Authority, strategy_file: Path | None = None,
                   strategy_class: str | None = None) -> dict:
    """Confirm and launch through the shared locked core, retaining both admissions."""
    runs.require_confirmed(root, run_id, confirm_real_orders, scope=scope)
    return runs.launch(root, run_id, credentials_file, "run", scope=scope,
                       strategy_file=strategy_file, strategy_class=strategy_class)


def operator_reconcile(root: Path, run_id: str, credentials_file: Path, *,
                       scope: authority.Authority) -> dict:
    return runs.launch(root, run_id, credentials_file, "reconcile", scope=scope)


def _fixed_prepare(config: configuration.Configuration, body: dict, scope: authority.Authority) -> dict:
    target = {"run_id": body["run_id"], "credential_ref": body["credential_ref"]}
    parameters = configuration.run_config(body["config"])
    # Read a previous declaration before consulting today's catalog. Deployment updates
    # must not reinterpret the source or research snapshot of an accepted request.
    with scope.serialized(config.root) as root:
        prior = requests.read_locked(root, body["request_id"])
        if prior:
            if requests.is_closed(prior):
                raise state.fail("LIVE_REQUEST_CLOSED_UNCLAIMED", "this request ID was closed before acceptance")
            command = prior["command"]
            original = command["inputs"]
            if (command["action"] != "prepare" or command["target"] != target
                    or original.get("source_id") != body["source_id"]
                    or any(original.get("config", {}).get(name) != value for name, value in parameters.items())):
                raise state.fail("LIVE_REQUEST_CONFLICT", "request-id already binds different preparation inputs")
            return command
    source = config.sources.get(body["source_id"])
    if source is None or not source.available():
        raise state.fail("LIVE_SOURCE_MISSING", "the configured source is unavailable")
    from engine.load import read_regular_file
    universe = read_regular_file(config.universe_file)
    return {"action": "prepare", "target": target, "inputs": {
        "source_id": source.source_id, "research_at": config.research_at, "candidate": source.candidate,
        "symbols": config.symbols, "source_sha256": source.source_sha256, "entry_class": source.entry_class,
        "strategy_file": str(source.strategy_file), "universe_file": str(config.universe_file),
        "universe_sha256": hashlib.sha256(universe).hexdigest(), "runtime": config.runtime,
        "config": {**parameters, "memory": config.memory,
                   "single_order_source_reviewed": source.single_order_source_reviewed}}}


def _prepare(config, root, run_id, credential_ref, inputs, request_id, *, existing=False):
    path = credentials.prepare_path_locked(root, credential_ref, request_id=request_id)
    directory = state.directory(root, run_id)
    source = directory / "inputs" / "strategy.py" if existing else Path(inputs["strategy_file"])
    universe = directory / "inputs" / "universe.json" if existing else Path(inputs["universe_file"])
    return runs.prepare_locked(root, run_id, _profile(config), inputs["research_at"], inputs["candidate"],
                                inputs["symbols"], universe, path, inputs["runtime"], **inputs["config"],
                                strategy_file=source,
                                strategy_class=inputs["entry_class"], request_id=request_id,
                                credential_ref=credential_ref)


def _operation(config, action, command, body, root, request_id):
    target, inputs = command["target"], command["inputs"]
    if action == "credential_save":
        return credentials.save_locked(root, target["credential_ref"], body["api_key"], body["api_secret"],
                                       request_id=request_id)
    if action == "credential_remove":
        return credentials.remove_locked(root, target["credential_ref"], request_id=request_id)
    run_id = target["run_id"]
    if action == "prepare":
        manifest = _prepare(config, root, run_id, target["credential_ref"], inputs, request_id)
        # Same review as the original CLI; a failed review cannot open a venue connection.
        return runs.review(_profile(config), inputs["research_at"], manifest)
    if action == "stop":
        return runs.stop_locked(root, run_id)
    if action == "maintain":
        return runs.maintain_locked(root, run_id)
    mode = "run" if action == "start" else action
    path = credentials.run_path_locked(root, run_id, mode, request_id=request_id)
    if action == "preflight":
        original = _prepare_claim(root, run_id)["command"]
        manifest = _prepare(config, root, run_id, original["target"]["credential_ref"], original["inputs"],
                            request_id, existing=True)
        runs.review(_profile(config), original["inputs"]["research_at"], manifest)
    if action == "start":
        runs.require_confirmed_locked(root, run_id, inputs["confirm_real_orders"])
    return runs.launch_locked(root, run_id, path, mode, request_id=request_id)


def resolve(config: configuration.Configuration, request_id: str, *, binding: release.Binding | None = None) -> dict:
    """Explicit local recovery of the original intent; never repeat a venue/runner command."""
    scope = authority.retained(config, binding)
    with scope.serialized(config.root) as root:
        claim = requests.read_locked(root, request_id)
        if claim is None:
            scope.admit_locked(root)
            return requests.recover_locked(root, request_id)
        view = requests.view_locked(root, request_id)
        if view["outcome"] != "outcome_unknown":
            return view
        scope.admit_locked(root)
        command = claim["command"]
        if command["action"] == "prepare":
            target, inputs = command["target"], command["inputs"]
            run_id, ref = target["run_id"], target["credential_ref"]
            # The credential helper proves this target has only local incomplete
            # preparation evidence, while retaining all other run/ref conflict checks.
            path = credentials.resolve_prepare_path_locked(root, run_id, ref, request_id)
            runs.prepare_locked(root, run_id, _profile(config), inputs["research_at"], inputs["candidate"],
                                 inputs["symbols"], Path(inputs["universe_file"]), path, inputs["runtime"],
                                 **inputs["config"],
                                 strategy_file=Path(inputs["strategy_file"]), strategy_class=inputs["entry_class"],
                                 request_id=request_id, credential_ref=ref, recover_partial=True)
            return requests.view_locked(root, request_id)
        return requests.recover_locked(root, request_id)


def execute(config: configuration.Configuration, action: str, target: str | None, body: dict, *,
            binding: release.Binding | None = None) -> tuple[int, dict]:
    """Called only by the fixed operator CLI, never a general command-line proxy."""
    if action in notify.ACTIONS:
        # Notification settings are not account operations: no request ID, journal or account lock.
        try:
            return 200, {"ok": True, "data": {"notify": notify.execute(config, action, body)}}
        except Exception as exc:
            code = exc.code if isinstance(exc, LiveRefusal) else "LIVE_RECORD_UNAVAILABLE"
            return (502 if code == "LIVE_NOTIFY_TELEGRAM" else 400 if isinstance(exc, LiveRefusal) else 500), error(code)
    request_id = body.get("request_id") if isinstance(body, dict) else None
    try:
        if not isinstance(request_id, str) or not requests.REQUEST_ID.fullmatch(request_id):
            raise state.fail("LIVE_REQUEST_ID", "provide one valid request identifier")
        if action == "resolve":
            configuration.fields(body, {"request_id"})
            if target != request_id:
                raise configuration.fail()
            view = resolve(config, request_id, binding=binding)
            return 200, {"ok": True, "data": {"request": view, **view["target"]}}
        if action == "prepare":
            configuration.fields(body, {"request_id", "run_id", "source_id", "credential_ref", "config"})
            configuration.text(body["run_id"], state.RUN_ID)
            configuration.text(body["source_id"], configuration.SOURCE_ID)
            command = _fixed_prepare(config, body, authority.retained(config, binding))
        elif action == "credential_save":
            configuration.fields(body, {"request_id", "api_key", "api_secret"})
            # Stable, opaque version identity for this one upload intent, not a key fingerprint.
            ref = hashlib.sha256(("live-credential:" + request_id).encode()).hexdigest()[:32]
            command = {"action": action, "target": {"credential_ref": ref}, "inputs": {}}
        elif action == "credential_remove":
            configuration.fields(body, {"request_id"})
            command = {"action": action, "target": {"credential_ref": target}, "inputs": {}}
        elif action in {"preflight", "start", "stop", "reconcile", "maintain"}:
            configuration.fields(body, {"request_id", "confirm_real_orders"} if action == "start" else {"request_id"})
            inputs = {"confirm_real_orders": body["confirm_real_orders"]} if action == "start" else {}
            if action == "start":
                configuration.text(inputs["confirm_real_orders"], configuration.DIGEST)
            command = {"action": action, "target": {"run_id": target}, "inputs": inputs}
        else:
            raise configuration.fail()
        scope = authority.retained(config, binding)
        result = requests.dispatch(config.root, request_id, command,
                                   lambda root, identity: _operation(config, action, command, body, root, identity),
                                   admit_new=None if action == "stop" else lambda root: scope.admit_locked(
                                       root, maintenance=action == "maintain"), serialized=scope.serialized)
        return (202 if action in {"preflight", "start", "reconcile"} else 200), {
            "ok": True, "data": {"request": result["request"], **command["target"]}}
    except Exception as exc:
        code = exc.code if isinstance(exc, LiveRefusal) else "LIVE_RECORD_UNAVAILABLE"
        status = (503 if code == "LIVE_RELEASE_UNAVAILABLE" else
                  409 if code in {"LIVE_REQUEST_CONFLICT", "LIVE_REQUEST_UNRESOLVED", "LIVE_CREDENTIAL_BUSY",
                                 "LIVE_CREDENTIAL_CHANGED", "LIVE_ACCOUNT_OWNED"}
                  else 400 if isinstance(exc, LiveRefusal) else 500)
        return status, error(code, request_id if isinstance(request_id, str) else None)
