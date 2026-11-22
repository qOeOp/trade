"""Anonymous reads of the public GHCR packages the release and the image resolver use."""

import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


MANIFESTS = ", ".join(f"application/vnd.{kind}" for kind in (
    "oci.image.index.v1+json", "docker.distribution.manifest.list.v2+json", "oci.image.manifest.v1+json",
    "docker.distribution.manifest.v2+json"))


class Registry:
    """Anonymous reads of the public GHCR packages."""

    def __init__(self, timeout: float = 60):
        self.tokens: dict[str, str] = {}
        self.timeout = timeout

    def get(self, repository: str, path: str, accept: str | None = None) -> dict:
        name = repository.removeprefix("ghcr.io/")
        if name not in self.tokens:
            self.tokens[name] = self.fetch(f"https://ghcr.io/token?scope=repository:{name}:pull", {})["token"]
        headers = {"Authorization": f"Bearer {self.tokens[name]}"}
        if accept:
            headers["Accept"] = accept
        return self.fetch(f"https://ghcr.io/v2/{name}/{path}", headers)

    def fetch(self, url: str, headers: dict) -> dict:
        with urlopen(Request(url, headers=headers), timeout=self.timeout) as response:
            return json.load(response)

    def manifest(self, repository: str, reference: str) -> dict:
        return self.get(repository, f"manifests/{reference}", MANIFESTS)

    def config(self, repository: str, digest: str) -> dict:
        return self.get(repository, f"blobs/{self.manifest(repository, digest)['config']['digest']}")

    def serves(self, image: str) -> bool:
        """Whether anyone can still pull this digest from its registry; False when that cannot be read."""
        name, digest = image.split("@", 1)
        try:
            self.manifest(name, digest)
            return True
        except (HTTPError, URLError, OSError, ValueError, KeyError):
            return False
