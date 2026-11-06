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
    oauth_config = Path("deploy/remote/oauth2-proxy.cfg").read_text()
    assert 'scope = "user:email read:org"' in oauth_config
    for name in ("ide", "paper", "ledger"):
        assert not services[name].get("secrets"), f"OAuth secret leaked into {name}"
        assert not any("/run/dolthub" in mount["target"] for mount in services[name].get("volumes", [])), \
            f"research publishing credential mounted in {name}"
    assert "mirror" in services["ledger"]["command"]
    assert "--research-ledger" in services["paper"]["command"]
    assert "--research=http://ledger:8769" in services["ide"]["command"]
    assert services["ide"]["environment"]["TRADE_IDE_CHAT"] == "1"
    assert any(mount["type"] == "volume" and mount["source"].endswith("trade-ide-agent")
               and mount["target"] == "/data/agent" and not mount.get("read_only", False)
               for mount in services["ide"]["volumes"])
    assert len(services["oauth2"]["secrets"]) == 2
    print("Remote deployment boundary passed with dummy configuration")
    cd = subprocess.run(["docker", "compose", "--env-file", str(env_file), "-f", "deploy/compose.yaml",
                         "-f", "deploy/remote/compose.yaml", "-f", "deploy/remote/cd.compose.yaml",
                         "config", "--format", "json"],
                        env={**os.environ, **values}, capture_output=True, text=True, check=True)
    released = json.loads(cd.stdout)["services"]
    assert {name for name, service in released.items() if service.get("ports")} == {"edge"}
    assert set(released["ide-router"]["networks"]) == {"frontend"}
    assert not released["ide-router"].get("secrets")
    assert "--upstream=http://ide-router:8765/" in released["oauth2"]["command"]
    assert released["paper"] == services["paper"]
    assert released["ledger"] == services["ledger"]
    print("Continuous Web routing preserves the existing authentication and execution boundaries")

    paper_cd = subprocess.run(["docker", "compose", "--env-file", str(env_file), "-f", "deploy/compose.yaml",
                               "-f", "deploy/remote/compose.yaml", "-f", "deploy/remote/cd.compose.yaml",
                               "-f", "deploy/remote/paper-cd.compose.yaml", "config", "--format", "json"],
                              env={**os.environ, **values}, capture_output=True, text=True, check=True)
    execution = json.loads(paper_cd.stdout)["services"]
    assert {name for name, service in execution.items() if service.get("ports")} == {"edge"}
    assert set(execution["paper-router"]["networks"]) == {"default"}
    assert not execution["paper-router"].get("secrets")
    assert execution["paper"] == services["paper"]
    assert execution["ledger"] == services["ledger"]
    assert execution["docker-api"] == services["docker-api"]
    print("Paper release router exposes no port and does not recreate the execution/ledger configuration")
