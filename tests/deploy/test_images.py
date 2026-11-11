"""Which admitted images a compose env file gets, with the channel and the registry faked."""
from pathlib import Path
import json
import tempfile
import unittest
from unittest.mock import Mock

from deploy.images import SPLIT, admitted, native, resolve, write_env
from deploy.release_host import IMAGE_REF, SOURCE


OLD, NEW, LATEST = "a" * 40, "b" * 40, "c" * 40
AMD, ARM, OTHER = "sha256:" + "1" * 64, "sha256:" + "2" * 64, "sha256:" + "3" * 64
IDE = "ghcr.io/qoeop/trade-ide"


def record(revision, image=True):
    return {"revision": revision, "image": f"{IDE}@{AMD}" if image else None,
            "service": f"svc-{revision}" if image else None, "runtime": "runtime"}


class Registry:
    """One build per digest; `index` is what the sha tag of each revision publishes."""

    def __init__(self, configs, index):
        self.configs, self.index = configs, index

    def config(self, _repository, digest):
        architecture, revision, source = self.configs[digest]
        return {"architecture": architecture, "config": {"Labels": {
            "org.opencontainers.image.revision": revision, "org.opencontainers.image.source": source}}}

    def manifest(self, _repository, reference):
        return {"manifests": [{"digest": digest, "platform": {"architecture": architecture}}
                              for architecture, digest in self.index[reference].items()]}


def built(index=None, configs=None):
    return Registry(configs or {AMD: ("amd64", NEW, SOURCE), ARM: ("arm64", NEW, SOURCE)},
                    {f"sha-{NEW}": index or {"amd64": AMD, "arm64": ARM}})


class AdmittedTests(unittest.TestCase):
    def test_a_newer_revision_still_in_checks_leaves_the_newest_admitted(self):
        history = [record(LATEST, image=False), record(NEW), record(NEW, image=False), record(OLD)]
        self.assertEqual(admitted(history)["revision"], NEW)

    def test_a_later_null_withdraws_that_revision_only(self):
        history = [record(NEW, image=False), record(NEW), record(OLD)]
        self.assertEqual(admitted(history)["revision"], OLD)
        with self.assertRaises(RuntimeError):
            admitted(history, NEW)

    def test_an_earlier_revision_can_be_named(self):
        self.assertEqual(admitted([record(NEW), record(OLD)], OLD)["revision"], OLD)

    def test_a_record_that_names_only_the_ide_is_never_chosen(self):
        with self.assertRaises(RuntimeError):
            admitted([{"revision": OLD, "image": f"{IDE}@{AMD}"}])


class NativeTests(unittest.TestCase):
    def test_this_cpu_gets_its_image_of_the_admitted_build(self):
        self.assertEqual(native(built(), f"{IDE}@{AMD}", IMAGE_REF, "arm64", NEW), (f"{IDE}@{ARM}", NEW))
        self.assertEqual(native(built(), f"{IDE}@{AMD}", IMAGE_REF, "amd64", NEW), (f"{IDE}@{AMD}", NEW))

    def test_refuses_a_build_that_cannot_be_bound_to_the_admission(self):
        cases = {
            "another revision": (built(), f"{IDE}@{AMD}", OLD),
            "the tag moved to another build": (built(index={"amd64": OTHER, "arm64": ARM},
                                                     configs={AMD: ("amd64", NEW, SOURCE)}), f"{IDE}@{AMD}", NEW),
            "no image for this CPU": (built(index={"amd64": AMD}), f"{IDE}@{AMD}", NEW),
            "the sibling is another revision": (built(configs={AMD: ("amd64", NEW, SOURCE), ARM: ("arm64", OLD, SOURCE)}),
                                                f"{IDE}@{AMD}", NEW),
            "the sibling is another CPU": (built(configs={AMD: ("amd64", NEW, SOURCE), ARM: ("amd64", NEW, SOURCE)}),
                                           f"{IDE}@{AMD}", NEW),
            "another repository's source": (built(configs={AMD: ("amd64", NEW, "https://example.invalid/x")}),
                                            f"{IDE}@{AMD}", NEW),
            "a moving tag": (built(), f"{IDE}:main", NEW),
            "another package": (built(), f"ghcr.io/qoeop/other@{AMD}", NEW),
        }
        for name, (registry, reference, revision) in cases.items():
            with self.subTest(name), self.assertRaises(RuntimeError):
                native(registry, reference, IMAGE_REF, "arm64", revision)


class ResolveTests(unittest.TestCase):
    def test_actual_registry_runtime_revision_must_match_service_inputs(self):
        class OlderRuntime(Registry):
            def config(self, repository, digest):
                value = super().config(repository, digest)
                if repository.endswith("/trade-runtime"):
                    value["config"]["Labels"]["org.opencontainers.image.revision"] = OLD
                return value

            def manifest(self, repository, reference):
                # The release's runtime is the execution image, whose index is exec-sha-REV; sha-REV is the replay
                # image's, which holds other digests.
                if repository.endswith("/trade-runtime"):
                    if not reference.startswith("exec-"):
                        raise KeyError(reference)
                    reference = reference.removeprefix("exec-")
                return super().manifest(repository, reference)

        registry = OlderRuntime({AMD: ("amd64", NEW, SOURCE), ARM: ("arm64", NEW, SOURCE)},
                                {f"sha-{sha}": {"amd64": AMD, "arm64": ARM} for sha in (OLD, NEW)})
        source = Mock()
        source.ancestor.return_value = True
        admission = {"revision": NEW, "image": f"{IDE}@{AMD}",
                     "service": f"ghcr.io/qoeop/trade-service@{AMD}",
                     "runtime": f"ghcr.io/qoeop/trade-runtime@{AMD}"}
        source.git.side_effect = lambda *args: {"log": "commit", "show": json.dumps(admission),
                                                "rev-parse": LATEST, "ls-tree": SPLIT + "\n"}[args[0]]
        revision, values = resolve(source, registry, "arm64", None)
        self.assertEqual(revision, NEW)
        self.assertEqual(values["TRADE_RUNTIME_IMAGE"], f"ghcr.io/qoeop/trade-runtime@{ARM}")
        source.require_runtime.assert_called_once_with(OLD, NEW)
        source.require_runtime.side_effect = RuntimeError("runtime build inputs differ")
        with self.assertRaisesRegex(RuntimeError, "build inputs"):
            resolve(source, registry, "arm64", None)

    def test_a_runtime_built_before_the_split_is_the_combined_image_of_its_own_index(self):
        """The release's runtime is read at exec-sha-REV when its revision has the split, else at sha-REV: there the
        one combined image replays and executes. Whether it has the split is read from Git, never from a 404."""
        runtime = "ghcr.io/qoeop/trade-runtime"
        admission = {"revision": NEW, "image": f"{IDE}@{AMD}", "service": f"ghcr.io/qoeop/trade-service@{AMD}",
                     "runtime": f"{runtime}@{OTHER}"}
        configs = {AMD: ("amd64", NEW, SOURCE), ARM: ("arm64", NEW, SOURCE),
                   OTHER: ("amd64", OLD, SOURCE), "sha256:" + "4" * 64: ("arm64", OLD, SOURCE)}
        combined = {"amd64": OTHER, "arm64": "sha256:" + "4" * 64}

        class Runtimes(Registry):
            def __init__(self, runtime_indexes):
                super().__init__(configs, {f"sha-{NEW}": {"amd64": AMD, "arm64": ARM}})
                self.runtime_indexes = runtime_indexes

            def manifest(self, repository, reference):
                if repository == runtime:
                    self.read = reference
                    return {"manifests": [
                        {"digest": digest, "platform": {"architecture": arch}}
                        for arch, digest in self.runtime_indexes[reference].items()]}
                return super().manifest(repository, reference)

        def source(split: bool):
            found = Mock()
            found.ancestor.return_value = True
            found.git.side_effect = lambda *args: {"log": "commit", "show": json.dumps(admission), "rev-parse": LATEST,
                                                   "ls-tree": SPLIT + "\n" if split else ""}[args[0]]
            return found

        before = Runtimes({f"sha-{OLD}": combined})
        _, values = resolve(source(split=False), before, "arm64", None)
        self.assertEqual((values["TRADE_RUNTIME_IMAGE"], before.read), (f"{runtime}@sha256:{'4' * 64}", f"sha-{OLD}"))
        after = Runtimes({f"exec-sha-{OLD}": combined, f"sha-{OLD}": {"amd64": AMD, "arm64": ARM}})
        _, values = resolve(source(split=True), after, "arm64", None)
        self.assertEqual((values["TRADE_RUNTIME_IMAGE"], after.read), (f"{runtime}@sha256:{'4' * 64}", f"exec-sha-{OLD}"))
        # After the split, a build with no execution index is refused, never taken from the replay image's index.
        with self.assertRaises(KeyError):
            resolve(source(split=True), Runtimes({f"sha-{OLD}": combined}), "arm64", None)
        # A runtime built off main is refused before its index is read.
        off_main = source(split=False)
        off_main.ancestor.side_effect = lambda before_, after_: before_ != OLD
        with self.assertRaisesRegex(RuntimeError, "not on main"):
            resolve(off_main, Runtimes({f"sha-{OLD}": combined}), "arm64", None)

    def test_a_build_off_main_is_refused(self):
        class Source:
            def git(self, *args):
                if args[0] == "log":
                    return "commit"
                if args[0] == "show":
                    return ('{"revision":"%s","image":"%s@%s","service":"ghcr.io/qoeop/trade-service@%s",'
                            '"runtime":"ghcr.io/qoeop/trade-runtime@%s"}' % (NEW, IDE, AMD, AMD, AMD))
                return LATEST

            def ancestor(self, before, after):
                return False

        with self.assertRaisesRegex(RuntimeError, "not on main"):
            resolve(Source(), built(), "arm64", None)

    def test_versions_by_default_and_every_main_build_only_when_asked(self):
        for arguments, branch in (((), "refs/heads/deploy-ready"), (("main-ready",), "refs/heads/main-ready")):
            source = Mock()
            source.ancestor.return_value = True
            source.git.side_effect = lambda *args: {"log": "", "rev-parse": LATEST}[args[0]]
            with self.subTest(branch), self.assertRaisesRegex(RuntimeError, "no admitted record"):
                resolve(source, built(), "arm64", None, *arguments)
            source.git.assert_called_once_with("log", "--format=%H", branch, "--", "release.json")


class WriteEnvTests(unittest.TestCase):
    def test_replaces_its_keys_and_keeps_every_other_line(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text("TRADE_UID=1\n# a note\nTRADE_IDE_IMAGE=old\nTRADE_DATA=/x\n")
            path.chmod(0o640)
            write_env(path, {"TRADE_IDE_IMAGE": "new", "TRADE_SERVICE_IMAGE": "svc"})
            self.assertEqual(path.read_text(),
                             "TRADE_UID=1\n# a note\nTRADE_DATA=/x\nTRADE_IDE_IMAGE=new\nTRADE_SERVICE_IMAGE=svc\n")
            self.assertEqual(path.stat().st_mode & 0o777, 0o640)
            self.assertEqual([item.name for item in Path(directory).iterdir()], [".env"])


if __name__ == "__main__":
    unittest.main()
