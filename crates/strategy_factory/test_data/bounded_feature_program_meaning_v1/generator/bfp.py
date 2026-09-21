"""
One generator, ten programs.

Each program is described by a spec; the acceptance bar was byte equality against the ten
separate generators these replaced.
Templates are deep-copied and edited rather than built from nothing because key order has to
match: serde emits JSON keys in Rust field order, and building fresh drifts from it.

"""

import copy
import hashlib
import json
import pathlib


# The Design and proposal every program is grown from. They sit beside this file so the
# corpus can be regenerated anywhere. Reading them out of a temporary directory made
# regeneration succeed only on the one machine that happened to still have them.
_TEMPLATES = pathlib.Path(__file__).parent / "templates"


def read_json(path):
    """
    Read one JSON document.
    """
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def write_json(value, path):
    """
    Write one JSON document in the shape the corpus is committed in.
    """
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=1)


# ---- primitive ids -----------------------------------------------------------
MEAN = "bfp.rolling.mean.full-window.nearest-ties-to-even.v1"
MIN = "bfp.rolling.min.full-window.v1"
MAX = "bfp.rolling.max.full-window.v1"
SUB = "bfp.fixed-i128.sub.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1"
MUL = "bfp.fixed-i128.mul.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1"
DIV = "bfp.fixed-i128.div.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1"
CMP = "bfp.fixed-i128.compare.equal-scale.v1"
SEL = "bfp.fixed-i128.select.equal-scale.v1"
FRAC = "bfp.range-fraction.closed-unit-rational.nearest-ties-to-even.v1"
RSI = "bfp.rsi.period-deltas.wilder.flat-50.nearest-ties-to-even.v1"
LAG = "bfp.lag.coordinate.offset.full-history.v1"
SWL = "bfp.swing-low.trailing-full-window.latest-coordinate-tie.v1"
BODY = "bfp.candle.body-magnitude.ohlc-validated.v1"
ATR = "bfp.atr.true-range.wilder-first-sample.nearest-ties-to-even.v1"
GAP = "bfp.candle.gap-signed.previous-close.ohlc-validated.v1"
FUSED = "bfp.fused-rational.two-input.i256-single-round.nearest-ties-to-even.v1"
SQRT = "bfp.fixed-i128.sqrt.max-scale-38.i256-single-round.nearest-ties-to-even.v1"


# ---- value references and nodes ----------------------------------------------
def iv(r):
    return {"kind": "INPUT_VALUE", "input_role_id": r}


def no(n, port="value"):
    return {"kind": "NODE_OUTPUT", "node_id": n, "port_id": port}


def co(c):
    return {"kind": "CONSTANT", "constant_id": c}


def ps(s):
    return {"kind": "PRIOR_STATE", "state_id": s}


def bd(k, s, req=False):
    return {"port_id": k, "source": s, "require_ready": req}


def fx(u, s, a="READY"):
    return [
        {
            "port_id": "value",
            "value_type": {"kind": "FIXED_I128", "unit": u, "scale": s},
            "availability": a,
        },
    ]


def bl():
    return [{"port_id": "value", "value_type": {"kind": "BOOLEAN"}, "availability": "READY"}]


def coord_port(role_identity_hex, avail="WARMING_READY"):
    """
    Build the second output of lag/swing: a coordinate whose value type embeds the
    lagged role's 32-byte identity.
    """
    return {
        "port_id": "coordinate",
        "value_type": {
            "kind": "OWNER_SAMPLE_COORDINATE",
            "input_role_identity": list(bytes.fromhex(role_identity_hex)),
        },
        "availability": avail,
    }


def op(nid, prim, binds, out, params, state=None, clock=None):
    return {
        "node_id": nid,
        "primitive_semantic_id": prim,
        "input_bindings": binds,
        "output_ports": out,
        "parameters": params,
        "state_id": state,
        "update_clock": ({"kind": "TRIGGER", "input_role_id": clock} if clock else None),
    }


# ---- parameters ---------------------------------------------------------------
NONE = {"kind": "NONE"}


def OS(s):
    return {"kind": "OUTPUT_SCALE", "output_scale": s, "rounding": "NEAREST_TIES_TO_EVEN"}


def WD(w):
    return {"kind": "WINDOW", "window": w, "rounding": None}


def WO(w):
    return {"kind": "WINDOW", "window": w, "rounding": None}


def WOS(w, s):
    return {
        "kind": "WINDOW_AND_OUTPUT_SCALE",
        "window": w,
        "output_scale": s,
        "rounding": "NEAREST_TIES_TO_EVEN",
    }


def POS(n, s):
    return {
        "kind": "PERIOD_AND_OUTPUT_SCALE",
        "period": n,
        "output_scale": s,
        "rounding": "NEAREST_TIES_TO_EVEN",
    }


def PD(n):
    return {"kind": "PERIOD", "period": n, "rounding": "NEAREST_TIES_TO_EVEN"}


def LG(off, mx):
    return {"kind": "LAG", "offset": off, "declared_max_lag": mx}


def CP(pr):
    return {"kind": "COMPARISON_PREDICATE", "predicate": pr}


def RF(num, den, s):
    return {
        "kind": "RANGE_FRACTION",
        "numerator": num,
        "denominator": den,
        "output_scale": s,
        "rounding": "NEAREST_TIES_TO_EVEN",
    }


def FR(numerator, denominator, quotient_scale, output_scale, output_unit):
    return {
        "kind": "FUSED_RATIONAL",
        "numerator": numerator,
        "denominator": denominator,
        "quotient_scale": quotient_scale,
        "output_scale": output_scale,
        "output_unit": output_unit,
        "rounding": "NEAREST_TIES_TO_EVEN",
    }


def fused_int(v):
    """One i128 constant inside fused postfix bytecode: tag 2 plus 16 little-endian bytes."""
    return [2, *list(int(v).to_bytes(16, "little", signed=True))]


# ---- derivation: role identity -------------------------------------------------
def role_identity(role):
    """
    SHA256(domain || serde bytes).

    A pure function needing no side table, but it does depend on InputRoleV2's field
    order.

    """
    b = json.dumps(role, separators=(",", ":"), ensure_ascii=False).encode()
    h = hashlib.sha256()
    h.update(b"strategy.design.input-role.v2\x00")
    h.update(b)
    return h.hexdigest()


# ---- declaration surface: role groups -------------------------------------------
def base(
    roles,
    fixture_design=str(_TEMPLATES / "fixture-design.json"),
    fixture_proposal=str(_TEMPLATES / "fixture-proposal.json"),
    max_inputs=16,
    max_nodes_per_reaction=4,
):
    """
    Grows a base carrying N input roles from the template.

    roles = [(semantic_id, timeframe, field, unit, short)].

    """
    d = read_json(fixture_design)
    p = read_json(fixture_proposal)
    br = copy.deepcopy(d["inputs"][0])
    bp = copy.deepcopy(p["inputs"][0])
    bar = next(r for r in d["reactions"] if r["kind"] == "BAR")
    ev = next(r for r in d["reactions"] if r["kind"] == "EVENT")
    node = bar["nodes"][0]
    bvb = copy.deepcopy(next(b for b in node["input_bindings"] if b["source"]["kind"] == "INPUT"))
    bcb = copy.deepcopy(
        next(b for b in node["input_bindings"] if b["source"]["kind"] == "OWNER_SAMPLE_COORDINATE"),
    )
    bvp = copy.deepcopy(d["plugins"][0]["input_ports"][0])
    bcp = copy.deepcopy(d["plugins"][0]["input_ports"][1])
    d["inputs"] = []
    p["inputs"] = []
    binds = []
    ports = []
    hexes = {}
    for rid, tf, fs, unit, short in roles:
        vport = f"input.{short}.v1"
        r = copy.deepcopy(br)
        r.update(
            semantic_id=rid,
            timeframe=tf,
            field_semantic_id=fs,
            unit=unit,
            instrument="BTCUSDT-PERP.BINANCE",
        )
        d["inputs"].append(r)
        pin = copy.deepcopy(bp)
        pin.update(
            input_role_id=rid,
            timeframe=tf,
            fact_type_semantic_id=fs,
            unit=unit,
            value_port_semantic_id=vport,
            update_clock={"kind": "TRIGGER", "input_role_id": rid},
        )
        p["inputs"].append(pin)
        vp = copy.deepcopy(bvp)
        vp["semantic_id"] = vport
        ports.append(vp)
        vb = copy.deepcopy(bvb)
        vb["port_id"] = vport
        vb["source"]["input_id"] = rid
        binds.append(vb)
        h = role_identity(r)
        hexes[rid] = h
        cpid = f"strategy.input.sample-coordinate.v1.{h}"
        cp = copy.deepcopy(bcp)
        cp["semantic_id"] = cpid
        ports.append(cp)
        cb = copy.deepcopy(bcb)
        cb["port_id"] = cpid
        cb["source"]["input_id"] = rid
        cb["source"]["source_semantic_id"] = f"strategy.value-ref.owner-sample-coordinate.v1({rid})"
        binds.append(cb)
    d["plugins"][0]["input_ports"] = ports
    node["input_bindings"] = copy.deepcopy(binds)
    ev["nodes"][0]["input_bindings"] = copy.deepcopy(binds)
    d["resources"].update(max_inputs=max_inputs, max_nodes_per_reaction=max_nodes_per_reaction)
    return d, p, hexes


ROLES4 = [
    ("research.input.close.weekly.v1", "1W", "MARKET_DATA.BAR.CLOSE.PRICE.V1", "PRICE", "weekly"),
    ("research.input.close.daily.v1", "1D", "MARKET_DATA.BAR.CLOSE.PRICE.V1", "PRICE", "daily"),
    ("research.input.close.h4.v1", "4H", "MARKET_DATA.BAR.CLOSE.PRICE.V1", "PRICE", "h4"),
    (
        "research.input.volume.daily.v1",
        "1D",
        "MARKET_DATA.BAR.VOLUME.QUANTITY.V1",
        "QUANTITY",
        "vol",
    ),
]
ROLES7 = [
    *ROLES4,
    ("research.input.high.daily.v1", "1D", "MARKET_DATA.BAR.HIGH.PRICE.V1", "PRICE", "high"),
    ("research.input.low.daily.v1", "1D", "MARKET_DATA.BAR.LOW.PRICE.V1", "PRICE", "low"),
    ("research.input.open.daily.v1", "1D", "MARKET_DATA.BAR.OPEN.PRICE.V1", "PRICE", "open"),
]


def prune_declarations(d, p):
    """
    Prune the declaration surface to follow the graph: an input role no node consumes gets the
    program refused, so all four places are pruned together.
    """
    used = {
        b["source"]["input_role_id"]
        for n in p["nodes"]
        for b in n["input_bindings"]
        if b["source"]["kind"] == "INPUT_VALUE"
    }
    p["inputs"] = [i for i in p["inputs"] if i["input_role_id"] in used]
    d["inputs"] = [i for i in d["inputs"] if i["semantic_id"] in used]
    keep = set()
    for r in d["reactions"]:
        for node in r["nodes"]:
            # Bindings with no input_id (state ports and the like) must be kept.
            node["input_bindings"] = [
                b
                for b in node["input_bindings"]
                if "input_id" not in b["source"] or b["source"]["input_id"] in used
            ]
            keep |= {b["port_id"] for b in node["input_bindings"]}
    d["plugins"][0]["input_ports"] = [
        q for q in d["plugins"][0]["input_ports"] if q["semantic_id"] in keep
    ]


def build_branches(template, specs):
    """
    Grow each declared branch from the template branch the fixture carries.

    Every terminal a spec does not override keeps the template's, which is what makes a
    decision table describable by only the outputs that differ between branches.

    """
    built = []
    for spec in specs:
        branch = copy.deepcopy(template)
        branch["priority"] = spec["priority"]
        branch["predicate"] = spec["predicate"]
        for terminal in branch["frame"]["terminal_outputs"]:
            override = spec.get("overrides", {}).get(terminal["manifest_port_id"])
            if override:
                terminal.update(override)
        built.append(branch)
    return built


def apply_constants(proposal, drop, add):
    """
    Replace the template's constants with the ones a program declares.
    """
    if drop or add:
        proposal["constants"] = [
            *(c for c in proposal["constants"] if c["constant_id"] not in drop),
            *add,
        ]


def apply_state_total(design, total):
    """
    Set one state budget in the three places a Design states it.
    """
    if total is None:
        return
    design["state"][0]["max_bytes"] = total
    design["plugins"][0]["state"]["max_bytes"] = total
    # `resources` sums every cell of design.state; the plugin field is the plugin's own
    # cell alone. Same name, different quantity.
    design["resources"]["max_state_bytes"] = sum(c["max_bytes"] for c in design["state"])


def emit(
    d,
    p,
    out,
    *,
    nodes=None,
    drop_constants=(),
    add_constants=(),
    state_cells=None,
    branches=None,
    bounds=None,
    state_total=None,
    catalog_version=None,
    mutate_constants=None,
    prune=True,
    after=None,
):
    """
    Write in the order the separate generators used, so key order still matches.
    """
    if nodes is not None:
        p["nodes"] = nodes
    apply_constants(p, drop_constants, add_constants)
    if state_cells is not None:
        p["state_cells"] = state_cells
    if prune:
        prune_declarations(d, p)
    if catalog_version is not None:
        p["catalog_semantic_version"] = catalog_version
    if branches is not None:
        table = p["proposal_decision_table"]
        table["branches"] = build_branches(table["branches"][0], branches)
    if mutate_constants:
        for c in p["constants"]:
            mutate_constants(c)
    if bounds:
        p["bounds"].update(**bounds)
    apply_state_total(d, state_total)
    if after:
        after(d, p)
    write_json(d, f"{out}-design.json")
    write_json(p, f"{out}-proposal.json")
    write_meaning(p, out)
    return d, p


# ---- meaning: what a generator should actually emit -----------------------------
# The Owner derives every other proposal field, so none of them are emitted here.
GRAPH_BOUND_KEYS = (
    "max_nodes",
    "max_edges",
    "max_depth",
    "max_ports",
    "max_constants",
    "max_fan_out",
    "max_lag",
    "max_window",
    "max_state_cells",
    "max_decision_branches",
    "max_source_bytes",
    "max_wasm_bytes",
)


def meaning_of(p):
    """
    Projects a proposal down to meaning.

    The counterpart of meaning_of() on the Rust side, kept so the two can be checked
    against each other.

    """
    return {
        "plugin_semantic_id": p["plugin_semantic_id"],
        "inputs": [
            {
                "role_semantic_id": i["input_role_id"],
                "value_port_semantic_id": i["value_port_semantic_id"],
                "update_clock": i["update_clock"],
            }
            for i in p["inputs"]
        ],
        "constants": p["constants"],
        "state_cells": p["state_cells"],
        "nodes": p["nodes"],
        "proposal_decision_table": p["proposal_decision_table"],
        "warmup": p["warmup"],
        "graph_bounds": {k: p["bounds"][k] for k in GRAPH_BOUND_KEYS},
    }


def write_meaning(p, out):
    write_json(meaning_of(p), f"{out}-meaning.json")


def declaration(design, p, locator):
    return {"research_request_locator": locator, "design": design, "meaning": meaning_of(p)}
