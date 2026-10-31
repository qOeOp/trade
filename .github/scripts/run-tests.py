"""Run each test module in its own process, as many at once as the runner has CPUs.

The tests mostly wait on the throwaway Dolt services and subprocesses they start, so one process
leaves the runner idle. Modules are the ones `unittest discover -s tests -t . -p 'test_*.py'`
finds; each module's output is printed whole when it ends, and any failed module fails the run.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
import os
from pathlib import Path
import subprocess
import sys
import time


def modules(root: Path) -> list[str]:
    """Discovery's modules: test_*.py files in packages reachable from tests/ through __init__.py."""
    found = []
    for directory, subdirectories, files in os.walk(root):
        if not (Path(directory) / "__init__.py").exists():
            subdirectories.clear()
            continue
        subdirectories.sort()
        relative = Path(directory).relative_to(root.parent)
        found += [".".join((*relative.parts, name[:-3])) for name in sorted(files)
                  if name.startswith("test_") and name.endswith(".py")]
    return found


def run(module: str) -> tuple[str, int, float, str]:
    start = time.monotonic()
    done = subprocess.run([sys.executable, "-m", "unittest", module], capture_output=True, text=True, check=False)
    return module, done.returncode, time.monotonic() - start, done.stdout + done.stderr


def main() -> None:
    names = modules(Path("tests"))
    if not names:
        raise SystemExit("no test modules found under tests/")
    workers = os.process_cpu_count() or 1
    print(f"{len(names)} test modules, {workers} at a time", flush=True)
    results = []
    with ThreadPoolExecutor(workers) as pool:
        for future in as_completed([pool.submit(run, name) for name in names]):
            module, code, seconds, output = future.result()
            results.append((module, code, seconds))
            print(f"=== {module}: {'ok' if code == 0 else f'FAILED (exit {code})'} in {seconds:.1f} s", flush=True)
            print(output, end="" if output.endswith("\n") else "\n", flush=True)
    print("Slowest modules:")
    for module, _, seconds in sorted(results, key=lambda result: -result[2])[:15]:
        print(f"{seconds:8.1f} s  {module}")
    failed = sorted(module for module, code, _ in results if code != 0)
    if failed:
        raise SystemExit("failed modules: " + ", ".join(failed))


if __name__ == "__main__":
    main()
