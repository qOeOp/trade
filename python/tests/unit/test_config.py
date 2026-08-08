import ast
import importlib
from pathlib import Path

from vibe_trader import config


CONFIG_MODULE_NAMES = (
    "analysis",
    "backtest",
    "common",
    "data",
    "execution",
    "live",
    "portfolio",
    "risk",
    "trading",
)
CONFIG_NAMES_EXCLUDED = frozenset(
    {
        "BookImbalanceActorConfig",
        "CompositeMarketMakerConfig",
        "DeltaNeutralVolConfig",
        "EmaCrossConfig",
        "GridMarketMakerConfig",
        "HurstVpinDirectionalConfig",
    },
)


def test_config_reexports_curated_core_surface() -> None:
    expected = {}

    for module_name in CONFIG_MODULE_NAMES:
        module = importlib.import_module(f"vibe_trader.{module_name}")
        expected.update(
            {
                name: value
                for name, value in vars(module).items()
                if name.endswith("Config") and name not in CONFIG_NAMES_EXCLUDED
            },
        )

    actual = {name: getattr(config, name) for name in config.__all__}

    assert config.__all__ == sorted(expected)
    assert actual == expected


def test_config_stub_matches_runtime_exports() -> None:
    stub_path = Path(config.__file__).with_suffix(".pyi")
    tree = ast.parse(stub_path.read_text())
    stub_imports = {
        alias.name for node in tree.body if isinstance(node, ast.ImportFrom) for alias in node.names
    }
    stub_exports = next(
        ast.literal_eval(node.value)
        for node in tree.body
        if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "__all__" for target in node.targets)
    )

    assert stub_exports == config.__all__
    assert stub_imports == set(config.__all__)
