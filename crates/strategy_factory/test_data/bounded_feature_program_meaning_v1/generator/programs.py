"""
Specs for the ten programs.

Each describes only its own graph and declaration; bfp derives the rest.

"""

import pathlib
import sys


sys.path.insert(0, str(pathlib.Path(__file__).parent))
import bfp
from bfp import ATR
from bfp import BODY
from bfp import CMP
from bfp import CP
from bfp import DIV
from bfp import FR
from bfp import FRAC
from bfp import FUSED
from bfp import GAP
from bfp import LAG
from bfp import LG
from bfp import MAX
from bfp import MEAN
from bfp import MIN
from bfp import MUL
from bfp import NONE
from bfp import OS
from bfp import PD
from bfp import POS
from bfp import RF
from bfp import RSI
from bfp import SEL
from bfp import SQRT
from bfp import SUB
from bfp import SWL
from bfp import WD
from bfp import WO
from bfp import WOS
from bfp import bd
from bfp import bl
from bfp import co
from bfp import coord_port
from bfp import fused_int
from bfp import fx
from bfp import iv
from bfp import no
from bfp import op
from bfp import ps


OUT = str(pathlib.Path(__file__).parent / "out")
D, W, H4, V = (
    "research.input.close.daily.v1",
    "research.input.close.weekly.v1",
    "research.input.close.h4.v1",
    "research.input.volume.daily.v1",
)
HI, LO, OP = (
    "research.input.high.daily.v1",
    "research.input.low.daily.v1",
    "research.input.open.daily.v1",
)


# ---- skeleton shared by the T line: relative-threshold entry, exit, cross-tick state ----
def t_line(
    name,
    *,
    confirm_node,
    confirm_cmp,
    extra_state,
    roles,
    win=4,
    rel_unit="PRICE/PRICE",
    rel_nodes=None,
    k_enter=("-200", 4),
    k_exit=("-50", 4),
    extra_constants=(),
    catalog_version=None,
    state_extra=0,
):
    d, p, _hexes = bfp.base(roles)
    rel = (
        rel_nodes
        if rel_nodes is not None
        else [
            op("dev", SUB, [bd("a", iv(D)), bd("b", no("m"), True)], fx("PRICE", 2), OS(2)),
            op("rel", DIV, [bd("a", no("dev")), bd("b", no("m"), True)], fx(rel_unit, 4), OS(4)),
        ]
    )
    nodes = [
        op(
            "m",
            MEAN,
            [bd("value", iv(D))],
            fx("PRICE", 2, "WARMING_READY"),
            WOS(win, 2),
            "st_m",
            D,
        ),
    ]
    nodes += rel
    nodes += confirm_node
    nodes += [
        op("c_low", CMP, [bd("a", no("rel")), bd("b", co("k_enter"))], bl(), CP("LESS")),
        confirm_cmp,
        op("c_back", CMP, [bd("a", no("rel")), bd("b", co("k_exit"))], bl(), CP("GREATER")),
        op(
            "n_pos",
            SEL,
            [
                bd("condition", ps("in_pos")),
                bd("when_true", co("zero")),
                bd("when_false", co("one")),
            ],
            fx("SIGNAL", 0),
            NONE,
        ),
        op("b_npos", CMP, [bd("a", no("n_pos")), bd("b", co("zero"))], bl(), CP("GREATER")),
        op(
            "y_pos",
            SEL,
            [
                bd("condition", no("b_npos")),
                bd("when_true", co("zero")),
                bd("when_false", co("one")),
            ],
            fx("SIGNAL", 0),
            NONE,
        ),
        op("b_ypos", CMP, [bd("a", no("y_pos")), bd("b", co("zero"))], bl(), CP("GREATER")),
        op(
            "e1",
            SEL,
            [
                bd("condition", no("c_rsi")),
                bd("when_true", co("one")),
                bd("when_false", co("zero")),
            ],
            fx("SIGNAL", 0),
            NONE,
        ),
        op(
            "e2",
            SEL,
            [bd("condition", no("c_low")), bd("when_true", no("e1")), bd("when_false", co("zero"))],
            fx("SIGNAL", 0),
            NONE,
        ),
        op(
            "e3",
            SEL,
            [
                bd("condition", no("b_npos")),
                bd("when_true", no("e2")),
                bd("when_false", co("zero")),
            ],
            fx("SIGNAL", 0),
            NONE,
        ),
        op("entry", CMP, [bd("a", no("e3")), bd("b", co("zero"))], bl(), CP("GREATER")),
        op(
            "x1",
            SEL,
            [
                bd("condition", no("c_back")),
                bd("when_true", co("one")),
                bd("when_false", co("zero")),
            ],
            fx("SIGNAL", 0),
            NONE,
        ),
        op(
            "x2",
            SEL,
            [
                bd("condition", no("b_ypos")),
                bd("when_true", no("x1")),
                bd("when_false", co("zero")),
            ],
            fx("SIGNAL", 0),
            NONE,
        ),
        op("exit", CMP, [bd("a", no("x2")), bd("b", co("zero"))], bl(), CP("GREATER")),
        op(
            "k1",
            SEL,
            [
                bd("condition", no("entry")),
                bd("when_true", co("one")),
                bd("when_false", no("y_pos")),
            ],
            fx("SIGNAL", 0),
            NONE,
        ),
        op(
            "k2",
            SEL,
            [bd("condition", no("exit")), bd("when_true", co("zero")), bd("when_false", no("k1"))],
            fx("SIGNAL", 0),
            NONE,
        ),
        op("in_pos_next", CMP, [bd("a", no("k2")), bd("b", co("zero"))], bl(), CP("GREATER")),
    ]
    consts = [
        {
            "constant_id": "one",
            "value": {"kind": "FIXED_I128", "coefficient": "1", "unit": "SIGNAL", "scale": 0},
        },
        {
            "constant_id": "zero",
            "value": {"kind": "FIXED_I128", "coefficient": "0", "unit": "SIGNAL", "scale": 0},
        },
        {
            "constant_id": "k_enter",
            "value": {
                "kind": "FIXED_I128",
                "coefficient": k_enter[0],
                "unit": rel_unit,
                "scale": k_enter[1],
            },
        },
        {
            "constant_id": "k_exit",
            "value": {
                "kind": "FIXED_I128",
                "coefficient": k_exit[0],
                "unit": rel_unit,
                "scale": k_exit[1],
            },
        },
        *list(extra_constants),
        {
            "constant_id": "w_on",
            "value": {
                "kind": "FIXED_I128",
                "coefficient": "200000",
                "unit": "WEIGHT_MICROS",
                "scale": 0,
            },
        },
        {
            "constant_id": "position-exit",
            "value": {"kind": "POSITION_INTENT_V1", "semantic_id": "kernel.position.exit.v1"},
        },
    ]
    mb_w = 20 + 324 * win
    cells = [
        {
            "state_id": "st_m",
            "writer_node_id": "m",
            "state_kind": {"kind": "PRIMITIVE"},
            "initial": "CANONICAL_EMPTY",
            "max_bytes": mb_w,
        },
        *list(extra_state),
        {
            "state_id": "in_pos",
            "writer_node_id": "in_pos_next",
            "state_kind": {
                "kind": "STRATEGY",
                "value_type": {"kind": "BOOLEAN"},
                "source_port_id": "value",
            },
            "initial": {"CONSTANT": {"constant_id": "initial-condition"}},
            "max_bytes": 1,
        },
    ]
    en_ov = {
        "proposal.target-weight.v1": {
            "source": co("w_on"),
            "conversion": {"kind": "FIXED_COEFFICIENT_TO_I32", "unit": "WEIGHT_MICROS", "scale": 0},
        },
    }
    # The entry branch needs the weight variant while the exit branch and the default frame
    # need the position variant, so they cannot share one constant.
    # A branch that rewrote a shared 'target' constant used to exist: it got the entry branch
    # right and the exit branch and default frame wrong at once. Derivation does not look at
    # the graph, so all four programs kept generating. It only ever produced programs no Owner
    # would admit, so it is deleted rather than left as an option.
    en_ov["proposal.target-variant.v1"] = {
        "lifecycle_semantic_id": "kernel.target.weight.v1",
        "source": co("target-weight-variant"),
    }
    consts.append(
        {
            "constant_id": "target-weight-variant",
            "value": {"kind": "TARGET_VARIANT_V1", "semantic_id": "kernel.target.weight.v1"},
        },
    )
    mut = None
    branches = [
        {
            "priority": 20,
            "predicate": no("exit"),
            "overrides": {
                "proposal.position-intent.v1": {
                    "lifecycle_semantic_id": "kernel.position.exit.v1",
                    "source": co("position-exit"),
                },
            },
        },
        {"priority": 10, "predicate": no("entry"), "overrides": en_ov},
    ]
    return bfp.emit(
        d,
        p,
        f"{OUT}/{name}",
        nodes=nodes,
        drop_constants={"threshold"},
        add_constants=consts,
        state_cells=cells,
        branches=branches,
        mutate_constants=mut,
        catalog_version=catalog_version,
        bounds={
            "max_nodes": 64,
            "max_edges": 256,
            "max_depth": 24,
            "max_ports": 192,
            "max_state_cells": 16,
            "max_fan_out": 24,
            "max_window": 64,
            "max_constants": 64,
        },
        state_total=mb_w + state_extra + 1 + 64,
    )


def build_all():
    PER, OFF, MAXLAG, SW = 4, 3, 4, 4
    rsi_state = 384 + 20 + 324 * (PER + 1)
    lag_state = 20 + 324 * (OFF + 1)

    def prim(sid, w, mb):
        return {
            "state_id": sid,
            "writer_node_id": w,
            "state_kind": {"kind": "PRIMITIVE"},
            "initial": "CANONICAL_EMPTY",
            "max_bytes": mb,
        }

    # T3: RSI confirmation.
    t_line(
        "t3",
        roles=bfp.ROLES4,
        state_extra=rsi_state,
        confirm_node=[
            op(
                "rsi",
                RSI,
                [bd("value", iv(D))],
                fx("dimensionless", 2, "WARMING_READY"),
                POS(PER, 2),
                "st_rsi",
                D,
            ),
        ],
        confirm_cmp=op(
            "c_rsi",
            CMP,
            [bd("a", no("rsi"), True), bd("b", co("rsi_lo"))],
            bl(),
            CP("LESS"),
        ),
        extra_state=[prim("st_rsi", "rsi", rsi_state)],
        extra_constants=[
            {
                "constant_id": "rsi_lo",
                "value": {
                    "kind": "FIXED_I128",
                    "coefficient": "3000",
                    "unit": "dimensionless",
                    "scale": 2,
                },
            },
        ],
    )

    # T4: lag confirmation, an atomic value+coordinate pair.
    _, _, hx4 = bfp.base(bfp.ROLES4)
    lag_pair = [
        op(
            "l3",
            LAG,
            [bd("value", iv(D))],
            [*fx("PRICE", 2, "WARMING_READY"), coord_port(hx4[D])],
            LG(OFF, MAXLAG),
            "st_l3",
            D,
        ),
        op("chg3", SUB, [bd("a", iv(D)), bd("b", no("l3"), True)], fx("PRICE", 2), OS(2)),
    ]
    k_up = [
        {
            "constant_id": "k_up",
            "value": {"kind": "FIXED_I128", "coefficient": "0", "unit": "PRICE", "scale": 2},
        },
    ]
    t_line(
        "t4",
        roles=bfp.ROLES4,
        state_extra=lag_state,
        confirm_node=lag_pair,
        confirm_cmp=op("c_rsi", CMP, [bd("a", no("chg3")), bd("b", co("k_up"))], bl(), CP("LESS")),
        extra_state=[prim("st_l3", "l3", lag_state)],
        extra_constants=k_up,
    )

    # T5: swing-low, same family, fed the close price. Nothing checks that semantic.
    swl_pair = [
        op(
            "l3",
            SWL,
            [bd("value", iv(D))],
            [*fx("PRICE", 2, "WARMING_READY"), coord_port(hx4[D])],
            WD(SW),
            "st_l3",
            D,
        ),
        op("chg3", SUB, [bd("a", iv(D)), bd("b", no("l3"), True)], fx("PRICE", 2), OS(2)),
    ]
    t_line(
        "t5",
        roles=bfp.ROLES4,
        state_extra=20 + 324 * SW,
        confirm_node=swl_pair,
        confirm_cmp=op("c_rsi", CMP, [bd("a", no("chg3")), bd("b", co("k_up"))], bl(), CP("LESS")),
        extra_state=[prim("st_l3", "l3", 20 + 324 * SW)],
        extra_constants=k_up,
    )

    # T6: candle.body, the Ohlc input rule, with neither state nor clock.
    ohlc = [bd("close", iv(D)), bd("high", iv(HI)), bd("low", iv(LO)), bd("open", iv(OP))]
    k50 = [
        {
            "constant_id": "k_up",
            "value": {"kind": "FIXED_I128", "coefficient": "50", "unit": "PRICE", "scale": 2},
        },
    ]
    t_line(
        "t6",
        roles=bfp.ROLES7,
        state_extra=0,
        confirm_node=[op("chg3", BODY, ohlc, fx("PRICE", 2), NONE)],
        confirm_cmp=op(
            "c_rsi",
            CMP,
            [bd("a", no("chg3")), bd("b", co("k_up"))],
            bl(),
            CP("GREATER"),
        ),
        extra_state=[],
        extra_constants=k50,
    )

    # T7: ATR, ClockedOhlc plus Bar state plus FirstSample, which declares READY, the
    # opposite of the three window rules.
    t_line(
        "t7",
        roles=bfp.ROLES7,
        state_extra=400,
        confirm_node=[op("chg3", ATR, ohlc, fx("PRICE", 2), PD(3), "st_atr", D)],
        confirm_cmp=op(
            "c_rsi",
            CMP,
            [bd("a", no("chg3")), bd("b", co("k_up"))],
            bl(),
            CP("GREATER"),
        ),
        extra_state=[prim("st_atr", "chg3", 400)],
        extra_constants=k50,
    )

    # T8: gap, PreviousClose, which declares WARMING_READY, with parameters = None.
    t_line(
        "t8",
        roles=bfp.ROLES7,
        state_extra=400,
        confirm_node=[op("chg3", GAP, ohlc, fx("PRICE", 2, "WARMING_READY"), NONE, "st_atr", D)],
        confirm_cmp=op(
            "c_rsi",
            CMP,
            [bd("a", no("chg3"), True), bd("b", co("k_up"))],
            bl(),
            CP("GREATER"),
        ),
        extra_state=[prim("st_atr", "chg3", 400)],
        extra_constants=k50,
    )

    # T9: the fused primitive computes (a-b)/(a+b) in place of SUB+DIV. Catalog v2 only.
    t_line(
        "t9",
        roles=bfp.ROLES7,
        state_extra=400,
        catalog_version=2,
        rel_unit="dimensionless",
        k_enter=("-2", 2),
        k_exit=("-1", 2),
        rel_nodes=[
            op(
                "rel",
                FUSED,
                [bd("a", iv(D)), bd("b", no("m"), True)],
                fx("dimensionless", 2),
                FR([1, 0, 1, 1, 4], [1, 0, 1, 1, 3], 4, 2, "dimensionless"),
            ),
        ],
        confirm_node=[op("chg3", GAP, ohlc, fx("PRICE", 2, "WARMING_READY"), NONE, "st_atr", D)],
        confirm_cmp=op(
            "c_rsi",
            CMP,
            [bd("a", no("chg3"), True), bd("b", co("k_up"))],
            bl(),
            CP("GREATER"),
        ),
        extra_state=[prim("st_atr", "chg3", 400)],
        extra_constants=k50,
    )


# ---- A line: one branch, no cross-tick state gate. Shares only base/emit/helpers ----
def a_line(name, sizing_nodes, sizing_constants, *, catalog_version=None, win=4):
    d, p, _hexes = bfp.base(bfp.ROLES4)
    wb = 20 + 324 * win
    nodes = [
        op(
            "w_min",
            MIN,
            [bd("value", iv(W))],
            fx("PRICE", 2, "WARMING_READY"),
            WO(win),
            "st_wmin",
            W,
        ),
        op(
            "w_max",
            MAX,
            [bd("value", iv(W))],
            fx("PRICE", 2, "WARMING_READY"),
            WO(win),
            "st_wmax",
            W,
        ),
        op(
            "d_mean",
            MEAN,
            [bd("value", iv(D))],
            fx("PRICE", 2, "WARMING_READY"),
            WOS(win, 2),
            "st_dmean",
            D,
        ),
        op("d_sq", MUL, [bd("a", iv(D)), bd("b", iv(D))], fx("PRICE*PRICE", 4), OS(4)),
        op(
            "d_e2",
            MEAN,
            [bd("value", no("d_sq"))],
            fx("PRICE*PRICE", 4, "WARMING_READY"),
            WOS(win, 4),
            "st_de2",
            D,
        ),
        op(
            "d_m2",
            MUL,
            [bd("a", no("d_mean"), True), bd("b", no("d_mean"), True)],
            fx("PRICE*PRICE", 4),
            OS(4),
        ),
        op(
            "d_var",
            SUB,
            [bd("a", no("d_e2"), True), bd("b", no("d_m2"))],
            fx("PRICE*PRICE", 4),
            OS(4),
        ),
        op("d_dev", SUB, [bd("a", iv(D)), bd("b", no("d_mean"), True)], fx("PRICE", 2), OS(2)),
        op(
            "d_dev2",
            MUL,
            [bd("a", no("d_dev")), bd("b", no("d_dev"))],
            fx("PRICE*PRICE", 4),
            OS(4),
        ),
        op(
            "d_quarter",
            FRAC,
            [bd("low", co("zero_p2")), bd("high", no("d_dev2"))],
            fx("PRICE*PRICE", 4),
            RF(1, 4, 4),
        ),
        op(
            "v_mean",
            MEAN,
            [bd("value", iv(V))],
            fx("QUANTITY", 2, "WARMING_READY"),
            WOS(win, 2),
            "st_vmean",
            V,
        ),
        op("c_boll", CMP, [bd("a", no("d_quarter")), bd("b", no("d_var"))], bl(), CP("GREATER")),
        op("c_vol", CMP, [bd("a", iv(V)), bd("b", no("v_mean"), True)], bl(), CP("GREATER")),
        op("c_wlo", CMP, [bd("a", iv(W)), bd("b", no("w_min"), True)], bl(), CP("GREATER")),
        op("c_whi", CMP, [bd("a", iv(W)), bd("b", no("w_max"), True)], bl(), CP("LESS")),
        op("c_pull", CMP, [bd("a", iv(H4)), bd("b", no("w_min"), True)], bl(), CP("GREATER")),
    ]
    # all_of: a conjunction chain. The one construct where a parameter is strategy language.
    prev = co("one")
    for i, c in enumerate(reversed(["c_wlo", "c_whi", "c_boll", "c_vol", "c_pull"])):
        nid = f"s{i}"
        nodes.append(
            op(
                nid,
                SEL,
                [bd("condition", no(c)), bd("when_true", prev), bd("when_false", co("zero"))],
                fx("SIGNAL", 0),
                NONE,
            ),
        )
        prev = no(nid)
    nodes.append(op("c_all", CMP, [bd("a", prev), bd("b", co("zero"))], bl(), CP("GREATER")))
    nodes += sizing_nodes
    consts = [
        {
            "constant_id": "one",
            "value": {"kind": "FIXED_I128", "coefficient": "1", "unit": "SIGNAL", "scale": 0},
        },
        {
            "constant_id": "zero",
            "value": {"kind": "FIXED_I128", "coefficient": "0", "unit": "SIGNAL", "scale": 0},
        },
        {
            "constant_id": "zero_p2",
            "value": {"kind": "FIXED_I128", "coefficient": "0", "unit": "PRICE*PRICE", "scale": 4},
        },
        *list(sizing_constants),
    ]
    cells = [
        {
            "state_id": s,
            "writer_node_id": n,
            "state_kind": {"kind": "PRIMITIVE"},
            "initial": "CANONICAL_EMPTY",
            "max_bytes": wb,
        }
        for s, n in [
            ("st_wmin", "w_min"),
            ("st_wmax", "w_max"),
            ("st_dmean", "d_mean"),
            ("st_de2", "d_e2"),
            ("st_vmean", "v_mean"),
        ]
    ]
    cells.append(
        {
            "state_id": "condition-state",
            "writer_node_id": "c_all",
            "state_kind": {
                "kind": "STRATEGY",
                "value_type": {"kind": "BOOLEAN"},
                "source_port_id": "value",
            },
            "initial": {"CONSTANT": {"constant_id": "initial-condition"}},
            "max_bytes": 1,
        },
    )
    # #749: a variant terminal must name the constant it emits. Rewriting a shared constant
    # leaves the default frame disagreeing.
    consts.append(
        {
            "constant_id": "target-weight-variant",
            "value": {"kind": "TARGET_VARIANT_V1", "semantic_id": "kernel.target.weight.v1"},
        },
    )
    branches = [
        {
            "priority": 10,
            "predicate": no("c_all"),
            "overrides": {
                "proposal.target-variant.v1": {
                    "lifecycle_semantic_id": "kernel.target.weight.v1",
                    "source": co("target-weight-variant"),
                },
                "proposal.target-weight.v1": {
                    "source": no("w_band"),
                    "conversion": {
                        "kind": "FIXED_COEFFICIENT_TO_I32",
                        "unit": "WEIGHT_MICROS",
                        "scale": 0,
                    },
                },
            },
        },
    ]
    return bfp.emit(
        d,
        p,
        f"{OUT}/{name}",
        nodes=nodes,
        drop_constants={"threshold"},
        add_constants=consts,
        state_cells=cells,
        branches=branches,
        catalog_version=catalog_version,
        prune=False,
        bounds={
            "max_nodes": 64,
            "max_edges": 256,
            "max_depth": 16,
            "max_ports": 192,
            "max_state_cells": 16,
            "max_fan_out": 16,
            "max_window": 64,
            "max_constants": 64,
        },
        state_total=wb * 5 + 16,
    )


# ---- ctl8: an eight-port control. Shares only base/emit/helpers with the A and T lines ----
def ctl8():
    F, U = "MARKET_DATA.BAR.CLOSE.PRICE.V1", "PRICE"
    R = [
        ("research.input.close.a.v1", "1W", F, U, "a"),
        ("research.input.close.b.v1", "1D", F, U, "b"),
        ("research.input.close.c.v1", "4H", F, U, "c"),
        ("research.input.close.d.v1", "15M", F, U, "d"),
    ]
    d, p, _ = bfp.base(R)
    a, b, c, e = (r[0] for r in R)
    WIN = 4
    nodes = [
        op(
            "m1",
            MEAN,
            [bd("value", iv(a))],
            [
                {
                    "port_id": "value",
                    "value_type": {"kind": "FIXED_I128", "unit": "PRICE", "scale": 2},
                    "availability": "WARMING_READY",
                },
            ],
            WOS(WIN, 2),
            "st_m1",
            a,
        ),
        op(
            "c1",
            CMP,
            [bd("a", iv(a)), {"port_id": "b", "source": no("m1"), "require_ready": True}],
            bl(),
            CP("GREATER"),
        ),
        op("c2", CMP, [bd("a", iv(c)), bd("b", iv(e))], bl(), CP("GREATER")),
        op("c4", CMP, [bd("a", iv(b)), bd("b", iv(c))], bl(), CP("GREATER")),
        op(
            "s1",
            SEL,
            [bd("condition", no("c2")), bd("when_true", co("one")), bd("when_false", co("zero"))],
            fx("SIGNAL", 0),
            NONE,
        ),
        op(
            "s2",
            SEL,
            [bd("condition", no("c1")), bd("when_true", no("s1")), bd("when_false", co("zero"))],
            fx("SIGNAL", 0),
            NONE,
        ),
        op(
            "s4",
            SEL,
            [bd("condition", no("c4")), bd("when_true", no("s2")), bd("when_false", co("zero"))],
            fx("SIGNAL", 0),
            NONE,
        ),
        op(
            "s3",
            SEL,
            [
                bd("condition", co("initial-condition")),
                bd("when_true", no("s4")),
                bd("when_false", co("zero")),
            ],
            fx("SIGNAL", 0),
            NONE,
        ),
        op("c_all", CMP, [bd("a", no("s3")), bd("b", co("zero"))], bl(), CP("GREATER")),
    ]
    consts = [
        {
            "constant_id": "one",
            "value": {"kind": "FIXED_I128", "coefficient": "1", "unit": "SIGNAL", "scale": 0},
        },
        {
            "constant_id": "zero",
            "value": {"kind": "FIXED_I128", "coefficient": "0", "unit": "SIGNAL", "scale": 0},
        },
    ]
    cells = [
        {
            "state_id": "st_m1",
            "writer_node_id": "m1",
            "state_kind": {"kind": "PRIMITIVE"},
            "initial": "CANONICAL_EMPTY",
            "max_bytes": 20 + 324 * WIN,
        },
        {
            "state_id": "condition-state",
            "writer_node_id": "c_all",
            "state_kind": {
                "kind": "STRATEGY",
                "value_type": {"kind": "BOOLEAN"},
                "source_port_id": "value",
            },
            "initial": {"CONSTANT": {"constant_id": "initial-condition"}},
            "max_bytes": 1,
        },
    ]
    return bfp.emit(
        d,
        p,
        f"{OUT}/ctl8",
        nodes=nodes,
        drop_constants={"threshold"},
        add_constants=consts,
        state_cells=cells,
        prune=False,
        branches=[{"priority": 10, "predicate": no("c_all")}],
        bounds={
            "max_nodes": 32,
            "max_edges": 128,
            "max_depth": 8,
            "max_ports": 96,
            "max_state_cells": 8,
            "max_fan_out": 16,
            "max_constants": 32,
        },
    )


def build_bases():

    for nm, roles in (("base4", bfp.ROLES4), ("base7", bfp.ROLES7)):
        d, p, _ = bfp.base(roles)
        bfp.write_json(d, f"{OUT}/{nm}-design.json")
        bfp.write_json(p, f"{OUT}/{nm}-proposal.json")


def build_a_line():
    def K(i, c, u, sc):
        return {
            "constant_id": i,
            "value": {"kind": "FIXED_I128", "coefficient": c, "unit": u, "scale": sc},
        }

    banded = [
        op("c_hivol", CMP, [bd("a", no("d_var")), bd("b", co("var_hi"))], bl(), CP("GREATER")),
        op("c_midvol", CMP, [bd("a", no("d_var")), bd("b", co("var_mid"))], bl(), CP("GREATER")),
        op(
            "w_inner",
            SEL,
            [
                bd("condition", no("c_midvol")),
                bd("when_true", co("w_mid")),
                bd("when_false", co("w_full")),
            ],
            fx("WEIGHT_MICROS", 0),
            NONE,
        ),
        op(
            "w_band",
            SEL,
            [
                bd("condition", no("c_hivol")),
                bd("when_true", co("w_small")),
                bd("when_false", no("w_inner")),
            ],
            fx("WEIGHT_MICROS", 0),
            NONE,
        ),
    ]
    a_line(
        "A0",
        banded,
        [
            K("var_hi", "40000000", "PRICE*PRICE", 4),
            K("var_mid", "10000000", "PRICE*PRICE", 4),
            K("w_small", "50000", "WEIGHT_MICROS", 0),
            K("w_mid", "150000", "WEIGHT_MICROS", 0),
            K("w_full", "300000", "WEIGHT_MICROS", 0),
        ],
    )
    # A0-v3: continuous k/sigma. sqrt is catalog v3 only, and k/sigma has to go through the
    # fused primitive because Quotient only concatenates syntax.
    a_line(
        "A0v3",
        [
            op("sigma", SQRT, [bd("value", no("d_var"))], fx("PRICE", 2), OS(2)),
            op(
                "w_band",
                FUSED,
                [bd("a", no("sigma")), bd("b", no("sigma"))],
                fx("WEIGHT_MICROS", 0),
                FR(fused_int(6_000_000), [1, 0], 4, 0, "WEIGHT_MICROS"),
            ),
        ],
        [],
        catalog_version=3,
    )


def s1():
    """
    Build the smallest admissible shape: one declared channel against one threshold.

    Every other program here was grown to drive a catalog rule, so all of them are wider than the
    bounded family a first production path is admitted for. This one is built to be minimal
    instead: one input role, one comparison against one constant, no state cell and no cross-tick
    carry. With a single channel there is no choice of decision clock to make, so the clock is
    that role and an Owner assembling this invents nothing.
    """
    role = ("research.input.close.daily.v1", "1D", "MARKET_DATA.BAR.CLOSE.PRICE.V1", "PRICE", "c")
    d, p, _ = bfp.base([role])
    channel = role[0]
    nodes = [
        op(
            "over",
            CMP,
            [bd("a", iv(channel)), bd("b", co("threshold"))],
            bl(),
            CP("GREATER"),
        ),
    ]
    # The entry branch names its own target variant. The default frame keeps the template's, and
    # the two must not become one constant: collapsing them is what left four earlier programs
    # with a correct entry branch and a wrong exit, and derivation does not look at the graph.
    consts = [
        {
            "constant_id": "target-entry-variant",
            "value": {"kind": "TARGET_VARIANT_V1", "semantic_id": "kernel.target.position.v1"},
        },
    ]
    return bfp.emit(
        d,
        p,
        f"{OUT}/s1",
        nodes=nodes,
        # `initial-condition` exists to seed a state cell, and this program has none. A declared
        # constant no node or terminal consumes is refused: the declaration surface has to follow
        # the graph for constants exactly as it does for input roles.
        drop_constants={"initial-condition"},
        add_constants=consts,
        state_cells=[],
        branches=[
            {
                "priority": 10,
                "predicate": no("over"),
                "overrides": {
                    "proposal.position-intent.v1": {
                        "lifecycle_semantic_id": "kernel.position.enter.v1",
                        "source": co("position"),
                    },
                    "proposal.target-variant.v1": {
                        "lifecycle_semantic_id": "kernel.target.position.v1",
                        "source": co("target-entry-variant"),
                    },
                },
            },
        ],
        bounds={
            "max_nodes": 4,
            # Edges count terminal references, not just graph wiring: eleven outputs in the
            # default frame, eleven in the branch, the predicate, and this node's two bindings
            # come to twenty-five. The graph contributes two of them, so a minimal program does
            # not get a small edge bound - the decision table sets the floor.
            "max_edges": 32,
            "max_depth": 2,
            "max_ports": 8,
            # A bound is a capacity and every capacity must be non-zero: `validate_bounds`
            # refuses `max_state_cells == 0` outright, so a program with no state cell still
            # declares room for one. Zero is not expressible.
            "max_state_cells": 1,
            "max_fan_out": 4,
            "max_constants": 16,
        },
    )


if __name__ == "__main__":
    build_bases()
    build_all()
    build_a_line()
    ctl8()
    s1()
    written = len({f.name.rsplit("-", 1)[0] for f in pathlib.Path(OUT).glob("*-meaning.json")})
    print(f"{written} programs from one generator")
