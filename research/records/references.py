"""Resolve navigation references against retained bytes or a frozen Git tree.

No target is read from the worktree. Local existence does not prove identity;
retained objects require byte hashes, and Git targets name an immutable commit.
Directories and installed-dependency paths remain navigation descriptors.
"""

from __future__ import annotations

import base64
from functools import lru_cache
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tomllib
from urllib.parse import unquote, urlsplit

from markdown_it import MarkdownIt

from research.records.common import ROOT

EXCLUDED_PARTS = {".git", ".venv", "node_modules", "__pycache__", ".cache", "cache", "caches", "secrets", ".secrets", "credentials"}
PARSER = MarkdownIt("commonmark")


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _canonical(value):
    def normalize(item):
        if isinstance(item, float) and item.is_integer():
            return int(item)
        if isinstance(item, dict):
            return {key: normalize(child) for key, child in item.items()}
        if isinstance(item, list):
            return [normalize(child) for child in item]
        return item
    return json.dumps(normalize(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def _source(provenance):
    return {key: provenance.get(key) for key in ("path", "git_commit", "source_head", "blob_sha256", "locator")}


def _result(status, proof=None, target=None, reason=None):
    value = {"status": status, "proof": proof or {}}
    if target is not None:
        value["target_object"] = target
    if reason:
        value["reason"] = reason
    return value


def _git(root, *args):
    process = subprocess.run(["git", *args], cwd=root, capture_output=True, check=False)
    return process.stdout if process.returncode == 0 else None


@lru_cache(maxsize=512)
def _git_target(root, commit, path):
    fixed = _git(root, "rev-parse", "--verify", "--end-of-options", f"{commit}^{{commit}}")
    if fixed is None:
        return None
    fixed = fixed.decode().strip()
    if not path:
        oid = _git(root, "rev-parse", f"{fixed}^{{tree}}")
        return {"kind": "tree", "commit": fixed, "oid": oid.decode().strip(), "raw": None} if oid else None
    row = _git(root, "ls-tree", "-z", "--full-tree", fixed, "--", path)
    if not row:
        return None
    records = row.rstrip(b"\0").split(b"\0")
    selected = next((item for item in records if item.split(b"\t", 1)[-1].decode("utf-8", errors="surrogateescape") == path), None)
    if selected is None:
        return None
    mode, kind, oid = selected.split(b"\t", 1)[0].decode().split()
    if mode == "120000":
        return {"kind": "symlink", "commit": fixed, "oid": oid}
    if kind not in {"blob", "tree"}:
        return {"kind": "unsupported_git_type", "commit": fixed, "oid": oid}
    raw = _git(root, "show", f"{fixed}:{path}") if kind == "blob" else None
    return {"kind": kind, "commit": fixed, "oid": oid, "raw": raw}


def _object_bytes(obj):
    body, provenance = obj.get("body", {}), obj.get("provenance", {})
    encoded = body.get("content_base64", provenance.get("raw_content_base64"))
    if encoded is None and isinstance(body.get("text"), str):
        raw = body["text"].encode("utf-8")
    elif isinstance(encoded, str):
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError):
            return None, "invalid_raw_payload"
    else:
        return None, "missing_raw_payload"
    actual = _sha(raw)
    declared = body.get("sha256") if body.get("format") else provenance.get("blob_sha256", provenance.get("sha256"))
    if not isinstance(declared, str) or declared != actual:
        return None, "retained_payload_hash_mismatch"
    if obj.get("kind") != "material_section":
        blob_sha = provenance.get("blob_sha256", provenance.get("sha256"))
        if blob_sha is not None and blob_sha != actual:
            return None, "retained_source_hash_mismatch"
    if obj.get("kind") in {"evidence_json", "attempt", "run"}:
        try:
            if _canonical(json.loads(raw)) != _canonical(body):
                return None, "retained_json_body_hash_mismatch"
        except (ValueError, UnicodeDecodeError, TypeError):
            return None, "invalid_retained_json"
    return raw, None


def _pick_object(candidates, commit):
    if not candidates:
        return None
    matching = [obj for obj in candidates if obj.get("provenance", {}).get("git_commit") == commit]
    matching = matching or [obj for obj in candidates if obj.get("provenance", {}).get("git_commit") is None]
    if not matching:
        return None
    # The caller provides one fixed database snapshot. Revisions sharing source
    # bytes may carry later indexing metadata; use its highest retained revision.
    return max(matching, key=lambda obj: obj.get("revision", 0))


class _AnchorParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.anchors = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "a":
            self.anchors.extend(dict.fromkeys(value for key, value in attrs if key.lower() in {"id", "name"} and value))

    handle_startendtag = handle_starttag


@lru_cache(maxsize=128)
def _html_anchors(raw):
    try:
        tokens = PARSER.parse(raw.decode("utf-8"))
    except UnicodeDecodeError:
        return []
    found = []
    for token in tokens:
        html = [(token.content, token.map)] if token.type == "html_block" else []
        if token.type == "inline":
            html.extend((child.content, token.map) for child in token.children or [] if child.type == "html_inline")
        for content, lines in html:
            parser = _AnchorParser()
            parser.feed(content)
            standalone = token.type == "inline" and all(child.type == "html_inline" or child.type == "text" and not child.content.strip() for child in token.children or [])
            syntax = "html_block" if token.type == "html_block" else "standalone_html" if standalone else "html_inline"
            found.extend({"name": value, "lines": lines, "syntax": syntax} for value in parser.anchors)
    return found


def _section_bytes_error(target, parent_raw):
    if target.get("kind") != "material_section":
        return None
    raw, error = _object_bytes(target)
    if error:
        return error
    locator = target.get("provenance", {}).get("locator", {})
    start, end = locator.get("start_byte"), locator.get("end_byte")
    if type(start) is not int or type(end) is not int or not 0 <= start <= end <= len(parent_raw):
        return "invalid_section_byte_bounds"
    if parent_raw[start:end] != raw:
        return "retained_section_bytes_mismatch"
    return None


def _fragment_target(fragment, material, raw, objects):
    path = material["provenance"]["path"]
    sha = material["provenance"].get("blob_sha256", material["body"].get("sha256"))
    sections = [obj for obj in objects if obj.get("kind") == "material_section"
                and obj.get("provenance", {}).get("path") == path
                and obj["provenance"].get("blob_sha256") == sha]
    unique_sections = {}
    for section in sections:
        previous = unique_sections.get(section["id"])
        if previous is None or section.get("revision", 0) > previous.get("revision", 0):
            unique_sections[section["id"]] = section
    sections = list(unique_sections.values())
    # HTML IDs are exact identifiers. Fenced code and inline code are excluded
    # by Markdown tokenization before the standard HTML parser sees content.
    anchors = [anchor for anchor in _html_anchors(raw) if anchor["name"] == fragment]
    if len(anchors) > 1:
        return None, {"reason": "ambiguous_html_anchor", "fragment": fragment}
    if anchors:
        anchor = anchors[0]
        begin, end = anchor["lines"] or (0, 0)
        following = sorted((obj for obj in sections if obj["provenance"]["locator"].get("start_line", 0) - 1 >= begin),
                           key=lambda obj: obj["provenance"]["locator"]["start_line"])
        lines = raw.decode("utf-8").splitlines()
        next_section = next((obj for obj in following if not "\n".join(lines[end:obj["provenance"]["locator"]["start_line"] - 1]).strip()), None) if anchor["syntax"] in {"html_block", "standalone_html"} else None
        containing = [obj for obj in sections if obj["provenance"]["locator"].get("start_line", 0) - 1 <= begin
                      < obj["provenance"]["locator"].get("end_line", 0)]
        target = next_section or (max(containing, key=lambda obj: obj["provenance"]["locator"]["start_line"]) if containing else material)
        error = _section_bytes_error(target, raw)
        if error:
            return None, {"reason": error, "fragment": fragment}
        return target, {"kind": "explicit_html_anchor", "fragment": fragment, "anchor_lines": anchor["lines"], "source_sha256": sha}
    matching = [obj for obj in sections if obj["body"].get("heading_anchor") == fragment]
    method = "heading_anchor"
    if not matching:
        matching = [obj for obj in sections if isinstance(obj["body"].get("explicit_id"), str)
                    and obj["body"]["explicit_id"].casefold() == fragment.casefold()]
        method = "unique_explicit_heading_id"
    identities = {(obj["id"], obj.get("revision", 0)) for obj in matching}
    if len(identities) != 1:
        return None, {"reason": "missing_or_ambiguous_fragment", "fragment": fragment}
    target = matching[0]
    error = _section_bytes_error(target, raw)
    if error:
        return None, {"reason": error, "fragment": fragment}
    return target, {"kind": method, "fragment": fragment, "source_sha256": sha}


def _line_count(raw):
    if raw is None:
        return None
    try:
        raw.decode("utf-8")
    except UnicodeDecodeError:
        return None
    return len(raw.splitlines())


def _reference(body, provenance):
    return {"id": "reference:" + _sha(_canonical(body)), "kind": "reference", "body": body, "provenance": provenance}


def _dependency(path, commit, root, source, line):
    parts = PurePosixPath(path).parts
    if not parts or parts[0] != ".venv" or "site-packages" not in parts:
        return None
    index = parts.index("site-packages")
    if index + 1 >= len(parts):
        return None
    module = parts[index + 1]
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", module):
        return None
    definition = _git_target(str(root), commit, "pyproject.toml")
    if not definition or definition["kind"] != "blob":
        return None
    try:
        project = tomllib.loads(definition["raw"].decode())
    except (ValueError, UnicodeDecodeError):
        return None
    normalized = lambda name: re.sub(r"[-_.]+", "-", name).casefold()
    pin = None
    distribution = None
    for declaration in project.get("project", {}).get("dependencies", []):
        match = re.fullmatch(r"([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?\s*==\s*([^ ;]+)", declaration)
        if match and normalized(match[1]) == normalized(module):
            distribution, pin = match.groups()
            break
    if pin is None:
        return None
    lock = _git_target(str(root), commit, "uv.lock")
    proof = {"kind": "pinned_dependency_descriptor", "source": _source(source),
             "pyproject": {"git_commit": definition["commit"], "git_oid": definition["oid"], "sha256": _sha(definition["raw"])},
             "excluded_target_content_read": False, "line_bounds": "not_checked_excluded_dependency_content"}
    if lock and lock["kind"] == "blob":
        try:
            packages = tomllib.loads(lock["raw"].decode()).get("package", [])
        except (ValueError, UnicodeDecodeError):
            return None
        if not any(normalized(item.get("name", "")) == normalized(distribution) and item.get("version") == pin for item in packages):
            return None
        proof["uv_lock"] = {"git_commit": lock["commit"], "git_oid": lock["oid"], "sha256": _sha(lock["raw"])}
    body = {"category": "dependency_reference", "distribution": distribution, "module": module,
            "version": pin, "path": path, "git_commit": definition["commit"], "target_content_read": False}
    if line is not None:
        body["line"] = line
    return _result("dependency_reference", proof,
                   _reference(body, {"origin": "frozen_dependency_descriptor", "git_commit": definition["commit"], "path": None, "locator": path}))


def resolve_link(href, source_path, source_provenance, objects, *, root=ROOT, repository_root=None, git_commit=None, supplemental_objects=()):
    """Resolve one href without reading any worktree target bytes.

    ``repository_root`` is the original root used by absolute links, and must
    match on a complete path boundary. Supplemental objects are caller-retained
    payloads, not permission to search untracked files. No publication occurs.
    A callable ``objects`` receives the normalized, checked path so callers can
    load only that path's retained revisions at their fixed database snapshot.
    """
    requested_root = Path(root).absolute()
    root = requested_root.resolve()
    repository_root = str(repository_root if repository_root is not None else requested_root).rstrip("/")
    source_provenance = source_provenance or {}
    proof = {"source": _source(source_provenance), "original_href": href}
    if not isinstance(source_path, str) or PurePosixPath(source_path).is_absolute() or ".." in PurePosixPath(source_path).parts:
        return _result("unsafe", proof, reason="invalid_source_path")
    if not isinstance(href, str) or "\x00" in href:
        return _result("unsafe", proof, reason="invalid_link")
    line = None
    before_fragment, separator, fragment_text = href.partition("#")
    parse_href = href
    if "://" not in before_fragment:
        match = re.fullmatch(r"(.*):(\d+)", before_fragment)
        if match:
            before_fragment, line = match[1], int(match[2])
            parse_href = before_fragment + (separator + fragment_text if separator else "")
    try:
        split = urlsplit(parse_href)
    except ValueError:
        return _result("unsafe", proof, reason="invalid_url")
    if split.scheme and split.scheme != "file" or split.netloc and split.scheme != "file":
        if split.scheme.casefold() in {"javascript", "data", "vbscript"}:
            return _result("unsafe", proof, reason="unsafe_url_scheme")
        body = {"category": "external_link", "target": href, "scheme": split.scheme}
        return _result("resolved", dict(proof, kind="external_navigation_reference", target_content_read=False),
                       _reference(body, {"origin": "declared_external_reference", "git_commit": None, "path": None, "locator": href}))
    if split.scheme == "file" and split.netloc not in {"", "localhost"}:
        return _result("unsafe", proof, reason="external_file_host")
    decoded = unquote(split.path)
    fragment = unquote(split.fragment)
    if line is None:
        ending = re.fullmatch(r"(.*):(\d+)", decoded)
        if ending:
            decoded, line = ending[1], int(ending[2])
    if "\x00" in decoded or "\\" in decoded:
        return _result("unsafe", proof, reason="invalid_local_path")
    if decoded.startswith("/"):
        if decoded != repository_root and not decoded.startswith(repository_root + "/"):
            return _result("unsafe", proof, reason="outside_repository_root")
        local = decoded[len(repository_root):].lstrip("/")
    else:
        local = str(PurePosixPath(source_path).parent / decoded) if decoded else source_path
    parts = []
    for part in PurePosixPath(local).parts:
        if part == "..":
            if not parts:
                return _result("unsafe", proof, reason="path_traversal_outside_repository")
            parts.pop()
        elif part not in {".", "", "/"}:
            parts.append(part)
    path = "/".join(parts)
    proof.update(path=path, fragment=fragment, line=line, repository_root=repository_root, percent_decodes=1)
    commit = git_commit or source_provenance.get("git_commit") or source_provenance.get("source_head")
    if commit and not re.fullmatch(r"[0-9a-f]{40}", str(commit)):
        fixed = _git(str(root), "rev-parse", "--verify", "--end-of-options", f"{commit}^{{commit}}")
        if fixed is None:
            return _result("unresolved", proof, reason="invalid_frozen_git_commit")
        commit = fixed.decode().strip()
    if any(part == ".env" or part.startswith(".env.") or part.endswith((".pem", ".key", ".p12")) for part in parts):
        return _result("unsafe", proof, reason="sensitive_path")
    excluded = set(parts) & EXCLUDED_PARTS
    if excluded:
        descriptor = _dependency(path, commit, root, source_provenance, line) if commit and excluded == {".venv"} else None
        if descriptor:
            descriptor["proof"] = {**proof, **descriptor["proof"]}
            return descriptor
        return _result("unsafe", proof, reason="excluded_path")
    current = root
    for part in parts:
        current = current / part
        if current.is_symlink():
            return _result("unsafe", proof, reason="symlink_path")
    if line is not None and line < 1:
        return _result("unresolved", proof, reason="line_out_of_bounds")
    supplied = list(objects(path) if callable(objects) else objects)
    additions = list(supplemental_objects)
    candidates = [obj for obj in supplied + additions if obj.get("kind") in {"material", "evidence_json", "attempt", "run"}
                  and obj.get("provenance", {}).get("path") == path]
    selected = _pick_object(candidates, commit)
    if selected is not None:
        raw, error = _object_bytes(selected)
        if error:
            return _result("unresolved", proof, reason=error)
        retained_commit = selected.get("provenance", {}).get("git_commit")
        if retained_commit:
            retained_git = _git_target(str(root), retained_commit, path)
            if not retained_git or retained_git["kind"] != "blob" or _sha(retained_git["raw"]) != _sha(raw):
                return _result("unresolved", proof, reason="retained_git_source_hash_mismatch")
        if line is not None:
            limit = _line_count(raw)
            if limit is None:
                return _result("unresolved", proof, reason="line_bounds_unavailable")
            if line > limit:
                return _result("unresolved", proof, reason="line_out_of_bounds")
        target = selected
        detail = {"kind": "retained_payload", "object_id": selected["id"], "revision": selected.get("revision"), "sha256": _sha(raw)}
        if fragment:
            target, anchor_proof = _fragment_target(fragment, selected, raw, supplied + additions)
            if target is None:
                return _result("unresolved", dict(proof, **anchor_proof), reason=anchor_proof["reason"])
            detail["anchor"] = anchor_proof
        return _result("resolved", dict(proof, **detail, supplemental=selected in additions), target)
    if not commit:
        return _result("unresolved", proof, reason="missing_frozen_git_commit")
    target = _git_target(str(root), commit, path)
    if target is None:
        ignored = subprocess.run(["git", "check-ignore", "-q", "--", path], cwd=root, capture_output=True).returncode == 0
        return _result("unsafe" if ignored else "unresolved", proof, reason="ignored_unretained_path" if ignored else "target_not_retained_or_in_git")
    if target["kind"] in {"symlink", "unsupported_git_type"}:
        return _result("unsafe", proof, reason="frozen_git_" + target["kind"])
    raw = target["raw"]
    if line is not None:
        limit = _line_count(raw)
        if limit is None:
            return _result("unresolved", proof, reason="line_out_of_bounds" if raw is None else "line_bounds_unavailable")
        if line > limit:
            return _result("unresolved", proof, reason="line_out_of_bounds")
    if fragment:
        if raw is None or not any(anchor["name"] == fragment for anchor in _html_anchors(raw)):
            return _result("unresolved", proof, reason="fragment_not_retained")
    body = {"category": "git_" + target["kind"], "git_commit": target["commit"], "path": path, "git_oid": target["oid"]}
    if raw is not None:
        body.update(sha256=_sha(raw), byte_length=len(raw))
    if line is not None:
        body["line"] = line
    if fragment:
        body["fragment"] = fragment
    provenance = {"origin": "frozen_git_navigation", "source_head": target["commit"], "git_commit": target["commit"],
                  "path": path, "blob_sha256": _sha(raw) if raw is not None else None,
                  "locator": {"git_oid": target["oid"], "line": line, "fragment": fragment}, "worktree_state": "committed"}
    detail = {"kind": "git_navigation", "git_commit": target["commit"], "git_oid": target["oid"], "git_kind": target["kind"], "sha256": body.get("sha256"), "target_content_read": target["kind"] == "blob", "directory_is_evidence": False}
    return _result("resolved", dict(proof, **detail), _reference(body, provenance))
