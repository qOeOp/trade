"""A local RFC 3161 timestamp authority for offline tests: its own root, TSA certificate and replies."""

from __future__ import annotations

from pathlib import Path
import shutil
import subprocess
import tempfile


def _run(*argv: str, cwd: Path) -> None:
    subprocess.run(["openssl", *argv], cwd=cwd, check=True, capture_output=True, timeout=60)


class LocalAuthority:
    """`roots` is the PEM to verify against; `respond(query)` signs a TimeStampResp for a query."""

    def __init__(self):
        self.root = Path(tempfile.mkdtemp(prefix="tsa-", dir="/tmp"))
        directory = self.root
        (directory / "tsa.ext").write_text("basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\n"
                                           "extendedKeyUsage=critical,timeStamping\n")
        _run("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "30",
             "-subj", "/CN=Ledger Test Root", "-addext", "basicConstraints=critical,CA:TRUE",
             "-addext", "keyUsage=critical,keyCertSign,cRLSign", cwd=directory)
        _run("req", "-newkey", "rsa:2048", "-nodes", "-keyout", "tsa.key", "-out", "tsa.csr",
             "-subj", "/CN=Ledger Test TSA", cwd=directory)
        _run("x509", "-req", "-in", "tsa.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial",
             "-out", "tsa.pem", "-days", "30", "-extfile", "tsa.ext", cwd=directory)
        (directory / "serial").write_text("01\n")
        (directory / "ts.cnf").write_text(
            "[ tsa ]\ndefault_tsa = local\n[ local ]\n"
            f"serial = {directory / 'serial'}\nsigner_cert = {directory / 'tsa.pem'}\n"
            f"certs = {directory / 'ca.pem'}\nsigner_key = {directory / 'tsa.key'}\nsigner_digest = sha256\n"
            "default_policy = 1.2.3.4.1\ndigests = sha256\naccuracy = secs:1\nordering = no\ntsa_name = no\n"
            "ess_cert_id_chain = no\ness_cert_id_alg = sha256\nclock_precision_digits = 0\n")
        self.roots = directory / "ca.pem"
        self.queries = 0

    def respond(self, url: str, query: bytes) -> bytes:
        self.queries += 1
        (self.root / "query.tsq").write_bytes(query)
        _run("ts", "-reply", "-config", str(self.root / "ts.cnf"), "-queryfile", "query.tsq", "-out", "reply.tsr",
             cwd=self.root)
        return (self.root / "reply.tsr").read_bytes()

    def close(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)
