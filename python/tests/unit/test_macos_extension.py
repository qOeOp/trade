import subprocess
import sys
import textwrap

import pytest


pytestmark = pytest.mark.skipif(sys.platform != "darwin", reason="macOS-specific extension tests")


@pytest.mark.parametrize(
    ("script", "expected_stdout"),
    [
        pytest.param(
            """
            import pyarrow
            import vibe_trader

            print("reached end", flush=True)
            """,
            "reached end\n",
            id="pyarrow-before-vibe",
        ),
        pytest.param(
            """
            import vibe_trader
            import pandas

            from vibe_trader.model import Currency

            Currency.from_str("USDC")
            print("currency constructed", flush=True)
            """,
            "currency constructed\n",
            id="currency-after-pandas",
        ),
        pytest.param(
            """
            import tempfile

            from vibe_trader.persistence import ParquetDataCatalog
            import pandas

            with tempfile.TemporaryDirectory() as directory:
                ParquetDataCatalog(directory)
            print("catalog constructed", flush=True)
            """,
            "catalog constructed\n",
            id="catalog-with-pandas",
        ),
    ],
)
def test_reported_pyarrow_reproductions_in_fresh_process(
    script: str,
    expected_stdout: str,
) -> None:
    pytest.importorskip("pandas")
    pytest.importorskip("pyarrow")

    result = subprocess.run(
        [sys.executable, "-c", textwrap.dedent(script)],
        capture_output=True,
        check=False,
        text=True,
    )

    assert result.returncode == 0, (result.stdout, result.stderr)
    assert result.stdout == expected_stdout
