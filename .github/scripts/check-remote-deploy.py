"""Resolve only dummy deployment configuration; assert the public authentication boundary."""
import json
import os
from pathlib import Path
import subprocess
import tempfile


with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    for name in ("client", "cookie"):
        (root / name).write_bytes(b"0123456789abcdef0123456789abcdef")
    values = {"TRADE_DOMAIN": "www.vibe-trading.info", "TRADE_GITHUB_USERS": "qOeOp",
              "TRADE_GITHUB_CLIENT_ID": "isolated-dummy-client", "TRADE_UID": "1000", "TRADE_GID": "1000",
              "TRADE_DATA": str(root / "data"), "TRADE_GITHUB_CLIENT_SECRET_FILE": str(root / "client"),
              "TRADE_OAUTH_COOKIE_SECRET_FILE": str(root / "cookie")}
    env_file = root / "dummy.env"
    env_file.write_text("\n".join(f"{key}={value}" for key, value in values.items()))
    result = subprocess.run(["docker", "compose", "--env-file", str(env_file), "-f", "deploy/compose.yaml",
                             "-f", "deploy/remote/compose.yaml", "config", "--format", "json"],
                            env={**os.environ, **values}, capture_output=True, text=True, check=True)
    services = json.loads(result.stdout)["services"]
    exposed = {name for name, service in services.items() if service.get("ports")}
    assert exposed == {"edge"}, f"origin bypass: publicly exposed services {exposed}"
    assert set(services["edge"]["networks"]) == {"edge"}
    assert "docker-api" not in services["ide"]["networks"]
    assert "docker-api" not in services["oauth2"]["networks"]
    assert services["oauth2"]["environment"]["OAUTH2_PROXY_GITHUB_USERS"] == "qOeOp"
    for name in ("ide", "paper", "ledger"):
        assert not services[name].get("secrets"), f"OAuth secret leaked into {name}"
        assert not any("/run/dolthub" in mount["target"] for mount in services[name].get("volumes", [])), \
            f"research publishing credential mounted in {name}"
    assert "mirror" in services["ledger"]["command"]
    assert "--research-ledger" in services["paper"]["command"]
    assert "--research=http://ledger:8769" in services["ide"]["command"]
    assert services["ide"]["environment"]["TRADE_IDE_CHAT"] == "0"
    assert len(services["oauth2"]["secrets"]) == 2
    print("Remote deployment boundary passed with dummy configuration")
