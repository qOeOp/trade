"""Bounded read DTOs. Custody bytes and detailed events remain in full reads."""

from __future__ import annotations

import json


BRIEF_LIMIT = 32768
BODY_FIELDS = {
    "schema_version", "attempt_id", "run_id", "component_id", "explicit_id", "declared_id",
    "title", "name", "question", "hypothesis", "mechanism", "description", "decision",
    "claim", "purpose", "research_purpose", "status", "role", "integrity", "evidence_grade",
    "scope", "next_action", "limitations", "statement", "decision_impact", "boundary",
    "metrics", "summary", "per_coin_summary", "account", "window", "cost_model",
    "strategy_binding", "runtime_identity", "input_identity_sha256", "source_commit",
    "source_files_sha256", "source_file_paths", "effective_config_sha256", "nautilus_version",
    "control_run_id", "parents", "mechanism_refs", "registration", "comparison_family",
    "target", "target_ref", "source_ref", "evidence_refs", "evidence", "disposition",
    "reviewer", "review_ref", "review_id", "review_revision", "proof", "aliases",
    "sha256", "bytes", "format", "category", "path", "git_commit", "resolution_status",
    "original_href", "rationale", "value_basis", "retention", "source_at", "family_id",
    "initial_registration", "content_sha256", "outcome", "layer", "item", "method",
    "kind", "goal_id", "contract", "decision_file_refs", "item_key",
}
METRIC_FIELDS = {
    "account_model", "annualized_return_pct", "closed_trade_win_rate", "closed_trades",
    "data_interval_minutes", "denied_orders", "exit_variant", "final_equity_usdt",
    "input_start_utc", "integrity_findings", "integrity_passed", "native_max_drawdown_daily_close",
    "native_risk_submit_rate", "native_sharpe_252", "native_sharpe_365", "net_change_usdt",
    "period_end_utc", "period_return_pct", "period_start_utc", "rejected_orders", "signal_variant",
    "sizing", "starting_balance_usdt", "stats_general", "stats_pnls", "stats_returns", "strategy",
    "win_rate_definition", "winning_trades", "accepted_exit_orders", "file_sha256", "filled_entries",
    "findings", "native_brackets", "native_bundles", "native_market_time_exits", "open_positions",
    "partially_filled_then_canceled_entries", "passed", "run",
}
PROVENANCE_FIELDS = {
    "origin", "path", "git_commit", "source_head", "blob_sha256", "sha256", "locator",
    "input_sha256", "operation_id", "source_path", "bytes",
}
RELATION_BODY_FIELDS = {
    "scope", "review_id", "review_revision", "review_ref", "proof", "evidence_refs",
    "decision_file_refs", "original_href", "resolution_status", "rationale", "item_key",
    "relationship", "boundary", "component", "disposition", "target", "target_ref",
}
RAW_FIELDS = {
    "text", "content_base64", "raw_content_base64", "raw_bytes", "source_bytes",
    "registration_bytes", "events", "event_arrays", "orders", "fills", "trades",
    "closed_positions", "trace", "event_log", "transactions", "equity_curve",
}
LIST_FIELDS = {
    "parents", "mechanism_refs", "evidence_refs", "evidence", "aliases", "per_coin_summary",
    "relations", "resolved_references", "corrections", "incoming_repairs", "reference_status",
    "runs", "candidate_runs", "control_runs", "run_ids", "mechanism_sources", "lineage",
    "fields", "boundaries", "retained_research_decisions", "limitations", "findings", "integrity_findings",
    "decision_file_refs", "matches", "match_reasons", "next_actions", "coins",
    "evidence_status", "run_refs",
}


def relation_view(edge):
    return {key: edge[key] for key in ("id", "kind", "from_id", "from_revision", "to_id", "to_revision")
            if key in edge} | {"body": {key: value for key, value in edge.get("body", {}).items()
                                        if key in RELATION_BODY_FIELDS}}


def _size(value):
    # Match the CLI rendering, not only compact JSON.
    return len(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False).encode("utf-8")) + 1


def bounded_brief(payload, *, at, identity=None, revision=None, limit=BRIEF_LIMIT,
                  command="material show"):
    """Return a whitelist projection with a deterministic UTF-8 byte ceiling.

    Never change the original payload. Omission is explicit, and every brief
    names the snapshot required to retrieve its detailed source again.
    """
    if limit < 2048:
        raise ValueError("brief limit must be at least 2048 bytes")
    omitted = []
    omitted_count = 0

    def omit(path):
        nonlocal omitted_count
        omitted_count += 1
        if len(omitted) < 64:
            omitted.append(path[:160])

    def project(value, path="", depth=0):
        if depth > 9:
            omit(path)
            return None
        if isinstance(value, str):
            if len(value.encode("utf-8")) > 1536:
                omit(path)
                return value.encode("utf-8")[:1536].decode("utf-8", errors="ignore") + "…"
            return value
        if isinstance(value, list):
            maximum = 64 if path.endswith("per_coin_summary") else 24
            if len(value) > maximum:
                omit(path + f"[{maximum}:]")
            return [project(child, f"{path}[{index}]", depth + 1)
                    for index, child in enumerate(value[:maximum])]
        if not isinstance(value, dict):
            return value
        keys = set(value)
        if path.endswith(".body") or path == "body":
            hashes = {key for key in keys if key.endswith("_source_sha256") and isinstance(value[key], str)
                      and len(value[key]) == 64}
            keys &= BODY_FIELDS | METRIC_FIELDS | hashes
        elif path.endswith(".provenance") or path == "provenance":
            keys &= PROVENANCE_FIELDS
        result = {}
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else key
            if key not in keys or key in RAW_FIELDS or key.endswith("_events") or key.endswith("_base64"):
                omit(child_path)
                continue
            if isinstance(child, list) and key not in LIST_FIELDS:
                omit(child_path)
                continue
            if len(result) >= 64:
                omit(child_path)
                continue
            result[key] = project(child, child_path, depth + 1)
        return result

    prepared = dict(payload)
    if isinstance(prepared.get("object"), dict):
        original = prepared["object"]
        body = original.get("body", {})
        if isinstance(body.get("per_coin"), list):
            def scalar_summary(value, depth=0):
                if isinstance(value, dict) and depth < 3:
                    return {key: scalar_summary(child, depth + 1) for key, child in value.items()
                            if key not in RAW_FIELDS and not key.endswith("_events")
                            and not isinstance(child, list)}
                return value if value is None or isinstance(value, (str, int, float, bool)) else None
            prepared["object"] = {**original, "body": {**body, "per_coin_summary": [
                scalar_summary({key: coin[key] for key in ("coin", "instrument", "quantity", "counts",
                                                          "risk_size_skips") if key in coin})
                for coin in body["per_coin"] if isinstance(coin, dict)]}}
    for name in ("relations", "resolved_references"):
        if isinstance(prepared.get(name), list):
            edges = prepared[name]
            for index, edge in enumerate(edges):
                if isinstance(edge, dict):
                    for key in set(edge.get("body", {})) - RELATION_BODY_FIELDS:
                        omit(f"{name}[{index}].body.{key}")
            prepared[name] = [relation_view(edge) for edge in edges]
    result = project(prepared)
    full_read = {"command": command, "at": at}
    if identity is not None:
        full_read["id"] = identity
    if revision is not None:
        full_read["revision"] = revision

    def metadata():
        result.update({"omitted_fields": omitted, "omitted_count": omitted_count,
                       "truncated": bool(omitted_count), "full_read": full_read})

    metadata()
    # A wide but shallow metric map can still exceed the budget. Remove the
    # largest non-identity leaf rather than silently exceeding the contract.
    essential = {"id", "revision", "kind", "commit", "at", "attempt_id", "run_id"}
    while _size(result) > limit:
        leaves = []

        def visit(value, path=""):
            if not isinstance(value, dict):
                return
            for key, child in value.items():
                child_path = f"{path}.{key}" if path else key
                if key in {"omitted_fields", "omitted_count", "truncated", "full_read"}:
                    continue
                if isinstance(child, dict) and child:
                    visit(child, child_path)
                elif key not in essential and key != "next_action" and not any(
                        part in {"decision", "claim"} for part in path.split(".")):
                    leaves.append((_size(child), value, key, child_path))

        visit(result)
        if not leaves:
            # Only pathological oversized IDs can reach this; preserve an
            # explicit omission and the full-read reference within the budget.
            result = {"commit": at, "full_read": full_read, "truncated": True,
                      "omitted_fields": ["payload"], "omitted_count": omitted_count + 1}
            break
        _, parent, key, path = max(leaves, key=lambda item: item[0])
        del parent[key]
        omit(path)
        metadata()
    return result
