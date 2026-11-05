"""Entry point: python3 ide/ide.py {check,compare,serve} ... (standard library only)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from research_graph.cli import main

sys.exit(main())
