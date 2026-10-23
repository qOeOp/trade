"""Entry point: python3 services/research-graph/graph.py {check,render,compare} ... (standard library only)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from research_graph.cli import main  # noqa: E402

sys.exit(main())
