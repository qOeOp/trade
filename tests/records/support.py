"""Test-only source manifests; production indexing accepts explicit payloads."""

import json
from pathlib import Path

from research.records.materials import _retained_payload, _safe_path, _sha

HISTORICAL_MANIFEST = "tests/records/fixtures/historical_sources.json"


def historical_fixture_refs(root: Path) -> list[dict]:
    """Read and validate the explicit retained-source manifest for ``scan``.

    The returned payloads retain the original commit and Git blob identity.
    Their bytes come from this manifest; no missing Git reference is fetched or
    silently substituted. Callers may also use the validated base64 payloads
    when an existing fixture needs exactly the same historical source bytes.
    """
    root = Path(root).resolve()
    manifest_path = root / HISTORICAL_MANIFEST
    if manifest_path.is_symlink() or not manifest_path.resolve().is_relative_to(root):
        raise ValueError("retained historical manifest path is unsafe")
    raw = manifest_path.read_bytes()
    try:
        manifest = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValueError("retained historical manifest is invalid JSON") from exc
    if not isinstance(manifest, dict) or manifest.get("schema_version") != 1 or not isinstance(manifest.get("sources"), list):
        raise ValueError("retained historical manifest schema is invalid")
    selections: dict[str, dict] = {}
    identities = set()
    for i, source in enumerate(manifest["sources"]):
        _, source = _retained_payload(source)
        identity = (source["original_commit"], source["path"])
        if identity in identities:
            raise ValueError("retained historical manifest has duplicate commit/path")
        identities.add(identity)
        source.update({"manifest_path": HISTORICAL_MANIFEST, "manifest_sha256": _sha(raw), "manifest_locator": f"/sources/{i}"})
        selection = selections.setdefault(source["original_commit"], {"commit": source["original_commit"], "paths": [], "retained_payloads": []})
        selection["paths"].append(source["path"])
        selection["retained_payloads"].append(source)
    return list(selections.values())
