import re
from pathlib import Path


PY_HANDLE = re.compile(
    r"fn\s+(py_handle_(?:quote_tick|trade_tick|bar|book|delta|deltas|depth))\s*\(",
)

EXPECTED_DELEGATE = {
    "py_handle_quote_tick": "self.handle_quote(",
    "py_handle_trade_tick": "self.handle_trade(",
    "py_handle_bar": "self.handle_bar(",
    "py_handle_book": "self.handle_book(",
    "py_handle_delta": "self.handle_delta(",
    "py_handle_deltas": "self.handle_deltas(",
    "py_handle_depth": "self.handle_depth(",
}


def test_python_indicator_handlers_delegate_to_rust_core() -> None:
    # Arrange
    rust_source = Path(__file__).resolve().parents[4] / "crates" / "indicators" / "src" / "python"
    handlers = 0
    failures: list[str] = []

    # Act
    assert rust_source.is_dir()

    for file_path in sorted(rust_source.rglob("*.rs")):
        source = file_path.read_text()
        for match in PY_HANDLE.finditer(source):
            handlers += 1
            function_name = match.group(1)
            body = _function_body(source, match.end())
            expected_delegate = EXPECTED_DELEGATE[function_name]
            if expected_delegate not in body:
                failures.append(f"{file_path.relative_to(rust_source)}::{function_name}")

    # Assert
    assert handlers > 0
    assert failures == []


def _function_body(source: str, signature_end: int) -> str:
    body_start = source.find("{", signature_end)
    assert body_start >= 0

    depth = 0

    for index in range(body_start, len(source)):
        char = source[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[body_start + 1 : index]

    raise AssertionError("unterminated Rust function body")
