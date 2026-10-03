#!/usr/bin/env python3
"""
Report every environment variable the R&D Owner API requires on its startup path, in the
build the deployment image makes, that its compose service does not pass in.

A missing variable does not fail `docker compose config`: the service dies at startup, before it
binds a port, so every route reads as unreachable for a reason no route owns.

Three readings make up "required in the build the image makes":

- `required_env("X")` in `async fn run()`, unconditionally or under a `#[cfg(feature = "...")]`
  that the image's `cargo build` enables, with each feature's own features expanded from the
  crate's `[features]` table;
- the variables a Market Data constructor on that path reads inside the data crate, where this
  check cannot read them from `run()`: pinned in `LIBRARY_READS`, and calibrated against each
  constructor's body;
- a constructor named like `*_from_*environment*` that `LIBRARY_READS` does not list is refused,
  so a new library read cannot arrive unnoticed;
- when a Deployment Store Admission constructor is on the startup path, every `DEPLOYMENT_STORE_*`
  variable the admission reads, enumerated from the constants that name them in its source, since
  `required` mode cannot start without them; and the mode is chosen in the private environment
  file, which this check cannot see.

Usage: owner_api_environment.py <main.rs> <docker-compose.yml> <Dockerfile.owner> <Cargo.toml>
<crates/data/src> | --self-test

"""

from __future__ import annotations

import re
import sys
import tomllib
from pathlib import Path


PACKAGE = "vibe-strategy-factory-rd-owner-api"
BINARY = "strategy-factory-rd-owner-api"
SERVICE = "rd-owner-api"

# The variables each Market Data constructor on the startup path requires, read inside the data
# crate. The two store-admission constructors read nothing in their own bodies: the
# DEPLOYMENT_STORE_* set they read through further calls is `STORE_ADMISSION_SOURCES`' business.
LIBRARY_READS: dict[str, tuple[str, ...]] = {
    "instrument_economic_terms_postgres_owner_from_environment_v1": (
        "INSTRUMENT_OWNER_DATABASE_URL",
    ),
    "instrument_master_v2_postgres_owner_from_environment": ("MARKET_DATA_OWNER_DATABASE_URL",),
    "native_replay_scheduling_resolver_v1_from_store_admission_environment": (),
    "shared_time_evidence_resolver_from_store_admission_environment_v1": (),
    "universe_sample_projection_owner_from_environment_v1": ("MARKET_DATA_OWNER_DATABASE_URL",),
}

# Deployment Store Admission's environment, read through calls this check cannot follow: every
# `const ...: &str = "DEPLOYMENT_STORE_..."` in these files names one variable it reads. In
# `disabled` mode it reads only the mode; in `required` mode it fails closed at startup without the
# rest, so the compose service must carry all of them for `required` to be reachable at all.
STORE_ADMISSION_CONSTRUCTORS = (
    "native_replay_scheduling_resolver_v1_from_store_admission_environment",
    "shared_time_evidence_resolver_from_store_admission_environment_v1",
)
STORE_ADMISSION_SOURCES = (
    "owner/store_admission/mod.rs",
    "owner/store_admission/composition.rs",
)
STORE_ADMISSION_CONSTANT = re.compile(
    r'const [A-Z_0-9]+: &str =\s*"(DEPLOYMENT_STORE_[A-Z_0-9]+)";',
)

CONSTRUCTOR = re.compile(r"\b([a-z_0-9]+_from_[a-z_0-9]*environment[a-z_0-9]*)\(")
REQUIRED_ENV = re.compile(r'required_env\("([A-Z_0-9]+)"\)')


def image_features(dockerfile: str, cargo_toml: str) -> set[str]:
    """
    Return the features the image's `cargo build` of the Owner API binary enables,
    expanded through the crate's own `[features]` table.
    """
    named: set[str] = set()
    for match in re.finditer(r"cargo build\b(?:[^\n\\]|\\\n)*", dockerfile):
        for command in re.split(r"&&|\|\||;", match.group(0)):
            if not re.search(rf"(?:-p|--package)\s+{PACKAGE}\b", command):
                continue
            if not re.search(rf"--bin\s+{BINARY}\b", command):
                continue
            for flag in re.finditer(
                r"(?:--features|-F)(?:\s+|=)(\"[^\"]*\"|'[^']*'|\S+)",
                command,
            ):
                named.update(
                    word for word in re.split(r"[,\s]+", flag.group(1).strip("\"'")) if word
                )
    table = tomllib.loads(cargo_toml).get("features", {})
    enabled: set[str] = set()
    pending = list(named)
    while pending:
        feature = pending.pop()
        if feature in enabled:
            continue
        enabled.add(feature)
        pending.extend(dep for dep in table.get(feature, []) if "/" not in dep and ":" not in dep)
    return enabled


def run_body(main_rs: str) -> tuple[list[str], int, int]:
    """
    Return main.rs's lines and the first and last line index of `async fn run()`.
    """
    lines = main_rs.split("\n")
    try:
        start = next(i for i, line in enumerate(lines) if line.startswith("async fn run()"))
    except StopIteration:
        raise SystemExit(
            "owner-api-environment: `async fn run()` not found; the check cannot run",
        ) from None
    depth = 0
    for index in range(start, len(lines)):
        depth += lines[index].count("{") - lines[index].count("}")
        if index > start and depth == 0:
            return lines, start, index
    return lines, start, len(lines) - 1


def gate(lines: list[str], index: int, start: int) -> str | None:
    """
    Return the `#[cfg(...)]` predicate binding the statement at `index`, if any.

    An attribute binds to the statement that follows it, so look back only to the end of
    the previous statement.

    """
    for back in range(index, start, -1):
        attribute = re.search(r"#\[cfg\((.*)\)\]", lines[back])
        if attribute:
            return attribute.group(1)
        if back != index and lines[back].rstrip().endswith((";", "{", "}")):
            return None
    return None


def active(predicate: str | None, features: set[str]) -> bool:
    """
    Whether a statement under `predicate` is compiled into the image.

    Only a plain `feature = "..."` predicate is evaluated; any other form counts as not
    compiled, as before.

    """
    if predicate is None:
        return True
    plain = re.fullmatch(r'\s*feature\s*=\s*"([a-z0-9-]+)"\s*', predicate)
    return bool(plain) and plain.group(1) in features


def startup_reads(
    main_rs: str,
    features: set[str],
) -> tuple[list[tuple[str, str]], list[str]]:
    """
    Return the variables the startup path requires in this build, each with where it is
    read, and every `*_from_*environment*` constructor on that path that `LIBRARY_READS`
    does not pin.
    """
    lines, start, end = run_body(main_rs)
    required: list[tuple[str, str]] = []
    unpinned: list[str] = []
    for index in range(start, end + 1):
        on = active(gate(lines, index, start), features)
        if on:
            required.extend(
                (match.group(1), f"main.rs:{index + 1}")
                for match in REQUIRED_ENV.finditer(lines[index])
            )
        for match in CONSTRUCTOR.finditer(lines[index]):
            name = match.group(1)
            if name not in LIBRARY_READS:
                unpinned.append(f"{name} (main.rs:{index + 1})")
            elif on:
                required.extend(
                    (var, f"{name} (main.rs:{index + 1})") for var in LIBRARY_READS[name]
                )
    return required, unpinned


def store_admission_reads(sources: dict[str, str]) -> list[str]:
    """
    Return every `DEPLOYMENT_STORE_*` variable the admission's sources name in a
    constant.

    Refuses when the files are missing or name none, since an empty reading would pass
    any compose file.

    """
    texts = [
        text
        for path, text in sources.items()
        if path.replace("\\", "/").endswith(STORE_ADMISSION_SOURCES)
    ]
    names = sorted({m.group(1) for text in texts for m in STORE_ADMISSION_CONSTANT.finditer(text)})
    if len(texts) != len(STORE_ADMISSION_SOURCES) or not names:
        raise SystemExit(
            "owner-api-environment: Deployment Store Admission's sources or their "
            f"DEPLOYMENT_STORE_* constants were not found ({', '.join(STORE_ADMISSION_SOURCES)})",
        )
    return names


def active_store_admission(main_rs: str, features: set[str]) -> list[str]:
    """
    Return each store-admission constructor compiled into the startup path, with where.
    """
    lines, start, end = run_body(main_rs)
    return [
        f"{match.group(1)} (main.rs:{index + 1})"
        for index in range(start, end + 1)
        if active(gate(lines, index, start), features)
        for match in CONSTRUCTOR.finditer(lines[index])
        if match.group(1) in STORE_ADMISSION_CONSTRUCTORS
    ]


def undelivered(required: list[tuple[str, str]], compose: str) -> list[str]:
    """
    Return each required variable the compose service's block does not name.
    """
    lines = compose.split("\n")
    try:
        first = next(i for i, line in enumerate(lines) if line.strip() == f"{SERVICE}:")
    except StopIteration:
        raise SystemExit(
            f"owner-api-environment: service {SERVICE} not found in the compose file",
        ) from None
    last = next(
        (i for i in range(first + 1, len(lines)) if re.match(r"^  [a-z-]+:$", lines[i])),
        len(lines),
    )
    block = "\n".join(lines[first:last])
    return [
        f"{name} ({where})"
        for name, where in required
        if re.search(rf"^\s+{re.escape(name)}:", block, re.MULTILINE) is None
    ]


def calibration(sources: dict[str, str]) -> list[str]:
    """
    Compare each pinned constructor with the variables its own body reads through `env::var`.
    """
    constants = {
        match.group(1): match.group(2)
        for text in sources.values()
        for match in re.finditer(r'const ([A-Z_0-9]+): &str = "([A-Z_0-9]+)";', text)
    }
    problems = []
    for name, pinned in LIBRARY_READS.items():
        body = None
        for text in sources.values():
            found = re.search(rf"\bfn {re.escape(name)}\(", text)
            if found:
                opened = text.index("{", found.end())
                depth = 0
                for index in range(opened, len(text)):
                    depth += {"{": 1, "}": -1}.get(text[index], 0)
                    if depth == 0:
                        body = text[opened : index + 1]
                        break
                break
        if body is None:
            problems.append(
                f"{name}: pinned in LIBRARY_READS but not found in the data crate",
            )
            continue
        reads = set()
        for match in re.finditer(
            r'env::var\(\s*("([A-Z_0-9]+)"|([A-Z_0-9]+))\s*\)',
            body,
        ):
            reads.add(match.group(2) or constants.get(match.group(3), match.group(3)))
        if reads != set(pinned):
            problems.append(
                f"{name}: reads {sorted(reads)}, but LIBRARY_READS pins {sorted(pinned)}",
            )
    return problems


def check(
    main_rs: Path,
    compose: Path,
    dockerfile: Path,
    cargo_toml: Path,
    data_src: Path,
) -> int:
    """
    Run the check on the repository and report the outcome.
    """
    features = image_features(
        dockerfile.read_text(encoding="utf-8"),
        cargo_toml.read_text(encoding="utf-8"),
    )
    main_text = main_rs.read_text(encoding="utf-8")
    required, unpinned = startup_reads(main_text, features)
    sources = {str(path): path.read_text(encoding="utf-8") for path in data_src.rglob("*.rs")}
    admission = active_store_admission(main_text, features)
    if admission:
        required.extend(
            (name, f"Deployment Store Admission in `required` mode, via {admission[0]}")
            for name in store_admission_reads(sources)
        )
    problems = [f"{line}: not pinned in LIBRARY_READS" for line in unpinned] + calibration(sources)
    missing = undelivered(required, compose.read_text(encoding="utf-8"))
    if problems:
        print(
            "ERROR: the Owner API's library environment reads are not pinned:",
            file=sys.stderr,
        )
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        print(
            "       Pin each constructor's required variables in LIBRARY_READS.",
            file=sys.stderr,
        )
        return 1
    if missing:
        print(
            f"ERROR: in the build the image makes (features: {', '.join(sorted(features)) or 'none'}), "
            f"the Owner API requires these environment variables, and {SERVICE} does not pass them in:",
            file=sys.stderr,
        )
        for line in missing:
            print(f"  {line}", file=sys.stderr)
        print(
            "       The service will exit before it binds a port, so every route looks unreachable;",
            file=sys.stderr,
        )
        print(
            "       for a Deployment Store Admission variable, in `required` mode.",
            file=sys.stderr,
        )
        print(
            f"       Add each one to the {SERVICE} 'environment:' block in docker-compose.yml.",
            file=sys.stderr,
        )
        return 1
    print(
        f"Every environment variable the Owner API requires in the image's build (features: "
        f"{', '.join(sorted(features)) or 'none'}) is delivered to {SERVICE}",
    )
    return 0


# `check-feature-gate-coverage.py` counts every `cfg(feature = "...")` text under product/ as a
# gated site, so the fixture's names are written with a `@` that is removed before use. Written
# plainly, `beta` and `gamma` would read as features no job compiles.
FIXTURE_MAIN = """\
async fn run() -> anyhow::Result<()> {
    let a = required_env("ALPHA")?;
    #[cfg(feature = "@beta")]
    let b = required_env("BETA")?;
    #[cfg(feature = "@gamma")]
    let terms = instrument_economic_terms_postgres_owner_from_environment_v1().await?;
    #[cfg(all(test, feature = "@gamma"))]
    let c = required_env("NEVER")?;
    Ok(())
}
""".replace('"@', '"')

FIXTURE_CARGO = '[features]\ndefault = []\nbeta = []\ngamma = ["beta", "other/feature"]\n'

FIXTURE_COMPOSE = """\
services:
  rd-owner-api:
    environment:
      ALPHA: x
      BETA: x
  other:
    environment:
      INSTRUMENT_OWNER_DATABASE_URL: x
"""


def reading_failures() -> list[str]:
    """
    Run the feature, startup-read and delivery readings against fixed sources in both
    directions.
    """
    failures = []
    plain = f"RUN cargo build -p {PACKAGE} --bin {BINARY} \\\n    && cargo build -p {PACKAGE} --bin other\n"
    gated = f"RUN cargo build --release -p {PACKAGE} --features gamma \\\n      --bin {BINARY}\n"
    if image_features(plain, FIXTURE_CARGO):
        failures.append("an image without features read as enabling some")
    if image_features(gated, FIXTURE_CARGO) != {"beta", "gamma"}:
        failures.append(
            f"gamma did not expand to beta: {image_features(gated, FIXTURE_CARGO)}",
        )
    off, _ = startup_reads(FIXTURE_MAIN, set())
    if [name for name, _ in off] != ["ALPHA"]:
        failures.append(
            f"the default build required more than its unconditional read: {off}",
        )
    on, _ = startup_reads(FIXTURE_MAIN, {"beta", "gamma"})
    if [name for name, _ in on] != ["ALPHA", "BETA", "INSTRUMENT_OWNER_DATABASE_URL"]:
        failures.append(
            f"an enabled feature's reads, or a constructor's library read, were missed: {on}",
        )
    if undelivered(on, FIXTURE_COMPOSE) != [
        "INSTRUMENT_OWNER_DATABASE_URL (instrument_economic_terms_postgres_owner_from_environment_v1 (main.rs:6))",
    ]:
        failures.append(
            f"a variable another service carries counted as delivered: {undelivered(on, FIXTURE_COMPOSE)}",
        )
    _, unpinned = startup_reads(
        FIXTURE_MAIN.replace("instrument_economic_terms", "new_market_owner"),
        set(),
    )
    if unpinned != ["new_market_owner_postgres_owner_from_environment_v1 (main.rs:6)"]:
        failures.append(f"an unpinned library constructor was not refused: {unpinned}")
    return failures + store_admission_failures()


def store_admission_failures() -> list[str]:
    """
    Run the store-admission readings against fixed sources in both directions.
    """
    failures = []
    gated = FIXTURE_MAIN.replace(
        "instrument_economic_terms_postgres_owner_from_environment_v1",
        STORE_ADMISSION_CONSTRUCTORS[0],
    )
    if active_store_admission(gated, set()):
        failures.append("a store-admission constructor under an off feature read as compiled")
    if active_store_admission(gated, {"beta", "gamma"}) != [
        f"{STORE_ADMISSION_CONSTRUCTORS[0]} (main.rs:6)",
    ]:
        failures.append("a compiled store-admission constructor was missed")
    sources = {
        "x/owner/store_admission/mod.rs": 'const MODE_ENV: &str = "DEPLOYMENT_STORE_ADMISSION_MODE";\n'
        'let test = env("DEPLOYMENT_STORE_PUBLISHER_TEST_DATABASE_URL");\n',
        "x/owner/store_admission/composition.rs": "pub(super) const ROOT_ENV: &str =\n"
        '    "DEPLOYMENT_STORE_POSTGRES_ROOT_CERTIFICATE_PATH";\n',
    }
    if store_admission_reads(sources) != [
        "DEPLOYMENT_STORE_ADMISSION_MODE",
        "DEPLOYMENT_STORE_POSTGRES_ROOT_CERTIFICATE_PATH",
    ]:
        failures.append(
            f"the admission's constants were misread: {store_admission_reads(sources)}",
        )
    try:
        store_admission_reads({"x/owner/store_admission/mod.rs": "no constants here"})
        failures.append("missing admission sources read as naming no variable")
    except SystemExit:
        pass
    return failures


def calibration_failures() -> list[str]:
    """
    Run the calibration of the pinned library reads against fixed constructor bodies.
    """
    failures = []
    source = {
        "a.rs": 'const OWNER_URL: &str = "INSTRUMENT_OWNER_DATABASE_URL";\n'
        "pub async fn instrument_economic_terms_postgres_owner_from_environment_v1() {\n"
        "    let url = std::env::var(OWNER_URL);\n}\n"
        "pub async fn universe_sample_projection_owner_from_environment_v1() {\n"
        '    let url = std::env::var("SOMETHING_ELSE");\n}\n',
    }
    problems = calibration(source)
    if not any(
        p.startswith(
            "universe_sample_projection_owner_from_environment_v1: reads ['SOMETHING_ELSE']",
        )
        for p in problems
    ):
        failures.append(
            f"a constructor reading another variable than pinned passed: {problems}",
        )
    if any(
        p.startswith("instrument_economic_terms_postgres_owner_from_environment_v1")
        for p in problems
    ):
        failures.append(
            f"a constructor reading its pinned variable through a constant was refused: {problems}",
        )
    return failures


def self_test() -> int:
    """
    Run every reading against fixed sources in both directions.
    """
    failures = reading_failures() + calibration_failures()
    if failures:
        for failure in failures:
            print(f"FAIL: {failure}", file=sys.stderr)
        return 1
    print(
        "owner-api-environment: reads the image's features and expands them, requires an enabled "
        "feature's reads and a constructor's library reads, refuses an unpinned constructor, "
        "calibrates the pinned reads against their bodies, requires store admission's "
        "enumerated variables when it is compiled",
    )
    return 0


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        sys.exit(self_test())
    if len(sys.argv) != 6:
        sys.exit(__doc__)
    sys.exit(check(*(Path(argument) for argument in sys.argv[1:])))
