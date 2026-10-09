"""Lossless, read-only indexing of repository research materials.

Relationships describe explicit JSON fields and Markdown structure. A link or
source recheck does not establish hypothesis inheritance or a correction claim.
Publication, object revisions, and custody transitions belong to the ledger.
"""

from __future__ import annotations

import base64
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
from typing import Iterable

from markdown_it import MarkdownIt

from research.records.common import ROOT
from research.records.references import resolve_link

PARSER = MarkdownIt("commonmark")
KNOWN_LEDGERS = {
    "SOURCE_CASES.md", "PRICE_ACTION_SOURCE_MAP.md", "RD_EXPERIMENTS.md",
    "RD_FINDINGS.md", "r1-native-rd-findings.md", "r1-native-rd-findings.zh.md",
}
EXCLUDED_PARTS = {".git", ".venv", "node_modules", "__pycache__", ".cache", "cache", "caches", "secrets", ".secrets", "credentials"}
PRIMARY_ID = re.compile(
    r"^(?:([CSHDF]\d+[a-z]?)\b|(?:Source(?: observation| check| recheck| access)?|Candidate|Diagnostic|Hypothesis|Finding)\s+([SCDHF]\d+[a-z]?)\b)",
    re.IGNORECASE,
)
ID_TOKEN = re.compile(r"\b([SCDHF]\d+[a-z]?)\b", re.IGNORECASE)
SHA256 = re.compile(r"^[0-9a-f]{64}$")
GIT_SHA1 = re.compile(r"^[0-9a-f]{40}$")
HISTORICAL_MANIFEST = "research/records/fixtures/historical_sources.json"


def _sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def _git(root: Path, *args: str, check: bool = True) -> bytes:
    result = subprocess.run(["git", *args], cwd=root, capture_output=True, check=False)
    if check and result.returncode:
        raise ValueError(f"git {' '.join(args[:2])}: {result.stderr.decode(errors='replace').strip()}")
    return result.stdout if result.returncode == 0 else b""


def _paths(raw: bytes) -> list[str]:
    return [part.decode("utf-8", errors="surrogateescape") for part in raw.split(b"\0") if part]


def _safe_path(path: str) -> bool:
    p = PurePosixPath(path)
    return not p.is_absolute() and ".." not in p.parts and not any(part in EXCLUDED_PARTS for part in p.parts)


def _retained_payload(source: dict, commit: str | None = None) -> tuple[bytes, dict]:
    """Validate an explicitly retained Git blob without requiring its commit."""
    if not isinstance(source, dict):
        raise ValueError("retained historical source must be an object")
    required = {"original_commit", "path", "blob_oid", "sha256", "byte_length", "content_base64"}
    if not required <= source.keys():
        raise ValueError("retained historical source is missing required fields")
    original = source["original_commit"]
    if not isinstance(original, str) or not GIT_SHA1.fullmatch(original) or (commit is not None and original != commit):
        raise ValueError("retained historical source original_commit does not match its selection")
    path = source["path"]
    if not isinstance(path, str) or not path or not _safe_path(path) or PurePosixPath(path).as_posix() != path or any(ord(c) < 32 for c in path):
        raise ValueError("retained historical source path is unsafe")
    if not isinstance(source["blob_oid"], str) or not GIT_SHA1.fullmatch(source["blob_oid"]):
        raise ValueError("retained historical source blob_oid is invalid")
    if not isinstance(source["sha256"], str) or not SHA256.fullmatch(source["sha256"]):
        raise ValueError("retained historical source sha256 is invalid")
    if type(source["byte_length"]) is not int or source["byte_length"] < 0:
        raise ValueError("retained historical source byte_length is invalid")
    if not isinstance(source["content_base64"], str):
        raise ValueError("retained historical source content_base64 is invalid")
    try:
        raw = base64.b64decode(source["content_base64"], validate=True)
    except (ValueError, base64.binascii.Error) as exc:
        raise ValueError("retained historical source content_base64 is invalid") from exc
    if len(raw) != source["byte_length"]:
        raise ValueError("retained historical source byte_length mismatch")
    if _sha(raw) != source["sha256"]:
        raise ValueError("retained historical source sha256 mismatch")
    oid = hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()
    if oid != source["blob_oid"]:
        raise ValueError("retained historical source blob_oid mismatch")
    fixture_keys = {"fixture_path", "fixture_sha256", "fixture_locator"}
    if fixture_keys & source.keys():
        if not fixture_keys <= source.keys():
            raise ValueError("retained historical source fixture provenance is incomplete")
        fixture = source["fixture_path"]
        if not isinstance(fixture, str) or not fixture or not _safe_path(fixture) or PurePosixPath(fixture).as_posix() != fixture:
            raise ValueError("retained historical source fixture path is unsafe")
        if not isinstance(source["fixture_sha256"], str) or not SHA256.fullmatch(source["fixture_sha256"]):
            raise ValueError("retained historical source fixture sha256 is invalid")
        if not isinstance(source["fixture_locator"], str) or not re.fullmatch(r"/sources/\d+", source["fixture_locator"]):
            raise ValueError("retained historical source fixture locator is invalid")
    return raw, dict(source)


def retained_historical_refs(root: Path = ROOT) -> list[dict]:
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
        source.update({"fixture_path": HISTORICAL_MANIFEST, "fixture_sha256": _sha(raw), "fixture_locator": f"/sources/{i}"})
        selection = selections.setdefault(source["original_commit"], {"commit": source["original_commit"], "paths": [], "retained_payloads": []})
        selection["paths"].append(source["path"])
        selection["retained_payloads"].append(source)
    return list(selections.values())


def _untracked_material(path: str) -> bool:
    return path.endswith(".md") and (
        path.startswith(("reports/", "research_notes/", "docs/plans/"))
        or path == "research/ledger_probe/README.md"
    )


def _slug(title: str) -> str:
    # An address for a heading, not a business identifier or semantic alias.
    return re.sub(r"[^\w\- ]", "", title.casefold()).replace(" ", "-") or "untitled"


def _primary_id(path: str, title: str) -> str | None:
    if PurePosixPath(path).name not in KNOWN_LEDGERS:
        return None
    match = PRIMARY_ID.match(title)
    return next((x for x in match.groups() if x), None) if match else None


def _material_body(raw: bytes, title: str, format_: str) -> dict:
    body = {
        "title": title, "content_base64": base64.b64encode(raw).decode("ascii"),
        "sha256": _sha(raw), "byte_length": len(raw), "format": format_,
    }
    try:
        body["text"] = raw.decode("utf-8")
    except UnicodeDecodeError:
        body["encoding"] = "invalid_utf8"
    return body


def _line_offsets(raw: bytes) -> list[int]:
    offsets = [0]
    for ending in re.finditer(rb"\r\n|\r|\n", raw):
        offsets.append(ending.end())
    if offsets[-1] != len(raw):
        offsets.append(len(raw))
    return offsets


def _extract_markdown(path: str, raw: bytes, provenance: dict) -> tuple[list[dict], list[dict], list[dict]]:
    """Parse Markdown structure while preserving original byte spans."""
    object_id = f"material:{path}"
    try:
        source = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        body = _material_body(raw, path, "markdown")
        return [{"id": object_id, "kind": "material", "body": body, "provenance": provenance}], [], [
            {"reason": "invalid_utf8", "object_id": object_id, "path": path, "byte_offset": exc.start}
        ]
    tokens = PARSER.parse(source)
    headings = []
    counts: Counter[str] = Counter()
    explicit_counts: Counter[str] = Counter()
    anchors: Counter[str] = Counter()
    review = []
    offsets = _line_offsets(raw)
    for i, token in enumerate(tokens):
        if token.type != "heading_open" or token.map is None:
            continue
        inline = tokens[i + 1]
        title = "".join(child.content if child.type in {"text", "code_inline", "image"} else " " if child.type in {"softbreak", "hardbreak"} else "" for child in inline.children or []).strip() or inline.content
        level = int(token.tag[1:])
        explicit = _primary_id(path, title) if level == 2 else None
        slug = _slug(title)
        counts[slug] += 1
        anchor = slug if anchors[slug] == 0 else f"{slug}-{anchors[slug]}"
        anchors[slug] += 1
        if explicit:
            explicit_counts[explicit] += 1
            suffix = explicit if explicit_counts[explicit] == 1 else f"{explicit}-occurrence-{explicit_counts[explicit]}"
        else:
            suffix = f"heading-{slug}-{counts[slug]}"
        headings.append({
            "id": f"section:{path}#{suffix}", "title": title, "level": level,
            "start": token.map[0], "heading_end": token.map[1], "explicit_id": explicit,
            "anchor": anchor, "occurrence": counts[slug],
        })
        if explicit and explicit_counts[explicit] > 1:
            review.append({"reason": "duplicate_explicit_heading_id", "path": path, "explicit_id": explicit})
        # Only the first declared heading identifier is used. Later IDs remain text.
        prefix_ids = ID_TOKEN.findall(title.split(":", 1)[0])
        headings[-1]["mentioned_ids"] = list(dict.fromkeys(token for token in prefix_ids if token.casefold() != (explicit or "").casefold()))
    title = headings[0]["title"] if headings else path
    objects = [{"id": object_id, "kind": "material", "body": _material_body(raw, title, "markdown"), "provenance": provenance}]
    relations = []
    for i, heading in enumerate(headings):
        end = next((h["start"] for h in headings[i + 1:] if h["level"] <= heading["level"]), len(offsets) - 1)
        start_byte, end_byte = offsets[heading["start"]], offsets[end]
        body = _material_body(raw[start_byte:end_byte], heading["title"], "markdown_fragment")
        body.update({
            "heading_level": heading["level"], "heading_anchor": heading["anchor"],
            "heading_occurrence": heading["occurrence"],
            "locator_method": "explicit_heading_id" if heading["explicit_id"] else "path_heading_occurrence",
        })
        if heading["explicit_id"]:
            body["explicit_id"] = heading["explicit_id"]
        if heading["mentioned_ids"]:
            body["mentioned_ids"] = heading["mentioned_ids"]
        prov = dict(provenance, locator={"start_byte": start_byte, "end_byte": end_byte, "start_line": heading["start"] + 1, "end_line": end, "heading": heading["title"]})
        objects.append({"id": heading["id"], "kind": "material_section", "body": body, "provenance": prov})
        relations.append({"kind": "contains", "from_id": object_id, "to_id": heading["id"], "body": {"source": prov}})
        heading["end"] = end
    for token in tokens:
        if token.type != "inline" or not token.children or token.map is None:
            continue
        owners = [h for h in headings if h["start"] <= token.map[0] < h["end"]]
        owner = max(owners, key=lambda h: (h["level"], h["start"]))["id"] if owners else object_id
        for child in token.children:
            attr = "src" if child.type == "image" else "href" if child.type == "link_open" else None
            if attr:
                href = child.attrGet(attr)
                if href:
                    relations.append({"kind": "references", "from_id": owner, "href": href, "body": {
                        "source": provenance, "source_lines": token.map, "syntax": child.type,
                    }})
    return objects, relations, review


def _json_path_kind(path: str) -> str | None:
    parts = PurePosixPath(path).parts
    if len(parts) == 5 and parts[:3] == ("research", "records", "attempts") and parts[-1] == "attempt.json":
        return "attempt"
    if len(parts) == 5 and parts[:3] == ("research", "records", "runs") and parts[-1] == "run.json":
        return "run"
    return None


def scan(root: Path = ROOT, include_untracked: bool = True, historical_refs: Iterable[str | dict] | None = None, *, supplemental_objects: Iterable[dict] = ()) -> dict:
    """Collect tracked Markdown, record JSON, and explicitly cited JSON evidence.

    Untracked Markdown is limited to reports, research_notes, docs/plans, and the
    comparison probe README. Git-ignored files and paths outside root are never
    read. ``historical_refs`` may contain commits or {commit, paths} selections,
    or an explicit {commit, paths, retained_payloads} selection returned by
    ``retained_historical_refs``. Retained payloads are byte/hash/OID verified
    and do not require the original commit to be available in this checkout.
    Historical snapshots precede the worktree and do not imply registration.
    Supplemental payloads must be explicitly retained and byte-hash verified;
    they never authorize scanning arbitrary untracked JSON.
    """
    root = Path(root).resolve()
    supplemental_objects = tuple(supplemental_objects)
    head = _git(root, "rev-parse", "HEAD").decode().strip()
    tracked = set(_paths(_git(root, "ls-files", "-z")))
    untracked = set(_paths(_git(root, "ls-files", "--others", "--exclude-standard", "-z"))) if include_untracked else set()
    review: list[dict] = []
    warnings: list[dict] = []
    objects: list[dict] = []
    relations: list[dict] = []
    snapshots: list[tuple[str | None, set[str], dict[str, tuple[bytes, dict]]]] = []
    for selection in historical_refs or []:
        ref = selection if isinstance(selection, str) else selection["commit"]
        if isinstance(selection, dict) and "retained_payloads" in selection:
            if not isinstance(ref, str) or not GIT_SHA1.fullmatch(ref):
                raise ValueError("retained historical selection commit is invalid")
            payloads = selection["retained_payloads"]
            if not isinstance(payloads, list) or not payloads:
                raise ValueError("retained historical selection requires explicit payloads")
            retained = {}
            for source in payloads:
                raw, metadata = _retained_payload(source, ref)
                path = metadata["path"]
                if path in retained:
                    raise ValueError("retained historical selection has duplicate paths")
                retained[path] = raw, metadata
            files = set(retained)
            if "paths" in selection:
                paths = selection["paths"]
                if not isinstance(paths, list) or any(not isinstance(path, str) for path in paths) or not set(paths) <= files:
                    raise ValueError("retained historical selection paths require matching payloads")
                files &= set(paths)
            # Optional local verification does not change retained provenance.
            # A missing original commit never causes a fetch or a fallback.
            available = _git(root, "cat-file", "-t", ref, check=False)
            if available:
                if available.strip() != b"commit":
                    raise ValueError("retained historical source original object is not a commit")
                for path in files:
                    original = _git(root, "show", f"{ref}:{path}")
                    if original != retained[path][0]:
                        raise ValueError("retained historical source differs from the available original Git blob")
            snapshots.append((ref, files, retained))
            continue
        commit = _git(root, "rev-parse", "--verify", f"{ref}^{{commit}}").decode().strip()
        files = set(_paths(_git(root, "ls-tree", "-r", "--name-only", "-z", commit)))
        if isinstance(selection, dict) and "paths" in selection:
            files &= set(selection["paths"])
        snapshots.append((commit, files, {}))
    snapshots.append((None, tracked | {p for p in untracked if _untracked_material(p)}, {}))
    bytes_scanned = 0
    snapshot_statistics = []
    for historical_commit, inventory, retained in snapshots:
        object_start = len(objects)
        relation_start = len(relations)
        local_objects: dict[str, dict] = {}
        md_relations = []
        explicit_sections: dict[str, list[str]] = defaultdict(list)
        raw_cache: dict[str, tuple[bytes, dict]] = {}
        json_data: dict[str, dict] = {}
        selected_json: set[str] = set()

        def read(path: str) -> tuple[bytes, dict] | None:
            nonlocal bytes_scanned
            if path in raw_cache:
                return raw_cache[path]
            if path not in inventory or not _safe_path(path):
                return None
            retained_provenance = {}
            if path in retained:
                raw, metadata = retained[path]
                commit = metadata["original_commit"]
                state = "historical_retained"
                retained_provenance = {"origin": "retained_git_blob", "verify_source": "retained_bytes", "git_blob_oid": metadata["blob_oid"]}
                if "fixture_path" in metadata:
                    retained_provenance["retained_fixture"] = {"path": metadata["fixture_path"], "sha256": metadata["fixture_sha256"], "locator": metadata["fixture_locator"]}
            elif historical_commit:
                raw = _git(root, "show", f"{historical_commit}:{path}")
                commit = historical_commit
                state = "historical_committed"
            else:
                file = root / path
                if file.is_symlink() or not file.resolve().is_relative_to(root):
                    review.append({"reason": "unsafe_symlink", "path": path})
                    return None
                try:
                    raw = file.read_bytes()
                except OSError as exc:
                    warnings.append({"reason": "unreadable_or_deleted", "path": path, "error": str(exc)})
                    return None
                baseline = _git(root, "show", f"{head}:{path}", check=False) if path in tracked else None
                # Empty files need Git existence checking: an absent blob is not an empty committed file.
                committed = path in tracked and subprocess.run(["git", "cat-file", "-e", f"{head}:{path}"], cwd=root, capture_output=True).returncode == 0 and baseline == raw
                commit = head if committed else None
                state = "committed" if committed else "modified" if path in tracked else "untracked"
            prov = {"source_head": head, "git_commit": commit, "path": path, "blob_sha256": _sha(raw), "locator": {"start_byte": 0, "end_byte": len(raw)}, "worktree_state": state}
            prov.update(retained_provenance)
            bytes_scanned += len(raw)
            raw_cache[path] = raw, prov
            return raw, prov

        def add(obj: dict) -> None:
            local_objects[obj["id"]] = obj

        for path in sorted(inventory):
            if not _safe_path(path):
                continue
            if path.endswith(".md"):
                value = read(path)
                if value:
                    extracted, refs, items = _extract_markdown(path, *value)
                    for obj in extracted:
                        add(obj)
                        explicit = obj["body"].get("explicit_id")
                        if explicit:
                            explicit_sections[explicit.casefold()].append(obj["id"])
                    md_relations.extend(refs)
                    review.extend(items)
            elif _json_path_kind(path):
                selected_json.add(path)

        # Source evidence has qualified structural fields; prose is not classified.
        for path in sorted(inventory):
            if not path.startswith("research/r1_native/results/") or not path.endswith(".json"):
                continue
            value = read(path)
            if not value:
                continue
            try:
                data = json.loads(value[0])
            except (ValueError, UnicodeDecodeError):
                continue
            if isinstance(data, dict) and (
                (isinstance(data.get("case"), str) and isinstance(data.get("source_reads"), dict))
                or (isinstance(data.get("media_sha256"), str) and "independent_source_case" in data)
            ):
                selected_json.add(path)
                json_data[path] = data

        def load_json(path: str) -> dict | None:
            if path in json_data:
                return json_data[path]
            value = read(path)
            if not value:
                return None
            try:
                data = json.loads(value[0])
            except (ValueError, UnicodeDecodeError) as exc:
                raw, prov = value
                add({"id": f"material:{path}", "kind": "material", "body": _material_body(raw, path, "json"), "provenance": prov})
                review.append({"reason": "invalid_json", "path": path, "error": str(exc)})
                return None
            if not isinstance(data, dict):
                raw, prov = value
                add({"id": f"material:{path}", "kind": "material", "body": _material_body(raw, path, "json"), "provenance": prov})
                return None
            json_data[path] = data
            return data

        # Only record-contract references extend the selected JSON set.
        for path in sorted(selected_json):
            data = load_json(path)
            if not data or not _json_path_kind(path):
                continue
            refs = list(data.get("evidence_refs", []))
            refs += [data[k] for k in ("summary_ref", "audit_ref", "artifact_manifest_ref") if isinstance(data.get(k), dict)]
            family = data.get("comparison_family")
            if isinstance(family, dict) and isinstance(family.get("analysis_ref"), dict):
                refs.append(family["analysis_ref"])
            for ref in refs:
                target = ref.get("path")
                if isinstance(target, str) and target.endswith(".json") and target in inventory and _safe_path(target):
                    selected_json.add(target)
        path_to_object = {obj["provenance"]["path"]: obj["id"] for obj in local_objects.values() if obj["kind"] == "material"}
        for path in sorted(selected_json):
            data = load_json(path)
            value = read(path)
            if data is None or value is None:
                if f"material:{path}" in local_objects:
                    path_to_object[path] = f"material:{path}"
                continue
            raw, prov = value
            kind = _json_path_kind(path) or "evidence_json"
            identifier = data.get(f"{kind}_id") if kind in {"attempt", "run"} else path
            if not isinstance(identifier, str):
                review.append({"reason": "missing_record_id", "path": path, "kind": kind})
                continue
            obj_id = f"{kind}:{identifier}"
            add({"id": obj_id, "kind": kind, "body": data, "provenance": dict(prov, raw_content_base64=base64.b64encode(raw).decode("ascii"))})
            path_to_object[path] = obj_id

        def ref_object(target: str, **metadata: object) -> str:
            identity = {"target": target, **metadata}
            obj_id = f"reference:{_sha(_canonical(identity))}"
            if obj_id not in local_objects:
                add({"id": obj_id, "kind": "reference", "body": identity, "provenance": {"source_head": head, "git_commit": historical_commit, "path": None, "blob_sha256": None, "locator": "derived_reference", "worktree_state": "derived"}})
            return obj_id

        def edge(kind: str, from_id: str, to_id: str, body: dict) -> None:
            relations.append({"kind": kind, "from_id": from_id, "to_id": to_id, "body": body})

        def section_target(token: str) -> str | None:
            choices = explicit_sections.get(token.casefold(), [])
            # Prefer the explicit source ledger over incidental case mentions in other documents.
            if len(choices) == 1:
                return choices[0]
            if len(choices) > 1:
                review.append({"reason": "ambiguous_explicit_reference", "token": token, "candidates": choices})
            return None

        def file_ref(from_id: str, ref: dict, field: str, prov: dict) -> None:
            path = ref.get("path")
            if not isinstance(path, str):
                return
            target = path_to_object.get(path)
            if not target:
                target = ref_object(path, category="file_evidence", declared_sha256=ref.get("sha256"))
            edge("evidence_ref", from_id, target, {"field": field, "reference": ref, "source": prov})

        for path in sorted(selected_json):
            data = json_data.get(path)
            from_id = path_to_object.get(path)
            if not data or not from_id:
                continue
            prov = local_objects[from_id]["provenance"]
            kind = _json_path_kind(path)
            if kind == "attempt":
                for i, parent in enumerate(data.get("parents", [])):
                    if isinstance(parent, dict) and parent.get("relationship") in {"hypothesis_extension", "repair", "composition"} and isinstance(parent.get("attempt_id"), str):
                        edge(parent["relationship"], from_id, f"attempt:{parent['attempt_id']}", {"field": f"/parents/{i}", "reference": parent, "source": prov})
                for i, item in enumerate(data.get("mechanism_refs", [])):
                    if not isinstance(item, dict) or item.get("relationship") != "component_reuse" or not isinstance(item.get("attempt_id"), str) or not isinstance(item.get("component"), str):
                        continue
                    target = f"attempt:{item['attempt_id']}"
                    edge("component_reuse", from_id, target, {"field": f"/mechanism_refs/{i}", "reference": item, "source": prov})
                    component = f"component:{item['component']}"
                    add({"id": component, "kind": "component", "body": {"name": item["component"]}, "provenance": dict(prov, locator=f"/mechanism_refs/{i}/component")})
                    for attempt in (from_id, target):
                        edge("component_index", component, attempt, {"field": f"/mechanism_refs/{i}/component", "boundary": item.get("boundary"), "source": prov})
                family = data.get("comparison_family")
                if isinstance(family, dict):
                    for role in ("origin", "factor_a", "factor_b"):
                        target = family.get(f"{role}_attempt_id")
                        if isinstance(target, str):
                            edge("comparison_family", from_id, f"attempt:{target}", {"role": role, "family_id": family.get("family_id"), "source": prov})
                    for cell, run in family.get("cells", {}).items():
                        edge("comparison_cell", from_id, f"run:{run}", {"cell": cell, "family_id": family.get("family_id"), "source": prov})
                    if isinstance(family.get("analysis_ref"), dict):
                        file_ref(from_id, family["analysis_ref"], "/comparison_family/analysis_ref", prov)
                for i, ref in enumerate(data.get("evidence_refs", [])):
                    if isinstance(ref, dict):
                        file_ref(from_id, ref, f"/evidence_refs/{i}", prov)
            elif kind == "run":
                if isinstance(data.get("attempt_id"), str):
                    edge("run_of", from_id, f"attempt:{data['attempt_id']}", {"field": "/attempt_id", "source": prov})
                if isinstance(data.get("control_run_id"), str):
                    edge("compared_with", from_id, f"run:{data['control_run_id']}", {"field": "/control_run_id", "source": prov})
                for field in ("summary_ref", "audit_ref", "artifact_manifest_ref"):
                    if isinstance(data.get(field), dict):
                        file_ref(from_id, data[field], f"/{field}", prov)
            case = data.get("case")
            if isinstance(case, str) and isinstance(data.get("source_reads"), dict):
                source = section_target(case)
                if source:
                    edge("documents_source_check", from_id, source, {"field": "/case", "source": prov})
                for token, reading in data["source_reads"].items():
                    target = section_target(token)
                    if target:
                        edge("references", from_id, target, {"field": f"/source_reads/{token}", "reading": reading, "source": prov})
                for i, token in enumerate(data.get("prior_experiments", [])):
                    target = f"attempt:{token}" if f"attempt:{token}" in local_objects else section_target(token)
                    if target:
                        edge("references", from_id, target, {"field": f"/prior_experiments/{i}", "source": prov})
                    else:
                        review.append({"reason": "unresolved_explicit_reference", "object_id": from_id, "field": f"/prior_experiments/{i}", "token": token})
                review.append({"reason": "source_recheck_semantics_require_review", "object_id": from_id, "case": case, "status": data.get("status"), "candidate_fields": ["case", "source_reads", "prior_experiments"], "boundary": "references do not establish corrects, narrows, uses_claim, or retrospective registration"})
            media = data.get("media_sha256")
            if isinstance(media, str) and SHA256.fullmatch(media) and "independent_source_case" in data:
                media_id = f"media:{media}"
                add({"id": media_id, "kind": "media_identity", "body": {"sha256": media, "source_url": data.get("source_url")}, "provenance": dict(prov, locator="/media_sha256")})
                # The explicit paired observation fields bind both processing attempts to one media.
                observations = []
                for key in data:
                    match = re.fullmatch(r"(s\d+)_media_stage_id", key)
                    if match and isinstance(data[key], str):
                        target = section_target(match.group(1))
                        if target:
                            observations.append((match.group(1), target))
                            edge("same_media", target, media_id, {"field": f"/{key}", "media_stage_id": data[key], "media_sha256": media, "independent_source_case": data.get("independent_source_case"), "source": prov})
                if len(observations) == 2 and data.get("independent_source_case") is False:
                    earlier, later = sorted(observations, key=lambda item: int(item[0][1:]))
                    edge("duplicate_of", later[1], earlier[1], {"fields": [f"/{later[0]}_media_stage_id", f"/{earlier[0]}_media_stage_id", "/media_sha256", "/independent_source_case"], "media_sha256": media, "independent_source_case": False, "source": prov})

        for item in md_relations:
            if "href" not in item:
                relations.append(item)
                continue
            href = item.pop("href")
            source_provenance = item["body"]["source"]
            result = resolve_link(
                href, source_provenance["path"], source_provenance,
                list(local_objects.values()), root=root,
                git_commit=historical_commit or source_provenance.get("git_commit") or head,
                supplemental_objects=supplemental_objects,
            )
            if result["status"] in {"resolved", "dependency_reference"}:
                target = result["target_object"]
                add(target)
                item["to_id"] = target["id"]
                item["body"]["resolution"] = result["proof"]
            else:
                category = "unsafe_local_link" if result["status"] == "unsafe" else "unresolved_local_link"
                target = ref_object(href, category=category,
                                    resolved_path=result["proof"].get("path"),
                                    fragment=result["proof"].get("fragment", ""))
                item["to_id"] = target
                review.append({"reason": category, "resolution_reason": result.get("reason"),
                               "object_id": item["from_id"], "target": href,
                               "resolved_path": result["proof"].get("path")})
            item["body"]["href"] = href
            relations.append(item)
        # Every relation endpoint exists even when a declared record is unavailable.
        for relation in relations[relation_start:]:
            for key in ("from_id", "to_id"):
                target = relation[key]
                if target not in local_objects:
                    add({"id": target, "kind": "unresolved_record", "body": {"declared_id": target, "status": "not_in_snapshot"}, "provenance": {"source_head": head, "git_commit": historical_commit, "path": None, "blob_sha256": None, "locator": "declared_json_reference", "worktree_state": "derived"}})
                    review.append({"reason": "unresolved_record", "object_id": target})
            relation["from_source_sha256"] = local_objects[relation["from_id"]]["provenance"].get("blob_sha256")
            relation["to_source_sha256"] = local_objects[relation["to_id"]]["provenance"].get("blob_sha256")
            relation["id"] = f"relation:{_sha(_canonical(relation))}"
        objects.extend(local_objects.values())
        snapshot_statistics.append({"git_commit": historical_commit, "objects": len(objects) - object_start, "relations": len(relations) - relation_start, "markdown_files": sum(obj["kind"] == "material" and obj["body"].get("format") == "markdown" for obj in local_objects.values()), "structured_json_files": sum(obj["kind"] in {"attempt", "run", "evidence_json"} for obj in local_objects.values())})
    # Multiple source paths can repeat a fact. Preserve distinct evidence bodies but
    # remove byte-identical edges within a snapshot.
    unique_relations = {r["id"]: r for r in relations}
    statistics = {
        "objects": len(objects), "relations": len(unique_relations), "review_queue": len(review),
        "warnings": len(warnings), "bytes_scanned": bytes_scanned,
        "current_markdown_files": snapshot_statistics[-1]["markdown_files"],
        "current_structured_json_files": snapshot_statistics[-1]["structured_json_files"],
        "objects_by_kind": dict(sorted(Counter(o["kind"] for o in objects).items())),
        "relations_by_kind": dict(sorted(Counter(r["kind"] for r in unique_relations.values()).items())),
        "review_by_reason": dict(sorted(Counter(r["reason"] for r in review).items())),
        "snapshots": snapshot_statistics,
    }
    return {"schema_version": 1, "source_head": head, "objects": objects, "relations": list(unique_relations.values()), "review_queue": review, "warnings": warnings, "statistics": statistics}
