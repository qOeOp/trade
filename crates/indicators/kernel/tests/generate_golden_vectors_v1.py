"""
Build literal BFGV fixtures from explicit, independently specified integer examples.

This test utility does not call the Rust implementation. State helpers encode the
documented checkpoint layouts; expected numerical coefficients are supplied by each
scenario, not evaluated using the production formulas. Coordinates are synthetic guest
inputs, never Owner receipts.

"""

import argparse
import re
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
I128_MAX = (1 << 127) - 1
HEADER = b"BFGI\x01\0\0\0"
READY, WARMING, NUMERIC, UNSUPPORTED = range(4)
CASES = {}


def i128(value):
    return value.to_bytes(16, "little", signed=True)


def fixed(value, scale=0):
    return i128(value) + bytes([scale])


def coordinate(number):
    return (
        struct.pack("<HH", 1, 0)
        + bytes([1]) * 32
        + bytes([2]) * 32
        + number.to_bytes(16, "little")
        + number.to_bytes(32, "little")
        + struct.pack("<QQQ", number, number, number)
        + bytes([3]) * 32
        + bytes([4]) * 32
        + bytes([5]) * 32
        + struct.pack("<Q", 1)
        + bytes([6]) * 32
        + number.to_bytes(32, "little")
    )


def window(kind, samples, size=3, rounding=0, input_scale=0, output_scale=0):
    assert len(samples) <= size
    head = struct.pack(
        "<HHBBBBIII",
        1,
        0,
        kind,
        rounding,
        input_scale,
        output_scale,
        size,
        len(samples),
        len(samples) % size,
    )
    entries = b"".join(coordinate(n) + i128(value) for n, value in samples)
    return head + entries + bytes(324 * (size - len(samples)))


def smoothing(kind, rounding, sample=None, output=0):
    head = struct.pack("<HHIBBBB", 1, 0, 3, kind, rounding, 0, int(sample is not None))
    payload = (
        bytes(340) if sample is None else coordinate(sample[0]) + i128(sample[1]) + i128(output)
    )
    return head + payload


def bar_state(kind, rounding=0, sample=None, output=None):
    status = 0 if sample is None else 1 if output is None else 2
    head = struct.pack("<HHBBBBI", 1, 0, kind, rounding, 0, status, 3 if kind == 2 else 0)
    if sample is None:
        return head + bytes(388)
    number, values = sample
    return head + coordinate(number) + b"".join(i128(value) for value in values) + i128(output or 0)


def rsi_state(rounding, samples, averages=None):
    status = 0 if not samples else 1 if averages is None else 2
    head = struct.pack("<HHBBBBI", 1, 0, rounding, 0, 0, status, 3)
    last = bytes(324) if not samples else coordinate(samples[-1][0]) + i128(samples[-1][1])
    averages_bytes = bytes(48) if averages is None else b"".join(i128(value) for value in averages)
    history = window(7, samples if averages is None else [], size=4)
    return head + last + averages_bytes + history


def state_input(number, values, period, input_scale=0, output_scale=0, max_lag=None):
    result = (
        HEADER
        + coordinate(number)
        + b"".join(values)
        + struct.pack("<BBI", input_scale, output_scale, period)
    )
    return result if max_lag is None else result + struct.pack("<I", max_lag)


def state_output(value=None, advanced=True, selected=None):
    result = bytes([int(advanced)])
    if value is not None:
        result += fixed(value)
        if selected is not None:
            result += coordinate(selected)
    return result


def names(constant):
    source = (ROOT / "src/required_golden_ids.rs").read_text()
    body = source.split("pub const " + constant)[1].split("= [")[1].split("];", 1)[0]
    return re.findall(r'"([^"]+)"', body)


PRIMITIVES = names("EXECUTABLE_PRIMITIVE_IDS_V1")
REQUIRED = names("REQUIRED_GOLDEN_IDS_V1")


def primitive(prefix, rounding=0):
    suffix = ".toward-zero.v1" if rounding == 1 else ".nearest-ties-to-even.v1"
    candidates = [
        name
        for name in PRIMITIVES
        if name.startswith("bfp." + prefix) and (not rounding or name.endswith(suffix))
    ]
    assert len(candidates) == 1, (prefix, rounding)
    return candidates[0]


def add(name, owner, rounding, inputs, output=b"", pre=b"", post=b"", terminal=READY):
    assert name not in CASES
    CASES[name] = (owner, rounding, terminal, pre, inputs, output, post)


def rolling_case(name, prefix, rounding=0, count=3, values=(10, 20, 30)):
    kinds = {
        "lag.": 7,
        "rolling.sum.": 1,
        "rolling.mean.": 2,
        "rolling.min.": 3,
        "rolling.max.": 4,
        "swing-high.": 5,
        "swing-low.": 6,
    }
    kind = kinds[prefix]
    samples = list(enumerate(values[:count], 1))
    period = 2 if kind == 7 else 3
    inputs = state_input(
        count,
        [fixed(values[count - 1])],
        period,
        max_lag=2 if kind == 7 else None,
    )
    output = None if count < 3 else {1: 60, 2: 20, 3: 10, 4: 30, 5: 30, 6: 10, 7: 10}[kind]
    selected = None if count < 3 or kind not in (5, 6, 7) else 3 if kind == 5 else 1
    add(
        name,
        primitive(prefix, rounding),
        rounding,
        inputs,
        state_output(output, selected=selected),
        window(kind, samples[:-1], rounding=rounding),
        window(kind, samples, rounding=rounding),
        READY if count == 3 else WARMING,
    )


def smoothing_case(name, prefix, rounding, first=False):
    kind = 1 if prefix == "ema." else 2
    output = 10 if first else 15 if kind == 1 else 13
    sample = (1, 10) if first else (2, 20)
    add(
        name,
        primitive(prefix, rounding),
        rounding,
        state_input(sample[0], [fixed(sample[1])], 3),
        state_output(output),
        smoothing(kind, rounding, None if first else (1, 10), 10),
        smoothing(kind, rounding, sample, output),
    )


def bar_case(name, prefix, rounding=0, first=False):
    kind = {"true-range.": 1, "atr.": 2, "candle.gap-": 3}[prefix]
    initial = (10, 20, 5, 15)
    later = (30, 35, 25, 32)
    values = initial if first else later
    output = (
        (None if kind == 3 else 15)
        if first
        else 20
        if kind == 1
        else 15
        if kind == 3
        else 16
        if rounding == 1
        else 17
    )
    number = 1 if first else 2
    pre = (
        bar_state(kind, rounding)
        if first
        else bar_state(kind, rounding, (1, initial), None if kind == 3 else 15)
    )
    add(
        name,
        primitive(prefix, rounding),
        rounding,
        state_input(number, [fixed(value) for value in values], 3 if kind == 2 else 0),
        state_output(output),
        pre,
        bar_state(kind, rounding, (number, values), output),
        WARMING if output is None else READY,
    )


def rsi_case(name, rounding, values, averages=None):
    samples = list(enumerate(values, 1))
    ready = len(values) == 4
    assert ready == (averages is not None)
    add(
        name,
        primitive("rsi.", rounding),
        rounding,
        state_input(len(values), [fixed(values[-1])], 3),
        state_output(averages[2] if ready else None),
        rsi_state(rounding, samples[:-1]),
        rsi_state(rounding, samples, averages),
        READY if ready else WARMING,
    )


def arithmetic_success(name, owner, rounding, prefix):
    operation = prefix.split(".")[1]
    if operation in ("add", "sub", "mul"):
        expected = {"add": 15, "sub": 9 if rounding == 1 else 10, "mul": 32}[operation]
        inputs = HEADER + fixed(125, 1) + fixed(26, 1) + bytes([0])
    elif operation == "div":
        expected = 3 if rounding == 1 else 4
        inputs = HEADER + fixed(7) + fixed(2) + bytes([0])
    elif operation == "rescale":
        expected = 3 if rounding == 1 else 4
        inputs = HEADER + fixed(35, 1) + bytes([0])
    elif operation == "compare":
        add(name, owner, rounding, HEADER + fixed(-1) + fixed(2) + bytes([1]), bytes([1]))
        return
    else:
        expected = 2
        inputs = HEADER + bytes([0]) + fixed(-1) + fixed(2)
    add(name, owner, rounding, inputs, fixed(expected))


def build_successes():
    for owner in PRIMITIVES:
        name = "bfp.golden.primitive." + owner[4:] + ".success.v1"
        rounding = (
            1
            if owner.endswith(".toward-zero.v1")
            else 2
            if owner.endswith(".nearest-ties-to-even.v1")
            else 0
        )
        prefix = owner[4:]
        if prefix.startswith("fixed-i128."):
            arithmetic_success(name, owner, rounding, prefix)
        elif prefix.startswith(("lag.", "rolling.", "swing-")):
            family = next(
                value
                for value in (
                    "lag.",
                    "rolling.sum.",
                    "rolling.mean.",
                    "rolling.min.",
                    "rolling.max.",
                    "swing-high.",
                    "swing-low.",
                )
                if prefix.startswith(value)
            )
            rolling_case(name, family, rounding)
        elif prefix.startswith(("ema.", "wilder.")):
            smoothing_case(name, prefix.split(".")[0] + ".", rounding)
        elif prefix.startswith(("true-range.", "atr.", "candle.gap-")):
            family = next(
                value
                for value in ("true-range.", "atr.", "candle.gap-")
                if prefix.startswith(value)
            )
            bar_case(name, family, rounding)
        elif prefix.startswith("rsi."):
            rsi_case(name, rounding, [10, 20, 10, 30], (10, 3, 76 if rounding == 1 else 77))
        elif prefix.startswith("range-fraction."):
            add(
                name,
                owner,
                rounding,
                HEADER + fixed(10) + fixed(21) + struct.pack("<BII", 0, 1, 2),
                fixed(15 if rounding == 1 else 16),
            )
        else:
            expected = {"body-magnitude": 7, "range": 18, "upper-wick": 5, "lower-wick": 6}[
                prefix.split(".")[1]
            ]
            add(
                name,
                owner,
                rounding,
                HEADER + b"".join(fixed(value) for value in (10, 22, 4, 17)),
                fixed(expected),
            )


def build_rounding_crosscuts():
    for mode, rounding in (("toward-zero", 1), ("nearest-ties-to-even", 2)):
        for sign, multiplier in (("positive", 1), ("negative", -1)):
            for parity, numerator in (("even", 5), ("odd", 7)):
                expected = 2 if parity == "even" else 3 if rounding == 1 else 4
                add(
                    f"bfp.golden.round.{mode}.{sign}.{parity}-half.v1",
                    primitive("fixed-i128.div.", rounding),
                    rounding,
                    HEADER + fixed(multiplier * numerator) + fixed(2) + bytes([0]),
                    fixed(multiplier * expected),
                )


def build_crosscuts():
    build_rounding_crosscuts()
    families = {
        "lag-offset-2": "lag.",
        "rolling-sum-window-3": "rolling.sum.",
        "rolling-mean-window-3": "rolling.mean.",
        "rolling-min-window-3": "rolling.min.",
        "rolling-max-window-3": "rolling.max.",
        "swing-high-window-3": "swing-high.",
        "swing-low-window-3": "swing-low.",
    }
    for family, prefix in families.items():
        for frontier, count in (("before-ready", 2), ("first-ready", 3)):
            rolling_case(
                f"bfp.golden.warm-up.{family}.{frontier}.v1",
                prefix,
                1 if prefix == "rolling.mean." else 0,
                count,
            )
    rsi_case("bfp.golden.warm-up.rsi-period-3.before-ready.v1", 1, [10, 20, 30])
    rsi_case("bfp.golden.warm-up.rsi-period-3.first-ready.v1", 1, [10, 20, 30, 40], (10, 0, 100))
    for prefix in ("ema.", "wilder."):
        smoothing_case(f"bfp.golden.{prefix[:-1]}-period-3.first-ready.v1", prefix, 1, first=True)
    bar_case("bfp.golden.atr-period-3.first-ready.v1", "atr.", 1, first=True)
    bar_case("bfp.golden.gap.before-ready.v1", "candle.gap-", first=True)
    bar_case("bfp.golden.gap.first-ready.v1", "candle.gap-")
    bar_case("bfp.golden.true-range.first.v1", "true-range.", first=True)
    bar_case("bfp.golden.true-range.previous-close.v1", "true-range.")
    rsi_case("bfp.golden.rsi.flat-50.v1", 1, [10, 10, 10, 10], (0, 0, 50))
    rsi_case("bfp.golden.rsi.zero-loss-100.v1", 1, [10, 20, 30, 40], (10, 0, 100))
    rsi_case("bfp.golden.rsi.zero-gain-0.v1", 1, [40, 30, 20, 10], (0, 10, 0))
    failures = [
        ("i256-overflow", "mul", fixed(I128_MAX) + fixed(I128_MAX) + bytes([38])),
        ("divide-by-zero", "div", fixed(1) + fixed(0) + bytes([0])),
        ("invalid-scale", "add", fixed(1, 39) + fixed(1) + bytes([0])),
        ("final-i128-overflow", "add", fixed(I128_MAX) + fixed(1) + bytes([0])),
        ("min-div-negative-one", "div", fixed(-I128_MAX - 1) + fixed(-1) + bytes([0])),
        ("scale-mismatch", "add", fixed(1) + fixed(1, 1) + bytes([0])),
    ]
    for name, operation, inputs in failures:
        add(
            f"bfp.golden.numeric.{name}.state-byte-identity.v1",
            primitive(f"fixed-i128.{operation}.", 1),
            1,
            HEADER + inputs,
            terminal=NUMERIC,
        )
    pre = window(1, [], size=1, input_scale=1)
    add(
        "bfp.golden.numeric.remainder-without-rounding.state-byte-identity.v1",
        primitive("rolling.sum."),
        0,
        state_input(1, [fixed(15, 1)], 1, input_scale=1),
        pre=pre,
        post=pre,
        terminal=NUMERIC,
    )
    pre = bar_state(1, sample=(1, (10, 20, 5, 15)), output=15)
    add(
        "bfp.golden.ohlc.ordering-violation.state-byte-identity.v1",
        primitive("true-range."),
        0,
        state_input(2, [fixed(value) for value in (10, 9, 5, 15)], 0),
        pre=pre,
        post=pre,
        terminal=NUMERIC,
    )
    for prefix, kind, value in (("swing-high.", 5, 30), ("swing-low.", 6, 10)):
        samples = [(1, value), (2, value), (3, value)]
        add(
            f"bfp.golden.{prefix}latest-coordinate-tie.v1",
            primitive(prefix),
            0,
            state_input(3, [fixed(value)], 3),
            state_output(value, selected=3),
            window(kind, samples[:-1]),
            window(kind, samples),
        )
    pre = smoothing(2, 1, (1, 10), 10)
    for name, number in (("same-no-advance", 1), ("equal-value-new-advance", 2)):
        add(
            f"bfp.golden.sample.{name}.v1",
            primitive("wilder.", 1),
            1,
            state_input(number, [fixed(10)], 3),
            state_output(10, advanced=number == 2),
            pre,
            smoothing(2, 1, (number, 10), 10),
        )
    add(
        "bfp.golden.numeric.wide-fit-after-scale.v1",
        primitive("fixed-i128.mul.", 1),
        1,
        HEADER + fixed(I128_MAX, 1) + fixed(10) + bytes([0]),
        fixed(I128_MAX),
    )
    for name, low, high, numerator, denominator in (
        ("denominator-zero", 10, 20, 1, 0),
        ("non-reduced-rational", 10, 20, 2, 4),
        ("above-one", 10, 20, 2, 1),
        ("low-above-high", 20, 10, 1, 2),
    ):
        add(
            f"bfp.golden.range-fraction.{name}.v1",
            primitive("range-fraction.", 1),
            1,
            HEADER + fixed(low) + fixed(high) + struct.pack("<BII", 0, numerator, denominator),
            terminal=UNSUPPORTED,
        )


def vector_bytes(name, fields):
    owner, rounding, terminal, pre, inputs, output, post = fields
    result = b"BFGV\x01\0\0\0"
    for value in (name, owner):
        encoded = value.encode("ascii")
        result += struct.pack("<H", len(encoded)) + encoded
    result += bytes([rounding, terminal])
    for value in (pre, inputs, output, post):
        result += struct.pack("<I", len(value)) + value
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    build_successes()
    build_crosscuts()
    assert set(CASES) == set(REQUIRED), (set(REQUIRED) - set(CASES), set(CASES) - set(REQUIRED))
    artifacts = {}
    entries = []
    for index, name in enumerate(sorted(CASES)):
        filename = f"{index:02}.bfgv"
        artifacts[ROOT / "src/goldens_v1" / filename] = vector_bytes(name, CASES[name])
        entries.append(f'    include_bytes!("goldens_v1/{filename}"),')
    registry = (
        "//! Literal canonical vectors, regenerated only by tests/generate_golden_vectors_v1.py.\n\npub(super) const GOLDENS: [&[u8]; 87] = [\n"
        + "\n".join(entries)
        + "\n];\n"
    )
    artifacts[ROOT / "src/golden_corpus.rs"] = registry.encode("ascii")
    for path, contents in artifacts.items():
        if args.check:
            assert path.read_bytes() == contents, path
        else:
            path.write_bytes(contents)
    assert {path.name for path in (ROOT / "src/goldens_v1").glob("*.bfgv")} == {
        f"{n:02}.bfgv" for n in range(87)
    }
    print("87 canonical vectors verified" if args.check else "87 canonical vectors generated")


if __name__ == "__main__":
    main()
