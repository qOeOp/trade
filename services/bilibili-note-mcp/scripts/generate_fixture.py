from __future__ import annotations

import argparse
from pathlib import Path

from bilibili_note_mcp.fixture import generate_fixture


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    args = parser.parse_args()
    generate_fixture(args.root.resolve())


if __name__ == "__main__":
    main()
