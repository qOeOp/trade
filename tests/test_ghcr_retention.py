"""Which GHCR versions the retention workflow may delete: only old pull request builds."""

from datetime import UTC, datetime
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("ghcr_retention", ROOT / ".github/scripts/ghcr-retention.py")
assert spec and spec.loader
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)

NOW = datetime(2026, 12, 31, tzinfo=UTC)
PR_COMMIT, MAIN_COMMIT = "a" * 40, "b" * 40
DIGEST = "sha256:" + "c" * 64


def version(*tags, updated="2026-11-01T00:00:00Z", name=DIGEST):
    return {"name": name, "updated_at": updated, "metadata": {"container": {"tags": list(tags)}}}


def removable(item, pinned=frozenset()):
    return retention.removable(item, NOW, lambda sha: sha == MAIN_COMMIT, set(pinned))


class RetentionTests(unittest.TestCase):
    def test_an_old_pull_request_index_and_its_native_manifests_go(self):
        for tags in (("pr-12", f"sha-{PR_COMMIT}"), ("pr-12-amd64", f"sha-{PR_COMMIT}-amd64"), ("pr-12-arm64",)):
            self.assertTrue(removable(version(*tags)), tags)

    def test_everything_else_stays(self):
        for item in (
            version("pr-12", f"sha-{PR_COMMIT}", updated="2026-12-15T00:00:00Z"),  # retagged within 30 days
            version(),  # untagged: an index may still name it
            version(f"sha-{PR_COMMIT}"),  # no pull request tag
            version("pr-12", "main"),
            version("pr-12", "v0.5.0"),
            version("exec-pr-12", f"exec-sha-{PR_COMMIT}"),  # an execution runtime build
            version("pr-12", f"sha-{MAIN_COMMIT}"),  # a commit of main
            version("pr-12-amd64", f"sha-{MAIN_COMMIT}-amd64"),
            version("pr-12", "latest"),
        ):
            self.assertFalse(removable(item), item["metadata"]["container"]["tags"])
        self.assertFalse(removable(version("pr-12"), pinned={DIGEST}))


if __name__ == "__main__":
    unittest.main()
