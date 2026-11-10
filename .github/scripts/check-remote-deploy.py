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
    values = {"TRADE_DOMAIN": "www.vibe-trading.info", "TRADE_GITHUB_ORG": "dummy-org", "TRADE_GITHUB_TEAM": "operators",
              "TRADE_GITHUB_CLIENT_ID": "isolated-dummy-client",
              "TRADE_RESEARCH_ORIGIN": "https://doltremoteapi.dolthub.com/dummy/research", "TRADE_UID": "1000", "TRADE_GID": "1000",
              "TRADE_DATA": str(root / "data"), "TRADE_GITHUB_CLIENT_SECRET_FILE": str(root / "client"),
              "TRADE_OAUTH_COOKIE_SECRET_FILE": str(root / "cookie")}
    env_file = root / "dummy.env"
    env_file.write_text("\n".join(f"{key}={value}" for key, value in values.items()))
    unnamed = subprocess.run(["docker", "compose", "--env-file", str(env_file), "-f", "deploy/compose.yaml",
                              "config", "--quiet"],
                             env={**os.environ, **values}, capture_output=True, text=True)
    assert unnamed.returncode != 0 and "deploy/images.py" in unnamed.stderr, "compose ran with no images named"
    digest = "sha256:" + "0" * 64
    values |= {"TRADE_IDE_IMAGE": f"ghcr.io/qoeop/trade-ide@{digest}",
               "TRADE_SERVICE_IMAGE": f"ghcr.io/qoeop/trade-service@{digest}",
               "TRADE_RUNTIME_IMAGE": f"ghcr.io/qoeop/trade-runtime@{digest}"}
    env_file.write_text("\n".join(f"{key}={value}" for key, value in values.items()))
    result = subprocess.run(["docker", "compose", "--env-file", str(env_file), "-f", "deploy/compose.yaml",
                             "-f", "deploy/remote/compose.yaml", "config", "--format", "json"],
                            env={**os.environ, **values}, capture_output=True, text=True, check=True)
    services = json.loads(result.stdout)["services"]
    moving = {name: service["image"] for name, service in services.items() if "@sha256:" not in service["image"]}
    assert not moving, f"images a pull can change: {moving}"
    exposed = {name for name, service in services.items() if service.get("ports")}
    assert exposed == {"edge"}, f"origin bypass: publicly exposed services {exposed}"
    assert set(services["edge"]["networks"]) == {"edge"}
    # The release plane runs the Web, its Agent and the Paper controller; the project starts neither.
    assert not {"ide", "paper"} & set(services), "a whole-project up would start a second Agent or Paper controller"
    assert "docker-api" not in services["oauth2"]["networks"]
    oauth_env = services["oauth2"]["environment"]
    assert (oauth_env["OAUTH2_PROXY_GITHUB_ORG"], oauth_env["OAUTH2_PROXY_GITHUB_TEAM"]) == ("dummy-org", "operators")
    assert "OAUTH2_PROXY_GITHUB_USERS" not in oauth_env, "a username list beside the team"
    oauth_config = Path("deploy/remote/oauth2-proxy.cfg").read_text()
    assert 'scope = "user:email read:org"' in oauth_config
    for name in set(services) - {"oauth2"}:
        assert not services[name].get("secrets"), f"OAuth secret leaked into {name}"
        assert not any("/run/dolthub" in mount["target"] for mount in services[name].get("volumes", [])), \
            f"research publishing credential mounted in {name}"
    assert "mirror" in services["ledger"]["command"]
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
    assert not {"ide", "paper"} & set(released)
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
    assert not {"ide", "paper"} & set(execution)
    assert execution["ledger"] == services["ledger"]
    assert execution["docker-api"] == services["docker-api"]
    print("Paper release router exposes no port and does not recreate the execution/ledger configuration")
