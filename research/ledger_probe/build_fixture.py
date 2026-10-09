"""Freeze a small, real-record fixture for comparing versioned OSS databases.

This reads existing Git evidence. It neither writes research records nor runs
strategies, and its simulated database commits are current validation steps.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
if not __package__:
    sys.path.insert(0, str(ROOT))
HERE = Path(__file__).resolve().parent
SOURCE_HEAD = "1b32849ca7ec6efd609b0a3bbbbd26bcd854103d"
OLD_C02_COMMIT = "2dd821cb206ee79975be5943bb3aa6f9c5bfe617"
LEDGER_PATH = "research/r1_native/RD_EXPERIMENTS.md"
CASES_PATH = "research/r1_native/SOURCE_CASES.md"
COMPONENT_ALIASES = ["ConfirmedLineSupportTouches", "已确认上升线状态", "确认趋势线状态"]


def canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def digest(value: object) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def blob(path: str, commit: str = SOURCE_HEAD) -> bytes:
    if commit == OLD_C02_COMMIT and path == CASES_PATH:
        from research.records.materials import retained_historical_refs
        for selection in retained_historical_refs(ROOT):
            for payload in selection["retained_payloads"]:
                if payload["original_commit"] == commit and payload["path"] == path:
                    return base64.b64decode(payload["content_base64"], validate=True)
        raise ValueError("explicit retained C02 source is unavailable")
    return subprocess.check_output(["git", "show", f"{commit}:{path}"], cwd=ROOT)


def provenance(path: str, locator: str, commit: str = SOURCE_HEAD) -> dict:
    return {"git_commit": commit, "path": path, "sha256": hashlib.sha256(blob(path, commit)).hexdigest(), "locator": locator}


def section(path: str, prefix: str, commit: str = SOURCE_HEAD) -> tuple[str, str]:
    lines = blob(path, commit).decode().splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith(prefix))
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    return "\n".join(lines[start:end]).strip(), f"L{start + 1}-L{end}; heading={lines[start]}"


def object_from_section(id_: str, kind: str, path: str, prefix: str, scope: str, state: str, aliases: list[str], revision: int = 1, commit: str = SOURCE_HEAD) -> dict:
    text, locator = section(path, prefix, commit)
    return {"id": id_, "kind": kind, "revision": revision, "body": {"title": text.splitlines()[0].removeprefix("## "), "text": text, "scope": scope, "state": state, "aliases": aliases}, "provenance": provenance(path, locator, commit)}


def attempt(id_: str, aliases: list[str] | None = None) -> dict:
    path = f"research/records/attempts/{id_}/attempt.json"
    data = json.loads(blob(path))
    scope = data["decision"]["scope"]
    if id_ == "H08":
        scope += " 仅允许独立审查或复用 ConfirmedLineSupportTouches 的已确认上升线状态计算；不能继承完整入场规则或整体收益。"
    elif id_ == "H18a":
        scope += " 仅复用 H08 的状态计算；假设父为 H15a，composition_mode=dependent；不能声称 H08 入场有效或估计独立二因子因果交互。code_parent=null，完整依赖/输入重建仍未知。"
    return {"id": f"attempt:{id_}", "kind": "attempt", "revision": 1, "body": {"title": f"{id_}：{data['question']}", "text": json.dumps(data, ensure_ascii=False, indent=2), "scope": scope, "state": f"{data['decision']['layer']}_{data['decision']['outcome']}", "aliases": [id_, *(aliases or [])]}, "provenance": provenance(path, "/")}


def relation(id_: str, kind: str, from_: str, to_: str, text: str, scope: str, from_revision: int = 1, to_revision: int = 1) -> dict:
    return {"id": id_, "kind": kind, "from_id": from_, "from_revision": from_revision, "to_id": to_, "to_revision": to_revision, "body": {"text": text, "scope": scope}}


def build_fixture() -> dict:
    objects = [attempt("H08", COMPONENT_ALIASES), attempt("H18a", COMPONENT_ALIASES), attempt("H15a"), attempt("H13"), attempt("H13b")]
    objects += [
        object_from_section("claim:C02-stop-attribution", "claim", CASES_PATH, "## C02 -", "旧历史解释：当时将区外结构止损归到 C02；已被 S46 收窄，不能用于今日来源证明。", "historical_narrowed", ["C02", "区外止损", "outside-zone structural stop"], commit=OLD_C02_COMMIT),
        object_from_section("claim:C02-stop-attribution", "claim", CASES_PATH, "## C02 -", "当前更正：ETH 四小时上升线影线与稍后日线下降阻力区域是两段；C02 未指定 ETH 多单或数值止损。S46 为 H27a/D95 结果之后的回顾性来源更正，不改其原登记或原生结果。", "current_corrected", ["C02", "S46", "止损来源更正"], revision=2),
        object_from_section("source:S46", "source_check", LEDGER_PATH, "## Source recheck S46:", "后见来源纠正，不是事前登记、独立来源样本或经济测试；收窄 D94/H27a 的来源解释，保留 H27a 代理规则的经济失败。", "retrospective_correction", ["S46", "C02 来源重读"]),
        object_from_section("diagnostic:D94", "diagnostic", LEDGER_PATH, "## Diagnostic D94:", "使用 C02 旧来源解释提出原生止损对 A 的几何诊断；读回时必须提示 S46 纠错。几何事实不产生替代成交或账户收益。", "source_rationale_needs_review", ["D94", "止损与 A 的几何"]),
        attempt("H27a"),
        object_from_section("diagnostic:D95", "diagnostic", LEDGER_PATH, "## Diagnostic D95:", "解释 H27a 原生路径中的缩量与收益损失；账户差 -6,216.68 USDT 不因 S46 来源收窄而改写，非独立因果优势或资格。", "bounded_diagnosis", ["D95", "H27a 路径归因"]),
        object_from_section("source:S01", "source_check", LEDGER_PATH, "## Source observation S01:", "2024-10-28 同一原始视频的第一次处理；DOGE 06:05-06:50 是条件路径，不是新订单事实。与 S15 合计只算一个独立原始媒体。", "development_source", ["S01", "4Kpsuq0K", "4a9ca56dc11f0dc7168a5d16a19df641913f05b8c7cfc31f6805c352f23ad830"]),
        object_from_section("source:S15", "source_check", LEDGER_PATH, "## Source check S15:", "重复处理 S01 的同一 URL 与同一 MP4 SHA-256；登记在再采集前但首次内容暴露之后，不能当独立事前来源测试或新增支持样本。", "duplicate_not_independent", ["S15", "4Kpsuq0K", "4a9ca56dc11f0dc7168a5d16a19df641913f05b8c7cfc31f6805c352f23ad830"]),
    ]
    relations = [
        relation("rel:H18a-component-H08", "component_reuse", "attempt:H18a", "attempt:H08", "ConfirmedLineSupportTouches", "只复用已确认上升线状态计算；不继承 H08 完整入场假设或整体收益。"),
        relation("rel:H18a-hypothesis-H15a", "hypothesis_extension", "attempt:H18a", "attempt:H15a", "持仓后取消未成交层级，保留 H15a 三层入场/风险预算/保护。", "dependent composition；合法经济比较是 H18a 对冻结 H15a，不是 H08-only 的独立四格。"),
        relation("rel:H13b-repair-H13", "repair", "attempt:H13b", "attempt:H13", "靠近后挂单改为 B 首次新高时挂单。", "H13b 的 S27 来源门槛仍失败；不能补造年度结果。"),
        relation("rel:C02-v2-narrows-v1", "narrows", "claim:C02-stop-attribution", "claim:C02-stop-attribution", "S46 收窄旧 C02 结构止损来源归因。", "revision 1 仍可历史读回；revision 2 不能倒写旧登记。", from_revision=2),
        relation("rel:S46-corrects-C02-v1", "corrects", "source:S46", "claim:C02-stop-attribution", "结果后重读原始来源，发现旧 C02 混合上升线影线、日线阻力区与区外止损。", "来源解释修正，不改变原生经济结果。"),
        relation("rel:C02-v2-supported-S46", "supported_by", "claim:C02-stop-attribution", "source:S46", "当前 C02 更正的依据。", "回顾性来源纠正。", from_revision=2),
        relation("rel:D94-uses-C02-v1", "uses_claim", "diagnostic:D94", "claim:C02-stop-attribution", "D94 注册来源张力时使用旧 C02 区外止损解释。", "直接受影响：复核来源归因；原几何诊断事实不自动失效。"),
        relation("rel:H27a-uses-C02-v1", "uses_claim", "attempt:H27a", "claim:C02-stop-attribution", "H27a 原登记将 A - 0.25 prior ATR 视为 C02/C20 的研究者代理。", "直接受影响：收窄来源忠实度；规则/原登记/原生失败结果仍为其历史事实。"),
        relation("rel:H27a-follows-D94", "depends_on", "attempt:H27a", "diagnostic:D94", "D94 几何诊断支持单独登记 H27a。", "不把 D94 几何比率替代 H27a 原生账户。"),
        relation("rel:D95-interprets-H27a", "interprets", "diagnostic:D95", "attempt:H27a", "保留 H27a 缩量与账户差的原生路径解释。", "后继影响链应显示 D95；S46 不改其账户差或因果边界。"),
        relation("rel:S15-duplicate-S01", "duplicate_of", "source:S15", "source:S01", "相同原始 URL；MP4 SHA-256 4a9ca56dc11f0dc7168a5d16a19df641913f05b8c7cfc31f6805c352f23ad830。", "两个处理尝试只算一个独立媒体来源；S15 不增加独立来源支持。"),
        relation("rel:C02-v1-from-S01", "derived_from", "claim:C02-stop-attribution", "source:S01", "旧 C02 来源段：02:10-03:15。", "保留旧错误解释的来源定位。"),
        relation("rel:C02-v2-from-S01", "derived_from", "claim:C02-stop-attribution", "source:S01", "同一原始来源的更正解释。", "未增加独立来源样本。", from_revision=2),
    ]
    sources = []
    for obj in objects:
        p = obj["provenance"]
        source = {k: p[k] for k in ("git_commit", "path", "sha256")}
        if source not in sources:
            sources.append(source)
    for path in ["research/r1_native/results/2026-10-09-s46-stop-source-recheck.json", "research/r1_native/results/2026-10-08-s15-duplicate-source.json", "research/r1_native/results/2026-10-08-h13b-source-gate.json"]:
        p = provenance(path, "/")
        sources.append({k: p[k] for k in ("git_commit", "path", "sha256")})
    return {"fixture_schema_version": 1, "source_head": SOURCE_HEAD, "transcription": {"kind": "current_validation_transcription", "preregistered": False, "scope": "真实历史资料的当前验证转录；下游数据库导入/模拟提交不是历史实验事前登记。"}, "objects": objects, "relations": relations, "source_blobs": sources}


def build_contract(fixture: dict) -> dict:
    obj = {(x["id"], x["revision"]): x for x in fixture["objects"]}
    correction_objects = [["claim:C02-stop-attribution", 2], ["source:S46", 1]]
    correction_relation_ids = [r["id"] for r in fixture["relations"] if (r["from_id"], r["from_revision"]) in {tuple(x) for x in correction_objects} or (r["to_id"], r["to_revision"]) in {tuple(x) for x in correction_objects}]
    baseline_objects = [x for x in fixture["objects"] if [x["id"], x["revision"]] not in correction_objects]
    baseline_relations = [r for r in fixture["relations"] if r["id"] not in correction_relation_ids]
    scopes = {id_: obj[(f"attempt:{id_}", 1)]["body"]["scope"] for id_ in ["H08", "H18a"]}
    return {
        "contract_schema_version": 3,
        "validation_revision": 3,
        "revision_note": "在正式 A7 执行前，按后端原生存储模型校准 working-set 条件：恢复所有实际存在的原生状态；没有未提交工作集的 backend 此项 not_applicable。在正式 A5 验收前，让两个 writer 写入不同真实对象 revision，排除重复对象约束造成的 CAS 假阳性。fixture 与其他硬门槛/hash 未改变。",
        "fixture_sha256": digest(fixture),
        "registration_nature": "本合同是已读历史证据后的当前验证冻结；不声称历史或本轮研究假设事前登记。",
        "canonical_hash": "SHA-256 of UTF-8 JSON with ensure_ascii=False, sort_keys=True, separators=(',', ':'); array order retained",
        "common_invariants": ["对象键为 (id,revision)，历史对象正文不可覆盖；关系端点均固定对象 revision。", "成功与冲突必须由持久内容、版本和操作读回判定，HTTP 200/CLI exit 0 不充分。", "version 校验、对象/关系写入、operation_id 登记和 version 增量在同一原生事务/原子提交。", "每类独立从冻结基线启动；跨类残余写入不能改变验收期待。", "别名查询只声明固定中文与 ASCII alias 的精确匹配，不声称通用语义搜索。"],
        "validation_history": {
            "baseline": {"object_keys": [[o["id"], o["revision"]] for o in baseline_objects], "relation_ids": [r["id"] for r in baseline_relations], "objects_sha256": digest(baseline_objects), "relations_sha256": digest(baseline_relations)},
            "correction": {"add_object_keys": correction_objects, "add_relation_ids": correction_relation_ids, "current_objects_sha256": digest(fixture["objects"]), "current_relations_sha256": digest(fixture["relations"])},
            "note": "baseline/correction 是本轮验证模拟提交，baseline 已包含历史后继结果；并非按历史时序重演登记。",
        },
        "classes": [
            {"id": "A1-component-recall", "required": True, "queries": COMPONENT_ALIASES, "query_contract": "kind=attempt，body.aliases 精确匹配；ASCII 可 casefold，中文保持原字；排序按 id。", "metadata_boundary": "基于本轮人工证据抽取的固定元数据；不证明自动 Markdown 抽取或一般自然语言召回质量。", "expected_ids": ["attempt:H08", "attempt:H18a"], "expected_scope_by_attempt": scopes, "expected_relation": "rel:H18a-component-H08", "forbidden_conclusions": ["H08 完整策略收益已经验证", "H18a 继承 H08 完整入场假设", "H08/H15a/H18a 可估计独立二因子交互"]},
            {"id": "A2-correction-and-impact", "required": True, "historical_key": ["claim:C02-stop-attribution", 1], "historical_object_sha256": digest(obj[("claim:C02-stop-attribution", 1)]), "historical_text_contains": "a structural stop must sit outside the chosen zone", "current_key": ["claim:C02-stop-attribution", 2], "current_object_sha256": digest(obj[("claim:C02-stop-attribution", 2)]), "current_text_contains": "This segment specifies no ETH long order or numeric stop boundary", "direct_affected_ids": ["attempt:H27a", "diagnostic:D94"], "downstream_affected_ids": ["diagnostic:D95"], "fixed_endpoint_relations": ["rel:D94-uses-C02-v1", "rel:H27a-uses-C02-v1"], "required_boundary": "S46 发生在 H27a/D95 结果之后；只收窄来源解释，不改变原登记或 H27a 原生账户失败。", "additional_negative_or_unknown": {"key": ["attempt:H13b", 1], "state": "source_failed", "scope": obj[("attempt:H13b", 1)]["body"]["scope"], "no_annual_economic_result": True}},
            {"id": "A3-duplicate-source", "required": True, "keys": [["source:S01", 1], ["source:S15", 1]], "relation_id": "rel:S15-duplicate-S01", "media_sha256": "4a9ca56dc11f0dc7168a5d16a19df641913f05b8c7cfc31f6805c352f23ad830", "processing_attempt_count": 2, "independent_media_count": 1, "s15_independent_corroboration": False, "required_boundary": "保留两次处理尝试及登记错误；S15 已在 S01 首次暴露之后，不能把它当第二份独立证据。"},
            {"id": "A4-atomic-rollback", "required": True, "base_snapshot": "current", "operation_id": "validation:atomic-invalid-fk", "copy_real_objects_to_new_revision": [["attempt:H08", 1, 2], ["attempt:H18a", 1, 2], ["attempt:H13b", 1, 2]], "invalid_relation": {"id": "rel:validation-invalid-fk", "kind": "component_reuse", "from_id": "attempt:H18a", "from_revision": 2, "to_id": "attempt:ABSENT", "to_revision": 999, "body": {"text": "故意无效 FK 的验证输入", "scope": "当前验证输入，不是研究关系"}}, "expected": {"explicit_failure": True, "objects_added": 0, "relations_added": 0, "operations_added": 0, "ledger_version_delta": 0, "native_commit_delta": 0, "content_hash_unchanged": True}, "required_evidence": "提交后通过独立连接读回全体对象/关系、version、operation 登记；不是只对客户端验证报错。"},
            {"id": "A5-same-version-race", "required": True, "base_snapshot": "current", "copy_real_objects_by_writer": {"a": ["attempt:H13b", 1, 2], "b": ["attempt:H13", 1, 2]}, "operation_ids": ["validation:race-a", "validation:race-b"], "disjoint_write_requirement": "writer a 仅写 H13b revision 2，writer b 仅写 H13 revision 2，各有不同 operation_id 与对象 ID；唯一共享校验点是 expected global publication version/CAS guard。不能以重复对象 PK/doc ID 约束代替 CAS 证明。", "expected_version": "same global publication version read before either transaction; SQL atomic guard / Terminus DataVersion equivalent", "stale_control": "另做串行旧 head/version 控制：一次成功后，新连接以同一旧 version 提交不同 operation，必须显式拒绝；此控制不能替代并发验收。", "race_modes": ["ordinary simultaneous clients", "intentional delay after version read/validation before mutation"], "delay_requirement": "两客户端各自真实连接；屏障确保均基于相同旧 version 开始，至少一写方故意延迟 >=250ms。校验与最终原子提交属于同事务；如 backend 在序列化点校验则证明第二方看到冲突。", "expected": {"success_count": 1, "explicit_conflict_count": 1, "ledger_version_delta": 1, "operation_rows": 1, "new_object_revisions": 1, "conflict_reason": "expected-version conflict 或原生 transaction version conflict；duplicate-key/doc-id conflict 不算通过"}, "forbidden": "不能仅靠进程内锁/客户端预检；不能把两个 success 合并后称一成功；不能因两个 writer 写同一对象而产生冲突。"},
            {"id": "A6-idempotent-operation", "required": True, "base_snapshot": "current", "operation_id": "validation:lost-response", "copy_real_object_to_new_revision": ["attempt:H13b", 1, 2], "steps": ["首次操作原生提交成功后客户端故意丢弃响应。", "新连接按 operation_id 查询已提交内容 hash、result/version/native commit。", "相同 operation_id 与相同 canonical request 重放，返回同一结果；无新对象/version/commit。", "相同 operation_id 改用 H13@1→@2 的不同 canonical request，显式 operation-content conflict。"], "expected": {"operation_rows": 1, "ledger_version_delta": 1, "new_object_revisions": 1, "native_success_commit_count": 1, "replay_result_identical": True, "different_content_conflict": True}},
            {"id": "A7-native-history-recovery", "required": True, "base_snapshot": "baseline then correction native commits", "branch_requirement": "保留 main 的 correction commit 和 validation-baseline 指向 baseline commit；还创建 validation-review 分支并记录其原生 head。", "working_set_requirement": "backend 有原生未提交工作集时，必须保留一次未提交的真实 H13b revision 2 副本并恢复其 hash；没有此原生状态时 working_set_recovery=not_applicable，仍须完整原生 commit/branch/storage 恢复。不能以 not_applicable 掩盖实际存在但未备份的工作集。", "backup_requirement": "使用 backend 原生仓库/存储格式的完整备份，含所有 commit、分支和实际存在的工作集；逻辑 JSON/CSV dump 只算当前内容导出。记录备份路径、机制和文件 SHA-256。", "restore_requirement": "恢复到事先不存在或全空的新目录/独立实例；读取 backup 后原生 old commit、当前 commit、分支 heads 与所有实际存在的原生工作集，核对对象 ID/revision/hash 及固定端点关系。", "expected_baseline_object_hash": digest(obj[("claim:C02-stop-attribution", 1)]), "expected_current_object_hash": digest(obj[("claim:C02-stop-attribution", 2)]), "expected_baseline_objects_hash": digest(baseline_objects), "expected_baseline_relations_hash": digest(baseline_relations), "expected_current_objects_hash": digest(fixture["objects"]), "expected_current_relations_hash": digest(fixture["relations"]), "required_boundary": "同机空目录恢复只是本机恢复验证；不泛称独立主机灾难恢复。"},
        ],
        "out_of_scope": ["10k 或更大规模性能、通用资料质量、生产权限治理", "正式研究 ledger/HTTP 服务/DSL 或 records 权威迁移", "策略回放、经济改善和独立资格"],
    }


def verify_fixture(fixture: dict) -> None:
    keys = [(o["id"], o["revision"]) for o in fixture["objects"]]
    assert len(keys) == len(set(keys)), "duplicate object revision"
    assert len(fixture["relations"]) == len({r["id"] for r in fixture["relations"]})
    for r in fixture["relations"]:
        assert (r["from_id"], r["from_revision"]) in keys, r
        assert (r["to_id"], r["to_revision"]) in keys, r
    for source in fixture["source_blobs"]:
        assert hashlib.sha256(blob(source["path"], source["git_commit"])).hexdigest() == source["sha256"]
    duplicate = json.loads(blob("research/r1_native/results/2026-10-08-s15-duplicate-source.json"))
    assert duplicate["independent_source_case"] is False
    assert duplicate["media_sha256"] == "4a9ca56dc11f0dc7168a5d16a19df641913f05b8c7cfc31f6805c352f23ad830"
    gate = json.loads(blob("research/r1_native/results/2026-10-08-h13b-source-gate.json"))
    assert gate["passed"] is False and gate["s27_positive_source_gate"] is False


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Read-only check that frozen JSON equals the Git-derived fixture/contract")
    args = parser.parse_args()
    fixture = build_fixture()
    verify_fixture(fixture)
    values = {"fixture.json": fixture, "contract.json": build_contract(fixture)}
    for name, value in values.items():
        path = HERE / name
        content = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
        if args.check:
            assert path.read_text() == content, f"frozen {name} differs; investigate before regenerating"
        else:
            path.write_text(content)
    print(json.dumps({"source_head": SOURCE_HEAD, "objects": len(fixture["objects"]), "relations": len(fixture["relations"]), "fixture_sha256": digest(fixture), "mode": "check" if args.check else "write"}))


if __name__ == "__main__":
    main()
