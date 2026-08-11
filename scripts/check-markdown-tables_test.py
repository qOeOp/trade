#!/usr/bin/env python3
"""
Tests for the Markdown table normalizer.
"""

import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("check-markdown-tables.py")
SPEC = importlib.util.spec_from_file_location("check_markdown_tables", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DisplayWidthTests(unittest.TestCase):
    def test_counts_cjk_as_two_columns(self):
        assert MODULE.display_width("\u4e2d\u6587 A") == 6

    def test_ignores_combining_marks(self):
        assert MODULE.display_width("e\u0301") == 1


class NormalizeTableTests(unittest.TestCase):
    def test_aligns_mixed_cjk_and_ascii_by_display_width(self):
        rows = [
            "| Name | \u8bf4\u660e |",
            "| --- | --- |",
            "| API | English |",
            "| \u4e2d\u6587 | \u503c |",
        ]

        normalized = MODULE.normalize_table(rows)

        assert normalized == [
            "| Name | \u8bf4\u660e    |",
            "| ---- | ------- |",
            "| API  | English |",
            "| \u4e2d\u6587 | \u503c      |",
        ]
        assert MODULE.normalize_table(normalized) == normalized


if __name__ == "__main__":
    unittest.main()
